import AppKit

/// Options that Repoes Sweep saves in UserDefaults. Defaults: green for passing on,
/// remote branches shown (only yours), sections collapse when the panel closes, scan every 10 minutes.
enum ReposPrefs {
    private static let greenKey = "repos.greenForPassing"
    private static let remoteKey = "repos.showRemoteBranches"
    private static let myRemoteKey = "repos.showOnlyMyRemoteBranches"
    private static let rememberKey = "repos.rememberExpanded"
    private static let expandedKey = "repos.expandedSections"
    private static let scanKey = "repos.scanMinutes"

    static let scanChoices = [5, 10, 15, 20, 30, 60, 240, 480, 720, 1440]

    static var greenForPassing: Bool {
        get { bool(greenKey, true) }
        set { UserDefaults.standard.set(newValue, forKey: greenKey) }
    }
    static var showRemoteBranches: Bool {
        get { bool(remoteKey, true) }
        set { UserDefaults.standard.set(newValue, forKey: remoteKey) }
    }
    /// When remote branches are shown, keep only tips whose author email matches this clone's `user.email`.
    static var showOnlyMyRemoteBranches: Bool {
        get { bool(myRemoteKey, true) }
        set { UserDefaults.standard.set(newValue, forKey: myRemoteKey) }
    }
    /// On keeps Out of date, Cleanup, and Remote branches open after the panel closes.
    static var rememberExpanded: Bool {
        get { bool(rememberKey, false) }
        set { UserDefaults.standard.set(newValue, forKey: rememberKey) }
    }
    static var expandedSections: Set<String> {
        get { Set(UserDefaults.standard.stringArray(forKey: expandedKey) ?? []) }
        set { UserDefaults.standard.set(Array(newValue), forKey: expandedKey) }
    }
    /// Minutes between repo scans (each scan fetches every clone).
    static var scanMinutes: Int {
        get {
            let v = UserDefaults.standard.object(forKey: scanKey) as? Int ?? 10
            return scanChoices.contains(v) ? v : 10
        }
        set { UserDefaults.standard.set(newValue, forKey: scanKey) }
    }

    private static func bool(_ key: String, _ fallback: Bool) -> Bool {
        UserDefaults.standard.object(forKey: key) as? Bool ?? fallback
    }
}

/// What a piece of text means, so colors stay consistent in the panel.
enum Tone {
    case good, caution, warning, bad, running, dim, plain
}
