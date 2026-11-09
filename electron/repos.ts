import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { glabGraphQL, run } from "./shell";
import type { RemoteBranch, RepoStatus } from "./types";

/** Repo root: $MYGIT_REPO_ROOT | $REPOS_TOOLBELT_ROOT, else ~/.config/mygit/repo-root, else ~/git-repos. */
export function repoRoot(): string {
  const env = process.env.MYGIT_REPO_ROOT || process.env.REPOS_TOOLBELT_ROOT;
  if (env) return env;
  try {
    const cfg = path.join(os.homedir(), ".config", "mygit", "repo-root");
    const line = fs.readFileSync(cfg, "utf8").split(/\r?\n/)[0]?.trim() ?? "";
    const expanded = line.startsWith("~")
      ? path.join(os.homedir(), line.slice(1))
      : line;
    if (expanded && fs.existsSync(expanded)) return expanded;
  } catch {
    // no config file
  }
  return path.join(os.homedir(), "git-repos");
}

function skipDir(name: string): boolean {
  return name === ".git" || name === "node_modules" || name.startsWith(".terraform");
}

/** Every folder under root with a `.git` entry. Does not descend into a clone once found. */
export async function discover(root: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || skipDir(e.name)) continue;
      const full = path.join(dir, e.name);
      if (fs.existsSync(path.join(full, ".git"))) {
        found.push(full);
        continue;
      }
      await walk(full);
    }
  }
  await walk(root);
  return found.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}

export async function git(
  repo: string,
  ...args: string[]
): Promise<[number, string]> {
  const r = await run("git", ["-C", repo, ...args], { mergeStderr: true });
  return [r.status, r.out.trim()];
}

function lines(text: string): string[] {
  return text.split(/\r?\n/).filter((l) => l.length > 0);
}

/** Skip expensive `git cherry` when the branch is huge vs upstream. */
const SQUASH_CHERRY_MAX_COMMITS = 40;

/**
 * Local cleanup only: true when `ref` still has commits not in `upstream`
 * ancestry, but every one already landed as a *different* SHA on upstream
 * (`git cherry` all `-`). Empty / huge ranges are not treated as squash-merged.
 */
async function isSquashLandedOnUpstream(
  repo: string,
  upstream: string,
  ref: string,
): Promise<boolean> {
  // Cheap gate: cherry walks history; bail if nothing unique or too many commits.
  const [lrc, lout] = await git(
    repo,
    "rev-list",
    `--max-count=${SQUASH_CHERRY_MAX_COMMITS + 1}`,
    `${upstream}..${ref}`,
  );
  if (lrc !== 0) return false;
  const unique = lines(lout);
  if (unique.length === 0 || unique.length > SQUASH_CHERRY_MAX_COMMITS) return false;

  const [rc, out] = await git(repo, "cherry", upstream, ref);
  if (rc !== 0) return false;
  const rows = lines(out);
  if (rows.length === 0) return false;
  return rows.every((line) => line.startsWith("-"));
}

export async function primaryBranch(repo: string): Promise<string | undefined> {
  const [rc, head] = await git(
    repo,
    "symbolic-ref",
    "--quiet",
    "--short",
    "refs/remotes/origin/HEAD",
  );
  if (rc === 0 && head.startsWith("origin/")) return head.slice("origin/".length);
  for (const name of ["main", "master"]) {
    if ((await git(repo, "show-ref", "--verify", "--quiet", `refs/heads/${name}`))[0] === 0) {
      return name;
    }
    if (
      (await git(repo, "show-ref", "--verify", "--quiet", `refs/remotes/origin/${name}`))[0] === 0
    ) {
      return name;
    }
  }
  return undefined;
}

