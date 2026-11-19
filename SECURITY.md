# Security

Repoes Sweep does not store a git password, an SSH key, or a personal access token. It runs `git` as you, so it uses the credentials git already has on this machine.

## Reporting

Open a GitHub issue for a vulnerability in this repository. Do not paste private repository names, remote URLs that contain tokens, or the contents of a clone. Describe the behavior and the impact.

## What the app stores

Preferences are a JSON file, `prefs.json`, in the app's user-data directory (`~/Library/Application Support/Repoes Sweep/data/prefs.json` on macOS, `%APPDATA%\Repoes Sweep\data\prefs.json` on Windows). Creating the file requests mode `0600`. It holds the scan interval, whether remote branches are shown, whether only your remote branches are listed, whether a clean state is drawn in green, whether the menu-bar mark has a dark backdrop, and whether the app opens at login. Those are settings, not credentials.

On macOS, if `prefs.json` cannot be read or parsed, the app reads `repos.greenForPassing`, `repos.showRemoteBranches`, `repos.showOnlyMyRemoteBranches`, and `repos.scanMinutes` from the legacy Swift UserDefaults domain `com.kris.repos` once and writes `prefs.json`. After a readable file is in place, later launches read it and do not consult UserDefaults.

Which cards and sections are collapsed is kept in memory for the open panel and cleared when the panel closes. Those names are not written to disk.

Pull & Fix can create a git stash named `Repoes Sweep auto-stash` or `Repoes Sweep before checkout primary`. Clean can create `Repoes Sweep before clean`. That stash stays inside the clone, in git's own stash list.

## How commands run

`git` and `glab` are started by name with an argument array and no shell. `GIT_TERMINAL_PROMPT=0` is set. Paths come from the clone the app discovered under the configured root. Remote branch names are the names `git for-each-ref` reported for `origin`. Delete refuses the primary branch and any name that starts with `-`. When remote branches are shown, open MR badges use one optional `glab api graphql` call per scan for your authored open MRs; failure just means no badges.

Clean deletes local branches with `git branch -D`. Delete and Delete all run `git push origin --delete` after you confirm. Both are destructive. The confirmation is the only prompt.

## Out of scope

The app is not sandboxed. It needs to read the clones under the repo root and run `git`, including `fetch` and `push`. Protect the SSH key or credential helper the same way you protect any other git login on this machine.
