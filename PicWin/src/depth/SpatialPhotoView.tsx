import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { DepthMap } from './DepthMap'

interface SpatialPhotoViewProps {
  texture: HTMLCanvasElement | HTMLImageElement
  textureRevision: number
  depthMap: DepthMap
  imageSize: { width: number; height: number }
  tilt: { width: number; height: number }
  tiltSettling: boolean
  onFirstFrame?: () => void
}

function cameraTransform(tilt: { width: number; height: number }): THREE.Vector3 {
  return new THREE.Vector3(tilt.width * 0.28, -tilt.height * 0.28, 3.15)
}

function makeGeometry(depth: DepthMap, imageSize: { width: number; height: number }): THREE.BufferGeometry {
  const cols = 140
  const rows = 100
  const aspect = Math.max(imageSize.width, 1) / Math.max(imageSize.height, 1)
  const planeWidth = aspect >= 1 ? 2.0 : 2.0 * aspect
  const planeHeight = aspect >= 1 ? 2.0 / aspect : 2.0
  const maxDisplace = 0.16
  const vertexCount = (cols + 1) * (rows + 1)
  const positions = new Float32Array(vertexCount * 3)
  const uvs = new Float32Array(vertexCount * 2)
  let i = 0
  for (let row = 0; row <= rows; row++) {
    for (let col = 0; col <= cols; col++) {
      const u = col / cols
      const v = row / rows
      positions[i * 3] = (u - 0.5) * planeWidth
      positions[i * 3 + 1] = (v - 0.5) * planeHeight
      positions[i * 3 + 2] = depth.sample(u, 1 - v) * maxDisplace
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
  tilt,
  tiltSettling,
  onFirstFrame
}: SpatialPhotoViewProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<Engine | null>(null)
  const tiltRef = useRef(tilt)
  const settlingRef = useRef(tiltSettling)
  const onFirstFrameRef = useRef(onFirstFrame)
  tiltRef.current = tilt
  settlingRef.current = tiltSettling
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
      const pos = cameraTransform(value)
      camera.position.copy(pos)
      camera.up.set(0, 1, 0)
      camera.lookAt(0, 0, 0.05)
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
    engine.photo.geometry = makeGeometry(depthMap, imageSize)
    engine.didReport = false
  }, [depthMap, imageSize.width, imageSize.height])

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