/** One GraphQL call: open MRs you authored, keyed by lowercased project fullPath. */
export async function authoredOpenMRBranches(): Promise<Map<string, Set<string>>> {
  const query =
    "query{currentUser{authoredMergeRequests(state:opened,first:100,sort:UPDATED_DESC){nodes{sourceBranch project{fullPath}}}}}";
  const map = new Map<string, Set<string>>();
  const data = await glabGraphQL(query);
  const nodes = (
    data as {
      currentUser?: {
        authoredMergeRequests?: {
          nodes?: { sourceBranch?: string; project?: { fullPath?: string } }[];
        };
      };
    } | null
  )?.currentUser?.authoredMergeRequests?.nodes;
  if (!Array.isArray(nodes)) return map;
  for (const node of nodes) {
    const branch = node.sourceBranch;
    const full = node.project?.fullPath;
    if (!branch || !full) continue;
    const key = full.toLowerCase();
    if (!map.has(key)) map.set(key, new Set());
    map.get(key)!.add(branch);
  }
  return map;
}

/** GitLab project path from an origin URL, or undefined for non-GitLab remotes. */
export function gitlabFullPath(originUrl: string): string | undefined {
  let s = originUrl.trim();
  if (s.endsWith(".git")) s = s.slice(0, -4);
  const low = s.toLowerCase();
  for (const marker of ["gitlab.com:", "gitlab.com/"]) {
    const i = low.indexOf(marker);
    if (i >= 0) return low.slice(i + marker.length);
  }
  return undefined;
}

/** True when FETCH_HEAD is missing or older than `maxAgeMs` (timer scans can skip fetch). */
async function needsFetch(repo: string, maxAgeMs: number): Promise<boolean> {
  const [rc, rel] = await git(repo, "rev-parse", "--git-path", "FETCH_HEAD");
  if (rc !== 0 || !rel) return true;
  const file = path.isAbsolute(rel) ? rel : path.join(repo, rel);
  try {
    const st = await fsp.stat(file);
    return Date.now() - st.mtimeMs >= maxAgeMs;
  } catch {
    return true;
  }
}

function relName(repo: string, root: string): string {
  const rel = path.relative(root, repo);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return repo;
  return rel.split(path.sep).join("/");
}

export interface ScanOptions {
  forceFetch: boolean;
  scanMinutes: number;
  showRemoteBranches: boolean;
  openMRsByProject: Map<string, Set<string>>;
}

/** Fetches origin when needed and collects everything the panel shows. */
export async function scan(
  repo: string,
  root: string,
  opts: ScanOptions,
): Promise<RepoStatus> {
  const s: RepoStatus = {
    name: relName(repo, root),
    path: repo,
    branch: "",
    behind: 0,
    cleanupBranches: [],
    remoteBranches: [],
    dirtyCount: 0,
    gone: false,
  };
  const [rc, br] = await git(repo, "symbolic-ref", "--quiet", "--short", "HEAD");
  if (rc !== 0 || !br) {
    s.error = "detached HEAD";
    s.linkedWorktree = await isLinkedWorktree(repo);
    s.primary = await primaryBranch(repo);
    return s;
  }
  s.branch = br;
  const fetchAgeMs = Math.max(60, opts.scanMinutes * 60) * 1000;
  if (opts.forceFetch || (await needsFetch(repo, fetchAgeMs))) {
    await git(repo, "fetch", "--quiet", "--prune", "origin");
  }
  if ((await git(repo, "rev-parse", "--verify", "--quiet", "HEAD"))[0] !== 0) {
    const [historyRc, history] = await git(repo, "rev-list", "--all", "--max-count=1");
    if (historyRc === 0 && !history) s.empty = true;
    else s.error = "Could not read HEAD";
    return s;
  }

  const [crc, counts] = await git(
    repo,
    "rev-list",
    "--left-right",
    "--count",
    "HEAD...@{upstream}",
  );
  if (crc === 0) {
    const parts = counts.split(/[\t ]+/);
    if (parts.length >= 2) s.behind = parseInt(parts[1], 10) || 0;
  }
  const [src, status] = await git(repo, "status", "--porcelain", "-b");
  if (src === 0) {
    const rows = status.split(/\r?\n/);
    s.gone = rows[0]?.includes("[gone]") ?? false;
    s.dirtyCount = Math.max(0, rows.length - 1);
  }

  const primary = await primaryBranch(repo);
  if (!primary) return s;
  s.primary = primary;
  const plan = await cleanupPlan(repo, primary);
  if (plan) {
    s.cleanupBranches = plan.candidates;
    s.cleanupMerged = plan.merged;
    s.protectedCleanupBranches = plan.protected;
    s.cleanupPrimaryElsewhere = plan.primaryElsewhere;
  } else s.error = "Could not inspect local branch worktrees";

  let openMRs = new Set<string>();
  if (opts.showRemoteBranches) {
    const url = (await git(repo, "remote", "get-url", "origin"))[1];
    const full = url ? gitlabFullPath(url) : undefined;
    if (full) openMRs = opts.openMRsByProject.get(full) ?? new Set();
  }
  s.remoteBranches = await remoteBranches(repo, primary, openMRs);
  return s;
}

