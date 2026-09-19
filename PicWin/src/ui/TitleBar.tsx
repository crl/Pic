import type { ReactNode } from 'react'
import { galleryStore, useGallery } from '../store/galleryStore'
import { fileName } from '../store/decodeImage'

function IconButton({
  label,
  disabled,
  onClick,
  children
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="titlebar-no-drag inline-flex h-7 w-7 items-center justify-center rounded text-white/90 hover:bg-white/10 disabled:opacity-35"
    >
      {children}
    </button>
  )
}

export function TitleBar() {
  const store = useGallery()
  const title = store.currentPath ? fileName(store.currentPath) : 'Pic'
  const spatialOn = store.isSpatialMode

  return (
    <div className="titlebar-drag relative flex h-10 shrink-0 items-center bg-[#1c1c1c] text-[12px] text-white/90">
      <div className="titlebar-no-drag z-10 min-w-0 max-w-[38%] truncate pl-3 text-[13px] font-medium tracking-wide">
        {title}
      </div>

      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="titlebar-no-drag pointer-events-auto flex overflow-hidden rounded border border-white/12">
          <ModeButton
            active={store.displayMode === 'fit'}
            disabled={!store.currentImage || spatialOn}
            onClick={() => galleryStore.setDisplayMode('fit')}
          >
            自适应
          </ModeButton>
          <ModeButton
            active={store.displayMode === 'actual'}
            disabled={!store.currentImage || spatialOn}
            onClick={() => galleryStore.setDisplayMode('actual')}
          >
            实际大小
          </ModeButton>
        </div>
      </div>

      <div className="titlebar-no-drag z-10 ml-auto flex items-center pr-1">
        <IconButton
          label="3D 景深"
          disabled={!store.currentImage || store.spatialBusy}
          onClick={() => void galleryStore.toggleSpatial()}
        >
          {store.spatialBusy ? (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border border-white/30 border-t-white" />
          ) : (
            <CubeIcon active={spatialOn && !store.isPanoramaMode} />
          )}
        </IconButton>
        <IconButton
          label="720° 球面全景"
          disabled={!store.currentImage}
          onClick={() => galleryStore.togglePanorama()}
        >
          <GlobeIcon active={store.isPanoramaMode} />
        </IconButton>
        <WindowButton label="最小化" onClick={() => window.pic.windowControl('min')}>
          <svg width="10" height="10" viewBox="0 0 10 10">
            <path d="M1 5h8" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </WindowButton>
        <WindowButton label="最大化" onClick={() => window.pic.windowControl('max')}>
          <svg width="10" height="10" viewBox="0 0 10 10">
            <rect x="1.5" y="1.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </WindowButton>
        <WindowButton label="关闭" danger onClick={() => window.pic.windowControl('close')}>
          <svg width="10" height="10" viewBox="0 0 10 10">
            <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </WindowButton>
      </div>
    </div>
  )
}

function ModeButton({
  active,
  disabled,
  onClick,
  children
}: {
  active: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`h-6 min-w-[56px] px-2 text-[11px] disabled:opacity-40 ${
        active ? 'bg-white/18 text-white' : 'bg-transparent text-white/70 hover:bg-white/8'
      }`}
    >
      {children}
    </button>
  )
}

function WindowButton({
  label,
  onClick,
  danger,
  children
}: {
  label: string
  onClick: () => void
  danger?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`titlebar-no-drag flex h-10 w-11 items-center justify-center text-white/80 ${
        danger ? 'hover:bg-[#c42b1c] hover:text-white' : 'hover:bg-white/10'
      }`}
    >
      {children}
    </button>
  )
}

function GlobeIcon({ active }: { active: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" className={active ? 'text-accent' : 'text-white'}>
      <circle
        cx="8"
        cy="8"
        r="6"
        fill="currentColor"
        fillOpacity="0.18"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <ellipse cx="8" cy="8" rx="2.5" ry="6" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M2 8h12M3.4 4.7h9.2M3.4 11.3h9.2" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}

function CubeIcon({ active }: { active: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" className={active ? 'text-accent' : 'text-white'}>
      <path
        d="M8 1.6 14 5v6L8 14.4 2 11V5L8 1.6Z"
        fill="currentColor"
        fillOpacity="0.18"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path d="M8 14.4V8M14 5 8 8 2 5" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}
