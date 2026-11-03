import Foundation

/// One clone's state as the Repos section needs it.
struct RepoStatus: Identifiable {
    var id: String { path }
    let name: String          // path relative to the repo root
    let path: String
    var branch: String = ""
    var behind: Int = 0
    var primary: String?
    var cleanupBranches: [String] = []        // local branches other than primary
    var remoteBranches: [RemoteBranch] = []   // origin/* except HEAD and primary
    var dirtyCount: Int = 0
    var gone: Bool = false                    // upstream branch was deleted on the remote
    var error: String?
}

struct RemoteBranch: Equatable, Identifiable {
    var id: String { name }
    let name: String
    let merged: Bool   // reachable from origin/<primary>
}

enum ReposModel {
    /// Repo root: $MYGIT_REPO_ROOT, else ~/.config/mygit/repo-root, else ~/git-repos.
    static var root: String {
        let env = ProcessInfo.processInfo.environment
        if let r = env["MYGIT_REPO_ROOT"] ?? env["REPOS_TOOLBELT_ROOT"], !r.isEmpty { return r }
        let cfg = NSString(string: "~/.config/mygit/repo-root").expandingTildeInPath
        if let s = try? String(contentsOfFile: cfg, encoding: .utf8),
           let line = s.split(separator: "\n").first.map({ $0.trimmingCharacters(in: .whitespaces) }),
           !line.isEmpty, FileManager.default.fileExists(atPath: line) {
            return line
        }
        return NSString(string: "~/git-repos").expandingTildeInPath
    }

    static func discover() -> [String] {
        var found: [String] = []
        guard let e = FileManager.default.enumerator(atPath: root) else { return found }
        while let rel = e.nextObject() as? String {
            let name = (rel as NSString).lastPathComponent
            if name == ".git" { continue }
            if name == "node_modules" || name.hasPrefix(".terraform") { e.skipDescendants(); continue }
            let full = (root as NSString).appendingPathComponent(rel)
            if FileManager.default.fileExists(atPath: (full as NSString).appendingPathComponent(".git")) {
                found.append(full)
                e.skipDescendants()
            }
        }
        return found.sorted { $0.lowercased() < $1.lowercased() }
    }

