import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { DepthMap } from './DepthMap'

interface SpatialPhotoViewProps {
  texture: HTMLCanvasElement | HTMLImageElement
  textureRevision: number
  depthMap: DepthMap
  imageSize: { width: number; height: number }
  focus: { x: number; y: number }
  strength: number
  tilt: { width: number; height: number }
  tiltSettling: boolean
  onFirstFrame?: () => void
}

function cameraTransform(tilt: { width: number; height: number }, strength: number): THREE.Vector3 {
  const amount = Math.min(Math.max(strength, 0), 1)
  const offset = 0.16 + amount * 0.44
  return new THREE.Vector3(tilt.width * offset, -tilt.height * offset, 3.2 - amount * 0.6)
}

function sampleGrid(depth: DepthMap, cols: number, rows: number): Float32Array {
  const width = cols + 1
  const height = rows + 1
  const raw = new Float32Array(width * height)
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      raw[row * width + col] = depth.sample(col / cols, 1 - row / rows)
    }
  }
  const smooth = new Float32Array(width * height)
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      let acc = 0
      let count = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const y = row + dy
          const x = col + dx
          if (x < 0 || y < 0 || x >= width || y >= height) continue
          acc += raw[y * width + x]!
          count++
        }
      }
      smooth[row * width + col] = acc / Math.max(count, 1)
    }
  }
  return smooth
}

function relativeZ(depth: number, focusDepth: number, maxDisplace: number): number {
  const delta = depth - focusDepth
  const mag = Math.pow(Math.abs(delta), 0.75)
  return Math.sign(delta) * mag * maxDisplace
}

function clampGradients(values: Float32Array, width: number, height: number, maxStep: number): void {
  for (let pass = 0; pass < 2; pass++) {
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const i = row * width + col
        const current = values[i]!
        let next = current
        if (col > 0) {
          const left = values[i - 1]!
          if (Math.abs(current - left) > maxStep) {
            next = left + Math.sign(current - left) * maxStep
          }
        }
        if (row > 0) {
          const up = values[i - width]!
          if (Math.abs(next - up) > maxStep) {
            next = up + Math.sign(next - up) * maxStep
          }
        }
        values[i] = next
      }
    }
  }
}

function makeGeometry(
  depth: DepthMap,
  imageSize: { width: number; height: number },
  focus: { x: number; y: number },
  strength: number
): THREE.BufferGeometry {
  const cols = 140
  const rows = 100
  const aspect = Math.max(imageSize.width, 1) / Math.max(imageSize.height, 1)
  const planeWidth = aspect >= 1 ? 2.0 : 2.0 * aspect
  const planeHeight = aspect >= 1 ? 2.0 / aspect : 2.0
  const amount = Math.min(Math.max(strength, 0), 1)
  const maxDisplace = amount * 0.4
  const width = cols + 1
  const height = rows + 1
  const sampled = sampleGrid(depth, cols, rows)
  const focusDepth = depth.sample(focus.x, focus.y)
  const zs = new Float32Array(width * height)
  for (let i = 0; i < sampled.length; i++) {
    zs[i] = relativeZ(sampled[i]!, focusDepth, maxDisplace)
  }
  clampGradients(zs, width, height, Math.max(0.018, maxDisplace * 0.14))

  const vertexCount = width * height
  const positions = new Float32Array(vertexCount * 3)
  const uvs = new Float32Array(vertexCount * 2)
  let i = 0
  for (let row = 0; row <= rows; row++) {
    for (let col = 0; col <= cols; col++) {
      const u = col / cols
      const v = row / rows
      positions[i * 3] = (u - 0.5) * planeWidth
      positions[i * 3 + 1] = (v - 0.5) * planeHeight
      positions[i * 3 + 2] = zs[row * width + col]!
      uvs[i * 2] = u
      uvs[i * 2 + 1] = v
      i++
    }
  }
  const indices = new Uint32Array(cols * rows * 6)
  const stride = cols + 1
  let t = 0
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const i0 = row * stride + col
      const i1 = i0 + 1
      const i2 = i0 + stride
      const i3 = i2 + 1
      indices.set([i0, i1, i2, i1, i3, i2], t)
      t += 6
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  return geometry
}