/** Strips `<>` and lowercases so `user.email` matches `%(authoremail)`. */
function normalizeEmail(raw: string): string {
  return raw.replace(/^[\s<]+|[\s>]+$/g, "").toLowerCase();
}

async function remoteBranches(
  repo: string,
  primary: string,
  openMRs: Set<string>,
): Promise<RemoteBranch[]> {
  const me = normalizeEmail((await git(repo, "config", "user.email"))[1]);
  const [rc, out] = await git(
    repo,
    "for-each-ref",
    "--format=%(refname)%09%(symref)%09%(authoremail)",
    "refs/remotes/origin/",
  );
  if (rc !== 0) return [];
  const [mrc, mout] = await git(
    repo,
    "for-each-ref",
    `--merged=refs/remotes/origin/${primary}`,
    "--format=%(refname)",
    "refs/remotes/origin/",
  );
  const merged = new Set(mrc === 0 ? lines(mout) : []);
  const prefix = "refs/remotes/origin/";
  const result: RemoteBranch[] = [];
  for (const line of lines(out)) {
    const parts = line.split("\t");
    const ref = parts[0];
    if (parts.length > 1 && parts[1]) continue; // origin/HEAD symbolic ref
    if (ref === prefix + primary || !ref.startsWith(prefix)) continue;
    const author = parts.length > 2 ? normalizeEmail(parts[2]) : "";
    const name = ref.slice(prefix.length);
    // Ancestry only for remotes — squash cherry per origin/* ref made scans crawl.
    result.push({
      name,
      merged: merged.has(ref),
      mine: !!me && !!author && me === author,
      hasOpenMR: openMRs.has(name),
    });
  }
  return result.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}

function firstLine(text: string): string {
  return text.split(/\r?\n/)[0] ?? text;
}

function lastLine(text: string): string {
  const rows = text.split(/\r?\n/).filter(Boolean);
  return rows[rows.length - 1] ?? text;
}

/** `git pull --ff-only`, then a plain pull if that is rejected. Null on success. */
async function pullRaw(repo: string): Promise<string | null> {
  if ((await git(repo, "pull", "--ff-only"))[0] === 0) return null;
  const [rc, out] = await git(repo, "pull");
  return rc === 0 ? null : out || "pull failed";
}

export async function pull(repo: string): Promise<string | null> {
  const err = await pullRaw(repo);
  return err === null ? null : err.slice(0, 160);
}

type FixId = "checkoutPrimaryPull" | "stashPullPop" | "pullRebase" | "clearBlockers";

const FAILURE_PATTERNS: { needles: string[]; summary: string; fix: FixId | null }[] = [
  {
    needles: ["no such ref was fetched", "specifies to merge with the ref"],
    summary: "Remote branch is gone",
    fix: "checkoutPrimaryPull",
  },
  {
    needles: [
      "would be overwritten by merge",
      "please commit your changes or stash",
      "local changes to the following files",
      "your local changes to the following files would be overwritten",
      "untracked working tree files would be overwritten",
    ],
    summary: "Local changes block pull",
    fix: "stashPullPop",
  },
  {
    needles: [
      "not possible to fast-forward",
      "need to specify how to reconcile",
      "divergent branches",
      "cannot fast-forward",
    ],
    summary: "Local and remote diverged",
    fix: "pullRebase",
  },
  {
    needles: [
      "needs merge",
      "unmerged paths",
      "you need to resolve your current index first",
      "fix conflicts",
      "merge conflict",
      "unmerged files",
      "you are in the middle of a merge",
      "rebase in progress",
      "you must edit all merge conflicts",
      "could not write index",
    ],
    summary: "Unresolved merge / rebase",
    fix: "clearBlockers",
  },
  {
    needles: ["permission denied", "authentication failed", "could not read from remote", "publickey"],
    summary: "Git auth / SSH failed",
    fix: null,
  },
  { needles: ["not a git repository", "not a repo"], summary: "Not a git repo", fix: null },
];

