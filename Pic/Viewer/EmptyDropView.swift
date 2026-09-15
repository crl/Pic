import SwiftUI

struct EmptyDropView: View {
    var isTargeted: Bool
    var onOpen: () -> Void

    var body: some View {
        VStack(spacing: 18) {
            Image(systemName: "photo.on.rectangle.angled")
                .font(.system(size: 56, weight: .light))
                .foregroundStyle(.secondary)
            Text("将图片拖到这里")
                .font(.title2.weight(.medium))
            Text("或打开一个文件夹，用方向键翻看上一张 / 下一张")
                .foregroundStyle(.secondary)
            Button("打开…", action: onOpen)
                .keyboardShortcut("o", modifiers: .command)
                .controlSize(.large)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(40)
        .overlay {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(
                    isTargeted ? Color.accentColor : Color.secondary.opacity(0.35),
                    style: StrokeStyle(lineWidth: 2, dash: [10, 7])
                )
                .padding(28)
        }
        .background(isTargeted ? Color.accentColor.opacity(0.08) : Color.clear)
        .animation(.easeInOut(duration: 0.15), value: isTargeted)
    }
}
