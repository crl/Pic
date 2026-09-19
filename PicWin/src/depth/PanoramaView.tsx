import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { isEquirectangular, spreadToHaov } from './panorama'

interface PanoramaViewProps {
  image: HTMLImageElement
  spread: number
  bend: number
  kind: 'panorama' | 'turntable'
  panels: number
  onFirstFrame?: () => void
}

export function PanoramaView({
  image,
  spread,
  bend,
  kind,
  panels,
  onFirstFrame
}: PanoramaViewProps) {
  if (kind === 'turntable') {
    return <TurntableView image={image} panels={Math.max(panels, 2)} onFirstFrame={onFirstFrame} />
  }
  return <CylinderPanoView image={image} spread={spread} bend={bend} onFirstFrame={onFirstFrame} />
}

function CylinderPanoView({
  image,
  spread,
  bend,
  onFirstFrame
}: {
  image: HTMLImageElement
  spread: number
  bend: number
  onFirstFrame?: () => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const onFirstFrameRef = useRef(onFirstFrame)
  onFirstFrameRef.current = onFirstFrame
  const worldRef = useRef<{
    mesh: THREE.Mesh
    camera: THREE.PerspectiveCamera
    yaw: number
    pitch: number
    limits: ViewLimits
  } | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setClearColor(0x000000, 1)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    Object.assign(renderer.domElement.style, {
      width: '100%',
      height: '100%',
      display: 'block',
      cursor: 'grab',
      touchAction: 'none'
    })
    host.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 4000)
    camera.rotation.order = 'YXZ'

    const map = new THREE.Texture(image)
    map.colorSpace = THREE.SRGBColorSpace
    map.minFilter = THREE.LinearFilter
    map.magFilter = THREE.LinearFilter
    map.generateMipmaps = false
    map.wrapS = THREE.ClampToEdgeWrapping
    map.wrapT = THREE.ClampToEdgeWrapping
    map.needsUpdate = true

    const material = new THREE.MeshBasicMaterial({ map, side: THREE.DoubleSide })
    const geometry = makePanoGeometry(image, spread, bend)
    const mesh = new THREE.Mesh(geometry, material)
    scene.add(mesh)

    const world = {
      mesh,
      camera,
      yaw: 0,
      pitch: 0,
      limits: viewLimits(image, spread, bend)
    }
    worldRef.current = world

    let dragging = false
    let lastX = 0
    let lastY = 0
    let running = true
    let didReport = false

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

    const canvas = renderer.domElement
    const onDown = (event: PointerEvent): void => {
      dragging = true
      lastX = event.clientX
      lastY = event.clientY
      canvas.setPointerCapture(event.pointerId)
      canvas.style.cursor = 'grabbing'
    }
    const onMove = (event: PointerEvent): void => {
      if (!dragging) return
      world.yaw -= (event.clientX - lastX) * 0.005
      world.pitch -= (event.clientY - lastY) * 0.005
      applyLimits(world)
      lastX = event.clientX
      lastY = event.clientY
    }
    const onUp = (event: PointerEvent): void => {
      dragging = false
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId)
      }
      canvas.style.cursor = 'grab'
    }
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      camera.fov = Math.min(Math.max(camera.fov + event.deltaY * 0.04, 40), 100)
      camera.updateProjectionMatrix()
    }

    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)
    canvas.addEventListener('wheel', onWheel, { passive: false })

    const tick = (): void => {
      if (!running) return
      camera.rotation.y = world.yaw
      camera.rotation.x = world.pitch
      renderer.render(scene, camera)
      if (!didReport) {
        didReport = true
        onFirstFrameRef.current?.()
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)

    return () => {
      running = false
      worldRef.current = null
      observer.disconnect()
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
      canvas.removeEventListener('wheel', onWheel)
      geometry.dispose()
      material.dispose()
      map.dispose()
      renderer.dispose()
      canvas.remove()
    }
  }, [image])

  useEffect(() => {
    const world = worldRef.current
    if (!world) return
    const previous = world.mesh.geometry
    world.mesh.geometry = makePanoGeometry(image, spread, bend)
    previous.dispose()
    world.limits = viewLimits(image, spread, bend)
    applyLimits(world)
  }, [image, spread, bend])

  return <div ref={hostRef} className="h-full w-full" />
}

