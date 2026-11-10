import AppKit

final class Launcher: NSObject, NSApplicationDelegate {
    private let server = Process()
    private let data = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("Eidos", isDirectory: true)
    private var quitting = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        let menu = NSMenu()
        let item = NSMenuItem()
        let actions = NSMenu()
        actions.addItem(withTitle: "退出 Eidos", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        item.submenu = actions
        menu.addItem(item)
        NSApp.mainMenu = menu

        do {
            try start()
        } catch {
            showError(error.localizedDescription)
        }
    }

    private func start() throws {
        let resources = Bundle.main.resourceURL!
        try FileManager.default.createDirectory(at: data, withIntermediateDirectories: true)
        let log = data.appendingPathComponent("player.log")
        try Data().write(to: log)
        let output = try FileHandle(forWritingTo: log)
        server.executableURL = resources.appendingPathComponent("runtime/node")
        server.arguments = [resources.appendingPathComponent("start.mjs").path]
        server.standardOutput = output
        server.standardError = output
        server.terminationHandler = { [weak self] _ in
            DispatchQueue.main.async {
                guard let self, !self.quitting else { return }
                self.showError("请关闭已经运行的 Eidos 后重试。启动日志位于 \(log.path)。")
            }
        }
        try server.run()
    }

    private func showError(_ message: String) {
        NSApp.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        alert.messageText = "Eidos 未能启动"
        alert.informativeText = message
        alert.addButton(withTitle: "关闭")
        alert.runModal()
        NSApp.terminate(nil)
    }

    func applicationWillTerminate(_ notification: Notification) {
        quitting = true
        if server.isRunning { server.terminate() }
    }
}

let app = NSApplication.shared
let launcher = Launcher()
app.delegate = launcher
app.setActivationPolicy(.regular)
app.run()
