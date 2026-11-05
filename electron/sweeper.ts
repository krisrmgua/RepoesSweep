import os from "node:os";
import {
  authoredOpenMRBranches,
  clean,
  deleteRemotes,
  discover,
  pull,
  pullAndFix,
  repoRoot,
  scan,
} from "./repos";
import type { PrefsStore } from "./prefs";
import type { RemoteDeleteRequest, RepoStatus } from "./types";

type Job = () => Promise<string | null>;

const SCAN_CONCURRENCY = Math.max(2, Math.min(8, os.cpus().length));

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export function listedRemoteBranches(repo: RepoStatus, onlyMine: boolean) {
  return onlyMine ? repo.remoteBranches.filter((b) => b.mine) : repo.remoteBranches;
}

/** Remote branches do not block green; only out of date and cleanup do. */
export function isClean(repos: RepoStatus[], updated: Date | null): boolean {
  if (!updated) return false;
  return !repos.some((r) => r.behind > 0 || r.gone || r.cleanupBranches.length > 0);
}

/**
 * Owns the scan loop and the git job queue. Jobs run one at a time so pulls,
 * cleans, and deletes never overlap. A repo leaves the list as soon as its job
 * succeeds. When the queue drains, a rescan confirms the result.
 */
export class Sweeper {
  repos: RepoStatus[] = [];
  lastScan: Date | null = null;
  scanning = false;
  root = repoRoot();
  result: string | null = null;

  private refreshWhenIdle = false;
  private queue: { id: number; label: string; job: Job }[] = [];
  private pending: { id: number; label: string }[] = [];
  private running = false;
  private seq = 0;
  private batchTotal = 0;
  private batchCompleted = 0;
  private listeners = new Set<() => void>();

  constructor(private prefs: PrefsStore) {}

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  repo(path: string): RepoStatus | undefined {
    return this.repos.find((r) => r.path === path);
  }

  async refresh(forceFetch = true): Promise<void> {
    if (this.scanning) {
      this.refreshWhenIdle = true;
      return;
    }
    this.scanning = true;
    this.emit();
    try {
      const prefs = this.prefs.get();
      const root = repoRoot();
      const paths = await discover(root);
      const openMRsByProject = prefs.showRemoteBranches
        ? await authoredOpenMRBranches()
        : new Map<string, Set<string>>();
      this.repos = await mapLimit(paths, SCAN_CONCURRENCY, (p) =>
        scan(p, root, {
          forceFetch,
          scanMinutes: prefs.scanMinutes,
          showRemoteBranches: prefs.showRemoteBranches,
          openMRsByProject,
        }),
      );
      this.root = root;
      this.lastScan = new Date();
    } catch (err) {
      this.result = `Scan failed: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      this.scanning = false;
      this.emit();
    }
    if (this.refreshWhenIdle) {
      this.refreshWhenIdle = false;
      void this.refresh(true);
    }
  }

  enqueue(label: string, job: Job): void {
    if (this.pending.length === 0) {
      this.batchTotal = 0;
      this.batchCompleted = 0;
    }
    const id = ++this.seq;
    this.pending.push({ id, label });
    this.queue.push({ id, label, job });
    this.batchTotal += 1;
    this.emit();
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    while (this.queue.length) {
      const next = this.queue.shift()!;
      let err: string | null;
      try {
        err = await next.job();
      } catch (e) {
        err = e instanceof Error ? e.message : String(e);
      }
      this.pending = this.pending.filter((p) => p.id !== next.id);
      this.batchCompleted += 1;
      this.result = err ? `Failed: ${next.label} · ${err}` : `Done: ${next.label}`;
      this.emit();
      if (this.pending.length === 0) void this.refresh(true);
    }
    this.running = false;
  }

  activity(): string | null {
    const current = this.pending[0];
    if (!current) return null;
    if (this.batchTotal <= 1) return current.label;
    const step = Math.min(this.batchCompleted + 1, this.batchTotal);
    const left = this.pending.length - 1;
    return left > 0
      ? `${current.label} · ${step} of ${this.batchTotal} · ${left} left`
      : `${current.label} · ${step} of ${this.batchTotal}`;
  }

  pull(paths: string[]): void {
    for (const repo of this.lookup(paths)) {
      this.enqueue(`Pull ${repo.name}`, async () => {
        const err = await pull(repo.path);
        if (!err) this.markPulled(repo);
        return err;
      });
    }
  }

  pullFix(paths: string[]): void {
    for (const repo of this.lookup(paths)) {
      this.enqueue(`Pull & Fix ${repo.name}`, async () => {
        const err = await pullAndFix(repo);
        if (!err) this.markPulled(repo);
        return err;
      });
    }
  }

  clean(paths: string[]): void {
    for (const repo of this.lookup(paths)) {
      this.enqueue(`Clean ${repo.name}`, async () => {
        const err = await clean(repo);
        if (!err) this.markCleaned(repo);
        return err;
      });
    }
  }

  /**
   * Only branches the last scan listed for that repo are deleted, so the renderer
   * cannot name an arbitrary ref or the primary branch.
   */
  deleteRemote(request: RemoteDeleteRequest): void {
    const items = request.items
      .map((item) => {
        const repo = this.repo(item.path);
        if (!repo) return null;
        const known = new Set(repo.remoteBranches.map((b) => b.name));
        const branches = item.branches.filter((b) => known.has(b) && b !== repo.primary);
        return branches.length ? { repo, branches } : null;
      })
      .filter((x): x is { repo: RepoStatus; branches: string[] } => x !== null);
    if (!items.length) return;

    for (const { repo, branches } of items) {
      for (const branch of branches) {
        this.enqueue(`Delete origin/${branch}`, async () => {
          const err = await deleteRemotes(repo.path, [branch], repo.primary);
          if (!err) this.markRemoteDeleted(repo, branch);
          return err ? `${repo.name}: ${err}` : null;
        });
      }
    }
  }

  /** Pull succeeded, so this clone is no longer an update. */
  private markPulled(repo: RepoStatus): void {
    repo.behind = 0;
    repo.gone = false;
  }

  /** Clean succeeded. A pull ran too, unless the primary lives in another worktree. */
  private markCleaned(repo: RepoStatus): void {
    repo.cleanupBranches = [];
    if (!repo.cleanupPrimaryElsewhere) this.markPulled(repo);
  }

  /** One remote branch delete succeeded. */
  private markRemoteDeleted(repo: RepoStatus, branch: string): void {
    repo.remoteBranches = repo.remoteBranches.filter((item) => item.name !== branch);
  }

  private lookup(paths: string[]): RepoStatus[] {
    return paths
      .map((p) => this.repo(p))
      .filter((r): r is RepoStatus => r !== undefined);
  }
}
