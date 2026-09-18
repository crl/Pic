import type { PicApi } from '../electron/preload'

declare global {
  interface Window {
    pic: PicApi
  }
}

export {}
