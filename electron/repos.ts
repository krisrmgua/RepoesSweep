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
    return s;
  }
  s.branch = br;
  const fetchAgeMs = Math.max(60, opts.scanMinutes * 60) * 1000;
  if (opts.forceFetch || (await needsFetch(repo, fetchAgeMs))) {
    await git(repo, "fetch", "--quiet", "--prune", "origin");
  }
  if ((await git(repo, "rev-parse", "--verify", "--quiet", "HEAD"))[0] !== 0) {
    s.error = "empty repo";
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
  const [lrc, locals] = await git(repo, "for-each-ref", "--format=%(refname:short)", "refs/heads/");
  if (lrc === 0) s.cleanupBranches = lines(locals).filter((b) => b !== primary);

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

type FixId = "checkoutPrimaryPull" | "stashPullPop" | "pullRebase";

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
    ],
    summary: "Local changes block pull",
    fix: "stashPullPop",
  },
  {
    needles: [
      "not possible to fast-forward",
      "need to specify how to reconcile",
      "divergent branches",
    ],
    summary: "Local and remote diverged",
    fix: "pullRebase",
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
  let [rc, out] = await git(s.path, "checkout", primary);
  if (rc !== 0 && blockedByLocalChanges(out)) {
    await git(s.path, "stash", "push", "-u", "-m", "Repoes Sweep before checkout primary");
    [rc, out] = await git(s.path, "checkout", primary);
  }
  if (rc !== 0) return `checkout ${primary} failed: ${out.slice(0, 120)}`;
  const err = await pullRaw(s.path);
  return err === null ? null : `pull failed: ${err.slice(0, 120)}`;
}

async function pullRebase(repo: string): Promise<string | null> {
  const [rc, out] = await git(repo, "pull", "--rebase");
  return rc === 0 ? null : (lastLine(out) || "pull --rebase failed").slice(0, 160);
}

/** Stashes local changes (including untracked), pulls, then pops. A conflicting pop leaves them in the stash. */
async function pullStashed(repo: string): Promise<string | null> {
  const dirty = (await git(repo, "status", "--porcelain"))[1].length > 0;
  if (dirty && (await git(repo, "stash", "push", "-u", "-m", "Repoes Sweep auto-stash"))[0] !== 0) {
    return "stash failed";
  }
  const err = await pull(repo);
  if (dirty) {
    const [rc, out] = await git(repo, "stash", "pop");
    if (rc !== 0) {
      return `stash pop needs attention (changes are in git stash): ${out.slice(0, 120)}`;
    }
  }
  return err;
}

/**
 * Pull & Fix: gone upstream -> checkout primary; local changes -> stash, pull, pop;
 * diverged -> pull --rebase. Anything else is reported as-is.
 */
export async function pullAndFix(s: RepoStatus): Promise<string | null> {
  if (s.gone) return checkoutPrimaryPull(s);
  if (s.dirtyCount > 0) return pullStashed(s.path);
  const err = await pullRaw(s.path);
  if (err === null) return null;
  switch (classify(err)) {
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

/**
 * Checks out the primary branch, deletes every other local branch, then pulls.
 * Re-reads heads at clean time so a stale panel list cannot fail on already-gone branches.
 */
export async function clean(s: RepoStatus): Promise<string | null> {
  const primary = s.primary ?? (await primaryBranch(s.path));
  if (!primary) return "no main/master";
  if (await heldByOtherWorktree(s.path, primary)) {
    return `${primary} is checked out in another worktree`;
  }
  let [crc, cout] = await git(s.path, "checkout", primary);
  if (crc !== 0 && blockedByLocalChanges(cout)) {
    await git(s.path, "stash", "push", "-u", "-m", "Repoes Sweep before clean");
    [crc, cout] = await git(s.path, "checkout", primary);
  }
  if (crc !== 0) return `checkout ${primary}: ${cout.slice(0, 120)}`;

  const [lrc, locals] = await git(s.path, "for-each-ref", "--format=%(refname:short)", "refs/heads/");
  const branches = (lrc === 0 ? lines(locals) : s.cleanupBranches).filter(
    (b) => b && b !== primary,
  );

  const failed: string[] = [];
  for (const b of branches) {
    if (await heldByOtherWorktree(s.path, b)) {
      failed.push(`${b} (other worktree)`);
      continue;
    }
    const [rc, out] = await git(s.path, "branch", "-D", "--", b);
    if (rc === 0) continue;
    const low = out.toLowerCase();
    if (low.includes("not found") || low.includes("doesn't exist") || low.includes("does not exist")) {
      continue;
    }
    failed.push(`${b}: ${firstLine(out).slice(0, 80)}`);
  }
  await git(s.path, "pull", "--ff-only");
  return failed.length ? `couldn't delete: ${failed.join("; ")}` : null;
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
