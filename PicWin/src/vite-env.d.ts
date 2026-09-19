import type { PicApi } from './bridge/pic'

declare global {
  interface Window {
    pic: PicApi
  }
}

export {}