interface Engine {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  photo: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
  map: THREE.Texture | null
  currentTilt: { width: number; height: number }
  lastTime: number
  didReport: boolean
}

export function SpatialPhotoView({
  texture,
  textureRevision,
  depthMap,
  imageSize,
  focus,
  strength,
  tilt,
  tiltSettling,
  onFirstFrame
}: SpatialPhotoViewProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<Engine | null>(null)
  const tiltRef = useRef(tilt)
  const settlingRef = useRef(tiltSettling)
  const strengthRef = useRef(strength)
  const onFirstFrameRef = useRef(onFirstFrame)
  tiltRef.current = tilt
  settlingRef.current = tiltSettling
  strengthRef.current = strength
  onFirstFrameRef.current = onFirstFrame

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setClearColor(0x000000, 0)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    Object.assign(renderer.domElement.style, {
      width: '100%',
      height: '100%',
      display: 'block'
    })
    host.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 40)
    const material = new THREE.MeshBasicMaterial({ side: THREE.FrontSide })
    const photo = new THREE.Mesh(new THREE.BufferGeometry(), material)
    scene.add(photo)

    const engine: Engine = {
      renderer,
      scene,
      camera,
      photo,
      map: null,
      currentTilt: { width: 0, height: 0 },
      lastTime: performance.now(),
      didReport: false
    }
    engineRef.current = engine

    const applyCamera = (value: { width: number; height: number }): void => {
      const pos = cameraTransform(value, strengthRef.current)
      camera.position.copy(pos)
      camera.up.set(0, 1, 0)
      camera.lookAt(0, 0, 0)
    }
    applyCamera(engine.currentTilt)

    const resize = (): void => {
      const width = Math.max(host.clientWidth, 1)
      const height = Math.max(host.clientHeight, 1)
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(host)
    resize()

    let running = true
    const tick = (time: number): void => {
      if (!running) return
      const dt = Math.min(Math.max((time - engine.lastTime) / 1000, 0), 0.05)
      engine.lastTime = time
      const target = tiltRef.current
      const dx = target.width - engine.currentTilt.width
      const dy = target.height - engine.currentTilt.height
      const travel = Math.hypot(dx, dy)
      let lambda = 18
      if (settlingRef.current) lambda = 6.2
      else if (travel > 0.35) lambda = 7.2
      const alpha = 1 - Math.exp(-lambda * dt)
      engine.currentTilt = {
        width: engine.currentTilt.width + (target.width - engine.currentTilt.width) * alpha,
        height: engine.currentTilt.height + (target.height - engine.currentTilt.height) * alpha
      }
      applyCamera(engine.currentTilt)
      renderer.render(scene, camera)
      if (!engine.didReport && engine.map) {
        engine.didReport = true
        onFirstFrameRef.current?.()
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)

    return () => {
      running = false
      observer.disconnect()
      engineRef.current = null
      photo.geometry.dispose()
      material.dispose()
      engine.map?.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [])

  useEffect(() => {
    const engine = engineRef.current
    if (!engine) return
    engine.photo.geometry.dispose()
    engine.photo.geometry = makeGeometry(depthMap, imageSize, focus, strength)
    engine.didReport = false
  }, [depthMap, imageSize.width, imageSize.height, focus.x, focus.y, strength])

  useEffect(() => {
    const engine = engineRef.current
    if (!engine) return
    engine.map?.dispose()
    const map = new THREE.Texture(texture)
    map.colorSpace = THREE.SRGBColorSpace
    map.flipY = true
    map.needsUpdate = true
    map.wrapS = THREE.ClampToEdgeWrapping
    map.wrapT = THREE.ClampToEdgeWrapping
    map.minFilter = THREE.LinearFilter
    map.magFilter = THREE.LinearFilter
    engine.map = map
    engine.photo.material.map = map
    engine.photo.material.needsUpdate = true
  }, [texture, textureRevision])

  return <div ref={hostRef} className="h-full w-full" />
}
