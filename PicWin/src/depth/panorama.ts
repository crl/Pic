import { Size } from '../store/types'

export type PanoramaProjection =
  | { kind: 'equirect' }
  | { kind: 'cylinder'; haov: number; vaov: number; wrap: boolean }

export const panoSpreadMin = (80 * Math.PI) / 180
export const panoSpreadMax = Math.PI * 2

/** 2:1 equirectangular spherical panorama (often called 720°). */
export function isEquirectangular(size: Size): boolean {
  if (size.width < 512 || size.height < 256) return false
  const aspect = size.width / Math.max(size.height, 1)
  return aspect >= 1.85 && aspect <= 2.15
}

/** Pick sphere vs cylinder from the source image, instead of always wrapping 360×180. */
export function panoramaProjection(size: Size): PanoramaProjection {
  if (isEquirectangular(size)) return { kind: 'equirect' }
  const aspect = size.width / Math.max(size.height, 1)
  const vaov = Math.min(100, 42 + aspect * 8) * (Math.PI / 180)
  let haov = vaov * aspect
  const wrap = haov >= (330 * Math.PI) / 180 || aspect >= 4.8
  if (wrap) haov = Math.PI * 2
  else haov = Math.min(haov, Math.PI * 2)
  return { kind: 'cylinder', haov, vaov, wrap }
}

export function spreadToHaov(spread: number): number {
  const t = Math.min(Math.max(spread, 0), 1)
  return panoSpreadMin + t * (panoSpreadMax - panoSpreadMin)
}

export function haovToSpread(haov: number): number {
  return Math.min(Math.max((haov - panoSpreadMin) / (panoSpreadMax - panoSpreadMin), 0), 1)
}

export function suggestedPanoControls(size: Size): { spread: number; bend: number } {
  if (isEquirectangular(size)) return { spread: 1, bend: 1 }
  const projection = panoramaProjection(size)
  if (projection.kind === 'equirect') return { spread: 1, bend: 1 }
  return {
    spread: haovToSpread(projection.haov),
    bend: 0.38
  }
}
