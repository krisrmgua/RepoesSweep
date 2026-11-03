import AppKit
import SwiftUI

struct RemoteDeleteRequest: Identifiable {
    struct Item {
        let repo: String
        let path: String
        let primary: String?
        let branches: [String]
    }

    let items: [Item]
    /// "all" / "merged" for cross-repo actions; nil for a single-repo delete.
    let scope: String?

    var branchCount: Int { items.reduce(0) { $0 + $1.branches.count } }
    var repoCount: Int { items.count }
    var id: String {
        (scope ?? "repo") + "\u{0}" + items.map { "\($0.path):\($0.branches.joined(separator: ","))" }.joined(separator: "|")
    }

    init(repo: String, path: String, primary: String?, branches: [String]) {
        items = [Item(repo: repo, path: path, primary: primary, branches: branches)]
        scope = nil
    }

    init(items: [Item], scope: String) {
        self.items = items
        self.scope = scope
    }
}

final class SweepModel: ObservableObject {
    @Published var repos: [RepoStatus] = []
    @Published var scanning = false
    @Published var updated: Date?
    @Published var pending: [String] = []
    @Published var result: String?
    @Published var settings = false
    @Published var confirmDelete: RemoteDeleteRequest?
    @Published var expanded: Set<String> = ReposPrefs.rememberExpanded ? ReposPrefs.expandedSections : []
    @Published var contentHeight: CGFloat = 420
    @Published var chromeHeight: CGFloat = 80
    @Published var maximumHeight: CGFloat = 700
    var resize: (NSSize) -> Void = { _ in }
    var refresh: () -> Void = {}
    var pull: (RepoStatus) -> Void = { _ in }
    var pullFix: (RepoStatus) -> Void = { _ in }
    var clean: (RepoStatus) -> Void = { _ in }
    var pullAll: ([RepoStatus]) -> Void = { _ in }
    var pullFixAll: ([RepoStatus]) -> Void = { _ in }
    var cleanAll: ([RepoStatus]) -> Void = { _ in }
    var deleteRemote: (RemoteDeleteRequest) -> Void = { _ in }
    var prefsChanged: () -> Void = {}
    var quit: () -> Void = {}

    var outdated: [RepoStatus] { repos.filter { $0.behind > 0 || $0.gone } }
    var cleanup: [RepoStatus] { repos.filter { !$0.cleanupBranches.isEmpty } }
    var remotes: [RepoStatus] { repos.filter { !$0.listedRemoteBranches.isEmpty } }
    var remoteCount: Int { repos.reduce(0) { $0 + $1.listedRemoteBranches.count } }
    var mergedRemoteCount: Int {
        repos.reduce(0) { $0 + $1.listedRemoteBranches.filter(\.merged).count }
    }

    enum RemoteDeleteFilter { case all, merged, withoutMR }

    var remoteWithoutMRCount: Int {
        repos.reduce(0) { $0 + $1.listedRemoteBranches.filter { !$0.hasOpenMR }.count }
    }

    func remoteDeleteRequest(_ filter: RemoteDeleteFilter) -> RemoteDeleteRequest? {
        let items: [RemoteDeleteRequest.Item] = remotes.compactMap { repo in
            let branches = repo.listedRemoteBranches
                .filter {
                    switch filter {
                    case .all: return true
                    case .merged: return $0.merged
                    case .withoutMR: return !$0.hasOpenMR
                    }
                }
                .map(\.name)
            guard !branches.isEmpty else { return nil }
            return RemoteDeleteRequest.Item(repo: repo.name, path: repo.path, primary: repo.primary, branches: branches)
        }
        guard !items.isEmpty else { return nil }
        let scope: String
        switch filter {
        case .all: scope = "all"
        case .merged: scope = "merged"
        case .withoutMR: scope = "withoutMR"
        }
        return RemoteDeleteRequest(items: items, scope: scope)
    }

    static func isClean(_ repos: [RepoStatus], updated: Date?) -> Bool {
        guard updated != nil else { return false }
        return !repos.contains { $0.behind > 0 || $0.gone || !$0.cleanupBranches.isEmpty || !$0.listedRemoteBranches.isEmpty }
    }

