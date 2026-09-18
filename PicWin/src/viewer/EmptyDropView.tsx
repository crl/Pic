interface EmptyDropViewProps {
  isTargeted: boolean
  onOpen: () => void
}

export function EmptyDropView({ isTargeted, onOpen }: EmptyDropViewProps) {
  return (
    <div
      className={`relative flex h-full w-full flex-1 flex-col items-center justify-center gap-4 p-10 transition-colors duration-150 ${
        isTargeted ? 'bg-accent/10' : ''
      }`}
    >
      <div
        className={`absolute inset-7 rounded-[18px] border-2 border-dashed ${
          isTargeted ? 'border-accent' : 'border-white/25'
        }`}
      />
      <svg width="64" height="56" viewBox="0 0 64 56" fill="none" className="text-white/45">
        <rect x="4" y="10" width="40" height="32" rx="4" stroke="currentColor" strokeWidth="2" />
        <path d="M20 42h28a4 4 0 0 0 4-4V16" stroke="currentColor" strokeWidth="2" />
        <circle cx="16" cy="22" r="3" fill="currentColor" />
        <path d="M8 36l10-9 8 7 6-5 12 11" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      </svg>
      <div className="text-xl font-medium">将图片拖到这里</div>
      <div className="text-white/55">或打开一个文件夹，用方向键翻看上一张 / 下一张</div>
      <button
        type="button"
        onClick={onOpen}
        className="mt-2 rounded-md bg-white/12 px-5 py-2 text-sm hover:bg-white/18"
      >
        打开…
      </button>
    </div>
  )
}
