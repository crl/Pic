import SwiftUI

struct ImageCanvas: View {
    let image: NSImage
    let pixelSize: CGSize
    let mode: DisplayMode

    var body: some View {
        GeometryReader { proxy in
            switch mode {
            case .fit:
                fittedImage(in: proxy.size)
            case .actual:
                actualImage(in: proxy.size)
            }
        }
    }

    private var checkerboard: some View {
        CheckerboardView()
    }

    private func fittedImage(in size: CGSize) -> some View {
        ZStack {
            checkerboard
            Image(nsImage: image)
                .resizable()
                .interpolation(.high)
                .scaledToFit()
                .frame(width: size.width, height: size.height)
        }
    }

    private func actualImage(in size: CGSize) -> some View {
        let width = max(pixelSize.width, 1)
        let height = max(pixelSize.height, 1)
        return ScrollView([.horizontal, .vertical]) {
            ZStack {
                checkerboard
                    .frame(width: width, height: height)
                Image(nsImage: image)
                    .resizable()
                    .interpolation(.none)
                    .frame(width: width, height: height)
            }
            .frame(minWidth: size.width, minHeight: size.height)
            .frame(width: max(width, size.width), height: max(height, size.height))
        }
    }
}

struct CheckerboardView: View {
    var cell: CGFloat = 12

    var body: some View {
        Canvas { context, size in
            let light = Color(white: 0.22)
            let dark = Color(white: 0.16)
            let columns = Int(ceil(size.width / cell))
            let rows = Int(ceil(size.height / cell))
            for row in 0..<rows {
                for column in 0..<columns {
                    let rect = CGRect(
                        x: CGFloat(column) * cell,
                        y: CGFloat(row) * cell,
                        width: cell,
                        height: cell
                    )
                    context.fill(Path(rect), with: .color((row + column).isMultiple(of: 2) ? light : dark))
                }
            }
        }
        .allowsHitTesting(false)
    }
}