function classify(text: string): FixId | null | undefined {
  const low = text.toLowerCase();
  for (const p of FAILURE_PATTERNS) {
    if (p.needles.some((n) => low.includes(n))) return p.fix;
  }
  return undefined;
}

async function gitPathExists(repo: string, name: string): Promise<boolean> {
  const [rc, p] = await git(repo, "rev-parse", "--git-path", name);
  if (rc !== 0 || !p) return false;
  const abs = path.isAbsolute(p) ? p : path.join(repo, p);
  try {
    await fsp.access(abs);
    return true;
  } catch {
    return false;
  }
}

async function hasUnmergedPaths(repo: string): Promise<boolean> {
  const [rc, out] = await git(repo, "ls-files", "-u");
  return rc === 0 && out.length > 0;
}

/**
 * Clears unfinished merge/rebase/cherry-pick/revert (and leftover unmerged
 * index entries) so stash and pull can run. Preserves ordinary dirty files
 * when git can (`merge --abort` / `reset --merge`).
 */
export async function clearIndexBlockers(repo: string): Promise<string | null> {
  const steps: { when: () => Promise<boolean>; args: string[]; label: string }[] = [
    {
      when: async () => gitPathExists(repo, "CHERRY_PICK_HEAD"),
      args: ["cherry-pick", "--abort"],
      label: "cherry-pick --abort",
    },
    {
      when: async () => gitPathExists(repo, "REVERT_HEAD"),
      args: ["revert", "--abort"],
      label: "revert --abort",
    },
    {
      when: async () =>
        (await gitPathExists(repo, "rebase-merge")) ||
        (await gitPathExists(repo, "rebase-apply")) ||
        (await gitPathExists(repo, "REBASE_HEAD")),
      args: ["rebase", "--abort"],
      label: "rebase --abort",
    },
    {
      when: async () =>
        (await gitPathExists(repo, "MERGE_HEAD")) || (await gitPathExists(repo, "MERGE_MODE")),
      args: ["merge", "--abort"],
      label: "merge --abort",
    },
  ];

  for (const step of steps) {
    if (!(await step.when())) continue;
    const [rc, out] = await git(repo, ...step.args);
    if (rc !== 0) {
      const low = out.toLowerCase();
      if (!low.includes("no ") && !low.includes("not currently")) {
        return `${step.label} failed: ${out.slice(0, 120)}`;
      }
    }
  }

  // Stuck UU index without MERGE_HEAD (e.g. AUTO_MERGE left behind).
  if (await hasUnmergedPaths(repo)) {
    const [rc, out] = await git(repo, "reset", "--merge");
    if (rc !== 0) {
      return `reset --merge failed: ${out.slice(0, 120)}`;
    }
  }

  if (await hasUnmergedPaths(repo)) {
    return "still has unmerged paths after abort";
  }
  return null;
}

/**
 * Stash push that treats "nothing to save" as success and surfaces real errors.
 * Returns null on success (including empty), or an error string.
 */
