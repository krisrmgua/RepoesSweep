import Foundation

/// `RepoesSweep --dump` prints every clone's state as text, for checking without the menu bar.
public enum RepoDump {
    public static func run() {
        print("== Repoes Sweep under \(ReposModel.root)")
        let openMRs = ReposPrefs.showRemoteBranches ? ReposModel.authoredOpenMRBranches() : [:]
        for path in ReposModel.discover() {
            let s = ReposModel.scan(path, root: ReposModel.root, openMRsByProject: openMRs)
            let merged = s.remoteBranches.filter { $0.merged }.count
            print("  \(s.name) branch=\(s.branch) behind=\(s.behind) primary=\(s.primary ?? "-") cleanup=\(s.cleanupBranches.count) remote=\(s.remoteBranches.count) merged=\(merged)\(s.error.map { " error=\($0)" } ?? "")")
        }
    }
}

/// `RepoesSweep --pull-fix <path>` runs Pull & Fix on one repo and prints the scan before and after.
public enum PullFixCheck {
    public static func run(path: String) {
        let root = (path as NSString).deletingLastPathComponent
        let before = ReposModel.scan(path, root: root)
        print("before: behind=\(before.behind) dirty=\(before.dirtyCount) gone=\(before.gone)")
        let result = ReposModel.pullAndFix(before)
        print("result: \(result ?? "ok")")
        let after = ReposModel.scan(path, root: root)
        print("after:  behind=\(after.behind) dirty=\(after.dirtyCount) branch=\(after.branch)")
    }
}
