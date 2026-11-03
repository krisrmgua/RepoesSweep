import { spawn, type ChildProcess } from "node:child_process";

/**
 * Child env for git and glab. A menu-bar app launched from Finder gets a minimal
 * PATH, so Homebrew locations are prepended on macOS. Windows keeps the user PATH
 * (Git for Windows and glab installers add themselves there).
 */
export const childEnv: NodeJS.ProcessEnv = (() => {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
  if (process.platform !== "win32") {
    const extra = [
      "/opt/homebrew/bin",
      "/usr/local/bin",
      "/usr/bin",
      "/bin",
      "/usr/sbin",
      "/sbin",
    ];
    const current = (env.PATH ?? "").split(":").filter(Boolean);
    env.PATH = [...new Set([...extra, ...current])].join(":");
  }
  return env;
})();

export interface RunResult {
  status: number;
  out: string;
}

/** Runs a command without a shell. `mergeStderr` folds git's stderr messages into `out`. */
export function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number; mergeStderr?: boolean } = {},
): Promise<RunResult> {
  const { cwd, timeoutMs = 120_000, mergeStderr = false } = opts;
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let spawned: ChildProcess | undefined;
    try {
      spawned = spawn(cmd, args, {
        cwd,
        env: childEnv,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      spawned = undefined;
    }
    if (!spawned) {
      resolve({ status: -1, out: "" });
      return;
    }
    const child = spawned;
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout?.on("data", (c: Buffer) => chunks.push(c));
    child.stderr?.on("data", (c: Buffer) => {
      if (mergeStderr) chunks.push(c);
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ status: -1, out: Buffer.concat(chunks).toString("utf8") });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ status: code ?? -1, out: Buffer.concat(chunks).toString("utf8") });
    });
  });
}

/** `glab api graphql -f query=…` parsed as JSON `data`, or null on any failure. */
export async function glabGraphQL(
  query: string,
): Promise<Record<string, unknown> | null> {
  const r = await run(
    "glab",
    ["api", "graphql", "--hostname", "gitlab.com", "-f", `query=${query}`],
    { timeoutMs: 30_000 },
  );
  if (r.status !== 0 || !r.out.trim()) return null;
  try {
    const root = JSON.parse(r.out) as {
      data?: Record<string, unknown>;
      errors?: unknown;
    };
    if (root.errors) return null;
    return root.data ?? null;
  } catch {
    return null;
  }
}
