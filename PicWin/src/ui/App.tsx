import { useEffect, useRef, useState } from 'react'
import { SpatialPhotoView } from '../depth/SpatialPhotoView'
import { galleryStore, statusText, useGallery } from '../store/galleryStore'
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
    if (!store.depthMap) {
      setSpatialOpacity(0)
      return
    }
    if (!store.isSpatialMode) return
    setKeepSpatialLayer(true)
    window.setTimeout(() => revealSpatial(), 160)
  }, [store.depthMap])

  const revealSpatial = (): void => {
    if (!galleryStore.getSnapshot().isSpatialMode) return
    setSpatialOpacity(1)
  }

  const applyTilt = (value: { width: number; height: number }, settling: boolean): void => {
    setTiltSettling(settling)
    setTilt(value)
  }

  const spatialCovering = keepSpatialLayer && store.depthMap != null
  const twoDOpacity = spatialCovering ? 1 - spatialOpacity : 1
  const original = store.currentImage

  return (
    <div className="relative h-full">
      <div className="absolute inset-0">
        {keepSpatialLayer && store.depthMap && original ? (
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
            tilt={tilt}
            tiltSettling={tiltSettling}
            onFirstFrame={onFirstFrame}
          />
        </div>
      </div>
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
        {store.isSpatialMode ? (
          <div className="mb-2.5 flex items-center gap-2.5 text-white">
            <span className="text-[12px]">虚化</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={store.blurAmount}
              onChange={(event) => galleryStore.setBlurAmount(Number(event.target.value))}
              className="h-1 max-w-[240px] flex-1 accent-[#6bc7fa]"
            />
            <span className="w-10 text-right font-mono text-[12px]">{Math.round(store.blurAmount * 100)}%</span>
          </div>
        ) : null}
        <div className="flex items-center text-[12px] text-white/78">
          <span>{statusText(store)}</span>
          {store.depthSourceLabel && store.isSpatialMode ? (
            <>
              <span className="px-1.5">·</span>
              <span>{store.depthSourceLabel}</span>
            </>
          ) : null}
          <span className="flex-1" />
          {store.isSpatialMode ? <span>移动鼠标看立体 · 点击对焦</span> : null}
        </div>
      </div>
    </div>
  )
}
