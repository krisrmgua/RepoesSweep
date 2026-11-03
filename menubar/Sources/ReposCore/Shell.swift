import Foundation

/// Runs a command and returns (exit status, stdout). Uses a PATH that includes Homebrew,
/// because `git` lives there and menu-bar apps inherit a minimal PATH.
enum Shell {
    static let env: [String: String] = {
        var e = ProcessInfo.processInfo.environment
        e["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
        return e
    }()

    @discardableResult
    /// `mergeStderr` puts git's messages (which go to stderr) into the returned text.
    static func run(_ args: [String], cwd: String? = nil, mergeStderr: Bool = false) -> (status: Int32, out: String) {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        p.arguments = args
        p.environment = env
        if let cwd { p.currentDirectoryURL = URL(fileURLWithPath: cwd) }
        let pipe = Pipe()
        p.standardOutput = pipe
        p.standardError = mergeStderr ? pipe : Pipe()
        do { try p.run() } catch { return (-1, "") }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        p.waitUntilExit()
        return (p.terminationStatus, String(decoding: data, as: UTF8.self))
    }
}
