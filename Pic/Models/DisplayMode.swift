import Foundation

enum DisplayMode: String, CaseIterable, Identifiable {
    case fit
    case actual

    var id: String { rawValue }

    var title: String {
        switch self {
        case .fit: return "自适应"
        case .actual: return "实际大小"
        }
    }
}
