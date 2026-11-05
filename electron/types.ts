export interface RemoteBranch {
  name: string;
  /** Reachable from origin/<primary>. */
  merged: boolean;
  /** Tip author email matches this clone's user.email. */
  mine: boolean;
  /** Open GitLab MR you authored with this source branch (via glab). */
  hasOpenMR: boolean;
}

/** One clone's state as the panel needs it. */
export interface RepoStatus {
  /** Path relative to the repo root, always with `/` separators. */
  name: string;
  path: string;
  branch: string;
  behind: number;
  primary?: string;
  /** Local branches other than primary. */
  cleanupBranches: string[];
  /** Local branches retained because a worktree is using them. */
  protectedCleanupBranches?: string[];
  /** Primary belongs to another worktree; local cleanup must not switch or pull it here. */
  cleanupPrimaryElsewhere?: boolean;
  /** origin/* except HEAD and primary. */
  remoteBranches: RemoteBranch[];
  dirtyCount: number;
  /** Upstream branch was deleted on the remote. */
  gone: boolean;
  /** No commits exist yet; not an actionable scan error. */
  empty?: boolean;
  error?: string;
}

export interface Prefs {
  greenForPassing: boolean;
  showRemoteBranches: boolean;
  showOnlyMyRemoteBranches: boolean;
  /** Dark rounded backdrop behind the menu-bar mark, as on the other apps. */
  darkBarBackground: boolean;
  scanMinutes: number;
  openAtLogin: boolean;
}

export const SCAN_CHOICES = [5, 10, 15, 20, 30, 60, 240, 480, 720, 1440];

export type DeleteScope = "all" | "merged" | "withoutMR";

export interface RemoteDeleteItem {
  repo: string;
  path: string;
  primary?: string;
  branches: string[];
}

export interface RemoteDeleteRequest {
  items: RemoteDeleteItem[];
  /** Cross-repo scope, or null for a single-repo delete. */
  scope: DeleteScope | null;
}

export interface PanelState {
  repos: RepoStatus[];
  prefs: Prefs;
  scanning: boolean;
  updated: string | null;
  /** Live job line, e.g. "Pull foo · 2 of 5 · 3 left". */
  activity: string | null;
  result: string | null;
  root: string;
  platform: string;
  /** From package.json via Electron app.getVersion(). */
  version: string;
  /** Header mark as a data URL (white wings, diamond tinted by state). */
  mark: string | null;
}
