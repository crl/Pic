import AppKit
import CoreImage
import SwiftUI

enum FrostedBackdrop {
    private static let context = CIContext(options: [.useSoftwareRenderer: false])

    static func image(from source: NSImage) -> NSImage? {
        guard let ci = source.ciImage() else { return nil }
        let radius = min(max(ci.extent.width, ci.extent.height) * 0.045, 52)
        let blurred = ci
            .clampedToExtent()
            .applyingFilter("CIGaussianBlur", parameters: [kCIInputRadiusKey: radius])
            .cropped(to: ci.extent)
            .applyingFilter(
                "CIColorControls",
                parameters: [
                    kCIInputSaturationKey: 1.04,
                    kCIInputBrightnessKey: -0.08,
                    kCIInputContrastKey: 0.94
                ]
            )
        let extent = blurred.extent.integral
        guard let cgImage = context.createCGImage(blurred, from: extent) else { return nil }
        return NSImage(cgImage: cgImage, size: NSSize(width: extent.width, height: extent.height))
    }
}

struct DouyinLetterbox: View {
    let image: NSImage

    var body: some View {
        GeometryReader { proxy in
            Image(nsImage: image)
                .resizable()
                .scaledToFill()
                .frame(width: proxy.size.width, height: proxy.size.height)
                .clipped()
                .blur(radius: 32, opaque: true)
                .overlay(Color.black.opacity(0.28))
        }
        .allowsHitTesting(false)
    }
}

struct DouyinBottomFrost: View {
    var body: some View {
        VStack(spacing: 0) {
            Spacer()
            Rectangle()
                .fill(.ultraThinMaterial)
                .overlay(Color.black.opacity(0.18))
                .frame(height: 168)
                .mask(
                    LinearGradient(
                        stops: [
                            .init(color: .clear, location: 0),
                            .init(color: .black.opacity(0.55), location: 0.28),
                            .init(color: .black, location: 0.62),
                            .init(color: .black, location: 1)
                        ],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
        }
        .allowsHitTesting(false)
    }
}
