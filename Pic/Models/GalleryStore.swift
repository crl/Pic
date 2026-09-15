import AppKit
import Combine
import Foundation
import UniformTypeIdentifiers

@MainActor
final class GalleryStore: ObservableObject {
    static let shared = GalleryStore()

    static let supportedExtensions: Set<String> = [
        "jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "tif", "tiff", "bmp"
    ]

    @Published var items: [URL] = []
    @Published var index: Int = 0
    @Published var currentImage: NSImage?
    @Published var pixelSize: CGSize = .zero
    @Published var displayMode: DisplayMode = .fit
    @Published var isDropTargeted = false

    @Published var isSpatialMode = false
    @Published var spatialBusy = false
    @Published var spatialError: String?
    @Published var blurAmount: Double = 0.45
    @Published var focusNormalized = CGPoint(x: 0.5, y: 0.5)
    @Published var depthMap: DepthMap?
    @Published var bokehImage: NSImage?
    @Published var bokehRevision: Int = 0
    @Published var depthSourceLabel: String?

    private let depthProvider = DepthProvider()
    private var bokehTask: Task<Void, Never>?
    private var spatialTask: Task<Void, Never>?

    var currentURL: URL? {
        items.indices.contains(index) ? items[index] : nil
    }

    var canGoPrevious: Bool { items.count > 1 }
    var canGoNext: Bool { items.count > 1 }

    var statusText: String {
        guard let url = currentURL, currentImage != nil else {
            return "打开图片或将文件拖到窗口"
        }
        let name = url.lastPathComponent
        let count = "\(index + 1) / \(items.count)"
        let size = "\(Int(pixelSize.width)) × \(Int(pixelSize.height))"
        return "\(name)    \(count)    \(size)"
    }

