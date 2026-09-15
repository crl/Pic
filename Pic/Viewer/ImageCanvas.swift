import SwiftUI

struct ImageCanvas: View {
    let image: NSImage
    let pixelSize: CGSize
    let mode: DisplayMode
    var showBackdrop: Bool = true

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

    private func fittedImage(in size: CGSize) -> some View {
        let fit = Self.aspectFit(pixelSize, in: size)
        return ZStack {
            if showBackdrop {
                CheckerboardView()
                    .frame(width: fit.width, height: fit.height)
            }
            Image(nsImage: image)
                .resizable()
                .interpolation(.high)
                .frame(width: fit.width, height: fit.height)
        }
        .frame(width: size.width, height: size.height)
    }

    private func actualImage(in size: CGSize) -> some View {
        let width = max(pixelSize.width, 1)
        let height = max(pixelSize.height, 1)
        return ScrollView([.horizontal, .vertical]) {
            ZStack {
                if showBackdrop {
                    CheckerboardView()
                        .frame(width: width, height: height)
                }
                Image(nsImage: image)
                    .resizable()
                    .interpolation(.none)
                    .frame(width: width, height: height)
            }
            .frame(minWidth: size.width, minHeight: size.height)
            .frame(width: max(width, size.width), height: max(height, size.height))
        }
    }

    private static func aspectFit(_ image: CGSize, in container: CGSize) -> CGSize {
        let imageAspect = image.width / max(image.height, 1)
        let containerAspect = container.width / max(container.height, 1)
        if imageAspect > containerAspect {
            return CGSize(width: container.width, height: container.width / imageAspect)
        }
        return CGSize(width: container.height * imageAspect, height: container.height)
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