    func returnToOverview() {
        settings = false
        confirmDelete = nil
        if !ReposPrefs.rememberExpanded { expanded = [] }
    }

    func toggleSection(_ title: String) {
        if expanded.contains(title) { expanded.remove(title) } else { expanded.insert(title) }
        if ReposPrefs.rememberExpanded { ReposPrefs.expandedSections = expanded }
    }
}

private enum SweepStyle {
    static let background = Color(red: 0.055, green: 0.10, blue: 0.16)
    static let card = Color(red: 0.10, green: 0.17, blue: 0.25)
    static let cyan = Color(red: 0.30, green: 0.82, blue: 0.96)
    static let green = Color(red: 0.46, green: 0.88, blue: 0.70)
    static let amber = Color(red: 0.94, green: 0.80, blue: 0.52)
    static let red = Color(red: 1, green: 0.56, blue: 0.61)
    static let secondary = Color(red: 0.60, green: 0.68, blue: 0.78)

    static func status(_ tone: Tone) -> Color {
        switch tone {
        case .good: return ReposPrefs.greenForPassing ? green : secondary
        case .caution: return amber
        case .warning: return Color.orange
        case .bad: return red
        default: return secondary
        }
    }
}

private struct SweepContentHeight: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = max(value, nextValue()) }
}

private struct SweepChromeHeight: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value += nextValue() }
}

struct SweepPanel: View {
    @ObservedObject var model: SweepModel