async function stashPush(
  repo: string,
  message: string,
): Promise<{ error: string | null; stashed: boolean }> {
  const tryPush = async (withUntracked: boolean): Promise<[number, string]> =>
    withUntracked
      ? git(repo, "stash", "push", "-u", "-m", message)
      : git(repo, "stash", "push", "-m", message);

  let [rc, out] = await tryPush(true);
  if (rc === 0) return { error: null, stashed: true };
  let low = out.toLowerCase();
  if (low.includes("no local changes")) return { error: null, stashed: false };

  if (
    low.includes("needs merge") ||
    low.includes("unmerged") ||
    low.includes("could not write index")
  ) {
    const cleared = await clearIndexBlockers(repo);
    if (cleared) return { error: cleared, stashed: false };
    [rc, out] = await tryPush(true);
    if (rc === 0) return { error: null, stashed: true };
    low = out.toLowerCase();
    if (low.includes("no local changes")) return { error: null, stashed: false };
  }

  // Tracked-only fallback when -u fails (e.g. stubborn untracked).
  [rc, out] = await tryPush(false);
  if (rc === 0) return { error: null, stashed: true };
  if (out.toLowerCase().includes("no local changes")) {
    return { error: null, stashed: false };
  }
  return {
    error: `stash failed: ${(lastLine(out) || out).slice(0, 140)}`,
    stashed: false,
  };
}