interface ViewLimits {
  pitch: number
  yaw: number | null
}

function makePanoGeometry(image: HTMLImageElement, spread: number, bend: number): THREE.BufferGeometry {
  const useSphere = isEquirectangular({
    width: image.naturalWidth,
    height: image.naturalHeight
  }) && spread > 0.97 && bend > 0.97
  if (useSphere) {
    const sphere = new THREE.SphereGeometry(500, 64, 48)
    sphere.scale(-1, 1, 1)
    return sphere
  }
  return makeBentGeometry(spreadToHaov(spread), bend, image.naturalWidth / Math.max(image.naturalHeight, 1))
}

function makeBentGeometry(haov: number, bend: number, aspect: number): THREE.BufferGeometry {
  const segsX = 96
  const segsY = 16
  const radius = 500
  const width = radius * haov
  const height = width / Math.max(aspect, 0.05)
  const bendSafe = Math.max(Math.min(bend, 1), 0.02)
  const rEff = radius / bendSafe
  const centerShift = rEff - radius
  const positions = new Float32Array((segsX + 1) * (segsY + 1) * 3)
  const uvs = new Float32Array((segsX + 1) * (segsY + 1) * 2)
  let p = 0
  let t = 0
  for (let iy = 0; iy <= segsY; iy += 1) {
    const v = iy / segsY
    const y = (0.5 - v) * height
    for (let ix = 0; ix <= segsX; ix += 1) {
      const u = ix / segsX
      const angle = (u - 0.5) * haov * bendSafe
      positions[p++] = rEff * Math.sin(angle)
      positions[p++] = y
      positions[p++] = -rEff * Math.cos(angle) + centerShift
      uvs[t++] = u
      uvs[t++] = 1 - v
    }
  }
  const indices: number[] = []
  const row = segsX + 1
  for (let iy = 0; iy < segsY; iy += 1) {
    for (let ix = 0; ix < segsX; ix += 1) {
      const a = iy * row + ix
      indices.push(a, a + 1, a + row, a + 1, a + row + 1, a + row)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  return geometry
}

function viewLimits(image: HTMLImageElement, spread: number, bend: number): ViewLimits {
  if (
    isEquirectangular({ width: image.naturalWidth, height: image.naturalHeight }) &&
    spread > 0.97 &&
    bend > 0.97
  ) {
    return { pitch: Math.PI / 2 - 0.04, yaw: null }
  }
  const haov = spreadToHaov(spread)
  const aspect = image.naturalWidth / Math.max(image.naturalHeight, 1)
  const height = (500 * haov) / aspect
  const pitch = Math.max(0.1, Math.atan(height / 2 / 500) - 0.04)
  const wrap = haov > (330 * Math.PI) / 180 && bend > 0.85
  return {
    pitch,
    yaw: wrap ? null : Math.max(0.06, (haov * Math.max(bend, 0.18)) / 2 - 0.12)
  }
}

function applyLimits(world: { yaw: number; pitch: number; limits: ViewLimits }): void {
  world.pitch = Math.min(Math.max(world.pitch, -world.limits.pitch), world.limits.pitch)
  if (world.limits.yaw == null) return
  world.yaw = Math.min(Math.max(world.yaw, -world.limits.yaw), world.limits.yaw)
}

function TurntableView({
  image,
  panels,
  onFirstFrame
}: {
  image: HTMLImageElement
  panels: number
  onFirstFrame?: () => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const onFirstFrameRef = useRef(onFirstFrame)
  onFirstFrameRef.current = onFirstFrame

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setClearColor(0xd7dde4, 1)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    Object.assign(renderer.domElement.style, {
      width: '100%',
      height: '100%',
      display: 'block',
      cursor: 'grab',
      touchAction: 'none'
    })
    host.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100)
    const panelAspect = image.naturalWidth / panels / Math.max(image.naturalHeight, 1)
    const planeH = 1.7
    const planeW = planeH * panelAspect
    const geometry = new THREE.PlaneGeometry(planeW, planeH)

    const makeSlice = (): { mesh: THREE.Mesh; map: THREE.Texture; material: THREE.MeshBasicMaterial } => {
      const map = new THREE.Texture(image)
      map.colorSpace = THREE.SRGBColorSpace
      map.minFilter = THREE.LinearFilter
      map.magFilter = THREE.LinearFilter
      map.generateMipmaps = false
      map.wrapS = THREE.ClampToEdgeWrapping
      map.wrapT = THREE.ClampToEdgeWrapping
      map.repeat.set(1 / panels, 1)
      map.needsUpdate = true
      const material = new THREE.MeshBasicMaterial({
        map,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide
      })
      const mesh = new THREE.Mesh(geometry, material)
      scene.add(mesh)
      return { mesh, map, material }
    }

    const a = makeSlice()
    const b = makeSlice()

    let yaw = 0
    let pitch = 0.06
    let radius = 2.55
    let dragging = false
    let lastX = 0
    let lastY = 0
    let running = true
    let didReport = false

    const applyView = (): void => {
      const turn = ((yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
      const slots = 4
      const scaled = (turn / (Math.PI * 2)) * slots
      const s0 = Math.floor(scaled) % slots
      const frac = scaled - Math.floor(scaled)
      const s1 = (s0 + 1) % slots
      paintSlice(a, panels, s0)
      paintSlice(b, panels, s1)
      a.material.opacity = 1 - frac
      b.material.opacity = frac
      const cos = Math.cos(pitch)
      camera.position.set(Math.sin(yaw) * cos * radius, Math.sin(pitch) * radius, Math.cos(yaw) * cos * radius)
      camera.lookAt(0, 0, 0)
    }

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
    applyView()

    const canvas = renderer.domElement
    const onDown = (event: PointerEvent): void => {
      dragging = true
      lastX = event.clientX
      lastY = event.clientY
      canvas.setPointerCapture(event.pointerId)
      canvas.style.cursor = 'grabbing'
    }
    const onMove = (event: PointerEvent): void => {
      if (!dragging) return
      yaw -= (event.clientX - lastX) * 0.008
      pitch = Math.min(Math.max(pitch + (event.clientY - lastY) * 0.004, -0.35), 0.42)
      lastX = event.clientX
      lastY = event.clientY
    }
    const onUp = (event: PointerEvent): void => {
      dragging = false
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
      canvas.style.cursor = 'grab'
    }
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      radius = Math.min(Math.max(radius + event.deltaY * 0.002, 1.6), 4.2)
    }

    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)
    canvas.addEventListener('wheel', onWheel, { passive: false })

    const tick = (): void => {
      if (!running) return
      applyView()
      renderer.render(scene, camera)
      if (!didReport) {
        didReport = true
        onFirstFrameRef.current?.()
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)

    return () => {
      running = false
      observer.disconnect()
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
      canvas.removeEventListener('wheel', onWheel)
      geometry.dispose()
      a.material.dispose()
      b.material.dispose()
      a.map.dispose()
      b.map.dispose()
      renderer.dispose()
      canvas.remove()
    }
  }, [image, panels])

  return <div ref={hostRef} className="h-full w-full" />
}

function paintSlice(
  slice: { mesh: THREE.Mesh; map: THREE.Texture },
  panels: number,
  slot: number
): void {
  const view = slotToView(slot, panels)
  slice.map.repeat.set(1 / panels, 1)
  slice.map.offset.set(view.index / panels, 0)
  slice.mesh.scale.x = view.mirror ? -1 : 1
}

function slotToView(slot: number, panels: number): { index: number; mirror: boolean } {
  if (panels === 3) {
    const views = [
      { index: 0, mirror: false },
      { index: 1, mirror: false },
      { index: 2, mirror: false },
      { index: 1, mirror: true }
    ]
    return views[slot] ?? views[0]
  }
  if (panels === 2) {
    return { index: slot === 0 || slot === 3 ? 0 : 1, mirror: false }
  }
  return { index: slot % panels, mirror: false }
}
