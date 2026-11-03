import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

export function dataDir(): string {
  const dir = path.join(app.getPath("userData"), "data");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function prefsPath(): string {
  return path.join(dataDir(), "prefs.json");
}

export function assetPath(...parts: string[]): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "assets", ...parts);
  }
  return path.join(app.getAppPath(), "assets", ...parts);
}
