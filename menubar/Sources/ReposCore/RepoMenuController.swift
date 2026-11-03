import AppKit
import SwiftUI

/// Owns the Repoes Sweep menu-bar icon and the panel that opens from it.
public final class RepoMenuController: NSObject, NSPopoverDelegate {
    private let statusItem: NSStatusItem
    private let popover = NSPopover()
    private let model = SweepModel()
    private var outsideClickMonitor: Any?
    private var localClickMonitor: Any?
    private var resignObserver: NSObjectProtocol?
    private var appearanceObserver: NSKeyValueObservation?

    private var repos: [RepoStatus] = []
    private var lastScan: Date?
    private var scanTimer: Timer?
    private var scanning = false

    // Git work runs one job at a time so pulls, cleans, and deletes never overlap.
    private let work = DispatchQueue(label: "repos.work")
    private var pendingLabels: [String] = []
    private var lastResult: String?

    public init(statusItem: NSStatusItem) {
        self.statusItem = statusItem
        super.init()
        wirePanel()
        wireActions()
        statusItem.menu = nil
        statusItem.button?.target = self
        statusItem.button?.action = #selector(togglePanel)
        statusItem.button?.imagePosition = .imageOnly
        appearanceObserver = statusItem.button?.observe(\.effectiveAppearance) { [weak self] _, _ in
            DispatchQueue.main.async { self?.updateIcon() }
        }
        statusItem.button?.layer?.backgroundColor = nil
        updateIcon()
    }

    deinit {
        if let outsideClickMonitor { NSEvent.removeMonitor(outsideClickMonitor) }
        if let localClickMonitor { NSEvent.removeMonitor(localClickMonitor) }
        if let resignObserver { NotificationCenter.default.removeObserver(resignObserver) }
    }

    public func start() {
        refresh()
        scheduleTimer()
    }