    private var fittedSize: NSSize {
        let height = ceil(model.contentHeight + model.chromeHeight + 2)
        return NSSize(width: 440, height: min(model.maximumHeight, max(220, height)))
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider().overlay(Color.white.opacity(0.08))
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    if model.settings { preferences } else { overview }
                }
                .padding(12)
                .fixedSize(horizontal: false, vertical: true)
                .background(GeometryReader { geo in Color.clear.preference(key: SweepContentHeight.self, value: geo.size.height) })
            }
            .id(model.settings ? "settings" : "overview")
            Divider().overlay(Color.white.opacity(0.08))
            footer
        }
        .frame(width: fittedSize.width, height: fittedSize.height)
        .background(SweepStyle.background)
        .foregroundColor(.white)
        .preferredColorScheme(.dark)
        .tint(SweepStyle.cyan)
        .onPreferenceChange(SweepContentHeight.self) { if $0 > 0 { model.contentHeight = $0 } }
        .onPreferenceChange(SweepChromeHeight.self) { if $0 > 0 { model.chromeHeight = $0 } }
        .onChange(of: fittedSize) { model.resize($0) }
        .onAppear { model.resize(fittedSize) }
        .overlay {
            if let request = model.confirmDelete {
                ZStack {
                    Color.black.opacity(0.45)
                    deleteConfirm(request).frame(width: 300)
                        .shadow(color: .black.opacity(0.4), radius: 20)
                }
            }
        }
    }

    private var header: some View {
        HStack(spacing: 10) {
            if model.settings {
                Button { model.settings = false } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "chevron.left").font(.system(size: 12, weight: .semibold))
                        Text("Preferences").font(.system(size: 13, weight: .semibold))
                    }
                }
                .buttonStyle(SweepBackStyle())
            } else {
                mark(size: 22)
                Text("Repoes Sweep").font(.system(size: 15, weight: .semibold))
            }
            Spacer()
            if model.scanning { ProgressView().controlSize(.small) }
            Button { model.refresh() } label: { Image(systemName: "arrow.clockwise") }
                .buttonStyle(.plain).help("Refresh")
            if !model.settings {
                Button { model.settings = true } label: { Image(systemName: "gearshape") }
                    .buttonStyle(.plain).help("Preferences")
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
        .background(GeometryReader { geo in Color.clear.preference(key: SweepChromeHeight.self, value: geo.size.height) })
    }

    private var footer: some View {
        HStack {
            Text(model.updated.map { "Updated " + $0.formatted(date: .omitted, time: .shortened) } ?? "Scanning clones…")
            Spacer()
            Text("\(model.repos.count) repos")
            Button("Quit") { model.quit() }.buttonStyle(.plain).keyboardShortcut("q", modifiers: .command)
        }
        .font(.system(size: 10))
        .foregroundColor(SweepStyle.secondary)
        .padding(.horizontal, 12).padding(.vertical, 8)
        .background(GeometryReader { geo in Color.clear.preference(key: SweepChromeHeight.self, value: geo.size.height) })
    }

    private var overview: some View {
        VStack(alignment: .leading, spacing: 12) {
            if !model.pending.isEmpty {
                Text("Working: \(model.pending[0])" + (model.pending.count > 1 ? " (+\(model.pending.count - 1) queued)" : ""))
                    .font(.system(size: 11)).foregroundColor(SweepStyle.amber)
            }
            if let result = model.result {
                Text(result).font(.system(size: 11)).foregroundColor(SweepStyle.secondary).lineLimit(2)
            }
            section("Out of date", count: model.outdated.count, color: model.updated == nil ? SweepStyle.secondary : (model.outdated.isEmpty ? SweepStyle.green : SweepStyle.amber), symbol: "arrow.down.circle") {
                if model.updated == nil {
                    empty(model.scanning ? "Scanning clones…" : "No scan yet")
                } else if model.outdated.isEmpty {
                    empty("All repos up to date")
                } else {
                    HStack(spacing: 8) {
                        Button("Pull all (\(model.outdated.filter { !$0.gone }.count))") { model.pullAll(model.outdated.filter { !$0.gone }) }
                            .buttonStyle(SweepActionStyle())
                        Button("Pull & Fix all (\(model.outdated.count))") { model.pullFixAll(model.outdated) }
                            .buttonStyle(SweepActionStyle(primary: true))
                    }.padding(10)
                    ForEach(model.outdated) { repo in
                        divider
                        HStack(alignment: .center, spacing: 8) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(repo.name).font(.system(size: 12, weight: .medium)).lineLimit(1)
                                Text(repo.gone ? "Remote branch gone" : "\(repo.behind) behind")
                                    .font(.system(size: 10))
                                    .foregroundColor(SweepStyle.status(repo.gone ? .bad : .warning))
                            }
                            Spacer(minLength: 6)
                            if !repo.gone {
                                Button("Pull") { model.pull(repo) }.buttonStyle(SweepInlineStyle())
                            }
                            Button("Pull & Fix") { model.pullFix(repo) }.buttonStyle(SweepInlineStyle())
                        }.padding(.horizontal, 10).padding(.vertical, 8)
                    }
                }
            }
            section("Cleanup", count: model.cleanup.count, color: model.updated == nil ? SweepStyle.secondary : (model.cleanup.isEmpty ? SweepStyle.green : SweepStyle.amber), symbol: "scissors") {
                if model.updated == nil {
                    empty("Scanning clones…")
                } else if model.cleanup.isEmpty {
                    empty("No extra local branches")
                } else {
                    Button("Clean all (\(model.cleanup.count))") { model.cleanAll(model.cleanup) }
                        .buttonStyle(SweepActionStyle()).padding(10)
                    ForEach(model.cleanup) { repo in
                        divider
                        HStack(alignment: .center, spacing: 8) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(repo.name).font(.system(size: 12, weight: .medium)).lineLimit(1)
                                Text(repo.cleanupBranches.joined(separator: ", "))
                                    .font(.system(size: 10)).foregroundColor(SweepStyle.secondary).lineLimit(1)
                            }
                            Spacer(minLength: 6)
                            Button("Clean") { model.clean(repo) }.buttonStyle(SweepInlineStyle())
                        }.padding(.horizontal, 10).padding(.vertical, 8)
                    }
                }
            }
            if ReposPrefs.showRemoteBranches {
                section("Remote branches", count: model.remoteCount, color: model.updated == nil ? SweepStyle.secondary : (model.remotes.isEmpty ? SweepStyle.green : SweepStyle.cyan), symbol: "arrow.triangle.branch") {
                    if model.updated == nil {
                        empty("Scanning clones…")
                    } else if model.remotes.isEmpty {
                        empty("No remote branches")
                    } else {
                        HStack(spacing: 8) {
                            Spacer(minLength: 0)
                            if model.mergedRemoteCount > 0 {
                                Button("Delete all merged") {
                                    model.confirmDelete = model.remoteDeleteRequest(.merged)
                                }.buttonStyle(SweepInlineStyle())
                            }
                            if model.remoteWithoutMRCount > 0 {
                                Button("Delete all without MR") {
                                    model.confirmDelete = model.remoteDeleteRequest(.withoutMR)
                                }.buttonStyle(SweepInlineStyle())
                            }
                            Button("Delete all") {
                                model.confirmDelete = model.remoteDeleteRequest(.all)
                            }.buttonStyle(SweepInlineStyle())
                        }.padding(.horizontal, 10).padding(.top, 8).padding(.bottom, 4)
                        divider
                        ForEach(Array(model.remotes.enumerated()), id: \.element.id) { index, repo in
                            if index > 0 { divider }
                            VStack(alignment: .leading, spacing: 0) {
                                HStack(spacing: 8) {
                                    Text("\(repo.name)  ·  \(repo.primary ?? "primary")")
                                        .font(.system(size: 11, weight: .semibold))
                                        .foregroundColor(SweepStyle.secondary)
                                        .lineLimit(1)
                                    Spacer(minLength: 6)
                                    Button("Delete all") {
                                        model.confirmDelete = RemoteDeleteRequest(repo: repo.name, path: repo.path, primary: repo.primary, branches: repo.listedRemoteBranches.map(\.name))
                                    }.buttonStyle(SweepInlineStyle())
                                }.padding(.horizontal, 10).padding(.top, 8).padding(.bottom, 4)
                                ForEach(repo.listedRemoteBranches) { branch in
                                    HStack(spacing: 8) {
                                        Text(branch.name).font(.system(size: 12)).lineLimit(1)
                                        if branch.hasOpenMR {
                                            Text("MR")
                                                .font(.system(size: 9, weight: .bold))
                                                .foregroundColor(SweepStyle.cyan)
                                                .padding(.horizontal, 5)
                                                .padding(.vertical, 1)
                                                .background(SweepStyle.cyan.opacity(0.14))
                                                .overlay(RoundedRectangle(cornerRadius: 4).stroke(SweepStyle.cyan.opacity(0.45)))
                                                .cornerRadius(4)
                                                .help("Open merge request on this branch")
                                                .accessibilityLabel("Open merge request")
                                        }
                                        Spacer(minLength: 6)
                                        Text(branch.merged ? "merged" : "not merged")
                                            .font(.system(size: 10, weight: .medium))
                                            .foregroundColor(SweepStyle.status(branch.merged ? .good : .caution))
                                        Button("Delete") {
                                            model.confirmDelete = RemoteDeleteRequest(repo: repo.name, path: repo.path, primary: repo.primary, branches: [branch.name])
                                        }.buttonStyle(SweepInlineStyle())
                                    }.padding(.horizontal, 10).padding(.vertical, 5)
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    private var preferences: some View {
        VStack(alignment: .leading, spacing: 12) {
            card {
                prefToggle("Green for passing", ReposPrefs.greenForPassing) { ReposPrefs.greenForPassing = $0 }
                divider
                prefToggle("Show remote branches", ReposPrefs.showRemoteBranches) { ReposPrefs.showRemoteBranches = $0 }
                if ReposPrefs.showRemoteBranches {
                    divider
                    prefToggle("Only my remote branches", ReposPrefs.showOnlyMyRemoteBranches) {
                        ReposPrefs.showOnlyMyRemoteBranches = $0
                    }
                    .padding(.leading, 14)
                }
                divider
                prefToggle("Remember open sections", ReposPrefs.rememberExpanded) {
                    ReposPrefs.rememberExpanded = $0
                    ReposPrefs.expandedSections = $0 ? model.expanded : []
                }
            }
            Text("Scan every").font(.system(size: 12, weight: .semibold)).padding(.horizontal, 2)
            card {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 92), spacing: 6)], spacing: 6) {
                    ForEach(ReposPrefs.scanChoices, id: \.self) { minutes in
                        Button(Self.intervalLabel(minutes)) {
                            ReposPrefs.scanMinutes = minutes
                            model.prefsChanged()
                        }
                        .buttonStyle(SweepChoiceStyle(selected: minutes == ReposPrefs.scanMinutes))
                    }
                }.padding(10)
            }
            Text(ReposPrefs.rememberExpanded
                 ? "Open sections stay open after you close the panel."
                 : "Open sections collapse each time you close the panel.")
                .font(.system(size: 10)).foregroundColor(SweepStyle.secondary).padding(.horizontal, 2)
            Text("Timer scans skip fetch when a clone was fetched recently. Refresh always fetches.")
                .font(.system(size: 10)).foregroundColor(SweepStyle.secondary).padding(.horizontal, 2)
        }
    }

    private func prefToggle(_ title: String, _ on: Bool, _ set: @escaping (Bool) -> Void) -> some View {
        Toggle(title, isOn: Binding(get: { on }, set: { set($0); model.prefsChanged() }))
            .font(.system(size: 12))
            .toggleStyle(.switch)
            .padding(.horizontal, 10).padding(.vertical, 7)
    }

    private func deleteConfirm(_ request: RemoteDeleteRequest) -> some View {
        let title: String
        let detail: String
        if request.scope == "merged" {
            title = "Delete \(request.branchCount) merged remote branches?"
            detail = "This deletes every merged origin branch listed across \(request.repoCount) repos. Primary branches stay. It cannot be undone from here."
        } else if request.scope == "withoutMR" {
            title = "Delete \(request.branchCount) remote branches without an MR?"
            detail = "This deletes every listed origin branch with no open merge request across \(request.repoCount) repos. Branches with an MR badge stay. Primary branches stay. It cannot be undone from here."
        } else if request.scope == "all" {
            title = "Delete \(request.branchCount) remote branches?"
            detail = "This deletes every listed origin branch across \(request.repoCount) repos. Primary branches stay. It cannot be undone from here."
        } else if let item = request.items.first, request.branchCount > 1 {
            let kept = item.primary.map { "\($0) stays." } ?? "The primary branch stays."
            title = "Delete \(request.branchCount) remote branches?"
            detail = "This deletes every origin branch listed for \(item.repo). \(kept) It cannot be undone from here."
        } else {
            let item = request.items.first
            title = "Delete origin/\(item?.branches.first ?? "")?"
            detail = "This deletes the branch on the remote for \(item?.repo ?? "this repo"). It cannot be undone from here."
        }
        return VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.system(size: 13, weight: .semibold))
            Text(detail)
                .font(.system(size: 11)).foregroundColor(SweepStyle.secondary).fixedSize(horizontal: false, vertical: true)
            HStack {
                Button("Cancel") { model.confirmDelete = nil }.buttonStyle(SweepActionStyle())
                Button("Delete") {
                    model.confirmDelete = nil
                    model.deleteRemote(request)
                }.buttonStyle(SweepActionStyle(primary: true))
            }
        }
        .padding(14)
        .background(SweepStyle.card)
        .cornerRadius(10)
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.white.opacity(0.08)))
    }

    private func section<Content: View>(_ title: String, count: Int, color: Color, symbol: String, @ViewBuilder _ content: () -> Content) -> some View {
        let open = model.expanded.contains(title)
        return VStack(alignment: .leading, spacing: 6) {
            Button {
                model.toggleSection(title)
            } label: {
                HStack(spacing: 7) {
                    Image(systemName: symbol).font(.system(size: 12)).foregroundColor(color).frame(width: 16)
                    Text(title).font(.system(size: 12, weight: .semibold))
                    Text("\(count)").font(.system(size: 10, weight: .semibold)).foregroundColor(color)
                        .padding(.horizontal, 5).padding(.vertical, 2)
                        .background(color.opacity(0.12)).clipShape(Capsule())
                    Spacer()
                    Image(systemName: open ? "chevron.up" : "chevron.down")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(SweepStyle.secondary)
                }
                .padding(.horizontal, 2)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if open { card(content) }
        }
    }

    private func card<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 0, content: content)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(SweepStyle.card.opacity(0.7))
            .cornerRadius(9)
            .overlay(RoundedRectangle(cornerRadius: 9).stroke(Color.white.opacity(0.06), lineWidth: 1))
    }

    private func empty(_ text: String) -> some View {
        Text(text).font(.system(size: 11)).foregroundColor(SweepStyle.secondary)
            .padding(.horizontal, 12).padding(.vertical, 13)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var divider: some View { Rectangle().fill(Color.white.opacity(0.07)).frame(height: 1).padding(.horizontal, 10) }

    @ViewBuilder private func mark(size: CGFloat) -> some View {
        if let wings = Self.resource("RepoesSweepWings"), let diamond = Self.resource("RepoesSweepDiamond") {
            ZStack {
                Image(nsImage: wings).resizable().renderingMode(.template).foregroundColor(.white).scaledToFit()
                if let outline = Self.resource("RepoesSweepDiamondOutline") {
                    Image(nsImage: outline).resizable().renderingMode(.template).foregroundColor(.black).scaledToFit()
                }
                Image(nsImage: diamond).resizable().renderingMode(.template).foregroundColor(headerDiamond).scaledToFit()
                if let check = Self.resource("RepoesSweepCheck") {
                    Image(nsImage: check).resizable().renderingMode(.template).foregroundColor(.black).scaledToFit()
                }
            }.frame(width: size * 1.4, height: size)
        }
    }

    private var headerDiamond: Color {
        guard SweepModel.isClean(model.repos, updated: model.updated), ReposPrefs.greenForPassing else {
            return Color(red: 0.76, green: 0.78, blue: 0.82)
        }
        return Color(red: 0.13, green: 0.75, blue: 0.42)
    }

    private static func resource(_ name: String) -> NSImage? {
        Bundle.main.url(forResource: name, withExtension: "png").flatMap { NSImage(contentsOf: $0) }
    }

    private static func intervalLabel(_ minutes: Int) -> String {
        switch minutes {
        case 60: return "1 hour"
        case 1440: return "1 day"
        case _ where minutes >= 60 && minutes % 60 == 0: return "\(minutes / 60) hours"
        default: return "\(minutes) minutes"
        }
    }
}

