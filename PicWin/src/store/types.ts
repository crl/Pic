export type DisplayMode = 'fit' | 'actual'

export interface Size {
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

export const displayModeTitle: Record<DisplayMode, string> = {
  fit: '自适应',
  actual: '实际大小'
}

export const supportedExtensions = [
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'heic',
  'heif',
  'tif',
  'tiff',
  'bmp'
] as const
