import AppKit
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var backendProcess: Process?

    private let projectRoot = "/Users/bruceatabek/Desktop/INSPECTRIA"
    private let port = "4000"
    private var url: URL { URL(string: "http://localhost:\(port)")! }
    private var logFile: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Inspectria", isDirectory: true)
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        return base.appendingPathComponent("inspectria-app.log")
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        createWindow()
        appendLog("Inspectria native wrapper launched")
        startServicesAndLoad()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    func applicationWillTerminate(_ notification: Notification) {
        backendProcess?.terminate()
    }

    private func createWindow() {
        let configuration = WKWebViewConfiguration()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = true

        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1280, height: 820),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Inspectria"
        window.center()
        window.contentView = webView
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        showStatus("Inspectria başlatılıyor...")
    }

    private func showStatus(_ message: String) {
        let html = """
        <!doctype html>
        <html>
          <head>
            <meta charset=\"utf-8\" />
            <style>
              html, body { height: 100%; margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #eef6f5; color: #06323f; }
              body { display: grid; place-items: center; }
              main { text-align: center; padding: 32px; }
              h1 { margin: 0 0 12px; font-size: 30px; }
              p { margin: 0; color: #5e7378; font-size: 16px; }
            </style>
          </head>
          <body><main><h1>Inspectria</h1><p>\(escapeHtml(message))</p></main></body>
        </html>
        """
        webView.loadHTMLString(html, baseURL: nil)
    }

    func webView(
        _ webView: WKWebView,
        runOpenPanelWith parameters: WKOpenPanelParameters,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping ([URL]?) -> Void
    ) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.allowedContentTypes = [.image]

        panel.beginSheetModal(for: window) { response in
            completionHandler(response == .OK ? panel.urls : nil)
        }
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptAlertPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping () -> Void
    ) {
        let alert = NSAlert()
        alert.messageText = "Inspectria"
        alert.informativeText = message
        alert.addButton(withTitle: "OK")
        alert.beginSheetModal(for: window) { _ in
            completionHandler()
        }
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptConfirmPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (Bool) -> Void
    ) {
        let alert = NSAlert()
        alert.messageText = "Inspectria"
        alert.informativeText = message
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        alert.beginSheetModal(for: window) { response in
            completionHandler(response == .alertFirstButtonReturn)
        }
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptTextInputPanelWithPrompt prompt: String,
        defaultText: String?,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (String?) -> Void
    ) {
        let alert = NSAlert()
        alert.messageText = "Inspectria"
        alert.informativeText = prompt
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")

        let input = NSTextField(frame: NSRect(x: 0, y: 0, width: 320, height: 24))
        input.stringValue = defaultText ?? ""
        alert.accessoryView = input

        alert.beginSheetModal(for: window) { response in
            completionHandler(response == .alertFirstButtonReturn ? input.stringValue : nil)
        }
    }

    private func startServicesAndLoad() {
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                try self.ensurePostgres()
                if !self.isHealthy() {
                    try self.startBackend()
                }
                try self.waitForHealth()
                DispatchQueue.main.async {
                    self.webView.load(URLRequest(url: self.url))
                }
            } catch {
                self.appendLog("Startup failed: \(error.localizedDescription)")
                DispatchQueue.main.async {
                    self.showStatus("Başlatılamadı: \(error.localizedDescription)")
                }
            }
        }
    }

    private func ensurePostgres() throws {
        let pgCtl = projectRoot + "/.local-tools/Postgres.app/Contents/Versions/16/bin/pg_ctl"
        let initDb = projectRoot + "/.local-tools/Postgres.app/Contents/Versions/16/bin/initdb"
        let createdb = projectRoot + "/.local-tools/Postgres.app/Contents/Versions/16/bin/createdb"
        let pgData = projectRoot + "/backend/pgdata"

        guard FileManager.default.isExecutableFile(atPath: pgCtl) else {
            throw InspectriaError("Bundled PostgreSQL bulunamadı.")
        }

        if run(pgCtl, ["-D", pgData, "status"], allowFailure: true) == 0 {
            return
        }

        if !FileManager.default.fileExists(atPath: pgData) {
            let code = run(initDb, ["-D", pgData, "-U", "inspectra", "-A", "trust"], allowFailure: false)
            if code != 0 { throw InspectriaError("PostgreSQL data klasörü oluşturulamadı.") }
        }

        let code = run(pgCtl, ["-D", pgData, "-l", applicationLogPath(), "-o", "-p 5432", "start"], allowFailure: false)
        if code != 0 { throw InspectriaError("PostgreSQL başlatılamadı.") }
        _ = run(createdb, ["-h", "localhost", "-p", "5432", "-U", "inspectra", "inspectra"], allowFailure: true)
    }

    private func startBackend() throws {
        let node = findExecutable("node") ?? "/opt/homebrew/bin/node"
        guard FileManager.default.isExecutableFile(atPath: node) else {
            throw InspectriaError("Node.js bulunamadı.")
        }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: node)
        process.arguments = ["backend/server.js"]
        process.currentDirectoryURL = URL(fileURLWithPath: projectRoot)
        process.environment = mergedEnvironment()

        let handle = try FileHandle(forWritingTo: logFile)
        handle.seekToEndOfFile()
        process.standardOutput = handle
        process.standardError = handle

        try process.run()
        backendProcess = process
        appendLog("Backend started with pid \(process.processIdentifier)")
    }

    private func waitForHealth() throws {
        for _ in 0..<60 {
            if isHealthy() { return }
            Thread.sleep(forTimeInterval: 0.5)
        }
        throw InspectriaError("Inspectria backend zamanında yanıt vermedi.")
    }

    private func isHealthy() -> Bool {
        guard let healthUrl = URL(string: "http://localhost:\(port)/api/health") else { return false }
        var request = URLRequest(url: healthUrl)
        request.timeoutInterval = 1.0

        let semaphore = DispatchSemaphore(value: 0)
        var ok = false
        URLSession.shared.dataTask(with: request) { data, response, _ in
            if let http = response as? HTTPURLResponse, http.statusCode == 200, let data = data {
                ok = String(data: data, encoding: .utf8)?.contains("Inspectria") == true
            }
            semaphore.signal()
        }.resume()
        _ = semaphore.wait(timeout: .now() + 1.5)
        return ok
    }

    private func run(_ executable: String, _ arguments: [String], allowFailure: Bool) -> Int32 {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments
        process.currentDirectoryURL = URL(fileURLWithPath: projectRoot)
        process.environment = mergedEnvironment()

        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe

        do {
            try process.run()
            process.waitUntilExit()
            let output = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
            if !output.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                appendLog("$ \(executable) \(arguments.joined(separator: " "))\n\(output)")
            }
            if process.terminationStatus != 0 && !allowFailure {
                appendLog("Command failed with status \(process.terminationStatus)")
            }
            return process.terminationStatus
        } catch {
            appendLog("Command could not run: \(executable) \(error.localizedDescription)")
            return 127
        }
    }

    private func findExecutable(_ name: String) -> String? {
        for dir in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"] {
            let path = dir + "/" + name
            if FileManager.default.isExecutableFile(atPath: path) { return path }
        }
        return nil
    }

    private func mergedEnvironment() -> [String: String] {
        var env = ProcessInfo.processInfo.environment
        env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:" + (env["PATH"] ?? "")
        env["PORT"] = port
        return env
    }

    private func applicationLogPath() -> String {
        logFile.path
    }

    private func appendLog(_ message: String) {
        let line = "[\(Date())] \(message)\n"
        if !FileManager.default.fileExists(atPath: logFile.path) {
            FileManager.default.createFile(atPath: logFile.path, contents: nil)
        }
        if let handle = try? FileHandle(forWritingTo: logFile) {
            handle.seekToEndOfFile()
            if let data = line.data(using: .utf8) { handle.write(data) }
            try? handle.close()
        }
    }

    private func escapeHtml(_ input: String) -> String {
        input
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
    }
}

struct InspectriaError: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
