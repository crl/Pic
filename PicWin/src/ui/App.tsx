import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { SpatialPhotoView } from '../depth/SpatialPhotoView'
import { PanoramaView } from '../depth/PanoramaView'
import { galleryStore, statusText, useGallery, canGoNext, canGoPrevious } from '../store/galleryStore'
import { warmupDepth } from '../depth/DepthProvider'
import { DepthMap } from '../depth/DepthMap'
import { spreadToHaov } from '../depth/panorama'
import { Point, Size } from '../store/types'
import { EmptyDropView } from '../viewer/EmptyDropView'
import { DouyinBottomFrost, DouyinLetterbox, ImageCanvas, aspectFitSize } from '../viewer/ImageCanvas'
import { TitleBar } from './TitleBar'

export function App() {
  const store = useGallery()

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.code === 'Space' && !event.repeat) {
        const tag = (event.target as HTMLElement | null)?.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON') return
        event.preventDefault()
        galleryStore.toggleDisplayMode()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void warmupDepth()
    }, 400)
    return () => window.clearTimeout(timer)
  }, [])

  return (
    <div
      className="titlebar-no-drag flex h-full flex-col bg-black"
      onDragEnter={(event) => {
        event.preventDefault()
        galleryStore.setDropTargeted(true)
      }}
      onDragOver={(event) => {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
        galleryStore.setDropTargeted(true)
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node)) return
        galleryStore.setDropTargeted(false)
      }}
      onDrop={(event) => {
        event.preventDefault()
        event.stopPropagation()
        galleryStore.setDropTargeted(false)
        const file = event.dataTransfer.files[0]
        if (!file) return
        window.setTimeout(() => {
          if (galleryStore.getSnapshot().items.length > 0) return
          void galleryStore.openFromFile(file)
        }, 100)
      }}
    >
      <TitleBar />
      <div className="relative min-h-0 flex-1">
        {store.currentImage ? (
          <Viewer />
        ) : (
          <EmptyDropView isTargeted={store.isDropTargeted} onOpen={() => void galleryStore.presentOpenPanel()} />
        )}
        <EdgeNav />
        {store.spatialError ? (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/50">
            <div className="w-[360px] rounded-lg bg-[#2b2b2b] p-5 shadow-xl">
              <div className="text-[15px] font-medium">
              {/景深|wasm|backend|onnx|模型/i.test(store.spatialError) ? '无法计算景深' : '无法打开图片'}
            </div>
              <p className="mt-2 text-[13px] text-white/70">{store.spatialError}</p>
              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  className="rounded bg-white/12 px-3 py-1.5 text-[13px] hover:bg-white/18"
                  onClick={() => galleryStore.clearSpatialError()}
                >
                  好
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

interface SpatialSnapshot {
  path: string
  kind: 'depth' | 'pano'
  image: HTMLImageElement
  depthMap: DepthMap | null
  texture: HTMLCanvasElement | HTMLImageElement
  textureRevision: number
  pixelSize: Size
  focus: Point
  panoSpread: number
  panoBend: number
  panoKind: 'panorama' | 'turntable'
  panoPanels: number
}

function snapshotFromStore(store: ReturnType<typeof useGallery>): SpatialSnapshot | null {
  if (!store.currentPath || !store.currentImage) return null
  if (store.isPanoramaMode) {
    return {
      path: store.currentPath,
      kind: 'pano',
      image: store.currentImage,
      depthMap: null,
      texture: store.currentImage,
      textureRevision: 0,
      pixelSize: store.pixelSize,
      focus: store.focusNormalized,
      panoSpread: store.panoSpread,
      panoBend: store.panoBend,
      panoKind: store.panoKind,
      panoPanels: store.panoPanels
    }
  }
  if (!store.depthMap) return null
  return {
    path: store.currentPath,
    kind: 'depth',
    image: store.currentImage,
    depthMap: store.depthMap,
    texture: store.bokehCanvas ?? store.currentImage,
    textureRevision: store.bokehRevision,
    pixelSize: store.pixelSize,
    focus: store.focusNormalized,
    panoSpread: store.panoSpread,
    panoBend: store.panoBend,
    panoKind: store.panoKind,
    panoPanels: store.panoPanels
  }
}

function Viewer() {
  const store = useGallery()
  const [tilt, setTilt] = useState({ width: 0, height: 0 })
  const [tiltSettling, setTiltSettling] = useState(false)
  const [spatialOpacity, setSpatialOpacity] = useState(0)
  const [keepSpatialLayer, setKeepSpatialLayer] = useState(false)
  const [shown, setShown] = useState<HTMLImageElement | null>(store.currentImage)
  const [shownSize, setShownSize] = useState<Size>(store.pixelSize)
  const [incoming, setIncoming] = useState<HTMLImageElement | null>(null)
  const [incomingSize, setIncomingSize] = useState<Size>(store.pixelSize)
  const [incomingOpacity, setIncomingOpacity] = useState(0)
  const [shownSpatial, setShownSpatial] = useState<SpatialSnapshot | null>(null)
  const [incomingSpatial, setIncomingSpatial] = useState<SpatialSnapshot | null>(null)
  const [incomingSpatialOpacity, setIncomingSpatialOpacity] = useState(0)
  const fadeRef = useRef(0)
  const spatialTimer = useRef<number | null>(null)
  const spatialCrossfadeRef = useRef(0)
  const shownSpatialRef = useRef<SpatialSnapshot | null>(null)
  const incomingSpatialRef = useRef<SpatialSnapshot | null>(null)
  shownSpatialRef.current = shownSpatial
  incomingSpatialRef.current = incomingSpatial

  useEffect(() => {
    const image = store.currentImage
    if (!image) {
      fadeRef.current += 1
      setShown(null)
      setIncoming(null)
      setIncomingOpacity(0)
      return
    }
    if (!shown) {
      setShown(image)
      setShownSize(store.pixelSize)
      return
    }
    const generation = ++fadeRef.current
    setIncoming(image)
    setIncomingSize(store.pixelSize)
    setIncomingOpacity(0)
    requestAnimationFrame(() => setIncomingOpacity(1))
    const timer = window.setTimeout(() => {
      if (generation !== fadeRef.current) return
      setShown(image)
      setShownSize(store.pixelSize)
      setIncoming(null)
      setIncomingOpacity(0)
    }, 340)
    return () => window.clearTimeout(timer)
  }, [store.currentPath])

  useEffect(() => {
    applyTilt({ width: 0, height: 0 }, false)
    if (store.isSpatialMode) {
      setKeepSpatialLayer(true)
      if (!store.spatialInstant) setSpatialOpacity(0)
    } else {
      setSpatialOpacity(0)
      if (spatialTimer.current) window.clearTimeout(spatialTimer.current)
      spatialTimer.current = window.setTimeout(() => {
        if (!galleryStore.getSnapshot().isSpatialMode) {
          setKeepSpatialLayer(false)
          setShownSpatial(null)
          setIncomingSpatial(null)
          setIncomingSpatialOpacity(0)
          shownSpatialRef.current = null
          incomingSpatialRef.current = null
        }
      }, 380)
    }
  }, [store.isSpatialMode])

  useEffect(() => {
    if (!store.isSpatialMode && !keepSpatialLayer) return
    const snap = snapshotFromStore(store)
    if (!snap) return
    const shownSnap = shownSpatialRef.current
    const incomingSnap = incomingSpatialRef.current
    if (!shownSnap && !incomingSnap) {
      setShownSpatial(snap)
      return
    }
    if (shownSnap?.path === snap.path) {
      setShownSpatial(snap)
      if (incomingSnap) {
        spatialCrossfadeRef.current += 1
        setIncomingSpatial(null)
        setIncomingSpatialOpacity(0)
        if (incomingSnap.image !== snap.image && incomingSnap.image !== shownSnap.image) {
          galleryStore.releaseImage(incomingSnap.image)
        }
      }
      return
    }
    if (incomingSnap?.path === snap.path) {
      setIncomingSpatial(snap)
      return
    }
    spatialCrossfadeRef.current += 1
    if (incomingSnap && incomingSnap.image !== snap.image && incomingSnap.image !== shownSnap?.image) {
      galleryStore.releaseImage(incomingSnap.image)
    }
    setIncomingSpatial(snap)
    setIncomingSpatialOpacity(0)
  }, [
    store.currentPath,
    store.currentImage,
    store.depthMap,
    store.bokehRevision,
    store.isSpatialMode,
    store.isPanoramaMode,
    store.panoKind,
    store.panoPanels,
    store.panoSpread,
    store.panoBend,
    store.focusNormalized.x,
    store.focusNormalized.y,
    keepSpatialLayer
  ])

  const revealSpatial = (): void => {
    if (!galleryStore.getSnapshot().isSpatialMode) return
    setSpatialOpacity(1)
  }

  const revealIncomingSpatial = (path: string): void => {
    if (incomingSpatialRef.current?.path !== path) return
    revealSpatial()
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setIncomingSpatialOpacity(1))
    })
    const generation = ++spatialCrossfadeRef.current
    window.setTimeout(() => {
      if (generation !== spatialCrossfadeRef.current) return
      const next = incomingSpatialRef.current
      if (!next || next.path !== path) return
      const previous = shownSpatialRef.current
      setShownSpatial(next)
      setIncomingSpatial(null)
      setIncomingSpatialOpacity(0)
      if (previous && previous.image !== next.image) {
        galleryStore.releaseImage(previous.image)
      }
    }, 420)
  }

  const applyTilt = (value: { width: number; height: number }, settling: boolean): void => {
    setTiltSettling(settling)
    setTilt(value)
  }

  const spatialOn = store.isSpatialMode && spatialOpacity >= 0.5
  const spatialLayers = [shownSpatial, incomingSpatial].filter((layer, index, list): layer is SpatialSnapshot => {
    return !!layer && list.findIndex((item) => item?.path === layer.path) === index
  })

  return (
    <div className="relative h-full">
      <div className="absolute inset-0">
        <div
          className="absolute inset-0"
          style={{ pointerEvents: spatialOn ? 'none' : 'auto' }}
        >
          <div className="absolute inset-0">
            {shown ? <DouyinLetterbox image={shown} /> : null}
            {incoming ? (
              <div className="absolute inset-0" style={{ opacity: incomingOpacity, transition: 'opacity 320ms ease-in-out' }}>
                <DouyinLetterbox image={incoming} />
              </div>
            ) : null}
            {shown ? (
              <ImageCanvas image={shown} pixelSize={shownSize} mode={store.displayMode} showBackdrop />
            ) : null}
            {incoming ? (
              <ImageCanvas
                image={incoming}
                pixelSize={incomingSize}
                mode={store.displayMode}
                showBackdrop={false}
                opacity={incomingOpacity}
              />
            ) : null}
          </div>
        </div>

        {keepSpatialLayer && spatialLayers.length > 0 ? (
          <div
            className="absolute inset-0"
            style={{
              opacity: spatialOpacity,
              transition: store.spatialInstant ? 'none' : 'opacity 320ms ease-out',
              pointerEvents: spatialOn ? 'auto' : 'none'
            }}
          >
            {spatialLayers.map((layer) => {
              const isIncoming = incomingSpatial?.path === layer.path
              const interactive = isIncoming ? incomingSpatialOpacity > 0.85 : !incomingSpatial
              return (
                <div
                  key={layer.path}
                  className="absolute inset-0"
                  style={{
                    opacity: isIncoming ? incomingSpatialOpacity : 1,
                    transition: isIncoming ? 'opacity 360ms ease-in-out' : undefined,
                    pointerEvents: interactive ? 'auto' : 'none'
                  }}
                >
                  {layer.kind === 'pano' ? (
                    <PanoramaView
                      image={layer.image}
                      spread={layer.panoSpread}
                      bend={layer.panoBend}
                      kind={layer.panoKind}
                      panels={layer.panoPanels}
                      onFirstFrame={
                        isIncoming ? () => revealIncomingSpatial(layer.path) : revealSpatial
                      }
                    />
                  ) : layer.depthMap ? (
                    <SpatialLayer
                      snapshot={layer}
                      tilt={tilt}
                      tiltSettling={tiltSettling}
                      interactive={interactive}
                      onTilt={applyTilt}
                      onFirstFrame={
                        isIncoming ? () => revealIncomingSpatial(layer.path) : revealSpatial
                      }
                    />
                  ) : null}
                </div>
              )
            })}
          </div>
        ) : null}
      </div>
      {store.spatialBusy ? (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
          <span className="pic-spin" />
        </div>
      ) : null}
      <OverlayChrome />
    </div>
  )
}

