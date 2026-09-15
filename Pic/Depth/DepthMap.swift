import CoreImage
import CoreVideo
import Foundation

struct DepthMap: Equatable {
    let width: Int
    let height: Int
    /// Row-major, 0 = far, 1 = near.
    let values: [Float]
    let suggestedFocus: CGPoint?

    func sample(u: Float, v: Float) -> Float {
        guard width > 1, height > 1, !values.isEmpty else { return 0 }
        let x = min(max(u, 0), 1) * Float(width - 1)
        let y = min(max(v, 0), 1) * Float(height - 1)
        let x0 = Int(floor(x))
        let y0 = Int(floor(y))
        let x1 = min(x0 + 1, width - 1)
        let y1 = min(y0 + 1, height - 1)
        let tx = x - Float(x0)
        let ty = y - Float(y0)
        let v00 = value(x0, y0)
        let v10 = value(x1, y0)
        let v01 = value(x0, y1)
        let v11 = value(x1, y1)
        let a = v00 * (1 - tx) + v10 * tx
        let b = v01 * (1 - tx) + v11 * tx
        return a * (1 - ty) + b * ty
    }

    func ciImage() -> CIImage {
        var pixels = [UInt8](repeating: 0, count: width * height)
        for i in values.indices {
            pixels[i] = UInt8(clamping: Int((values[i] * 255).rounded()))
        }
        let data = Data(pixels)
        let bitmap = CGImage(
            width: width,
            height: height,
            bitsPerComponent: 8,
            bitsPerPixel: 8,
            bytesPerRow: width,
            space: CGColorSpaceCreateDeviceGray(),
            bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.none.rawValue),
            provider: CGDataProvider(data: data as CFData)!,
            decode: nil,
            shouldInterpolate: true,
            intent: .defaultIntent
        )
        return CIImage(cgImage: bitmap!)
    }

    static func fromPixelBuffer(_ buffer: CVPixelBuffer, invert: Bool) -> DepthMap {
        CVPixelBufferLockBaseAddress(buffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }

        let width = CVPixelBufferGetWidth(buffer)
        let height = CVPixelBufferGetHeight(buffer)
        let format = CVPixelBufferGetPixelFormatType(buffer)
        var values = [Float](repeating: 0, count: width * height)

        if format == kCVPixelFormatType_DisparityFloat32 || format == kCVPixelFormatType_DepthFloat32 {
            let bytesPerRow = CVPixelBufferGetBytesPerRow(buffer)
            let base = CVPixelBufferGetBaseAddress(buffer)!.assumingMemoryBound(to: UInt8.self)
            for y in 0..<height {
                let row = UnsafeRawPointer(base + y * bytesPerRow).bindMemory(to: Float.self, capacity: width)
                for x in 0..<width {
                    values[y * width + x] = row[x]
                }
            }
        } else if format == kCVPixelFormatType_DisparityFloat16 || format == kCVPixelFormatType_DepthFloat16 {
            let bytesPerRow = CVPixelBufferGetBytesPerRow(buffer)
            let base = CVPixelBufferGetBaseAddress(buffer)!.assumingMemoryBound(to: UInt8.self)
            for y in 0..<height {
                let row = UnsafeRawPointer(base + y * bytesPerRow).bindMemory(to: UInt16.self, capacity: width)
                for x in 0..<width {
                    values[y * width + x] = Float(Float16(bitPattern: row[x]))
                }
            }
        } else {
            let image = CIImage(cvPixelBuffer: buffer)
            return fromCIImage(image, invert: invert)
        }

        return normalized(values: values, width: width, height: height, invert: invert)
    }

    static func fromCIImage(_ image: CIImage, invert: Bool) -> DepthMap {
        let extent = image.extent.integral
        let width = Int(extent.width)
        let height = Int(extent.height)
        var values = [Float](repeating: 0, count: width * height)
        let context = CIContext(options: [.useSoftwareRenderer: false])
        values.withUnsafeMutableBytes { buffer in
            guard let base = buffer.baseAddress else { return }
            context.render(
                image,
                toBitmap: base,
                rowBytes: width * MemoryLayout<Float>.size,
                bounds: extent,
                format: .Rf,
                colorSpace: nil
            )
        }
        return normalized(values: values, width: width, height: height, invert: invert)
    }

    private func value(_ x: Int, _ y: Int) -> Float {
        values[y * width + x]
    }

    private static func normalized(values: [Float], width: Int, height: Int, invert: Bool) -> DepthMap {
        var finite = values.map { v -> Float in
            if v.isFinite { return v }
            return 0
        }
        let valid = finite.filter { $0 > 0 && $0.isFinite }
        let minValue = valid.min() ?? 0
        let maxValue = valid.max() ?? 1
        let span = max(maxValue - minValue, 1e-5)
        for i in finite.indices {
            var n = (finite[i] - minValue) / span
            n = min(max(n, 0), 1)
            if invert { n = 1 - n }
            finite[i] = n
        }
        let focus = suggestedFocus(values: finite, width: width, height: height)
        return DepthMap(width: width, height: height, values: finite, suggestedFocus: focus)
    }

    /// Prefer a nearby (bright) region in the central 40% of the frame.
    private static func suggestedFocus(values: [Float], width: Int, height: Int) -> CGPoint? {
        guard width > 8, height > 8 else { return nil }
        let x0 = width * 3 / 10
        let x1 = width * 7 / 10
        let y0 = height * 3 / 10
        let y1 = height * 7 / 10
        var best: Float = -1
        var bestX = width / 2
        var bestY = height / 2
        var y = y0
        while y < y1 {
            var x = x0
            while x < x1 {
                let v = values[y * width + x]
                if v > best {
                    best = v
                    bestX = x
                    bestY = y
                }
                x += 2
            }
            y += 2
        }
        return CGPoint(x: CGFloat(bestX) / CGFloat(width), y: CGFloat(bestY) / CGFloat(height))
    }
}

enum DepthSource {
    case embedded
    case machineLearning
    case cache

    var title: String {
        switch self {
        case .embedded: return "人像深度"
        case .machineLearning: return "估算深度"
        case .cache: return "已缓存"
        }
    }
}
