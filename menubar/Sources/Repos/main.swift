import AppKit
import ReposCore

// `RepoesSweep --dump` prints the repo state as text; `RepoesSweep --pull-fix <path>` runs Pull & Fix on one repo.
if CommandLine.arguments.contains("--dump") {
    RepoDump.run()
    exit(0)
}
if let i = CommandLine.arguments.firstIndex(of: "--pull-fix"), i + 1 < CommandLine.arguments.count {
    PullFixCheck.run(path: CommandLine.arguments[i + 1])
    exit(0)
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
