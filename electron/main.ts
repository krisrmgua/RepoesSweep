import path from "node:path";
import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  ipcMain,
  nativeTheme,
  screen,
} from "electron";
import { PrefsStore } from "./prefs";
import { Sweeper, isClean, listedRemoteBranches } from "./sweeper";
import { createTrayIcon, headerMarkDataUrl } from "./trayIcon";
import type { PanelState, Prefs, RemoteDeleteRequest } from "./types";

let tray: Tray | null = null;
let panel: BrowserWindow | null = null;
let prefs: PrefsStore;
let sweeper: Sweeper;
let scanTimer: ReturnType<typeof setInterval> | null = null;
let lastHiddenAt = 0;
let iconKey = "";

const isDev = process.env.REPOES_DEV === "1";

const PANEL_WIDTH = 440;
const PANEL_MIN_HEIGHT = 220;
const PANEL_MAX_HEIGHT = 720;
/** Opening the panel rescans when the last scan is older than this. */
const STALE_SCAN_MS = 120_000;

/** Dev server URL from the environment. Only a loopback Vite address is accepted. */
function loopbackDevUrl(raw: string | undefined): string {
  let parsed: URL;
  try {
    parsed = new URL(raw ?? "");
  } catch {
    throw new Error("Dev mode needs the Vite server URL in the environment.");
  }
  const loopback = parsed.hostname === "127.0.0.1" || parsed.hostname === "::1";
  const web = parsed.protocol === "https:" || parsed.protocol === "http:";
  if (!loopback || !web) throw new Error("The dev panel only loads from the loopback Vite server.");
  return parsed.href;
}

function loadPanel(win: BrowserWindow): void {
  if (isDev) {
    void win.loadURL(loopbackDevUrl(process.env.REPOES_DEV_SERVER));
    return;
  }
  void win.loadFile(path.join(app.getAppPath(), "dist", "index.html"));
}