private struct SweepBackStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .padding(.horizontal, 8).padding(.vertical, 5)
            .background(Color.white.opacity(configuration.isPressed ? 0.16 : 0.08))
            .cornerRadius(6)
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.white.opacity(0.14), lineWidth: 0.5))
    }
}

private struct SweepActionStyle: ButtonStyle {
    var primary = false
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.font(.system(size: 11, weight: .medium)).frame(maxWidth: .infinity)
            .padding(.horizontal, 10).padding(.vertical, 7)
            .background(primary ? SweepStyle.cyan.opacity(configuration.isPressed ? 0.55 : 0.9) : Color.white.opacity(configuration.isPressed ? 0.14 : 0.07))
            .foregroundColor(primary ? SweepStyle.background : .white)
            .cornerRadius(6)
    }
}

private struct SweepInlineStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.font(.system(size: 10, weight: .medium)).lineLimit(1)
            .padding(.horizontal, 7).padding(.vertical, 3)
            .foregroundColor(Color.white.opacity(0.9))
            .background(Color.white.opacity(configuration.isPressed ? 0.14 : 0.04))
            .cornerRadius(4)
            .overlay(RoundedRectangle(cornerRadius: 4).stroke(Color.white.opacity(0.13), lineWidth: 0.5))
    }
}

private struct SweepChoiceStyle: ButtonStyle {
    var selected = false
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.font(.system(size: 11, weight: selected ? .semibold : .regular))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 6)
            .background(selected ? SweepStyle.cyan.opacity(0.22) : Color.white.opacity(configuration.isPressed ? 0.1 : 0.04))
            .foregroundColor(selected ? SweepStyle.cyan : .white)
            .cornerRadius(6)
    }
}
