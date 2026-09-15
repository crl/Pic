import CoreImage
import Foundation

actor DepthProvider {
    private var cache: [URL: DepthMap] = [:]
    private var order: [URL] = []
    private let maxCached = 24
    private let estimator = DepthAnythingEstimator()

    func depth(for url: URL, preview: CIImage) async throws -> (map: DepthMap, source: DepthSource) {
        if let cached = cache[url] {
            return (cached, .cache)
        }

        if let embedded = EmbeddedDepthReader.read(from: url) {
            remember(url, embedded)
            return (embedded, .embedded)
        }

        guard !preview.extent.isEmpty else { throw DepthError.emptyImage }
        let estimated = try await estimator.estimate(from: preview)
        remember(url, estimated)
        return (estimated, .machineLearning)
    }

    private func remember(_ url: URL, _ map: DepthMap) {
        cache[url] = map
        order.removeAll { $0 == url }
        order.append(url)
        while order.count > maxCached {
            let oldest = order.removeFirst()
            cache.removeValue(forKey: oldest)
        }
    }
}
