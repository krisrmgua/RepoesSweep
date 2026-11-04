import repoIcon from "@primer/octicons/build/svg/repo-16.svg?raw";
import checkIcon from "@primer/octicons/build/svg/check-circle-fill-16.svg?raw";
import alertIcon from "@primer/octicons/build/svg/alert-fill-16.svg?raw";
import type {
  DeleteScope,
  PanelState,
  Prefs,
  RemoteBranch,
  RemoteDeleteItem,
  RemoteDeleteRequest,
  RepoStatus,
} from "../../electron/types";

declare global {
  interface Window {
    sweep: {
      getState: () => Promise<PanelState>;
      refresh: () => Promise<void>;
      pull: (paths: string[]) => Promise<void>;
      pullFix: (paths: string[]) => Promise<void>;
      clean: (paths: string[]) => Promise<void>;
      deleteRemote: (request: RemoteDeleteRequest) => Promise<void>;
      setPrefs: (partial: Partial<Prefs>) => Promise<PanelState>;
      hide: () => Promise<void>;
      quit: () => Promise<void>;
      fitHeight: (height: number) => Promise<void>;
      onChanged: (cb: () => void) => () => void;
      onClosed: (cb: () => void) => () => void;
    };
  }
}

const SCAN_CHOICES = [5, 10, 15, 20, 30, 60, 240, 480, 720, 1440];
const OUT_OF_DATE = "Out of date";
const CLEANUP = "Cleanup";
const REMOTE = "Remote branches";

const ICONS = {
  outdated:
    '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.2"/><path d="M8 4.8v6M5.4 8.6 8 11.2l2.6-2.6"/></svg>',
  cleanup:
    '<svg viewBox="0 0 16 16"><circle cx="4.5" cy="11.5" r="2"/><circle cx="4.5" cy="4.5" r="2"/><path d="M6.2 5.6 13.5 12M6.2 10.4 13.5 4"/></svg>',
  remote:
    '<svg viewBox="0 0 16 16"><circle cx="4.5" cy="3.5" r="1.6"/><circle cx="4.5" cy="12.5" r="1.6"/><circle cx="11.5" cy="5.5" r="1.6"/><path d="M4.5 5.1v5.8M11.5 7.1c0 2.4-2.2 3-7 3.8"/></svg>',
};

let state: PanelState | null = null;
let view: "overview" | "settings" = "overview";
let expanded = new Set<string>();
let expandedLoaded = false;
let repoFilter: "all" | "updates" | "cleanup" | "remote" = "all";
let closeConfirm: ((value: boolean) => void) | null = null;

const content = document.getElementById("content")!;
const markImg = document.getElementById("mark") as HTMLImageElement;
const brand = document.getElementById("brand")!;
const back = document.getElementById("back")!;
const gear = document.getElementById("gear")!;
const spinner = document.getElementById("spinner")!;
const updatedEl = document.getElementById("updated")!;
const countEl = document.getElementById("count")!;
const versionEl = document.getElementById("app-version")!;

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function listed(repo: RepoStatus, prefs: Prefs): RemoteBranch[] {
  return prefs.showOnlyMyRemoteBranches
    ? repo.remoteBranches.filter((b) => b.mine)
    : repo.remoteBranches;
}

function outdated(s: PanelState): RepoStatus[] {
  return s.repos.filter((r) => r.behind > 0 || r.gone);
}

function cleanup(s: PanelState): RepoStatus[] {
  return s.repos.filter((r) => r.cleanupBranches.length > 0);
}

function remotes(s: PanelState): RepoStatus[] {
  return s.repos.filter((r) => listed(r, s.prefs).length > 0);
}

function repoByPath(path: string | undefined): RepoStatus | undefined {
  return path ? state?.repos.find((r) => r.path === path) : undefined;
}

