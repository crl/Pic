import { CSSProperties, useEffect, useRef, useState } from 'react'
import { DisplayMode, Size } from '../store/types'

function aspectFit(image: Size, container: Size): Size {
  const imageAspect = image.width / Math.max(image.height, 1)
  const containerAspect = container.width / Math.max(container.height, 1)
  if (imageAspect > containerAspect) {
    return { width: container.width, height: container.width / imageAspect }
  }
  return { width: container.height * imageAspect, height: container.height }
}

function useSize() {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<Size>({ width: 0, height: 0 })
  useEffect(() => {
    const node = ref.current
    if (!node) return
    const apply = (): void => setSize({ width: node.clientWidth, height: node.clientHeight })
    apply()
    const observer = new ResizeObserver(apply)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  return { ref, size }
}

function Checkerboard({ width, height }: Size) {
  return (
    <div
      className="absolute inset-0"
      style={{
        width,
        height,
        backgroundColor: 'rgb(41, 41, 41)',
        backgroundImage:
          'linear-gradient(45deg, rgb(56, 56, 56) 25%, transparent 25%), linear-gradient(-45deg, rgb(56, 56, 56) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgb(56, 56, 56) 75%), linear-gradient(-45deg, transparent 75%, rgb(56, 56, 56) 75%)',
        backgroundSize: '24px 24px',
        backgroundPosition: '0 0, 0 12px, 12px -12px, -12px 0'
      }}
    />
  )
}

interface ImageCanvasProps {
  image: HTMLImageElement
  pixelSize: Size
  mode: DisplayMode
  showBackdrop?: boolean
  opacity?: number
}

export function ImageCanvas({
  image,
  pixelSize,
  mode,
  showBackdrop = true,
  opacity = 1
}: ImageCanvasProps) {
  return (
    <div className="absolute inset-0" style={{ opacity, transition: 'opacity 320ms ease-in-out' }}>
      {mode === 'fit' ? (
        <FitImage image={image} pixelSize={pixelSize} showBackdrop={showBackdrop} />
      ) : (
        <ActualImage image={image} pixelSize={pixelSize} showBackdrop={showBackdrop} />
      )}
    </div>
  )
}

function FitImage({
  image,
  pixelSize,
  showBackdrop
}: {
  image: HTMLImageElement
  pixelSize: Size
  showBackdrop: boolean
}) {
  const { ref, size } = useSize()
  const fit = aspectFit(pixelSize, size.width > 0 ? size : { width: 1, height: 1 })
  return (
    <div ref={ref} className="flex h-full w-full items-center justify-center">
      <div className="relative" style={{ width: fit.width, height: fit.height }}>
        {showBackdrop ? <Checkerboard {...fit} /> : null}
        <img src={image.src} alt="" draggable={false} className="absolute inset-0 h-full w-full" />
      </div>
    </div>
  )
}

function ActualImage({
  image,
  pixelSize,
  showBackdrop
}: {
  image: HTMLImageElement
  pixelSize: Size
  showBackdrop: boolean
}) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const width = Math.max(pixelSize.width, 1)
  const height = Math.max(pixelSize.height, 1)

  useEffect(() => {
    const node = scrollerRef.current
    if (!node) return
    const onWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      node.scrollLeft += event.deltaY !== 0 ? event.deltaY : event.deltaX
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  }, [])

  return (
    <div ref={scrollerRef} className="h-full w-full overflow-auto">
      <div
        className="flex items-center justify-center"
        style={{ minWidth: '100%', minHeight: '100%', width, height }}
      >
        <div className="relative shrink-0" style={{ width, height }}>
          {showBackdrop ? <Checkerboard width={width} height={height} /> : null}
          <img
            src={image.src}
            alt=""
            draggable={false}
            className="relative z-[1] block max-w-none"
            style={{ width, height, imageRendering: 'pixelated' }}
          />
        </div>
      </div>
    </div>
  )
}

export function DouyinLetterbox({ image }: { image: HTMLImageElement }) {
  const style: CSSProperties = {
    backgroundImage: `url(${image.src})`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    filter: 'blur(32px)',
    transform: 'scale(1.12)'
  }
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-0" style={style} />
      <div className="absolute inset-0 bg-black/30" />
    </div>
  )
}

export function DouyinBottomFrost() {
  return (
    <div className="pointer-events-none absolute inset-0">
      <div
        className="absolute inset-x-0 bottom-0 h-[168px] bg-black/30 backdrop-blur-xl"
        style={{
          maskImage: 'linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.55) 28%, black 62%, black 100%)',
          WebkitMaskImage:
            'linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.55) 28%, black 62%, black 100%)'
        }}
      />
    </div>
  )
}

export function aspectFitSize(image: Size, container: Size): Size {
  return aspectFit(image, container)
}
