#!/usr/bin/env node
/**
 * Temp-repo checks for Pull & Fix blockers.
 * Run: npm run build:electron && node scripts/pull-fix-selftest.mjs
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

function git(repo, ...args) {
  const r = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  return { rc: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
}

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const dist = path.join(process.cwd(), "dist-electron", "repos.js");
  must(fs.existsSync(dist), "Run npm run build:electron first");
  const { clearIndexBlockers, pullAndFix, primaryBranch } = await import(
    pathToFileURL(dist).href
  );

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "repoes-pullfix-"));
  const remote = path.join(root, "remote.git");
  const local = path.join(root, "local");
  const other = path.join(root, "other");

  git(root, "init", "--bare", "-b", "main", remote);
  git(root, "clone", remote, local);
  for (const repo of [local]) {
    git(repo, "config", "user.email", "t@t.com");
    git(repo, "config", "user.name", "t");
  }
  fs.writeFileSync(path.join(local, "f.txt"), "base\n");
  fs.writeFileSync(path.join(local, "README.md"), "readme\n");
  git(local, "add", ".");
  git(local, "commit", "-m", "base");
  git(local, "push", "-u", "origin", "main");

  git(root, "clone", remote, other);
  git(other, "config", "user.email", "t@t.com");
  git(other, "config", "user.name", "t");

  // --- 1. Stuck UU index (MERGE_HEAD removed) blocks stash; clear fixes it ---
  fs.writeFileSync(path.join(other, "f.txt"), "remote\n");
  git(other, "commit", "-am", "remote");
  git(other, "push");
  fs.writeFileSync(path.join(local, "f.txt"), "local\n");
  git(local, "commit", "-am", "local");
  git(local, "fetch");
  git(local, "merge", "origin/main");
  must(git(local, "ls-files", "-u").out.length > 0, "expected unmerged");
  const mergeHead = path.join(local, ".git", "MERGE_HEAD");
  if (fs.existsSync(mergeHead)) fs.unlinkSync(mergeHead);
  must(git(local, "stash", "push", "-u", "-m", "x").rc !== 0, "stash should fail while UU");
  must((await clearIndexBlockers(local)) === null, "clearIndexBlockers failed");
  must(git(local, "ls-files", "-u").out.length === 0, "unmerged remain after clear");

  // --- 2. Behind + dirty: Pull & Fix stashes, fast-forwards, pops ---
  git(local, "reset", "--hard", "origin/main");
  fs.writeFileSync(path.join(other, "f.txt"), "remote2\n");
  git(other, "commit", "-am", "remote2");
  git(other, "push");
  fs.writeFileSync(path.join(local, "README.md"), "readme\nnote\n");
  git(local, "fetch");

  const status = {
    name: "local",
    path: local,
    branch: "main",
    behind: 1,
    cleanupBranches: [],
    remoteBranches: [],
    dirtyCount: 1,
    gone: false,
    primary: (await primaryBranch(local)) ?? "main",
  };
  const err = await pullAndFix(status);
  must(err === null, `pullAndFix failed: ${err}`);
  must(
    git(local, "status", "--porcelain").out.includes("README.md"),
    "local edit should return after stash pop",
  );
  const counts = git(local, "rev-list", "--left-right", "--count", "HEAD...@{upstream}").out
    .split(/\s+/);
  must(counts[1] === "0", `still behind: ${counts.join(" ")}`);

  console.log("pull-fix-selftest: ok");
  fs.rmSync(root, { recursive: true, force: true });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
