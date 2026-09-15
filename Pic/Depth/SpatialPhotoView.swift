import AppKit
import SceneKit
import SwiftUI

struct SpatialPhotoView: NSViewRepresentable {
    var texture: NSImage
    var textureRevision: Int
    var depthMap: DepthMap
    var tilt: CGSize
    var tiltSettling: Bool
    var onFirstFrame: (() -> Void)?

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeNSView(context: Context) -> SCNView {
        let view = SCNView()
        view.scene = SCNScene()
        view.wantsLayer = true
        view.layer?.isOpaque = false
        view.backgroundColor = .clear
        view.autoenablesDefaultLighting = false
        view.allowsCameraControl = false
        view.antialiasingMode = .multisampling4X
        view.isPlaying = true
        view.rendersContinuously = true
        view.delegate = context.coordinator
        context.coordinator.onFirstFrame = onFirstFrame
        context.coordinator.install(in: view)
        context.coordinator.update(
            texture: texture,
            revision: textureRevision,
            depth: depthMap,
            tilt: tilt,
            tiltSettling: tiltSettling,
            in: view
        )
        return view
    }

    func updateNSView(_ view: SCNView, context: Context) {
        context.coordinator.onFirstFrame = onFirstFrame
        context.coordinator.update(
            texture: texture,
            revision: textureRevision,
            depth: depthMap,
            tilt: tilt,
            tiltSettling: tiltSettling,
            in: view
        )
    }

    final class Coordinator: NSObject, SCNSceneRendererDelegate {
        var onFirstFrame: (() -> Void)?

        private let cameraNode = SCNNode()
        private let photoNode = SCNNode()
        private var lastDepthSize: (Int, Int)?
        private var lastTextureRevision: Int = -1
        private var targetTilt: CGSize = .zero
        private var currentTilt: CGSize = .zero
        private var settling = false
        private var lastRenderTime: TimeInterval?
        private var didReportFirstFrame = false

        func install(in view: SCNView) {
            guard let scene = view.scene else { return }
            scene.background.contents = NSColor.clear

            let camera = SCNCamera()
            camera.fieldOfView = 30
            camera.zNear = 0.01
            camera.zFar = 40
            camera.wantsHDR = false
            cameraNode.camera = camera
            cameraNode.transform = Self.cameraTransform(tilt: .zero)
            scene.rootNode.addChildNode(cameraNode)
            scene.rootNode.addChildNode(photoNode)
        }

        func update(
            texture: NSImage,
            revision: Int,
            depth: DepthMap,
            tilt: CGSize,
            tiltSettling: Bool,
            in view: SCNView
        ) {
            let depthSize = (depth.width, depth.height)
            if lastDepthSize == nil || lastDepthSize! != depthSize {
                photoNode.geometry = Self.makeGeometry(depth: depth, imageSize: texture.pixelSize)
                lastDepthSize = depthSize
                lastTextureRevision = -1
            }

            if lastTextureRevision != revision, let material = photoNode.geometry?.firstMaterial {
                material.lightingModel = .constant
                material.diffuse.contents = texture.cgImageForScene ?? texture
                material.diffuse.contentsTransform = SCNMatrix4Translate(SCNMatrix4MakeScale(1, -1, 1), 0, 1, 0)
                material.diffuse.wrapS = .clamp
                material.diffuse.wrapT = .clamp
                material.diffuse.magnificationFilter = .linear
                material.diffuse.minificationFilter = .linear
                material.isDoubleSided = false
                lastTextureRevision = revision
            }

            targetTilt = tilt
            settling = tiltSettling
        }

        func renderer(_ renderer: SCNSceneRenderer, didRenderScene scene: SCNScene, atTime time: TimeInterval) {
            let dt: Float
            if let lastRenderTime {
                dt = Float(min(max(time - lastRenderTime, 0), 0.05))
            } else {
                dt = 1.0 / 60.0
            }
            lastRenderTime = time

            let dx = Float(targetTilt.width - currentTilt.width)
            let dy = Float(targetTilt.height - currentTilt.height)
            let travel = hypot(dx, dy)
            let lambda: Float
            if settling {
                lambda = 6.2
            } else if travel > 0.35 {
                lambda = 7.2
            } else {
                lambda = 18.0
            }
            let alpha = 1 - exp(-lambda * dt)
            let x = Float(currentTilt.width) + (Float(targetTilt.width) - Float(currentTilt.width)) * alpha
            let y = Float(currentTilt.height) + (Float(targetTilt.height) - Float(currentTilt.height)) * alpha
            currentTilt = CGSize(width: CGFloat(x), height: CGFloat(y))
            cameraNode.transform = Self.cameraTransform(tilt: currentTilt)

            guard !didReportFirstFrame, lastTextureRevision >= 0 else { return }
            didReportFirstFrame = true
            DispatchQueue.main.async { [weak self] in
                self?.onFirstFrame?()
            }
        }

        private static func cameraTransform(tilt: CGSize) -> SCNMatrix4 {
            let maxOffset: Float = 0.28
            let x = Float(tilt.width) * maxOffset
            let y = Float(-tilt.height) * maxOffset
            let node = SCNNode()
            node.position = SCNVector3(x, y, 3.15)
            node.look(at: SCNVector3(0, 0, 0.05), up: SCNVector3(0, 1, 0), localFront: SCNVector3(0, 0, -1))
            return node.transform
        }

        private static func makeGeometry(depth: DepthMap, imageSize: CGSize) -> SCNGeometry {
            let cols = 140
            let rows = 100
            let aspect = Float(max(imageSize.width, 1) / max(imageSize.height, 1))
            let planeWidth: Float = aspect >= 1 ? 2.0 : 2.0 * aspect
            let planeHeight: Float = aspect >= 1 ? 2.0 / aspect : 2.0
            let maxDisplace: Float = 0.16

            var vertices: [SCNVector3] = []
            var uvs: [CGPoint] = []
            vertices.reserveCapacity((cols + 1) * (rows + 1))
            uvs.reserveCapacity((cols + 1) * (rows + 1))

            for row in 0...rows {
                for col in 0...cols {
                    let u = Float(col) / Float(cols)
                    let v = Float(row) / Float(rows)
                    let x = (u - 0.5) * planeWidth
                    let y = (v - 0.5) * planeHeight
                    let z = depth.sample(u: u, v: 1 - v) * maxDisplace
                    vertices.append(SCNVector3(x, y, z))
                    uvs.append(CGPoint(x: CGFloat(u), y: CGFloat(v)))
                }
            }

            var indices: [UInt32] = []
            indices.reserveCapacity(cols * rows * 6)
            let stride = cols + 1
            for row in 0..<rows {
                for col in 0..<cols {
                    let i0 = UInt32(row * stride + col)
                    let i1 = i0 + 1
                    let i2 = i0 + UInt32(stride)
                    let i3 = i2 + 1
                    indices.append(contentsOf: [i0, i1, i2, i1, i3, i2])
                }
            }

            let vertexSource = SCNGeometrySource(vertices: vertices)
            let uvSource = SCNGeometrySource(textureCoordinates: uvs)
            let element = SCNGeometryElement(indices: indices, primitiveType: .triangles)
            let geometry = SCNGeometry(sources: [vertexSource, uvSource], elements: [element])

            let material = SCNMaterial()
            material.lightingModel = .constant
            material.diffuse.contentsTransform = SCNMatrix4Translate(SCNMatrix4MakeScale(1, -1, 1), 0, 1, 0)
            material.isDoubleSided = false
            geometry.materials = [material]
            return geometry
        }
    }
}