    @discardableResult
    static func git(_ path: String, _ args: String..., timeout: Double = 60) -> (Int32, String) {
        let r = Shell.run(["git", "-C", path] + args, mergeStderr: true)
        return (r.status, r.out.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    static func primaryBranch(_ repo: String) -> String? {
        let (rc, head) = git(repo, "symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD")
        if rc == 0, head.hasPrefix("origin/") { return String(head.dropFirst("origin/".count)) }
        for name in ["main", "master"] {
            if git(repo, "show-ref", "--verify", "--quiet", "refs/heads/\(name)").0 == 0 { return name }
            if git(repo, "show-ref", "--verify", "--quiet", "refs/remotes/origin/\(name)").0 == 0 { return name }
        }
        return nil
    }

    /// Fetches origin (slow) and collects everything the Repos tabs show.
    static func scan(_ path: String, root: String) -> RepoStatus {
        let name = path.hasPrefix(root + "/") ? String(path.dropFirst(root.count + 1)) : path
        var s = RepoStatus(name: name, path: path)
        let (rc, br) = git(path, "symbolic-ref", "--quiet", "--short", "HEAD")
        guard rc == 0, !br.isEmpty else { s.error = "detached HEAD"; return s }
        s.branch = br
        git(path, "fetch", "--quiet", "--prune", "origin")
        guard git(path, "rev-parse", "--verify", "--quiet", "HEAD").0 == 0 else { s.error = "empty repo"; return s }

        let (crc, counts) = git(path, "rev-list", "--left-right", "--count", "HEAD...@{upstream}")
        if crc == 0 {
            let parts = counts.split(whereSeparator: { $0 == "\t" || $0 == " " })
            if parts.count >= 2 { s.behind = Int(parts[1]) ?? 0 }
        }
        s.dirtyCount = git(path, "status", "--porcelain").1.split(separator: "\n").count
        let sb = git(path, "status", "-sb").1.split(separator: "\n").first.map(String.init) ?? ""
        s.gone = sb.contains("[gone]")

        guard let primary = primaryBranch(path) else { return s }
        s.primary = primary
        let (lrc, locals) = git(path, "for-each-ref", "--format=%(refname:short)", "refs/heads/")
        if lrc == 0 {
            s.cleanupBranches = locals.split(separator: "\n").map(String.init).filter { $0 != primary && !$0.isEmpty }
        }
        s.remoteBranches = remoteBranches(path, primary: primary)
        return s
    }

    static func remoteBranches(_ path: String, primary: String) -> [RemoteBranch] {
        let (rc, out) = git(path, "for-each-ref", "--format=%(refname)%09%(symref)", "refs/remotes/origin/")
        guard rc == 0 else { return [] }
        let (mrc, mout) = git(path, "for-each-ref", "--merged=refs/remotes/origin/\(primary)", "--format=%(refname)", "refs/remotes/origin/")
        let merged = mrc == 0 ? Set(mout.split(separator: "\n").map(String.init)) : []
        let prefix = "refs/remotes/origin/"
        var result: [RemoteBranch] = []
        for line in out.split(separator: "\n") {
            let parts = line.split(separator: "\t", omittingEmptySubsequences: false)
            let ref = String(parts[0])
            if parts.count > 1 && !parts[1].isEmpty { continue }   // origin/HEAD symbolic ref
            if ref == prefix + primary { continue }
            result.append(RemoteBranch(name: String(ref.dropFirst(prefix.count)), merged: merged.contains(ref)))
        }
        return result.sorted { $0.name.lowercased() < $1.name.lowercased() }
    }

    /// `git pull --ff-only`, then a plain pull if that is rejected.
    static func pull(_ path: String) -> String? {
        if git(path, "pull", "--ff-only").0 == 0 { return nil }
        let (rc, out) = git(path, "pull")
        return rc == 0 ? nil : (out.isEmpty ? "pull failed" : String(out.prefix(160)))
    }

    /// Known failure causes, matched against git's error text (lowercase substrings).
    enum FixID { case checkoutPrimaryPull, stashPullPop, pullRebase }

    struct RepoIssue {
        let summary: String
        let fix: FixID?
    }

    static let failurePatterns: [(needles: [String], summary: String, fix: FixID?)] = [
        (["no such ref was fetched", "specifies to merge with the ref"], "Remote branch is gone", .checkoutPrimaryPull),
        (["would be overwritten by merge", "please commit your changes or stash", "local changes to the following files"], "Local changes block pull", .stashPullPop),
        (["not possible to fast-forward", "need to specify how to reconcile", "divergent branches"], "Local and remote diverged", .pullRebase),
        (["permission denied", "authentication failed", "could not read from remote", "publickey"], "Git auth / SSH failed", nil),
        (["not a git repository", "not a repo"], "Not a git repo", nil),
    ]

    static func classify(_ text: String) -> RepoIssue? {
        let low = text.lowercased()
        for p in failurePatterns where p.needles.contains(where: { low.contains($0) }) {
            return RepoIssue(summary: p.summary, fix: p.fix)
        }
        return nil
    }

    /// Plain `pull --ff-only`, falling back to `pull`. Returns nil on success, else git's output.
    static func pullRaw(_ path: String) -> String? {
        if git(path, "pull", "--ff-only").0 == 0 { return nil }
        let (rc, out) = git(path, "pull")
        return rc == 0 ? nil : (out.isEmpty ? "pull failed" : out)
    }

    /// Checks out the primary branch (stashing local edits if needed) and pulls.
    static func checkoutPrimaryPull(_ s: RepoStatus) -> String? {
        guard let primary = s.primary ?? primaryBranch(s.path) else { return "no main/master to check out" }
        if heldByOtherWorktree(s.path, primary) { return "\(primary) is checked out in another worktree; pull it there" }
        var (rc, out) = git(s.path, "checkout", primary)
        let low = out.lowercased()
        if rc != 0, ["overwritten", "local changes", "uncommitted", "stash"].contains(where: { low.contains($0) }) {
            git(s.path, "stash", "push", "-u", "-m", "Repoes Sweep before checkout primary")
            (rc, out) = git(s.path, "checkout", primary)
        }
        if rc != 0 { return "checkout \(primary) failed: \(String(out.prefix(120)))" }
        if let err = pullRaw(s.path) { return "pull failed: \(String(err.prefix(120)))" }
        return nil
    }

    static func pullRebase(_ path: String) -> String? {
        let (rc, out) = git(path, "pull", "--rebase")
        return rc == 0 ? nil : String((out.split(separator: "\n").last ?? "pull --rebase failed").prefix(160))
    }

    static func heldByOtherWorktree(_ path: String, _ branch: String) -> Bool {
        let (rc, out) = git(path, "for-each-ref", "--format=%(worktreepath)", "refs/heads/\(branch)")
        guard rc == 0 else { return false }
        let wt = out.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !wt.isEmpty else { return false }
        return URL(fileURLWithPath: wt).resolvingSymlinksInPath().path
            != URL(fileURLWithPath: path).resolvingSymlinksInPath().path
    }

    /// Pull & Fix: gone upstream -> checkout primary; local changes -> stash, pull, pop;
    /// diverged -> pull --rebase. Anything else is reported as-is.
    static func pullAndFix(_ s: RepoStatus) -> String? {
        if s.gone { return checkoutPrimaryPull(s) }
        if s.dirtyCount > 0 { return pullStashed(s.path) }
        guard let err = pullRaw(s.path) else { return nil }
        switch classify(err)?.fix {
        case .stashPullPop: return pullStashed(s.path)
        case .pullRebase: return pullRebase(s.path)
        case .checkoutPrimaryPull: return checkoutPrimaryPull(s)
        case nil: return String(err.split(separator: "\n").last.map(String.init)?.prefix(160) ?? "pull failed")
        }
    }

    /// Stashes local changes (including untracked), pulls, then pops the stash.
    /// If the pop conflicts, the changes stay in the stash and the message says so.
    static func pullStashed(_ path: String) -> String? {
        let dirty = !git(path, "status", "--porcelain").1.isEmpty
        if dirty, git(path, "stash", "push", "-u", "-m", "Repoes Sweep auto-stash").0 != 0 {
            return "stash failed"
        }
        let err = pull(path)
        if dirty {
            let (rc, out) = git(path, "stash", "pop")
            if rc != 0 { return "stash pop needs attention (changes are in git stash): \(String(out.prefix(120)))" }
        }
        return err
    }

    /// Checks out the primary branch, deletes every other local branch, then pulls.
    static func clean(_ s: RepoStatus) -> String? {
        guard let primary = s.primary else { return "no main/master" }
        let (crc, cout) = git(s.path, "checkout", primary)
        if crc != 0 { return "checkout \(primary): \(String(cout.prefix(120)))" }
        var failed: [String] = []
        for b in s.cleanupBranches where git(s.path, "branch", "-D", b).0 != 0 { failed.append(b) }
        _ = git(s.path, "pull", "--ff-only")
        return failed.isEmpty ? nil : "couldn't delete: \(failed.joined(separator: ", "))"
    }

    /// Deletes every listed origin branch. The primary branch is refused one by one.
    static func deleteRemotes(_ path: String, branches: [String], primary: String?) -> String? {
        var failed: [String] = []
        for branch in branches {
            if let err = deleteRemote(path, branch: branch, primary: primary) {
                failed.append("\(branch): \(err)")
            }
        }
        return failed.isEmpty ? nil : String(failed.joined(separator: "; ").prefix(160))
    }

    /// Deletes origin/<branch> on the remote. Refuses the primary branch and names that don't exist on origin.
    static func deleteRemote(_ path: String, branch: String, primary: String?) -> String? {
        guard branch != primary, !branch.hasPrefix("-") else { return "refused: \(branch)" }
        guard git(path, "show-ref", "--verify", "--quiet", "refs/remotes/origin/\(branch)").0 == 0 else {
            return "origin/\(branch) not found"
        }
        let (rc, out) = git(path, "push", "origin", "--delete", branch)
        return rc == 0 ? nil : String(out.prefix(160))
    }
}
