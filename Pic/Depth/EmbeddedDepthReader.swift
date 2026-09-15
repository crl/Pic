import AVFoundation
import Foundation
import ImageIO

enum EmbeddedDepthReader {
    static func read(from url: URL) -> DepthMap? {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }

        var orientation = CGImagePropertyOrientation.up
        if let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
           let raw = properties[kCGImagePropertyOrientation] as? UInt32,
           let value = CGImagePropertyOrientation(rawValue: raw) {
            orientation = value
        }

        let types: [(CFString, Bool)] = [
            (kCGImageAuxiliaryDataTypeDisparity, false),
            (kCGImageAuxiliaryDataTypeDepth, true)
        ]

        for (type, invert) in types {
            guard let info = CGImageSourceCopyAuxiliaryDataInfoAtIndex(source, 0, type) as? [AnyHashable: Any],
                  var depthData = try? AVDepthData(fromDictionaryRepresentation: info) else {
                continue
            }

            depthData = depthData.applyingExifOrientation(orientation)
            let pixelFormat: OSType = invert
                ? kCVPixelFormatType_DepthFloat32
                : kCVPixelFormatType_DisparityFloat32
            if depthData.depthDataType != pixelFormat {
                depthData = depthData.converting(toDepthDataType: pixelFormat)
            }
            return DepthMap.fromPixelBuffer(depthData.depthDataMap, invert: invert)
        }

        return nil
    }
}