function createPanel(): BrowserWindow {
  const win = new BrowserWindow({
    width: PANEL_WIDTH,
    height: 420,
    show: false,
    frame: false,
    resizable: false,
    useContentSize: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    backgroundColor: "#0b1220",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (process.platform === "darwin") {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }
  loadPanel(win);
  win.on("blur", () => {
    if (!isDev) win.hide();
  });
  win.on("hide", () => {
    lastHiddenAt = Date.now();
    win.webContents.send("sweep:closed");
  });
  return win;
}

function trayDisplay() {
  const point = tray
    ? { x: tray.getBounds().x, y: tray.getBounds().y }
    : screen.getCursorScreenPoint();
  return screen.getDisplayNearestPoint(point);
}

function fitPanelToContent(contentHeight: number): void {
  if (!panel) return;
  const maxH = Math.min(PANEL_MAX_HEIGHT, trayDisplay().workArea.height - 40);
  const height = Math.min(Math.max(Math.ceil(contentHeight), PANEL_MIN_HEIGHT), maxH);
  panel.setContentSize(PANEL_WIDTH, height);
  if (panel.isVisible()) positionPanel(panel);
}

function positionPanel(win: BrowserWindow): void {
  if (!tray) return;
  const trayBounds = tray.getBounds();
  const winBounds = win.getBounds();
  const wa = trayDisplay().workArea;
  let x = Math.round(trayBounds.x + trayBounds.width / 2 - winBounds.width / 2);
  let y =
    process.platform === "darwin"
      ? Math.round(trayBounds.y + trayBounds.height + 4)
      : Math.round(trayBounds.y - winBounds.height - 4);
  x = Math.min(Math.max(x, wa.x + 8), wa.x + wa.width - winBounds.width - 8);
  y = Math.min(Math.max(y, wa.y + 8), wa.y + wa.height - winBounds.height - 8);
  win.setPosition(x, y, false);
}

function togglePanel(): void {
  if (!panel) panel = createPanel();
  if (panel.isVisible()) {
    panel.hide();
    return;
  }
  // The click that blurred (and hid) the panel also lands here; do not reopen it.
  if (Date.now() - lastHiddenAt < 250) return;
  positionPanel(panel);
  panel.show();
  panel.focus();
  const last = sweeper.lastScan?.getTime() ?? 0;
  if (Date.now() - last > STALE_SCAN_MS) void sweeper.refresh(true);
}

function panelState(): PanelState {
  const p = prefs.get();
  const clean = isClean(sweeper.repos, sweeper.lastScan) && p.greenForPassing;
  return {
    repos: sweeper.repos,
    prefs: p,
    scanning: sweeper.scanning,
    updated: sweeper.lastScan?.toISOString() ?? null,
    activity: sweeper.activity(),
    result: sweeper.result,
    root: sweeper.root,
    platform: process.platform,
    version: app.getVersion(),
    mark: headerMarkDataUrl(clean),
  };
}

function updateTray(): void {
  if (!tray) return;
  const p = prefs.get();
  const repos = sweeper.repos;
  const clean = isClean(repos, sweeper.lastScan) && p.greenForPassing;
  const dark = nativeTheme.shouldUseDarkColors;
  const key = `${clean}:${dark}`;
  if (key !== iconKey) {
    iconKey = key;
    tray.setImage(createTrayIcon(clean, dark));
  }
  const behind = repos.filter((r) => r.behind > 0 || r.gone).length;
  const cleanup = repos.filter((r) => r.cleanupBranches.length > 0).length;
  const remote = p.showRemoteBranches
    ? repos.reduce((n, r) => n + listedRemoteBranches(r, p.showOnlyMyRemoteBranches).length, 0)
    : 0;
  tray.setToolTip(
    `Repoes Sweep · ${behind} behind · ${cleanup} cleanup · ${remote} remote`,
  );
}

function broadcast(): void {
  updateTray();
  panel?.webContents.send("sweep:changed");
}

function scheduleTimer(): void {
  if (scanTimer) clearInterval(scanTimer);
  const minutes = prefs.get().scanMinutes;
  // Timer pass reuses a recent FETCH_HEAD; refresh always fetches.
  scanTimer = setInterval(() => void sweeper.refresh(false), minutes * 60_000);
}

function applyLoginItem(): void {
  if (!app.isPackaged) return;
  if (process.platform !== "darwin" && process.platform !== "win32") return;
  app.setLoginItemSettings({ openAtLogin: prefs.get().openAtLogin });
}

function asPaths(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  return [];
}

function wireIpc(): void {
  ipcMain.handle("sweep:getState", () => panelState());
  ipcMain.handle("sweep:refresh", () => void sweeper.refresh(true));
  ipcMain.handle("sweep:pull", (_e, paths: unknown) => sweeper.pull(asPaths(paths)));
  ipcMain.handle("sweep:pullFix", (_e, paths: unknown) => sweeper.pullFix(asPaths(paths)));
  ipcMain.handle("sweep:clean", (_e, paths: unknown) => sweeper.clean(asPaths(paths)));
  ipcMain.handle("sweep:deleteRemote", (_e, request: RemoteDeleteRequest) => {
    if (!request || !Array.isArray(request.items)) return;
    sweeper.deleteRemote({
      scope:
        request.scope === "all" || request.scope === "merged" || request.scope === "withoutMR"
          ? request.scope
          : null,
      items: request.items.map((item) => ({
        repo: String(item?.repo ?? ""),
        path: String(item?.path ?? ""),
        branches: asPaths(item?.branches),
      })),
    });
  });
  ipcMain.handle("sweep:setPrefs", (_e, partial: Partial<Prefs>) => {
    prefs.update(partial ?? {});
    return panelState();
  });
  ipcMain.handle("sweep:hide", () => panel?.hide());
  ipcMain.handle("sweep:quit", () => app.quit());
  ipcMain.handle("sweep:fitHeight", (_e, height: unknown) => {
    if (typeof height === "number" && Number.isFinite(height)) fitPanelToContent(height);
  });
}

function boot(): void {
  if (process.platform === "darwin") app.dock?.hide();
  prefs = new PrefsStore();
  sweeper = new Sweeper(prefs);

  sweeper.onChange(() => broadcast());
  prefs.onChange((prev, next) => {
    if (prev.scanMinutes !== next.scanMinutes) scheduleTimer();
    if (prev.openAtLogin !== next.openAtLogin) applyLoginItem();
    if (!prev.showRemoteBranches && next.showRemoteBranches) void sweeper.refresh(false);
    broadcast();
  });
  nativeTheme.on("updated", () => updateTray());

  tray = new Tray(createTrayIcon(false, nativeTheme.shouldUseDarkColors));
  iconKey = `false:${nativeTheme.shouldUseDarkColors}`;
  updateTray();
  tray.on("click", () => togglePanel());
  tray.on("right-click", () => {
    const menu = Menu.buildFromTemplate([
      { label: "Open Repoes Sweep", click: () => togglePanel() },
      { label: "Refresh", click: () => void sweeper.refresh(true) },
      { type: "separator" },
      { label: "Quit", click: () => app.quit() },
    ]);
    tray?.popUpContextMenu(menu);
  });

  panel = createPanel();
  wireIpc();
  applyLoginItem();
  void sweeper.refresh(true);
  scheduleTimer();
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  if (process.platform === "win32") app.setAppUserModelId("com.kris.repos");
  app.whenReady().then(() => boot());
  app.on("second-instance", () => togglePanel());
  app.on("before-quit", () => {
    if (scanTimer) clearInterval(scanTimer);
  });
  // Tray app: stay alive with no windows.
  app.on("window-all-closed", () => {});
}
