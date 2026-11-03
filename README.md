# Repoes Sweep

Repoes Sweep is a macOS menu-bar app that watches the git clones on your Mac and lets you catch them up from one panel. It fetches each clone, then shows what is behind, which local branches are left over, and which remote branches are still on `origin`.

The panel is a dark inbox, the same shape as a small status window. The three lists start collapsed. Click a header to open it. Clicking away closes the panel, and the next open starts collapsed again unless you turn on **Remember open sections**.

Requires **macOS 13** or later and the Swift command-line tools. Git has to already work in a terminal for those clones. The app does not install git and it does not store a password or a token.

## Install

```bash
git clone https://github.com/krisrmgua/RepoesSweep.git
cd RepoesSweep/menubar
./install.sh
```

That builds `Repoes Sweep.app`, copies it to `~/Applications/Repoes Sweep.app`, and starts it at login. Run `./install.sh` again to update. The bundle id is `com.kris.repos`, so an update keeps the preferences you already set.

A manual build, without installing, is:

```bash
cd menubar
./make-app.sh
open "Repoes Sweep.app"
```

Quit and rerun `./install.sh` after you change the source if you want the menu-bar copy updated.

## Git on this Mac

Repoes Sweep runs `git` as you. Whatever already works for `git fetch` and `git push` in Terminal is what the app uses: an SSH key, a credential helper, or a signed-in host. It never asks for a password of its own and it never writes a credential file.

Check that before you rely on the panel:

```bash
git -C ~/git-repos/example status
git -C ~/git-repos/example fetch --prune origin
```

If those fail, the panel will fail the same way. Fix the login in git, not in Repoes Sweep.

`git` is started through `/usr/bin/env` with a PATH that includes Homebrew (`/opt/homebrew/bin` and `/usr/local/bin`), because a menu-bar app does not inherit your shell PATH.

## Which clones it watches

On each scan it walks one root directory and treats every folder with a `.git` directory as a clone. It skips `node_modules` and `.terraform`.

The root is the first of these that is set and exists:

1. `MYGIT_REPO_ROOT` or `REPOS_TOOLBELT_ROOT`
2. The first line of `~/.config/mygit/repo-root`
3. `~/git-repos`

A detached HEAD or an empty repo is reported as an error for that clone and left out of the action lists.

## How the panel works

A scan runs when the app launches, on the interval you pick, and when you press refresh. Opening the panel also scans if the last one is more than two minutes old. Each scan fetches `origin` with `--prune`. Pull, Pull & Fix, Clean, remote deletes, and the matching “all” actions also rescan once their job queue is empty, so counts and the green icon update without a manual refresh. While jobs run, the overview shows the current action and, for a batch, `N of M` plus how many are left.

The overview has three sections. The count stays on the header while the section is collapsed.

### Out of date

A clone is listed when the current branch is behind its upstream, or when the upstream branch was deleted (`gone`).

- **Pull** runs `git pull --ff-only`, then a plain `git pull` if fast-forward is rejected.
- **Pull & Fix** tries to get past the usual blocks:
  - upstream gone: check out the primary branch (`main` or `master`, or `origin/HEAD`) and pull
  - local edits in the way: stash them, including untracked files, pull, then pop the stash
  - local and remote diverged: `git pull --rebase`
- **Pull all** and **Pull & Fix all** queue one job per listed clone. Jobs run one at a time.

A stash created here is labeled `Repoes Sweep auto-stash` or `Repoes Sweep before checkout primary`. If the pop conflicts, the changes stay in `git stash` and the panel says so.

### Cleanup

A clone is listed when it has local branches other than the primary branch.

**Clean** checks out the primary branch (stashing local edits if needed), deletes every other local head with `git branch -D`, then pulls with `--ff-only`. It re-reads branches at clean time, so an already-gone name is not an error. Branches checked out in another worktree are reported and skipped. `-D` deletes the branch even when it is not merged. This does not delete anything on the remote.

### Remote branches

Shown when **Show remote branches** is on. Each clone lists `origin` branches other than the primary, marked **merged** when that tip is reachable from `origin/<primary>`.

**Only my remote branches** (on by default, nested under that preference) keeps tips whose author email matches the clone's `user.email`. Turn it off to see every `origin` branch again.

Branches with an open GitLab merge request you authored show a small **MR** badge next to the name (one `glab` GraphQL call per scan when the section is on).

**Delete**, per-repo **Delete all**, and section-wide **Delete all** / **Delete all merged** / **Delete all without MR** ask first, then run `git push origin --delete` for those names. The primary branch is not in the list and is refused if a name matches it. This removes the branch on the remote. It cannot be undone from the app.

## Menu-bar icon

The mark is the bolt, the diamond, and the tail. The diamond has a black outline and a black check.

- **Light gray** while any clone is out of date or has extra local branches.
- **Green** when those two are empty and **Green for passing** is on. Remote branches do not keep the diamond gray.

The bolts and the tail follow the menu bar: light on a dark bar, dark on a light bar.

## Preferences

| Item | Default |
|---|---|
| Green for passing | On. The diamond can turn green, and a merged remote branch is shown in green. |
| Show remote branches | On. Hides the Remote branches section when off. |
| Only my remote branches | On. Shown under Show remote branches. Keeps tips authored by this clone's `user.email`. |
| Remember open sections | Off. Closing the panel collapses every section. On keeps the ones you left open, including after a restart. |
| Scan every | 10 minutes. Choices run from 5 minutes to 1 day. Timer scans skip `git fetch` when FETCH_HEAD is still fresh; the refresh button always fetches. |

Preferences live in UserDefaults under `com.kris.repos`. They are not credentials.

## Clicking away

Clicking outside the panel closes it, including a click on the desktop. The menu-bar icon still toggles the panel. A confirmation dialog stays up while you use it.

## Develop

```bash
cd menubar
swift build
./make-app.sh
```

`RepoesSweep --dump` prints each clone after a real fetch. `RepoesSweep --pull-fix <path>` runs Pull & Fix on one clone and prints the before and after. Both use your real checkouts.

XCTest is not required. Command Line Tools can build the package.

## Layout

| Path | What |
|---|---|
| `menubar/` | Swift Package Manager app |
| `menubar/install.sh` | Build, install to `~/Applications`, and login start |
| `menubar/Resources/` | Menu-bar mark, split into wings, diamond, outline, and check |

## License

[MIT](LICENSE). Copyright 2026 Kristopher Simmons.
