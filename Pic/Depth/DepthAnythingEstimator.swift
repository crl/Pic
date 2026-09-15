import CoreImage
import CoreML
import CoreVideo
import Foundation

actor DepthAnythingEstimator {
    private var model: MLModel?
    private let context = CIContext(options: [.useSoftwareRenderer: false])
    private let targetSize = CGSize(width: 518, height: 392)

    func estimate(from image: CIImage) async throws -> DepthMap {
        let mlModel = try await loadIfNeeded()
        let resized = image.resized(to: targetSize)
        guard let pixelBuffer = context.argbPixelBuffer(from: resized) else {
            throw DepthError.pixelBuffer
        }

        let provider = try MLDictionaryFeatureProvider(dictionary: ["image": pixelBuffer])
        let result = try await mlModel.prediction(from: provider)
        guard let output = result.featureValue(for: "depth")?.imageBufferValue else {
            throw DepthError.modelOutput
        }

        let originalSize = CGSize(width: image.extent.width, height: image.extent.height)
        let depthImage = CIImage(cvPixelBuffer: output).resized(to: originalSize)
        return DepthMap.fromCIImage(depthImage, invert: false)
    }

    private func loadIfNeeded() async throws -> MLModel {
        if let model {
            return model
        }

        let configuration = MLModelConfiguration()
        configuration.computeUnits = .all

        if let compiled = bundledModelURL(extension: "mlmodelc") {
            model = try MLModel(contentsOf: compiled, configuration: configuration)
        } else if let package = bundledModelURL(extension: "mlpackage") {
            let compiledURL = try await MLModel.compileModel(at: package)
            model = try MLModel(contentsOf: compiledURL, configuration: configuration)
        } else {
            throw DepthError.modelMissing
        }

        return model!
    }

    private func bundledModelURL(extension ext: String) -> URL? {
        Bundle.main.url(forResource: "DepthAnythingV2SmallF16", withExtension: ext)
    }
}

enum DepthError: LocalizedError {
    case modelMissing
    case pixelBuffer
    case modelOutput
    case emptyImage

    var errorDescription: String? {
        switch self {
        case .modelMissing:
            return "找不到景深模型，无法估算 3D 景深。"
        case .pixelBuffer:
            return "无法把图片送入景深模型。"
        case .modelOutput:
            return "景深模型没有返回深度图。"
        case .emptyImage:
            return "当前没有可计算的图片。"
        }
    }
}

extension CIImage {
    func resized(to size: CGSize) -> CIImage {
        let scaleX = size.width / extent.width
        let scaleY = size.height / extent.height
        var output = transformed(by: CGAffineTransform(scaleX: scaleX, y: scaleY))
        output = output.transformed(
            by: CGAffineTransform(translationX: -output.extent.origin.x, y: -output.extent.origin.y)
        )
        return output
    }
}

extension CIContext {
    func argbPixelBuffer(from image: CIImage) -> CVPixelBuffer? {
        var buffer: CVPixelBuffer?
        let status = CVPixelBufferCreate(
            kCFAllocatorDefault,
            Int(image.extent.width),
            Int(image.extent.height),
            kCVPixelFormatType_32ARGB,
            nil,
            &buffer
        )
        guard status == kCVReturnSuccess, let buffer else { return nil }
        render(image, to: buffer)
        return buffer
    }
}
