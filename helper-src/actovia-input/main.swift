// actovia-input — the native input/perception helper for Actovia's Computer Use runtime.
//
// A single-file command-line tool with three subcommands:
//
//   actovia-input list-windows
//       Prints a JSON array of on-screen, layer-0 windows (Actovia's own windows
//       excluded) to stdout:
//         [{ "id": Number, "app": String, "bundleId": String,
//            "title": String, "bounds": [x, y, w, h] }]
//       `title` requires Screen Recording permission; without it the field is
//       present but empty. This subcommand itself needs no TCC permission.
//
//   actovia-input screenshot --window <id>
//       Writes PNG bytes for the given window to stdout. Exits 1 with a stderr
//       message if the window is gone or capture fails (needs Screen Recording).
//
//   actovia-input input [--clamp x,y,w,h]
//       Reads newline-delimited JSON commands on stdin, one per line, and posts
//       the matching CGEvent immediately (needs Accessibility):
//         {"op":"move","x":N,"y":N}
//         {"op":"down","button":"left|right|middle"}
//         {"op":"up","button":"left|right|middle"}
//         {"op":"wheel","dx":N,"dy":N}
//         {"op":"key","code":N,"down":true|false}
//       --clamp restricts every `move` point to the given rect.

import AppKit
import CoreGraphics
import Foundation
import ScreenCaptureKit

enum ActoviaInput {
  static let ownBundleId = "app.yancey.actovia"
  static let ownAppName = "Actovia"

  // MARK: - Small shared helpers

  static func stderr(_ message: String) {
    FileHandle.standardError.write(Data((message + "\n").utf8))
  }

  static func fail(_ message: String, code: Int32 = 1) -> Never {
    stderr(message)
    exit(code)
  }

  static func optionValue(_ args: [String], _ name: String) -> String? {
    guard let index = args.firstIndex(of: name), index + 1 < args.count else { return nil }
    return args[index + 1]
  }

  /// JSONSerialization hands back `NSNumber` for every JSON number; normalize.
  static func asDouble(_ value: Any?) -> Double? {
    switch value {
    case let number as NSNumber: return number.doubleValue
    case let double as Double: return double
    case let int as Int: return Double(int)
    default: return nil
    }
  }

  // MARK: - list-windows

