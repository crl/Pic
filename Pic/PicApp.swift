import SwiftUI

@main
struct PicApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @ObservedObject private var store = GalleryStore.shared

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(store)
        }
        .defaultSize(width: 1100, height: 760)
        .windowToolbarStyle(.unifiedCompact)
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("打开…") {
                    store.presentOpenPanel()
                }
                .keyboardShortcut("o", modifiers: .command)
            }

            CommandMenu("显示") {
                Button("自适应大小") {
                    store.displayMode = .fit
                }
                .keyboardShortcut("0", modifiers: .command)

                Button("实际大小") {
                    store.displayMode = .actual
                }
                .keyboardShortcut("1", modifiers: .command)

                Divider()

                Button(store.isSpatialMode ? "关闭 3D 景深" : "3D 景深") {
                    Task { await store.toggleSpatial() }
                }
                .keyboardShortcut("3", modifiers: .command)
                .disabled(store.currentImage == nil || store.spatialBusy)
            }

            CommandMenu("前往") {
                Button("上一张") {
                    store.previous()
                }
                .keyboardShortcut(.leftArrow, modifiers: [])
                .disabled(!store.canGoPrevious)

                Button("下一张") {
                    store.next()
                }
                .keyboardShortcut(.rightArrow, modifiers: [])
                .disabled(!store.canGoNext)
            }
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        Task { @MainActor in
            if let url = urls.first {
                GalleryStore.shared.open(url)
            }
        }
    }
}
