import AppKit
import CoreImage
import Foundation
import Vision

enum PortraitBokehFilter {
    private static let context = CIContext(options: [.useSoftwareRenderer: false])

    static func apply(image: NSImage, depth: DepthMap, focus: CGPoint, blurAmount: Double) -> NSImage? {
        guard let source = image.ciImage() else { return nil }

        let amount = min(max(blurAmount, 0), 1)
        guard amount > 0.01 else { return image }

        let focusDepth = depth.sample(u: Float(focus.x), v: Float(focus.y))
        let mask = blurMask(from: depth, focusDepth: focusDepth, amount: amount)
        let longest = max(source.extent.width, source.extent.height)
        let maxRadius = min(longest * 0.028, 48) * CGFloat(amount)
        let working = scaledForBlur(source)
        let workingMask = mask.resized(to: working.extent.size)
        let scaledRadius = maxRadius * (working.extent.width / max(source.extent.width, 1))

        let blurred: CIImage
        if let filter = CIFilter(name: "CIMaskedVariableBlur") {
            filter.setValue(working, forKey: kCIInputImageKey)
            filter.setValue(workingMask, forKey: "inputMask")
            filter.setValue(scaledRadius, forKey: kCIInputRadiusKey)
            blurred = filter.outputImage?.cropped(to: working.extent) ?? working
        } else {
            blurred = working
                .applyingFilter("CIGaussianBlur", parameters: [kCIInputRadiusKey: scaledRadius])
                .cropped(to: working.extent)
        }

        let result = blurred.resized(to: source.extent.size)
        return nsImage(from: result)
    }

    private static func blurMask(from depth: DepthMap, focusDepth: Float, amount: Double) -> CIImage {
        let gain = Float(1.6 + 2.8 * amount)
        let focusBand = Float(0.05)
        var pixels = [UInt8](repeating: 0, count: depth.width * depth.height * 4)
        for i in depth.values.indices {
            let delta = max(0, abs(depth.values[i] - focusDepth) - focusBand)
            let coverage = min(max(delta * gain, 0), 1) * Float(amount)
            let a = UInt8(clamping: Int(coverage * 255))
            let offset = i * 4
            pixels[offset] = a
            pixels[offset + 1] = a
            pixels[offset + 2] = a
            pixels[offset + 3] = a
        }
        let data = Data(pixels)
        let cgImage = CGImage(
            width: depth.width,
            height: depth.height,
            bitsPerComponent: 8,
            bitsPerPixel: 32,
            bytesPerRow: depth.width * 4,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
            provider: CGDataProvider(data: data as CFData)!,
            decode: nil,
            shouldInterpolate: true,
            intent: .defaultIntent
        )!
        return CIImage(cgImage: cgImage)
    }

    private static func scaledForBlur(_ image: CIImage) -> CIImage {
        let longest = max(image.extent.width, image.extent.height)
        let maxLongest: CGFloat = 1600
        guard longest > maxLongest else { return image }
        let scale = maxLongest / longest
        return image.resized(to: CGSize(width: image.extent.width * scale, height: image.extent.height * scale))
    }

    private static func nsImage(from image: CIImage) -> NSImage? {
        let extent = image.extent.integral
        guard let cgImage = context.createCGImage(image, from: extent) else { return nil }
        return NSImage(cgImage: cgImage, size: NSSize(width: extent.width, height: extent.height))
    }
}

enum PersonFocusFinder {
    static func focusPoint(in image: CIImage) -> CGPoint? {
        let request = VNGeneratePersonSegmentationRequest()
        request.qualityLevel = .balanced
        request.outputPixelFormat = kCVPixelFormatType_OneComponent8
        let handler = VNImageRequestHandler(ciImage: image, options: [:])
        do {
            try handler.perform([request])
        } catch {
            return nil
        }
        guard let buffer = request.results?.first?.pixelBuffer else { return nil }

        CVPixelBufferLockBaseAddress(buffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }

        let width = CVPixelBufferGetWidth(buffer)
        let height = CVPixelBufferGetHeight(buffer)
        let bytesPerRow = CVPixelBufferGetBytesPerRow(buffer)
        guard let base = CVPixelBufferGetBaseAddress(buffer) else { return nil }
        let pixels = base.assumingMemoryBound(to: UInt8.self)

        var sumX = 0
        var sumY = 0
        var count = 0
        stride(from: 0, to: height, by: 4).forEach { y in
            let row = pixels + y * bytesPerRow
            stride(from: 0, to: width, by: 4).forEach { x in
                if row[x] > 140 {
                    sumX += x
                    sumY += y
                    count += 1
                }
            }
        }
        guard count > 40 else { return nil }
        return CGPoint(
            x: CGFloat(sumX) / CGFloat(count) / CGFloat(width),
            y: CGFloat(sumY) / CGFloat(count) / CGFloat(height)
        )
    }
}
