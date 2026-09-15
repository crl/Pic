import SwiftUI
import UniformTypeIdentifiers

struct ContentView: View {
    @EnvironmentObject private var store: GalleryStore
    @FocusState private var canvasFocused: Bool
    @State private var tilt: CGSize = .zero
    @State private var tiltSettling = false
    @State private var spatialOpacity: Double = 0
    @State private var keepSpatialLayer = false
    @State private var shownImage: NSImage?
    @State private var shownPixelSize: CGSize = .zero
    @State private var incomingImage: NSImage?
    @State private var incomingPixelSize: CGSize = .zero
    @State private var incomingOpacity: Double = 0
    @State private var fadeGeneration = 0

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            if store.currentImage == nil {
                EmptyDropView(isTargeted: store.isDropTargeted) {
                    store.presentOpenPanel()
                }
            } else {
                viewer
                    .onChange(of: store.isSpatialMode) { _, enabled in
                        handleSpatialModeChange(enabled)
                    }
                    .onChange(of: store.currentURL) { _, _ in
                        handleImageChange()
                    }
                    .onChange(of: store.depthMap != nil) { _, hasDepth in
                        handleDepthAvailability(hasDepth)
                    }
                    .onAppear {
                        shownImage = store.currentImage
                        shownPixelSize = store.pixelSize
                    }
                overlayChrome
            }
        }
        .focusable()
        .focusEffectDisabled()
        .focused($canvasFocused)
        .onAppear { canvasFocused = true }
        .onDrop(of: [.fileURL], isTargeted: $store.isDropTargeted, perform: store.handleDrop)
        .onMoveCommand { direction in
            switch direction {
            case .left:
                store.previous()
            case .right:
                store.next()
            default:
                break
            }
        }
        .onKeyPress(.space) {
            store.toggleDisplayMode()
            return .handled
        }
        .alert("无法计算景深", isPresented: errorPresented) {
            Button("好", role: .cancel) {}
        } message: {
            Text(store.spatialError ?? "")
        }
        .toolbar { toolbarContent }
        .toolbarRole(.editor)
        .controlSize(.small)
        .navigationTitle(store.currentURL?.lastPathComponent ?? "Pic")
    }

    @ViewBuilder
    private var viewer: some View {
        ZStack {
            if keepSpatialLayer, let depth = store.depthMap, let original = store.currentImage {
                spatialLayer(depth: depth, original: original)
            }

            imageStack
                .opacity(twoDOpacity)
                .allowsHitTesting(spatialOpacity < 0.5)
        }
    }

    private var spatialCovering: Bool {
        keepSpatialLayer && store.depthMap != nil
    }

    private var twoDOpacity: Double {
        spatialCovering ? 1 - spatialOpacity : 1
    }

    private var imageStack: some View {
        ZStack {
            if let shownImage {
                DouyinLetterbox(image: shownImage)
            }
            if let incomingImage {
                DouyinLetterbox(image: incomingImage)
                    .opacity(incomingOpacity)
            }

            if let shownImage {
                ImageCanvas(
                    image: shownImage,
                    pixelSize: shownPixelSize,
                    mode: store.displayMode,
                    showBackdrop: true
                )
            }
            if let incomingImage {
                ImageCanvas(
                    image: incomingImage,
                    pixelSize: incomingPixelSize,
                    mode: store.displayMode,
                    showBackdrop: false
                )
                .opacity(incomingOpacity)
            }
        }
    }

    private func handleImageChange() {
        guard let image = store.currentImage else {
            fadeGeneration += 1
            shownImage = nil
            incomingImage = nil
            incomingOpacity = 0
            return
        }

        if shownImage == nil {
            shownImage = image
            shownPixelSize = store.pixelSize
            incomingImage = nil
            incomingOpacity = 0
            return
        }

        fadeGeneration += 1
        let generation = fadeGeneration
        incomingImage = image
        incomingPixelSize = store.pixelSize
        incomingOpacity = 0
        withAnimation(.easeInOut(duration: 0.32)) {
            incomingOpacity = 1
        }
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 340_000_000)
            guard generation == fadeGeneration else { return }
            shownImage = image
            shownPixelSize = store.pixelSize
            incomingImage = nil
            incomingOpacity = 0
        }
    }

    private func handleDepthAvailability(_ hasDepth: Bool) {
        if !hasDepth {
            var transaction = Transaction()
            transaction.disablesAnimations = true
            withTransaction(transaction) {
                spatialOpacity = 0
            }
            return
        }
        guard store.isSpatialMode else { return }
        keepSpatialLayer = true
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 160_000_000)
            revealSpatial()
        }
    }

    private func spatialLayer(depth: DepthMap, original: NSImage) -> some View {
        GeometryReader { proxy in
            let fit = aspectFit(store.pixelSize, in: proxy.size)
            ZStack {
                DouyinLetterbox(image: original)
                DouyinBottomFrost()
                SpatialPhotoView(
                    texture: store.bokehImage ?? original,
                    textureRevision: store.bokehRevision,
                    depthMap: depth,
                    tilt: tilt,
                    tiltSettling: tiltSettling,
                    onFirstFrame: revealSpatial
                )
                .frame(width: fit.width, height: fit.height)
                .transaction { $0.animation = nil }
                .overlay {
                    Color.clear
                        .contentShape(Rectangle())
                        .onContinuousHover { phase in
                            switch phase {
                            case .active(let location):
                                applyTilt(
                                    CGSize(
                                        width: (location.x / max(fit.width, 1)) * 2 - 1,
                                        height: (location.y / max(fit.height, 1)) * 2 - 1
                                    ),
                                    settling: false
                                )
                            case .ended:
                                break
                            }
                        }
                        .onTapGesture { location in
                            store.setFocus(
                                normalized: CGPoint(
                                    x: location.x / max(fit.width, 1),
                                    y: location.y / max(fit.height, 1)
                                )
                            )
                        }
                }
            }
        }
        .allowsHitTesting(store.isSpatialMode)
    }

    private func applyTilt(_ value: CGSize, settling: Bool) {
        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction) {
            tiltSettling = settling
            tilt = value
        }
    }

    private func handleSpatialModeChange(_ enabled: Bool) {
        applyTilt(.zero, settling: false)

        if enabled {
            keepSpatialLayer = true
            spatialOpacity = 0
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: 160_000_000)
                revealSpatial()
            }
        } else {
            withAnimation(.easeInOut(duration: 0.36)) {
                spatialOpacity = 0
            }
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: 380_000_000)
                if !store.isSpatialMode {
                    keepSpatialLayer = false
                }
            }
        }
    }

    private func revealSpatial() {
        guard store.isSpatialMode, spatialOpacity < 1 else { return }
        withAnimation(.easeInOut(duration: 0.38)) {
            spatialOpacity = 1
        }
    }

    private func aspectFit(_ image: CGSize, in container: CGSize) -> CGSize {
        let imageAspect = image.width / max(image.height, 1)
        let containerAspect = container.width / max(container.height, 1)
        if imageAspect > containerAspect {
            return CGSize(width: container.width, height: container.width / imageAspect)
        }
        return CGSize(width: container.height * imageAspect, height: container.height)
    }

    private var overlayChrome: some View {
        VStack {
            Spacer()
                .allowsHitTesting(false)
            VStack(spacing: 10) {
                if store.isSpatialMode {
                    apertureBar
                        .transition(.opacity)
                }
                HStack {
                    Text(store.statusText)
                    if let label = store.depthSourceLabel, store.isSpatialMode {
                        Text("·")
                        Text(label)
                    }
                    Spacer()
                    if store.isSpatialMode {
                        Text("移动鼠标看立体 · 点击对焦")
                    }
                }
                .font(.caption)
                .foregroundStyle(.white.opacity(0.78))
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity)
            .background {
                if store.isSpatialMode {
                    Rectangle()
                        .fill(.ultraThinMaterial)
                        .overlay(Color.black.opacity(0.12))
                } else {
                    Color.black.opacity(0.42)
                }
            }
            .animation(.easeInOut(duration: 0.32), value: store.isSpatialMode)
        }
    }

    private var apertureBar: some View {
        HStack(spacing: 10) {
            Text("虚化")
                .font(.caption)
            Slider(value: $store.blurAmount, in: 0...1)
                .controlSize(.small)
                .frame(maxWidth: 240)
                .onChange(of: store.blurAmount) { _, _ in
                    store.apertureChanged()
                }
            Text("\(Int(store.blurAmount * 100))%")
                .font(.caption.monospacedDigit())
                .frame(width: 40, alignment: .trailing)
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 4)
    }

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        ToolbarItemGroup(placement: .navigation) {
            Button(action: store.previous) {
                Label("上一张", systemImage: "chevron.left")
            }
            .disabled(!store.canGoPrevious)
            .help("上一张")

            Button(action: store.next) {
                Label("下一张", systemImage: "chevron.right")
            }
            .disabled(!store.canGoNext)
            .help("下一张")
        }

        ToolbarItem(placement: .principal) {
            Picker("显示", selection: $store.displayMode) {
                ForEach(DisplayMode.allCases) { mode in
                    Text(mode.title).tag(mode)
                }
            }
            .pickerStyle(.segmented)
            .frame(minWidth: 112, idealWidth: 124, maxWidth: 136)
            .disabled(store.currentImage == nil || store.isSpatialMode)
            .help("自适应 / 实际大小")
        }

        ToolbarItem(placement: .primaryAction) {
            Button {
                Task { await store.toggleSpatial() }
            } label: {
                if store.spatialBusy {
                    ProgressView()
                        .controlSize(.mini)
                } else {
                    Image(systemName: "cube.fill")
                        .font(.body)
                        .imageScale(.medium)
                        .aspectRatio(1, contentMode: .fit)
                        .frame(width: 16, height: 16)
                        .accessibilityLabel("3D 景深")
                }
            }
            .foregroundStyle(store.isSpatialMode ? Color.accentColor : Color.primary)
            .disabled(store.currentImage == nil || store.spatialBusy)
            .help("3D 景深")
        }
    }

    private var errorPresented: Binding<Bool> {
        Binding(
            get: { store.spatialError != nil },
            set: { if !$0 { store.spatialError = nil } }
        )
    }
}
