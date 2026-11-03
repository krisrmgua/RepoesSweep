import AppKit

public final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private var controller: RepoMenuController!

    public override init() { super.init() }

    public func applicationDidFinishLaunching(_ notification: Notification) {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        controller = RepoMenuController(statusItem: statusItem)
        controller.start()
    }
}
