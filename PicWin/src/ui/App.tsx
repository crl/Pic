import { useEffect, useRef, useState, type ReactNode } from 'react'
import { SpatialPhotoView } from '../depth/SpatialPhotoView'
import { PanoramaView } from '../depth/PanoramaView'
import { galleryStore, statusText, useGallery, canGoNext, canGoPrevious } from '../store/galleryStore'
import { warmupDepth } from '../depth/DepthProvider'
import { spreadToHaov } from '../depth/panorama'
import { Size } from '../store/types'
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
  const fadeRef = useRef(0)
  const spatialTimer = useRef<number | null>(null)

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
      setSpatialOpacity(0)
      window.setTimeout(() => revealSpatial(), 160)
    } else {
      setSpatialOpacity(0)
      if (spatialTimer.current) window.clearTimeout(spatialTimer.current)
      spatialTimer.current = window.setTimeout(() => {
        if (!galleryStore.getSnapshot().isSpatialMode) setKeepSpatialLayer(false)
      }, 380)
    }
  }, [store.isSpatialMode])

  useEffect(() => {
    const pano = store.isPanoramaMode
    if (!store.depthMap && !pano) {
      setSpatialOpacity(0)
      return
    }
    if (!store.isSpatialMode) return
    setKeepSpatialLayer(true)
    window.setTimeout(() => revealSpatial(), 160)
  }, [store.depthMap, store.isPanoramaMode])

  const revealSpatial = (): void => {
    if (!galleryStore.getSnapshot().isSpatialMode) return
    setSpatialOpacity(1)
  }

  const applyTilt = (value: { width: number; height: number }, settling: boolean): void => {
    setTiltSettling(settling)
    setTilt(value)
  }

  const isPano = store.isPanoramaMode
  const spatialCovering = keepSpatialLayer && (store.depthMap != null || isPano)
  const twoDOpacity = spatialCovering ? 1 - spatialOpacity : 1
  const original = store.currentImage

  return (
    <div className="relative h-full">
      <div className="absolute inset-0">
        {keepSpatialLayer && original && isPano ? (
          <div
            className="absolute inset-0"
            style={{ pointerEvents: store.isSpatialMode ? 'auto' : 'none' }}
          >
            <PanoramaView
              image={original}
              spread={store.panoSpread}
              bend={store.panoBend}
              kind={store.panoKind}
              panels={store.panoPanels}
              onFirstFrame={revealSpatial}
            />
          </div>
        ) : null}
        {keepSpatialLayer && store.depthMap && original && !isPano ? (
          <SpatialLayer
            depthReady
            original={original}
            tilt={tilt}
            tiltSettling={tiltSettling}
            onTilt={applyTilt}
            onFirstFrame={revealSpatial}
          />
        ) : null}

        <div
          className="absolute inset-0"
          style={{
            opacity: twoDOpacity,
            pointerEvents: spatialOpacity >= 0.5 ? 'none' : 'auto',
            transition: 'opacity 380ms ease-in-out'
          }}
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
  original,
  tilt,
  tiltSettling,
  onTilt,
  onFirstFrame
}: {
  depthReady: boolean
  original: HTMLImageElement
  tilt: { width: number; height: number }
  tiltSettling: boolean
  onTilt: (value: { width: number; height: number }, settling: boolean) => void
  onFirstFrame: () => void
}) {
  const store = useGallery()
  const hostRef = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState<Size>({ width: 0, height: 0 })

  useEffect(() => {
    const node = hostRef.current
    if (!node) return
    const apply = (): void => {
      setFit(aspectFitSize(store.pixelSize, { width: node.clientWidth, height: node.clientHeight }))
    }
    apply()
    const observer = new ResizeObserver(apply)
    observer.observe(node)
    return () => observer.disconnect()
  }, [store.pixelSize.width, store.pixelSize.height])

  if (!store.depthMap) return null
  const texture = store.bokehCanvas ?? original

  return (
    <div ref={hostRef} className="absolute inset-0" style={{ pointerEvents: store.isSpatialMode ? 'auto' : 'none' }}>
      <DouyinLetterbox image={original} />
      <DouyinBottomFrost />
      <div className="absolute inset-0 flex items-center justify-center">
        <div
          className="relative"
          style={{ width: Math.max(fit.width, 1), height: Math.max(fit.height, 1) }}
          onMouseMove={(event) => {
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
            const rect = event.currentTarget.getBoundingClientRect()
            galleryStore.setFocus({
              x: (event.clientX - rect.left) / Math.max(rect.width, 1),
              y: (event.clientY - rect.top) / Math.max(rect.height, 1)
            })
          }}
        >
          <SpatialPhotoView
            texture={texture}
            textureRevision={store.bokehRevision}
            depthMap={store.depthMap}
            imageSize={store.pixelSize}
            focus={store.focusNormalized}
            strength={store.parallaxAmount}
            tilt={tilt}
            tiltSettling={tiltSettling}
            onFirstFrame={onFirstFrame}
          />
        </div>
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
