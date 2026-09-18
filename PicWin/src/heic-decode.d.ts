declare module 'heic-decode' {
  interface HeicDecodeResult {
    width: number
    height: number
    data: Uint8ClampedArray | Uint8Array
  }

  interface HeicDecodeOptions {
    buffer: ArrayBuffer | Uint8Array
  }

  function heicDecode(options: HeicDecodeOptions): Promise<HeicDecodeResult>
  export default heicDecode
}