function realpathSafe(p: string): string {
  let resolved = path.resolve(p);
  try {
    resolved = fs.realpathSync.native(resolved);
  } catch {
    // keep resolved
  }
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

async function heldByOtherWorktree(repo: string, branch: string): Promise<boolean> {
  const [rc, out] = await git(repo, "for-each-ref", "--format=%(worktreepath)", `refs/heads/${branch}`);
  if (rc !== 0) return false;
  const wt = out.trim();
  if (!wt) return false;
  return realpathSafe(wt) !== realpathSafe(repo);
}

/** Branch ownership is shared by all linked worktrees. Never move another worktree. */
async function cleanupPlan(repo: string, primary: string): Promise<{
  candidates: string[]; merged: string[]; protected: string[]; primaryElsewhere: boolean;
} | null> {
  const [rc, out] = await git(repo, "for-each-ref", "--format=%(refname:short)%09%(worktreepath)", "refs/heads/");
  if (rc !== 0) return null;
  // Local branches already reachable from origin/<primary>, so they are safe to drop.
  const [mrc, mout] = await git(
    repo,
    "for-each-ref",
    `--merged=refs/remotes/origin/${primary}`,
    "--format=%(refname:short)",
    "refs/heads/",
  );
  const mergedSet = new Set(mrc === 0 ? lines(mout) : []);
  const upstream = `origin/${primary}`;
  const heads = lines(out).map((line) => {
    const tab = line.indexOf("\t");
    return { name: tab < 0 ? line : line.slice(0, tab), worktree: tab < 0 ? "" : line.slice(tab + 1) };
  });
  const here = realpathSafe(repo);
  const owner = heads.find((head) => head.name === primary)?.worktree;
  const primaryElsewhere = Boolean(owner && realpathSafe(owner) !== here);
  const candidates: string[] = [];
  const protectedBranches: string[] = [];
  for (const head of heads) {
    if (head.name === primary) continue;
    // The current non-primary branch can be cleaned after switching to primary,
    // but only if primary is available in this worktree.
    if (head.worktree && (realpathSafe(head.worktree) !== here || primaryElsewhere)) {
      protectedBranches.push(head.name);
    } else {
      candidates.push(head.name);
    }
  }
  const ancestryMerged = candidates.filter((name) => mergedSet.has(name));
  const maybeSquash = candidates.filter((name) => !mergedSet.has(name));
  const squashFlags = await Promise.all(
    maybeSquash.map((name) => isSquashLandedOnUpstream(repo, upstream, name)),
  );
  const merged = [
    ...ancestryMerged,
    ...maybeSquash.filter((_, i) => squashFlags[i]),
  ];
  return {
    candidates,
    merged,
    protected: protectedBranches,
    primaryElsewhere,
  };
}

function blockedByLocalChanges(out: string): boolean {
  const low = out.toLowerCase();
  return ["overwritten", "local changes", "uncommitted", "stash"].some((n) => low.includes(n));
}

/** Checks out the primary branch (stashing local edits if needed) and pulls. */
async function checkoutPrimaryPull(s: RepoStatus): Promise<string | null> {
  const primary = s.primary ?? (await primaryBranch(s.path));
  if (!primary) return "no main/master to check out";
  if (await heldByOtherWorktree(s.path, primary)) {
    return `${primary} is checked out in another worktree; pull it there`;
  }
  const blocked = await clearIndexBlockers(s.path);
  if (blocked) return blocked;
  let [rc, out] = await git(s.path, "checkout", primary);
  if (rc !== 0 && blockedByLocalChanges(out)) {
    const { error: stashErr } = await stashPush(
      s.path,
      "Repoes Sweep before checkout primary",
    );
    if (stashErr) return stashErr;
    [rc, out] = await git(s.path, "checkout", primary);
  }
  if (rc !== 0) return `checkout ${primary} failed: ${out.slice(0, 120)}`;
  const err = await pullRaw(s.path);
  return err === null ? null : `pull failed: ${err.slice(0, 120)}`;
}

async function pullRebase(repo: string): Promise<string | null> {
  const blocked = await clearIndexBlockers(repo);
  if (blocked) return blocked;
  const [rc, out] = await git(repo, "pull", "--rebase");
  return rc === 0 ? null : (lastLine(out) || "pull --rebase failed").slice(0, 160);
}

/** Stashes local changes (including untracked), pulls, then pops. A conflicting pop leaves them in the stash. */
async function pullStashed(repo: string): Promise<string | null> {
  const blocked = await clearIndexBlockers(repo);
  if (blocked) return blocked;
  const dirty = (await git(repo, "status", "--porcelain"))[1].length > 0;
  let didStash = false;
  if (dirty) {
    const { error: stashErr, stashed } = await stashPush(repo, "Repoes Sweep auto-stash");
    if (stashErr) return stashErr;
    didStash = stashed;
  }
  const err = await pull(repo);
  if (didStash) {
    const [rc, out] = await git(repo, "stash", "pop");
    if (rc !== 0) {
      return `stash pop needs attention (changes are in git stash): ${out.slice(0, 120)}`;
    }
  }
  return err;
}

/**
 * Pull & Fix: clear unfinished merge/rebase, then gone upstream -> primary;
 * local changes -> stash/pull/pop; diverged -> rebase. Retries a few times
 * when git's error text maps to a known fix.
 */
export async function pullAndFix(s: RepoStatus): Promise<string | null> {
  const cleared = await clearIndexBlockers(s.path);
  if (cleared) return cleared;

  if (s.gone) return checkoutPrimaryPull(s);

  const dirtyNow = (await git(s.path, "status", "--porcelain"))[1].length > 0;
  if (dirtyNow || s.dirtyCount > 0) return pullStashed(s.path);

  let err = await pullRaw(s.path);
  for (let attempt = 0; attempt < 3 && err; attempt++) {
    switch (classify(err)) {
      case "clearBlockers": {
        const c = await clearIndexBlockers(s.path);
        if (c) return c;
        err = await pullRaw(s.path);
        continue;
      }
      case "stashPullPop":
        return pullStashed(s.path);
      case "pullRebase":
        return pullRebase(s.path);
      case "checkoutPrimaryPull":
        return checkoutPrimaryPull(s);
      default:
        return (lastLine(err) || "pull failed").slice(0, 160);
    }
  }
  return err === null ? null : (lastLine(err) || "pull failed").slice(0, 160);
}

/** Absolute git dir, or null when rev-parse fails. */
async function gitPath(repo: string, kind: "--git-dir" | "--git-common-dir"): Promise<string | null> {
  const [rc, out] = await git(repo, "rev-parse", kind);
  if (rc !== 0 || !out) return null;
  return realpathSafe(path.isAbsolute(out) ? out : path.resolve(repo, out));
}

/** True when this checkout is a linked worktree rather than the main working tree. */
async function isLinkedWorktree(repo: string): Promise<boolean> {
  const gitDir = await gitPath(repo, "--git-dir");
  const common = await gitPath(repo, "--git-common-dir");
  return Boolean(gitDir && common && gitDir !== common);
}

/** Main checkout that owns a linked worktree, from the shared git directory. */
async function mainWorktreePath(repo: string): Promise<string | null> {
  const common = await gitPath(repo, "--git-common-dir");
  return common ? path.dirname(common) : null;
}

/**
 * Detached HEAD has no branch cleanup list. A linked worktree is removed.
 * A normal checkout is switched onto its primary branch and pulled.
 * Removal refuses a dirty or locked worktree instead of forcing it.
 */
async function cleanDetached(s: RepoStatus): Promise<string | null> {
  if (await isLinkedWorktree(s.path)) {
    const main = await mainWorktreePath(s.path);
    if (!main || realpathSafe(main) === realpathSafe(s.path)) return "refusing to remove the main checkout";
    const [rc, out] = await git(main, "worktree", "remove", s.path);
    return rc === 0 ? null : (firstLine(out) || "worktree remove failed").slice(0, 160);
  }
  const primary = s.primary ?? (await primaryBranch(s.path));
  if (!primary) return "no main/master to check out";
  s.primary = primary;
  return checkoutPrimaryPull(s);
}

/** Deletes confirmed unused branches, retaining every branch owned by another worktree. */
export async function clean(s: RepoStatus): Promise<string | null> {
  if (s.error === "detached HEAD") return cleanDetached(s);
  const primary = s.primary ?? (await primaryBranch(s.path));
  if (!primary) return "no main/master";
  let plan = await cleanupPlan(s.path, primary);
  if (!plan) return "could not inspect local branch worktrees";
  const confirmed = new Set(s.cleanupBranches);
  // A queued request may become stale after another worktree cleans shared refs.
  if (!plan.candidates.some(branch => confirmed.has(branch))) return null;

  const usingPrimaryHere = !plan.primaryElsewhere;
  if (usingPrimaryHere) {
    const blocked = await clearIndexBlockers(s.path);
    if (blocked) return blocked;
    let [rc, out] = await git(s.path, "checkout", primary);
    if (rc !== 0 && blockedByLocalChanges(out)) {
      const {error} = await stashPush(s.path, "Repoes Sweep before clean");
      if (error) return error;
      [rc, out] = await git(s.path, "checkout", primary);
    }
    if (rc !== 0) return `checkout ${primary}: ${out.slice(0,120)}`;
  }
  // Refresh ownership after checkout; never expand the user's confirmed branch list.
  plan = await cleanupPlan(s.path, primary);
  if (!plan) return "could not recheck local branch worktrees";
  const failed: string[] = [];
  for (const branch of plan.candidates.filter(branch => confirmed.has(branch))) {
    const [rc,out] = await git(s.path, "branch", "-D", "--", branch);
    if (rc === 0) continue;
    const low = out.toLowerCase();
    // A concurrent worktree may claim or remove the ref after the ownership check.
    if (["not found", "doesn't exist", "does not exist", "used by worktree", "checked out at"].some(text => low.includes(text))) continue;
    failed.push(`${branch}: ${firstLine(out).slice(0,80)}`);
  }
  // In a linked worktree, stay on its current branch and leave the primary owner alone.
  if (usingPrimaryHere) {
    const [rc,out] = await git(s.path, "pull", "--ff-only");
    if (rc !== 0) failed.push(`pull failed: ${lastLine(out).slice(0,120)}`);
  }
  return failed.length ? failed.join("; ") : null;
}

/** Deletes origin/<branch> on the remote. Refuses the primary branch and names not on origin. */
async function deleteRemote(
  repo: string,
  branch: string,
  primary: string | undefined,
): Promise<string | null> {
  if (branch === primary || branch.startsWith("-")) return `refused: ${branch}`;
  if ((await git(repo, "show-ref", "--verify", "--quiet", `refs/remotes/origin/${branch}`))[0] !== 0) {
    return `origin/${branch} not found`;
  }
  const [rc, out] = await git(repo, "push", "origin", "--delete", branch);
  return rc === 0 ? null : out.slice(0, 160);
}

export async function deleteRemotes(
  repo: string,
  branches: string[],
  primary: string | undefined,
): Promise<string | null> {
  const failed: string[] = [];
  for (const branch of branches) {
    const err = await deleteRemote(repo, branch, primary);
    if (err) failed.push(`${branch}: ${err}`);
  }
  return failed.length ? failed.join("; ").slice(0, 160) : null;
}