  static func listWindows() {
    let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
    guard
      let rawWindows = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]]
    else {
      print("[]")
      return
    }

    var result: [[String: Any]] = []
    // CGWindowListCopyWindowInfo returns windows front-to-back; keep that order
    // so callers can pick the frontmost match.
    for window in rawWindows {
      let layer = Int(asDouble(window[kCGWindowLayer as String]) ?? -1)
      if layer != 0 { continue }

      guard let id = asDouble(window[kCGWindowNumber as String]).map({ Int($0) }) else { continue }

      let app = window[kCGWindowOwnerName as String] as? String ?? ""

      var bundleId = ""
      if let pidValue = asDouble(window[kCGWindowOwnerPID as String]),
        let running = NSRunningApplication(processIdentifier: pid_t(pidValue))
      {
        bundleId = running.bundleIdentifier ?? ""
      }

      if bundleId == ownBundleId || app == ownAppName { continue }

      // kCGWindowName is nil/empty without Screen Recording permission — still emit it.
      let title = window[kCGWindowName as String] as? String ?? ""

      var bounds: [Double] = [0, 0, 0, 0]
      if let boundsDict = window[kCGWindowBounds as String] as? [String: Any],
        let rect = CGRect(dictionaryRepresentation: boundsDict as CFDictionary)
      {
        bounds = [rect.origin.x, rect.origin.y, rect.size.width, rect.size.height]
      }
      if bounds[2] < 1 || bounds[3] < 1 { continue }

      result.append([
        "id": id,
        "app": app,
        "bundleId": bundleId,
        "title": title,
        "bounds": bounds,
      ])
    }

    guard let data = try? JSONSerialization.data(withJSONObject: result) else {
      print("[]")
      return
    }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
  }

  // MARK: - screenshot

  static func windowExists(_ id: CGWindowID) -> Bool {
    guard
      let list = CGWindowListCopyWindowInfo(.optionIncludingWindow, id) as? [[String: Any]]
    else {
      return false
    }
    return !list.isEmpty
  }

  static func pngData(from image: CGImage) -> Data? {
    NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:])
  }

  static func captureViaScreenCaptureKit(_ id: CGWindowID) async -> Data? {
    guard #available(macOS 14.0, *) else { return nil }
    do {
      let content = try await SCShareableContent.excludingDesktopWindows(
        false, onScreenWindowsOnly: true)
      guard let window = content.windows.first(where: { $0.windowID == id }) else { return nil }

      let filter = SCContentFilter(desktopIndependentWindow: window)
      let config = SCStreamConfiguration()
      config.width = Int(filter.contentRect.width * CGFloat(filter.pointPixelScale))
      config.height = Int(filter.contentRect.height * CGFloat(filter.pointPixelScale))
      // Keep the crop faithful to the window and consistent with the
      // CoreGraphics fallback (which never draws the cursor or shadow).
      config.showsCursor = false
      config.ignoreShadowsSingleWindow = true

      let image = try await SCScreenshotManager.captureImage(
        contentFilter: filter, configuration: config)
      return pngData(from: image)
    } catch {
      return nil
    }
  }

  @available(macOS, deprecated: 14.0)
  static func captureViaCoreGraphics(_ id: CGWindowID) -> Data? {
    guard
      let image = CGWindowListCreateImage(
        .null, .optionIncludingWindow, id, [.boundsIgnoreFraming, .bestResolution]),
      image.width > 0, image.height > 0
    else {
      return nil
    }
    return pngData(from: image)
  }

  static func screenshot(_ args: [String]) async {
    guard let raw = optionValue(args, "--window"), let id = CGWindowID(raw) else {
      fail("screenshot: --window <id> is required")
    }
    if !windowExists(id) {
      fail("screenshot: window \(id) not found")
    }

    let data = await captureViaScreenCaptureKit(id) ?? captureViaCoreGraphics(id)
    guard let png = data else {
      fail("screenshot: failed to capture window \(id) (Screen Recording permission may be required)")
    }
    FileHandle.standardOutput.write(png)
  }

  // MARK: - input

  struct ButtonKind {
    let button: CGMouseButton
    let downType: CGEventType
    let upType: CGEventType
  }

  static func buttonKind(_ name: String) -> ButtonKind {
    switch name {
    case "right":
      return ButtonKind(button: .right, downType: .rightMouseDown, upType: .rightMouseUp)
    case "middle":
      return ButtonKind(button: .center, downType: .otherMouseDown, upType: .otherMouseUp)
    default:
      return ButtonKind(button: .left, downType: .leftMouseDown, upType: .leftMouseUp)
    }
  }

  static func runInput(_ args: [String]) {
    var clamp: CGRect?
    if let raw = optionValue(args, "--clamp") {
      let parts = raw.split(separator: ",").compactMap { Double($0.trimmingCharacters(in: .whitespaces)) }
      guard parts.count == 4 else { fail("input: --clamp expects x,y,w,h") }
      clamp = CGRect(x: parts[0], y: parts[1], width: parts[2], height: parts[3])
    }

    let source = CGEventSource(stateID: .hidSystemState)
    // CGEvent mouse-button events carry a position; track the last known point so
    // a `down`/`up` with no preceding `move` still lands where the cursor is.
    var cursor = CGEvent(source: nil)?.location ?? .zero

    while let line = readLine(strippingNewline: true) {
      let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
      if trimmed.isEmpty { continue }

      guard let data = trimmed.data(using: .utf8),
        let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
        let op = object["op"] as? String
      else {
        stderr("input: ignoring malformed command: \(trimmed)")
        continue
      }

      switch op {
      case "move":
        guard let x = asDouble(object["x"]), let y = asDouble(object["y"]) else {
          stderr("input: move requires numeric x and y")
          continue
        }
        var point = CGPoint(x: x, y: y)
        if let clamp {
          point.x = min(max(point.x, clamp.minX), clamp.maxX)
          point.y = min(max(point.y, clamp.minY), clamp.maxY)
        }
        cursor = point
        CGEvent(
          mouseEventSource: source, mouseType: .mouseMoved,
          mouseCursorPosition: point, mouseButton: .left
        )?.post(tap: .cghidEventTap)

      case "down", "up":
        let kind = buttonKind(object["button"] as? String ?? "left")
        let event = CGEvent(
          mouseEventSource: source, mouseType: op == "down" ? kind.downType : kind.upType,
          mouseCursorPosition: cursor, mouseButton: kind.button)
        event?.setIntegerValueField(.mouseEventClickState, value: 1)
        event?.post(tap: .cghidEventTap)

      case "wheel":
        let dx = Int32((asDouble(object["dx"]) ?? 0).rounded())
        let dy = Int32((asDouble(object["dy"]) ?? 0).rounded())
        CGEvent(
          scrollWheelEvent2Source: source, units: .pixel,
          wheelCount: 2, wheel1: dy, wheel2: dx, wheel3: 0
        )?.post(tap: .cghidEventTap)

      case "key":
        guard let code = asDouble(object["code"]) else {
          stderr("input: key requires a numeric code")
          continue
        }
        let isDown = object["down"] as? Bool ?? true
        CGEvent(
          keyboardEventSource: source, virtualKey: CGKeyCode(Int(code)), keyDown: isDown
        )?.post(tap: .cghidEventTap)

      default:
        stderr("input: unknown op \"\(op)\"")
      }
    }
  }

  // MARK: - Application directories (shared by `activate` and `list-apps`)

  static let appRoots: [String] = [
    "/Applications",
    "/Applications/Utilities",
    "/System/Applications",
    "/System/Applications/Utilities",
    (NSHomeDirectory() as NSString).appendingPathComponent("Applications"),
  ]

  // MARK: - activate

  /// Resolve an app query (bundle id, or display / bundle / file name) to its
  /// on-disk `.app` URL.
  static func appURL(for query: String) -> URL? {
    if let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: query) {
      return url
    }
    let needle = query.lowercased()
    let fm = FileManager.default
    for root in appRoots {
      guard let entries = try? fm.contentsOfDirectory(atPath: root) else { continue }
      for entry in entries where entry.hasSuffix(".app") {
        let path = (root as NSString).appendingPathComponent(entry)
        var names = [(entry as NSString).deletingPathExtension]
        if let info = Bundle(path: path)?.infoDictionary {
          names.append(info["CFBundleName"] as? String ?? "")
          names.append(info["CFBundleDisplayName"] as? String ?? "")
        }
        if names.contains(where: { $0.lowercased() == needle }) {
          return URL(fileURLWithPath: path)
        }
      }
    }
    return nil
  }

  static func activate(_ args: [String]) async {
    guard let query = optionValue(args, "--app"), !query.isEmpty else {
      fail("activate: --app <name-or-bundle-id> is required")
    }
    guard let url = appURL(for: query) else {
      fail("activate: no application matches \"\(query)\"")
    }
    let config = NSWorkspace.OpenConfiguration()
    config.activates = true
    do {
      let app = try await NSWorkspace.shared.openApplication(at: url, configuration: config)
      let out: [String: Any] = [
        "bundleId": app.bundleIdentifier ?? "",
        "pid": app.processIdentifier,
      ]
      if let data = try? JSONSerialization.data(withJSONObject: out) {
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data("\n".utf8))
      }
    } catch {
      fail("activate: failed to open \"\(query)\": \(error.localizedDescription)")
    }
  }

  // MARK: - list-apps

  /// Render an app's icon to a `size`×`size` PNG data URI. Uses an off-screen
  /// bitmap context (no NSApplication / window server needed).
  static func iconDataURI(forApp path: String, size: Int) -> String? {
    let icon = NSWorkspace.shared.icon(forFile: path)
    guard
      let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)
    else { return nil }
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    icon.draw(
      in: NSRect(x: 0, y: 0, width: size, height: size),
      from: .zero, operation: .sourceOver, fraction: 1.0)
    NSGraphicsContext.restoreGraphicsState()
    guard let png = rep.representation(using: .png, properties: [:]) else { return nil }
    return "data:image/png;base64," + png.base64EncodedString()
  }

  static func listApps() {
    let fm = FileManager.default
    var seen = Set<String>()
    var result: [[String: Any]] = []
    for root in appRoots {
      guard let entries = try? fm.contentsOfDirectory(atPath: root) else { continue }
      for entry in entries where entry.hasSuffix(".app") {
        let path = (root as NSString).appendingPathComponent(entry)
        guard let bundle = Bundle(path: path),
          let bundleId = bundle.bundleIdentifier,
          bundleId != ownBundleId,
          !seen.contains(bundleId)
        else { continue }
        seen.insert(bundleId)
        let info = bundle.infoDictionary ?? [:]
        let name =
          (info["CFBundleDisplayName"] as? String)
          ?? (info["CFBundleName"] as? String)
          ?? (entry as NSString).deletingPathExtension
        var row: [String: Any] = ["name": name, "bundleId": bundleId, "path": path]
        if let icon = iconDataURI(forApp: path, size: 40) {
          row["icon"] = icon
        }
        result.append(row)
      }
    }
    result.sort {
      ($0["name"] as? String ?? "").localizedCaseInsensitiveCompare(
        $1["name"] as? String ?? "") == .orderedAscending
    }
    guard let data = try? JSONSerialization.data(withJSONObject: result) else {
      print("[]")
      return
    }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
  }
}

// MARK: - Entry point

let arguments = Array(CommandLine.arguments.dropFirst())

switch arguments.first {
case "list-windows":
  ActoviaInput.listWindows()
case "list-apps":
  ActoviaInput.listApps()
case "screenshot":
  await ActoviaInput.screenshot(arguments)
case "activate":
  await ActoviaInput.activate(arguments)
case "input":
  ActoviaInput.runInput(arguments)
default:
  ActoviaInput.stderr(
    "usage: actovia-input <list-windows | list-apps | screenshot --window <id> | "
      + "activate --app <name-or-bundle-id> | input [--clamp x,y,w,h]>")
  if let command = arguments.first {
    ActoviaInput.stderr("unknown command: \(command)")
  }
  exit(2)
}
