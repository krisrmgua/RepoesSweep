# Repo workbench visual and interaction verification

final result: passed

## Target and evidence

- Selected option 3's repository cards combined with option 1's green completion banner.
- Combined selected visual: `designs/repo-workbench/reference.png`.
- Real production renderer: `docs/screenshots/overview.png`, 880px wide at 2x (native 440pt panel).
- Side-by-side comparison: `designs/repo-workbench/comparison.png`, proportionally normalized to 880px widths.
- All screenshot content is synthetic and network requests are blocked. Real Git actions are replaced by a fixture bridge during capture.

Compared header/logo, full-width completion banner, All/Updates/Cleanup/Remote filters and counts, bulk toolbar, repo identity/current branch, status badge, task ordering, remote merge/MR states, per-task buttons, disclosure and footer. Original native brand and navy tokens are retained; real repo/check icons use Octicons, existing task icons are reused. MR remains an informational badge consistent with the existing app. Bulk remote deletion stays available in a separate Remote actions menu.

Initial comparison found flex-shrunk cards clipping task rows and excessive spacing. Changed the workbench container to block flow, made main content scroll within the capped panel, sized from natural content height, and tightened card/title/task/button spacing. Rebuilt and recaptured. Final layout follows the selected structure; system typography, flat button treatment, authentic operation counts, and the existing 440pt width remain intentional adaptations.

## Functional checks

Build, UI/Node/Electron TypeScript checks, and 21 isolated Electron scenarios passed without renderer errors:

- Repo workbench and success banner; update, cleanup and remote filters.
- Original Pull & Fix, cleanup and remote-delete confirmations; preference controls.
- Branch-specific delete confirmation and cancellation with zero backend calls.
- Confirmed deletion sends only the selected repo/branch; Pull sends only the selected repo.
- Repo collapse/expand restores task contents; persisted state uses the existing remember preference.
- Failure and working banners do not show green success styling.
- Empty task list; hidden remote preference removes remote filters/actions.
- Gone upstream has Pull & Fix and no plain Pull; long names do not overflow horizontally.
- At 440pt panel height, task content scrolls and footer stays inside the viewport.

Destructive Git semantics and backend implementations are unchanged. Cleanup and remote deletion still require the existing explicit confirmations. The generated mock's MR link artwork is represented by the app's existing MR badge rather than adding a new external-navigation feature.

Packaged macOS arm64 0.3.0, locally signed and signature verified. Installed bundle preserves the separate app-data directory and uses the existing packaged asset resolver for menu-bar artwork.

# Worktree-safe cleanup — 0.3.1

The reported failure occurred because local branch refs are shared by linked worktrees. Scans now exclude branches in use by other worktrees (and retain the current branch when primary is owned elsewhere). Repo cards explain retained branches. Clean rechecks ownership, deletes only confirmed branches still eligible, handles already-cleaned queued requests, and leaves a linked worktree on its current branch without touching the primary owner. Ordinary clones retain checkout-primary cleanup; pull errors now propagate rather than being silently discarded.

Validation: full build/typechecks passed; temporary Git integration tests verify dirty primary/linked worktrees retain their HEADs and edits, shared-ref stale requests succeed, a branch claimed after scan is retained, unconfirmed new branches survive, normal single-clone cleanup works, and pull failures are visible. Existing Pull & Fix self-test passed. All 22 isolated UI scenarios passed, including worktree-protected branches displaying with no Clean/Clean all action. Captured `docs/screenshots/worktree-protection.png`. No real repo cleanup was executed during testing.