function SpatialLayer({
  snapshot,
  tilt,
  tiltSettling,
  interactive,
  onTilt,
  onFirstFrame
}: {
  snapshot: SpatialSnapshot
  tilt: { width: number; height: number }
  tiltSettling: boolean
  interactive: boolean
  onTilt: (value: { width: number; height: number }, settling: boolean) => void
  onFirstFrame: () => void
}) {
  const store = useGallery()
  const hostRef = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState<Size>({ width: 0, height: 0 })
  const depthMap = snapshot.depthMap

  useLayoutEffect(() => {
    const node = hostRef.current
    if (!node) return
    const apply = (): void => {
      setFit(aspectFitSize(snapshot.pixelSize, { width: node.clientWidth, height: node.clientHeight }))
    }
    apply()
    const observer = new ResizeObserver(apply)
    observer.observe(node)
    return () => observer.disconnect()
  }, [snapshot.pixelSize.width, snapshot.pixelSize.height])

  if (!depthMap) return null

  return (
    <div ref={hostRef} className="absolute inset-0" style={{ pointerEvents: interactive ? 'auto' : 'none' }}>
      <DouyinLetterbox image={snapshot.image} />
      <DouyinBottomFrost />
      <div className="absolute inset-0 flex items-center justify-center">
        {fit.width > 2 && fit.height > 2 ? (
          <div
            className="relative"
            style={{ width: Math.max(fit.width, 1), height: Math.max(fit.height, 1) }}
            onMouseMove={(event) => {
              if (!interactive) return
              const rect = event.currentTarget.getBoundingClientRect()
              onTilt(
                {
                  width: ((event.clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1,
                  height: ((event.clientY - rect.top) / Math.max(rect.height, 1)) * 2 - 1
                },
                false
              )
            }}
            onClick={(event) => {
              if (!interactive || snapshot.path !== store.currentPath) return
              const rect = event.currentTarget.getBoundingClientRect()
              galleryStore.setFocus({
                x: (event.clientX - rect.left) / Math.max(rect.width, 1),
                y: (event.clientY - rect.top) / Math.max(rect.height, 1)
              })
            }}
          >
            <SpatialPhotoView
              texture={snapshot.texture}
              textureRevision={snapshot.textureRevision}
              depthMap={depthMap}
              imageSize={snapshot.pixelSize}
              focus={snapshot.focus}
              strength={store.parallaxAmount}
              tilt={tilt}
              tiltSettling={tiltSettling}
              onFirstFrame={onFirstFrame}
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}

function EdgeNav() {
  const store = useGallery()
  if (!store.currentImage) return null
  return (
    <>
      <EdgeButton
        side="left"
        label="上一张"
        disabled={!canGoPrevious(store)}
        onClick={() => galleryStore.previous()}
      >
        <path d="M7.5 2.5 3.5 6l4 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </EdgeButton>
      <EdgeButton
        side="right"
        label="下一张"
        disabled={!canGoNext(store)}
        onClick={() => galleryStore.next()}
      >
        <path d="M4.5 2.5 8.5 6l-4 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </EdgeButton>
    </>
  )
}

function EdgeButton({
  side,
  label,
  disabled,
  onClick,
  children
}: {
  side: 'left' | 'right'
  label: string
  disabled: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <div
      className={`group absolute inset-y-0 z-20 flex w-[72px] items-center ${
        side === 'left' ? 'left-0 justify-start pl-3' : 'right-0 justify-end pr-3'
      }`}
    >
      <button
        type="button"
        title={label}
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
        className={`flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-black/40 text-white/90 shadow-[0_8px_24px_rgba(0,0,0,0.35)] backdrop-blur-md transition duration-200 hover:scale-105 hover:border-white/25 hover:bg-white/15 hover:text-white disabled:pointer-events-none ${
          side === 'left' ? '-translate-x-1' : 'translate-x-1'
        } opacity-0 group-hover:translate-x-0 group-hover:enabled:opacity-100`}
      >
        <svg width="16" height="16" viewBox="0 0 12 12" fill="none">
          {children}
        </svg>
      </button>
    </div>
  )
}

function OverlayChrome() {
  const store = useGallery()
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0">
      <div
        className={`pointer-events-auto px-4 py-3 ${
          store.isSpatialMode ? 'bg-black/20 backdrop-blur-md' : 'bg-black/42'
        }`}
        style={{ transition: 'background 320ms ease-in-out' }}
      >
        <div className="flex items-center gap-3 text-[12px] text-white/78">
          <span className="shrink-0">{statusText(store)}</span>
          {store.depthSourceLabel && store.isSpatialMode ? (
            <>
              <span className="shrink-0">·</span>
              <span className="shrink-0">{store.depthSourceLabel}</span>
            </>
          ) : null}
          {store.isSpatialMode && store.isPanoramaMode && store.panoKind !== 'turntable' ? (
            <>
              <div className="flex min-w-0 flex-1 items-center gap-2.5 text-white">
                <span className="shrink-0">张角</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={store.panoSpread}
                  onChange={(event) => galleryStore.setPanoSpread(Number(event.target.value))}
                  className="h-1 min-w-[72px] max-w-[180px] flex-1 accent-[#6bc7fa]"
                />
                <span className="w-10 shrink-0 text-right font-mono">
                  {Math.round((spreadToHaov(store.panoSpread) * 180) / Math.PI)}°
                </span>
              </div>
              <div className="flex min-w-0 flex-1 items-center gap-2.5 text-white">
                <span className="shrink-0">弯曲</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={store.panoBend}
                  onChange={(event) => galleryStore.setPanoBend(Number(event.target.value))}
                  className="h-1 min-w-[72px] max-w-[180px] flex-1 accent-[#6bc7fa]"
                />
                <span className="w-10 shrink-0 text-right font-mono">{Math.round(store.panoBend * 100)}%</span>
              </div>
            </>
          ) : store.isSpatialMode && !store.isPanoramaMode ? (
            <>
              <div className="flex min-w-0 flex-1 items-center gap-2.5 text-white">
                <span className="shrink-0">虚化</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={store.blurAmount}
                  onChange={(event) => galleryStore.setBlurAmount(Number(event.target.value))}
                  className="h-1 min-w-[72px] max-w-[180px] flex-1 accent-[#6bc7fa]"
                />
                <span className="w-10 shrink-0 text-right font-mono">{Math.round(store.blurAmount * 100)}%</span>
              </div>
              <div className="flex min-w-0 flex-1 items-center gap-2.5 text-white">
                <span className="shrink-0">景深</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={store.parallaxAmount}
                  onChange={(event) => galleryStore.setParallaxAmount(Number(event.target.value))}
                  className="h-1 min-w-[72px] max-w-[180px] flex-1 accent-[#6bc7fa]"
                />
                <span className="w-10 shrink-0 text-right font-mono">{Math.round(store.parallaxAmount * 100)}%</span>
              </div>
            </>
          ) : (
            <span className="flex-1" />
          )}
          {store.isSpatialMode ? (
            <span className="shrink-0">
              {store.isPanoramaMode
                ? store.panoKind === 'turntable'
                  ? '拖动旋转角色 · 滚轮缩放'
                  : '拖动环视 · 滚轮缩放'
                : '移动鼠标看立体 · 点击对焦'}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  )
}
