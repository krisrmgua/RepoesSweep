# Security

Repoes Sweep does not store a git password, an SSH key, or a personal access token. It runs `git` as you, so it uses the credentials git already has on this Mac.

## Reporting

Open a GitHub issue for a vulnerability in this repository. Do not paste private repository names, remote URLs that contain tokens, or the contents of a clone. Describe the behavior and the impact.

## What the app stores

UserDefaults domain `com.kris.repos` holds the scan interval, whether remote branches are shown, whether only your remote branches are listed, whether a clean state is drawn in green, whether open sections are remembered, and the names of those sections. Those are settings, not credentials.

Pull & Fix can create a git stash named `Repoes Sweep auto-stash` or `Repoes Sweep before checkout primary`. That stash is inside the clone, in git's own stash list.

## How commands run

`git` is started through `/usr/bin/env` with an argument array. Paths come from the clone the app discovered under the configured root. Remote branch names are the names `git for-each-ref` reported for `origin`. Delete refuses the primary branch and any name that starts with `-`.

Clean deletes local branches with `git branch -D`. Delete and Delete all run `git push origin --delete` after you confirm. Both are destructive. The confirmation is the only prompt.

## Out of scope

The app is not sandboxed. It needs to read the clones under the repo root and run `git`, including `fetch` and `push`. Protect the SSH key or credential helper the same way you protect any other git login on this Mac.