    func presentOpenPanel() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.allowedContentTypes = [.image, .folder]
        panel.message = "选择一张图片或一个文件夹"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        open(url)
    }

    func open(_ url: URL) {
        let resolved = url.resolvingSymlinksInPath()
        var isDirectory: ObjCBool = false
        FileManager.default.fileExists(atPath: resolved.path, isDirectory: &isDirectory)

        if isDirectory.boolValue {
            let listed = Self.listImages(in: resolved)
            items = listed
            index = 0
        } else {
            let folder = resolved.deletingLastPathComponent()
            let listed = Self.listImages(in: folder)
            items = listed.isEmpty ? [resolved] : listed
            index = listed.firstIndex(of: resolved) ?? listed.firstIndex(where: { $0.path == resolved.path }) ?? 0
        }
        loadCurrent()
    }

    func previous() {
        guard !items.isEmpty else { return }
        index = (index - 1 + items.count) % items.count
        loadCurrent()
    }

    func next() {
        guard !items.isEmpty else { return }
        index = (index + 1) % items.count
        loadCurrent()
    }

    func toggleDisplayMode() {
        displayMode = displayMode == .fit ? .actual : .fit
    }

    func toggleSpatial() async {
        if isSpatialMode {
            isSpatialMode = false
            spatialError = nil
            return
        }
        await enableSpatial()
    }

    func setFocus(normalized: CGPoint) {
        focusNormalized = CGPoint(
            x: min(max(normalized.x, 0), 1),
            y: min(max(normalized.y, 0), 1)
        )
        scheduleBokeh()
    }

    func apertureChanged() {
        scheduleBokeh()
    }

    func handleDrop(providers: [NSItemProvider]) -> Bool {
        guard let provider = providers.first else { return false }
        provider.loadItem(forTypeIdentifier: UTType.fileURL.identifier, options: nil) { item, _ in
            let url: URL?
            if let data = item as? Data {
                url = URL(dataRepresentation: data, relativeTo: nil)
            } else if let urlItem = item as? URL {
                url = urlItem
            } else if let string = item as? String {
                url = URL(fileURLWithPath: string)
            } else {
                url = nil
            }
            guard let url else { return }
            Task { @MainActor in
                self.open(url)
            }
        }
        return true
    }

    private func loadCurrent() {
        spatialError = nil
        bokehTask?.cancel()
        spatialTask?.cancel()

        guard let url = currentURL else {
            currentImage = nil
            pixelSize = .zero
            depthMap = nil
            bokehImage = nil
            bokehRevision = 0
            depthSourceLabel = nil
            isSpatialMode = false
            return
        }

        guard let image = NSImage(contentsOf: url) else {
            currentImage = nil
            pixelSize = .zero
            return
        }

        currentImage = image
        pixelSize = image.pixelSize

        let staySpatial = isSpatialMode
        depthMap = nil
        bokehImage = nil
        bokehRevision = 0
        depthSourceLabel = nil

        if staySpatial {
            spatialTask = Task { await enableSpatial() }
        }
    }

    private func enableSpatial() async {
        guard let url = currentURL, let image = currentImage else { return }
        spatialBusy = true
        spatialError = nil
        defer { spatialBusy = false }

        do {
            let ciImage = image.ciImage() ?? CIImage()
            let result = try await depthProvider.depth(for: url, preview: ciImage)
            if Task.isCancelled { return }
            depthMap = result.map
            depthSourceLabel = result.source.title
            if let autoFocus = result.map.suggestedFocus ?? PersonFocusFinder.focusPoint(in: ciImage) {
                focusNormalized = autoFocus
            } else {
                focusNormalized = CGPoint(x: 0.5, y: 0.5)
            }
            isSpatialMode = true
            await recomputeBokeh()
        } catch {
            isSpatialMode = false
            spatialError = error.localizedDescription
        }
    }

    private func scheduleBokeh() {
        bokehTask?.cancel()
        bokehTask = Task { [blurAmount, focusNormalized] in
            try? await Task.sleep(nanoseconds: 30_000_000)
            guard !Task.isCancelled else { return }
            await recomputeBokeh(blurAmount: blurAmount, focus: focusNormalized)
        }
    }

    private func recomputeBokeh() async {
        await recomputeBokeh(blurAmount: blurAmount, focus: focusNormalized)
    }

    private func recomputeBokeh(blurAmount: Double, focus: CGPoint) async {
        guard let image = currentImage, let depthMap else { return }
        let rendered = await Task.detached(priority: .userInitiated) {
            PortraitBokehFilter.apply(image: image, depth: depthMap, focus: focus, blurAmount: blurAmount)
        }.value
        if Task.isCancelled { return }
        bokehImage = rendered
        bokehRevision += 1
    }

    static func listImages(in folder: URL) -> [URL] {
        let fm = FileManager.default
        guard let contents = try? fm.contentsOfDirectory(
            at: folder,
            includingPropertiesForKeys: [.isRegularFileKey],
            options: [.skipsHiddenFiles]
        ) else { return [] }

        return contents
            .filter { supportedExtensions.contains($0.pathExtension.lowercased()) }
            .sorted { $0.lastPathComponent.localizedStandardCompare($1.lastPathComponent) == .orderedAscending }
    }
}

extension NSImage {
    var pixelSize: CGSize {
        guard let representation = representations.first else { return size }
        let width = representation.pixelsWide
        let height = representation.pixelsHigh
        if width > 0 && height > 0 {
            return CGSize(width: width, height: height)
        }
        return size
    }

    var cgImageForScene: CGImage? {
        var rect = CGRect(origin: .zero, size: size)
        return cgImage(forProposedRect: &rect, context: nil, hints: nil)
    }

    func ciImage() -> CIImage? {
        if let tiff = tiffRepresentation, let image = CIImage(data: tiff) {
            return image
        }
        var rect = CGRect(origin: .zero, size: size)
        guard let cgImage = cgImage(forProposedRect: &rect, context: nil, hints: nil) else {
            return nil
        }
        return CIImage(cgImage: cgImage)
    }
}