function intervalLabel(minutes: number): string {
  if (minutes === 60) return "1 hour";
  if (minutes === 1440) return "1 day";
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60} hours`;
  return `${minutes} minutes`;
}

function requestFit(): void {
  requestAnimationFrame(() => {
    const app = document.getElementById("app");
    if (!app) return;
    const header = app.querySelector<HTMLElement>(".top");
    const footer = app.querySelector<HTMLElement>(".foot");
    void window.sweep.fitHeight(Math.ceil(content.scrollHeight + (header?.offsetHeight || 0) + (footer?.offsetHeight || 0)));
  });
}

/* ---------- confirm ---------- */

function askConfirm(opts: {
  title: string;
  message: string;
  confirmLabel: string;
  danger: boolean;
}): Promise<boolean> {
  const root = document.getElementById("confirm")!;
  const title = document.getElementById("confirm-title")!;
  const message = document.getElementById("confirm-message")!;
  const cancel = document.getElementById("confirm-cancel") as HTMLButtonElement;
  const ok = document.getElementById("confirm-ok") as HTMLButtonElement;

  closeConfirm?.(false);
  title.textContent = opts.title;
  message.textContent = opts.message;
  ok.textContent = opts.confirmLabel;
  ok.className = opts.danger ? "danger" : "primary";
  root.classList.remove("hidden");
  cancel.focus();

  return new Promise((resolve) => {
    const finish = (value: boolean) => {
      root.classList.add("hidden");
      cancel.removeEventListener("click", onCancel);
      ok.removeEventListener("click", onOk);
      root.removeEventListener("click", onBackdrop);
      document.removeEventListener("keydown", onKey, true);
      closeConfirm = null;
      resolve(value);
    };
    const onCancel = () => finish(false);
    const onOk = () => finish(true);
    const onBackdrop = (e: MouseEvent) => {
      if (e.target === root) finish(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        finish(false);
      }
    };
    closeConfirm = finish;
    cancel.addEventListener("click", onCancel);
    ok.addEventListener("click", onOk);
    root.addEventListener("click", onBackdrop);
    document.addEventListener("keydown", onKey, true);
  });
}

function deleteConfirmText(request: RemoteDeleteRequest): { title: string; message: string } {
  const branchCount = request.items.reduce((n, i) => n + i.branches.length, 0);
  const repoCount = request.items.length;
  const repos = plural(repoCount, "repo");
  if (request.scope === "merged") {
    return {
      title: `Delete ${plural(branchCount, "merged remote branch", "merged remote branches")}?`,
      message: `This deletes every merged origin branch listed across ${repos}. Primary branches stay. It cannot be undone from here.`,
    };
  }
  if (request.scope === "withoutMR") {
    return {
      title: `Delete ${plural(branchCount, "remote branch", "remote branches")} without an MR?`,
      message: `This deletes every listed origin branch with no open merge request across ${repos}. Branches with an MR badge stay. Primary branches stay. It cannot be undone from here.`,
    };
  }
  if (request.scope === "all") {
    return {
      title: `Delete ${plural(branchCount, "remote branch", "remote branches")}?`,
      message: `This deletes every listed origin branch across ${repos}. Primary branches stay. It cannot be undone from here.`,
    };
  }
  const item = request.items[0];
  if (branchCount > 1) {
    const kept = item.primary ? `${item.primary} stays.` : "The primary branch stays.";
    return {
      title: `Delete ${branchCount} remote branches?`,
      message: `This deletes every origin branch listed for ${item.repo}. ${kept} It cannot be undone from here.`,
    };
  }
  return {
    title: `Delete origin/${item?.branches[0] ?? ""}?`,
    message: `This deletes the branch on the remote for ${item?.repo ?? "this repo"}. It cannot be undone from here.`,
  };
}

async function confirmDelete(request: RemoteDeleteRequest | null): Promise<void> {
  if (!request || !request.items.length) return;
  const { title, message } = deleteConfirmText(request);
  const ok = await askConfirm({ title, message, confirmLabel: "Delete", danger: true });
  if (ok) await window.sweep.deleteRemote(request);
}

function scopedDeleteRequest(scope: DeleteScope): RemoteDeleteRequest | null {
  if (!state) return null;
  const s = state;
  const items: RemoteDeleteItem[] = remotes(s)
    .map((repo) => ({
      repo: repo.name,
      path: repo.path,
      primary: repo.primary,
      branches: listed(repo, s.prefs)
        .filter((b) => scope === "all" || (scope === "merged" ? b.merged : !b.hasOpenMR))
        .map((b) => b.name),
    }))
    .filter((i) => i.branches.length > 0);
  return items.length ? { items, scope } : null;
}

function repoDeleteRequest(repo: RepoStatus, branches: string[]): RemoteDeleteRequest {
  return {
    items: [{ repo: repo.name, path: repo.path, primary: repo.primary, branches }],
    scope: null,
  };
}

/* ---------- actions ---------- */

async function handleAction(act: string, el: HTMLElement): Promise<void> {
  if (!state) return;
  const s = state;
  const repo = repoByPath(el.dataset.path);
  switch (act) {
    case "filter":
      repoFilter = el.dataset.filter as typeof repoFilter;
      content.scrollTop = 0;
      render();
      content.querySelector<HTMLButtonElement>(`[data-filter="${repoFilter}"]`)?.focus();
      return;
    case "toggleRepo": {
      const key = `repo-collapsed:${el.dataset.path}`;
      if (expanded.has(key)) expanded.delete(key); else expanded.add(key);
      if (s.prefs.rememberExpanded) await window.sweep.setPrefs({expandedSections:[...expanded]});
      render();
      return;
    }
    case "toggle": {
      const key = el.dataset.section!;
      if (expanded.has(key)) expanded.delete(key);
      else expanded.add(key);
      if (s.prefs.rememberExpanded) {
        await window.sweep.setPrefs({ expandedSections: [...expanded] });
      }
      render();
      return;
    }
    case "pull":
      if (repo) await window.sweep.pull([repo.path]);
      return;
    case "pullFix":
      if (repo) await window.sweep.pullFix([repo.path]);
      return;
    case "pullAll":
      await window.sweep.pull(outdated(s).filter((r) => !r.gone).map((r) => r.path));
      return;
    case "pullFixAll": {
      const list = outdated(s);
      const ok = await askConfirm({
        title: `Pull & Fix ${plural(list.length, "repo")}?`,
        message:
          "Each repo is pulled. Blockers are cleared first (unfinished merge/rebase), then it may stash local edits (popped after), check out the primary branch, or run git pull --rebase.",
        confirmLabel: "Pull & Fix all",
        danger: false,
      });
      if (ok) await window.sweep.pullFix(list.map((r) => r.path));
      return;
    }
    case "clean": {
      if (!repo) return;
      const primary = repo.primary ?? "the primary branch";
      const ok = await askConfirm({
        title: `Clean ${repo.name}?`,
        message: `${repo.cleanupPrimaryElsewhere ? "Keeps this worktree on its current branch and leaves the primary worktree unchanged." : `Checks out ${primary}, then pulls after cleanup.`} Force-deletes ${plural(repo.cleanupBranches.length, "local branch", "local branches")} (${repo.cleanupBranches.join(", ")}) with git branch -D. Unmerged commits on those branches are lost. Branches in use by worktrees are kept. Nothing on the remote changes.`,
        confirmLabel: "Clean",
        danger: true,
      });
      if (ok) await window.sweep.clean([repo.path]);
      return;
    }
    case "cleanAll": {
      const list = cleanup(s);
      const total = list.reduce((n, r) => n + r.cleanupBranches.length, 0);
      const ok = await askConfirm({
        title: `Clean ${plural(list.length, "repo")}?`,
        message: `Uses the primary branch where available and leaves linked worktrees in place. Force-deletes ${plural(total, "local branch", "local branches")} with git branch -D. Unmerged commits on those branches are lost. Branches in use by worktrees are kept. Pulls only where the primary branch is available. Nothing on the remote changes.`,
        confirmLabel: "Clean all",
        danger: true,
      });
      if (ok) await window.sweep.clean(list.map((r) => r.path));
      return;
    }
    case "deleteBranch":
      if (repo && el.dataset.branch) {
        await confirmDelete(repoDeleteRequest(repo, [el.dataset.branch]));
      }
      return;
    case "deleteRepo":
      if (repo) await confirmDelete(repoDeleteRequest(repo, listed(repo, s.prefs).map((b) => b.name)));
      return;
    case "deleteMerged":
      await confirmDelete(scopedDeleteRequest("merged"));
      return;
    case "deleteWithoutMR":
      await confirmDelete(scopedDeleteRequest("withoutMR"));
      return;
    case "deleteAll":
      await confirmDelete(scopedDeleteRequest("all"));
      return;
    case "interval":
      state = await window.sweep.setPrefs({ scanMinutes: Number(el.dataset.minutes) });
      render();
      return;
  }
}

content.addEventListener("click", (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
  if (!el) return;
  void handleAction(el.dataset.act!, el);
});

content.addEventListener("change", async (e) => {
  const input = e.target as HTMLInputElement;
  const key = input.dataset.pref as keyof Prefs | undefined;
  if (!key) return;
  const partial: Partial<Prefs> = {};
  (partial as Record<string, unknown>)[key] = input.checked;
  if (key === "rememberExpanded") {
    partial.expandedSections = input.checked ? [...expanded] : [];
  }
  state = await window.sweep.setPrefs(partial);
  render();
});

/* ---------- render ---------- */

function empty(text: string): string {
  return `<div class="empty">${escapeHtml(text)}</div>`;
}

function renderOverview(s: PanelState): string {
  const behind = outdated(s);
  const extra = cleanup(s);
  const remoteRepos = s.prefs.showRemoteBranches ? remotes(s) : [];
  if (!s.prefs.showRemoteBranches && repoFilter === "remote") repoFilter = "all";
  const remoteBranches = remoteRepos.flatMap(repo => listed(repo, s.prefs));
  const filters = [["all","All",null],["updates","Updates",behind.length],["cleanup","Cleanup",extra.length],...(s.prefs.showRemoteBranches ? [["remote","Remote",remoteBranches.length]] : [])];
  let banner = "";
  if (s.activity) banner = `<div class="result-banner working" role="status">${ICONS.outdated}<span>Working: ${escapeHtml(s.activity)}</span></div>`;
  else if (s.result) {
    const success = s.result.startsWith("Done:");
    banner = `<div class="result-banner ${success ? "success" : "failure"}" role="status">${success ? checkIcon : alertIcon}<span>${escapeHtml(s.result)}</span></div>`;
  }
  const tabs = `<div class="repo-filters" role="group" aria-label="Repository tasks">${filters.map(([value,label,count]) => `<button data-act="filter" data-filter="${value}" class="${repoFilter === value ? "selected" : ""}" aria-pressed="${repoFilter === value}">${label}${count !== null ? `<span>${count}</span>` : ""}</button>`).join("")}</div>`;
  const bulk = `<div class="workbench-toolbar">${(repoFilter === "all" || repoFilter === "updates") && behind.length ? `<button class="act primary" data-act="pullAll" ${behind.every(r => r.gone) ? "disabled" : ""}>Pull all (${behind.filter(r => !r.gone).length})</button><button class="act" data-act="pullFixAll">Pull &amp; Fix all (${behind.length})</button>` : ""}${(repoFilter === "all" || repoFilter === "cleanup") && extra.length ? `<button class="act" data-act="cleanAll">Clean all (${extra.length})</button>` : ""}${(repoFilter === "all" || repoFilter === "remote") && remoteBranches.length ? `<details class="remote-tools"><summary>Remote actions</summary><div>${remoteBranches.some(b => b.merged) ? '<button class="inline danger-text" data-act="deleteMerged">Delete all merged</button>' : ""}${remoteBranches.some(b => !b.hasOpenMR) ? '<button class="inline danger-text" data-act="deleteWithoutMR">Delete all without MR</button>' : ""}<button class="inline danger-text" data-act="deleteAll">Delete all remote</button></div></details>` : ""}</div>`;
  const repos = s.repos.filter(repo => {
    const update = repo.behind > 0 || repo.gone;
    const local = repo.cleanupBranches.length > 0;
    const remote = s.prefs.showRemoteBranches && listed(repo,s.prefs).length > 0;
    return repoFilter === "updates" ? update : repoFilter === "cleanup" ? local : repoFilter === "remote" ? remote : update || local || remote || Boolean(repo.error) || Boolean(repo.protectedCleanupBranches?.length);
  });
  const cards = repos.map(repo => {
    const path = escapeHtml(repo.path);
    const update = repo.behind > 0 || repo.gone;
    const open = !expanded.has(`repo-collapsed:${repo.path}`);
    const status = repo.error ? "Scan error" : repo.gone ? "Remote branch gone" : repo.behind ? `${repo.behind} behind` : "Up to date";
    const tone = repo.error || repo.gone ? "bad" : repo.behind ? "warn" : s.prefs.greenForPassing ? "ok" : "muted";
    const tasks: string[] = [];
    if (repo.protectedCleanupBranches?.length && (repoFilter === "all" || repoFilter === "cleanup")) tasks.push(`<div class="worktree-note">Kept for worktrees: ${escapeHtml(repo.protectedCleanupBranches.join(", "))}</div>`);
    if (repo.error) tasks.push(`<div class="repo-error" role="status">${escapeHtml(repo.error)}</div>`);
    if (update && (repoFilter === "all" || repoFilter === "updates")) tasks.push(`<div class="work-task"><span class="task-icon tone-warn">${ICONS.outdated}</span><span class="task-description">${repo.gone ? "Remote branch gone" : `Behind ${plural(repo.behind,"commit")}`}</span><div class="task-actions">${!repo.gone ? `<button class="inline primary" data-act="pull" data-path="${path}">Pull</button>` : ""}<button class="inline" data-act="pullFix" data-path="${path}">Pull &amp; Fix</button></div></div>`);
    if (repo.cleanupBranches.length && (repoFilter === "all" || repoFilter === "cleanup")) tasks.push(`<div class="work-task"><span class="task-icon tone-warn">${ICONS.cleanup}</span><span class="task-description"><span class="task-label">Local ${repo.cleanupBranches.length === 1 ? "branch" : "branches"}:</span> ${escapeHtml(repo.cleanupBranches.join(", "))}</span><div class="task-actions"><button class="inline" data-act="clean" data-path="${path}">Clean</button></div></div>`);
    if (s.prefs.showRemoteBranches && (repoFilter === "all" || repoFilter === "remote")) {
      const branches = listed(repo,s.prefs);
      branches.forEach(branch => tasks.push(`<div class="work-task remote-task"><span class="task-icon tone-ok">${ICONS.remote}</span><span class="task-description"><span class="task-label">Remote branch:</span> ${escapeHtml(branch.name)}</span><span class="branch-state ${branch.merged ? s.prefs.greenForPassing ? "tone-ok" : "tone-muted" : "tone-warn"}">${branch.merged ? "Merged" : "Not merged"}</span>${branch.hasOpenMR ? '<span class="mr" title="Open merge request">MR</span>' : ""}<button class="inline danger-text" data-act="deleteBranch" data-path="${path}" data-branch="${escapeHtml(branch.name)}">Delete</button></div>`));
      if (branches.length > 1) tasks.push(`<div class="repo-remote-footer"><button class="inline danger-text" data-act="deleteRepo" data-path="${path}">Delete all remote (${branches.length})</button></div>`);
    }
    return `<article class="repo-work-card" data-repo-path="${path}"><button class="repo-work-head" data-act="toggleRepo" data-path="${path}" aria-expanded="${open}"><span class="repo-glyph">${repoIcon}</span><span class="repo-identity"><strong>${escapeHtml(repo.name)}</strong><span>${ICONS.remote}${escapeHtml(repo.branch || "Detached HEAD")}${repo.dirtyCount ? ` · ${plural(repo.dirtyCount,"local change")}` : ""}</span></span><span class="repo-status tone-${tone}">${status}</span><span class="chev ${open ? "up" : ""}" aria-hidden="true"></span></button>${open ? `<div class="repo-work-body">${tasks.join("")}</div>` : ""}</article>`;
  }).join("");
  return banner + tabs + bulk + (cards || empty(!s.updated ? s.scanning ? "Scanning clones…" : "No scan yet" : repoFilter === "all" ? "All repos are up to date. No cleanup or remote branches to review." : `No ${repoFilter === "updates" ? "out-of-date repos" : repoFilter === "cleanup" ? "local branches to clean (branches in use by worktrees are kept)" : "remote branches to review"}.`));
}

function toggleHtml(key: keyof Prefs, label: string, on: boolean, nested = false): string {
  return `<label class="pref${nested ? " nested" : ""}">
    <span>${escapeHtml(label)}</span>
    <span class="switch">
      <input type="checkbox" data-pref="${key}"${on ? " checked" : ""} />
      <span class="track"></span>
    </span>
  </label>`;
}

function renderSettings(s: PanelState): string {
  const p = s.prefs;
  const toggles = [
    toggleHtml("greenForPassing", "Green for passing", p.greenForPassing),
    toggleHtml("showRemoteBranches", "Show remote branches", p.showRemoteBranches),
    p.showRemoteBranches
      ? toggleHtml("showOnlyMyRemoteBranches", "Only my remote branches", p.showOnlyMyRemoteBranches, true)
      : "",
    toggleHtml("rememberExpanded", "Remember open repositories", p.rememberExpanded),
    toggleHtml("openAtLogin", "Open at login", p.openAtLogin),
  ].join("");
  const choices = SCAN_CHOICES.map(
    (m) =>
      `<button type="button" class="choice${m === p.scanMinutes ? " selected" : ""}" data-act="interval" data-minutes="${m}">${intervalLabel(m)}</button>`,
  ).join("");
  return `<div class="card">${toggles}</div>
    <div class="pref-label">Scan every</div>
    <div class="card"><div class="choices">${choices}</div></div>
    <div class="note">${
      p.rememberExpanded
        ? "Repository cards stay open after you close the panel."
        : "Repository cards start expanded each time you open the panel."
    }</div>
    <div class="note">Timer scans skip fetch when a clone was fetched recently. Refresh always fetches.</div>
    <div class="note">Scanning <span class="mono">${escapeHtml(s.root)}</span></div>`;
}

function render(): void {
  if (!state) return;
  const s = state;
  if (!expandedLoaded) {
    expanded = new Set(s.prefs.rememberExpanded ? s.prefs.expandedSections : []);
    expandedLoaded = true;
  }
  if (s.mark) {
    markImg.src = s.mark;
    markImg.classList.remove("hidden");
  } else {
    markImg.classList.add("hidden");
  }
  const settings = view === "settings";
  brand.classList.toggle("hidden", settings);
  back.classList.toggle("hidden", !settings);
  gear.classList.toggle("hidden", settings);
  spinner.classList.toggle("hidden", !s.scanning);

  const scrollTop = content.scrollTop;
  content.classList.toggle("workbench", !settings);
  content.innerHTML = settings ? renderSettings(s) : renderOverview(s);
  content.scrollTop = scrollTop;

  versionEl.textContent = `v${s.version}`;
  updatedEl.textContent = s.updated
    ? `Updated ${new Date(s.updated).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
    : "Scanning clones…";
  countEl.textContent = plural(s.repos.length, "repo");
  requestFit();
}

async function refreshState(): Promise<void> {
  state = await window.sweep.getState();
  render();
}

document.getElementById("refresh")!.addEventListener("click", () => {
  void window.sweep.refresh();
});
gear.addEventListener("click", () => {
  view = "settings";
  content.scrollTop = 0;
  render();
});
back.addEventListener("click", () => {
  view = "overview";
  render();
});
document.getElementById("quit")!.addEventListener("click", () => {
  void window.sweep.quit();
});

document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "q") {
    e.preventDefault();
    void window.sweep.quit();
    return;
  }
  if (e.key === "Escape") {
    if (view === "settings") {
      view = "overview";
      render();
    } else {
      void window.sweep.hide();
    }
  }
});

window.sweep.onChanged(() => void refreshState());
window.sweep.onClosed(() => {
  closeConfirm?.(false);
  view = "overview";
  if (state && !state.prefs.rememberExpanded) expanded.clear();
  render();
});

void refreshState();
window.addEventListener("load", () => requestFit());