    private func wirePanel() {
        popover.behavior = .transient
        popover.delegate = self
        outsideClickMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown, .otherMouseDown]) { [weak self] _ in
            guard let self, self.popover.isShown else { return }
            self.popover.performClose(nil)
        }
        localClickMonitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown, .otherMouseDown]) { [weak self] event in
            if let self, self.popover.isShown, let clicked = event.window,
               clicked !== self.popover.contentViewController?.view.window,
               clicked !== self.statusItem.button?.window,
               clicked.level.rawValue < NSWindow.Level.popUpMenu.rawValue, NSApp.modalWindow == nil {
                self.popover.performClose(nil)
            }
            return event
        }
        resignObserver = NotificationCenter.default.addObserver(forName: NSApplication.didResignActiveNotification, object: NSApp, queue: .main) { [weak self] _ in
            self?.popover.performClose(nil)
        }
        popover.contentSize = NSSize(width: 440, height: 540)
        model.maximumHeight = min(720, (NSScreen.main?.visibleFrame.height ?? 800) - 40)
        model.resize = { [weak self] size in self?.popover.contentSize = size }
        let host = NSHostingController(rootView: SweepPanel(model: model))
        host.view.appearance = NSAppearance(named: .darkAqua)
        popover.contentViewController = host
    }

    private func wireActions() {
        model.refresh = { [weak self] in self?.refresh() }
        model.pull = { [weak self] repo in self?.enqueue("Pull \(repo.name)") { ReposModel.pull(repo.path) } }
        model.pullFix = { [weak self] repo in self?.enqueue("Pull & Fix \(repo.name)") { ReposModel.pullAndFix(repo) } }
        model.clean = { [weak self] repo in self?.enqueue("Clean \(repo.name)") { ReposModel.clean(repo) } }
        model.pullAll = { [weak self] list in
            for repo in list { self?.enqueue("Pull \(repo.name)") { ReposModel.pull(repo.path) } }
        }
        model.pullFixAll = { [weak self] list in
            for repo in list { self?.enqueue("Pull & Fix \(repo.name)") { ReposModel.pullAndFix(repo) } }
        }
        model.cleanAll = { [weak self] list in
            for repo in list { self?.enqueue("Clean \(repo.name)") { ReposModel.clean(repo) } }
        }
        model.deleteRemote = { [weak self] request in
            let label = request.branches.count == 1
                ? "Delete origin/\(request.branches[0])"
                : "Delete \(request.branches.count) branches on \(request.repo)"
            self?.enqueue(label) {
                ReposModel.deleteRemotes(request.path, branches: request.branches, primary: request.primary)
            }
        }
        model.prefsChanged = { [weak self] in
            self?.scheduleTimer()
            self?.updateIcon()
            DispatchQueue.main.async { self?.model.objectWillChange.send() }
        }
        model.quit = { NSApp.terminate(nil) }
    }

    public func popoverDidClose(_ notification: Notification) {
        model.returnToOverview()
    }

    @objc private func togglePanel() {
        guard let button = statusItem.button else { return }
        if popover.isShown {
            popover.performClose(nil)
            return
        }
        model.maximumHeight = min(720, (button.window?.screen?.visibleFrame.height ?? 800) - 40)
        popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
        if lastScan.map({ Date().timeIntervalSince($0) > 120 }) ?? true { refresh() }
    }

    private func scheduleTimer() {
        scanTimer?.invalidate()
        scanTimer = Timer.scheduledTimer(withTimeInterval: TimeInterval(ReposPrefs.scanMinutes * 60), repeats: true) { [weak self] _ in
            self?.refresh()
        }
    }

    /// Fetches and scans every clone under the repo root, then updates the icon and panel.
    func refresh() {
        guard !scanning else { return }
        scanning = true
        model.scanning = true
        DispatchQueue.global(qos: .utility).async {
            let root = ReposModel.root
            let paths = ReposModel.discover()
            var results = [RepoStatus?](repeating: nil, count: paths.count)
            let lock = NSLock()
            DispatchQueue.concurrentPerform(iterations: paths.count) { i in
                let status = ReposModel.scan(paths[i], root: root)
                lock.lock(); results[i] = status; lock.unlock()
            }
            DispatchQueue.main.async {
                self.repos = results.compactMap { $0 }
                self.lastScan = Date()
                self.scanning = false
                self.model.repos = self.repos
                self.model.updated = self.lastScan
                self.model.scanning = false
                self.updateIcon()
            }
        }
    }

    /// Wings follow the menu bar. The center diamond is green only when out of date,
    /// cleanup, and remote branches are all empty.
    private func updateIcon() {
        let behind = repos.filter { $0.behind > 0 || $0.gone }.count
        let cleanup = repos.filter { !$0.cleanupBranches.isEmpty }.count
        let remote = repos.reduce(0) { $0 + $1.listedRemoteBranches.count }
        let clean = SweepModel.isClean(repos, updated: lastScan) && ReposPrefs.greenForPassing
        let diamond = clean ? Self.cleanGreen : Self.idleGray
        let appearance = statusItem.button?.effectiveAppearance ?? NSApp.effectiveAppearance
        let dark = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
        let wing: NSColor = dark ? .white : .black
        statusItem.button?.image = Self.menuBarImage(wing: wing, diamond: diamond)
        statusItem.button?.toolTip = "Repoes Sweep · \(behind) behind · \(cleanup) cleanup · \(remote) remote"
    }

    private static let cleanGreen = NSColor(srgbRed: 0.13, green: 0.75, blue: 0.42, alpha: 1)
    private static let idleGray = NSColor(srgbRed: 0.76, green: 0.78, blue: 0.82, alpha: 1)

    private static func menuBarImage(wing: NSColor, diamond: NSColor) -> NSImage {
        guard let wings = resource("RepoesSweepWings"), let gem = resource("RepoesSweepDiamond") else {
            let fallback = NSImage(systemSymbolName: "arrow.triangle.branch", accessibilityDescription: "Repoes Sweep") ?? NSImage()
            fallback.isTemplate = true
            return fallback
        }
        let height: CGFloat = 18
        let ratio = wings.size.height > 0 ? wings.size.width / wings.size.height : 1.4
        let size = NSSize(width: (height * ratio).rounded(), height: height)
        let image = NSImage(size: size)
        image.lockFocus()
        let rect = NSRect(origin: .zero, size: size)
        tint(wings, wing).draw(in: rect, from: .zero, operation: .sourceOver, fraction: 1)
        if let outline = resource("RepoesSweepDiamondOutline") {
            tint(outline, .black).draw(in: rect, from: .zero, operation: .sourceOver, fraction: 1)
        }
        tint(gem, diamond).draw(in: rect, from: .zero, operation: .sourceOver, fraction: 1)
        if let check = resource("RepoesSweepCheck") {
            tint(check, .black).draw(in: rect, from: .zero, operation: .sourceOver, fraction: 1)
        }
        image.unlockFocus()
        image.isTemplate = false
        image.accessibilityDescription = "Repoes Sweep"
        return image
    }

    private static func tint(_ image: NSImage, _ color: NSColor) -> NSImage {
        let copy = NSImage(size: image.size)
        copy.lockFocus()
        let rect = NSRect(origin: .zero, size: image.size)
        image.draw(in: rect)
        color.set()
        rect.fill(using: .sourceAtop)
        copy.unlockFocus()
        return copy
    }

    private static func resource(_ name: String) -> NSImage? {
        guard let url = Bundle.main.url(forResource: name, withExtension: "png") else { return nil }
        return NSImage(contentsOf: url)
    }

    /// Adds a git job to the serial queue; when it finishes, the repos are scanned again.
    private func enqueue(_ label: String, _ job: @escaping () -> String?) {
        DispatchQueue.main.async {
            self.pendingLabels.append(label)
            self.model.pending = self.pendingLabels
        }
        work.async {
            let err = job()
            DispatchQueue.main.async {
                self.pendingLabels.removeAll { $0 == label }
                self.lastResult = err.map { "Failed: \(label) — \($0)" } ?? "Done: \(label)"
                self.model.pending = self.pendingLabels
                self.model.result = self.lastResult
                self.refresh()
            }
        }
    }
}
