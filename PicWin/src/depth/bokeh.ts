import { DepthMap } from './DepthMap'

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('WebGL shader')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) ?? 'shader compile')
  }
  return shader
}

function program(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const prog = gl.createProgram()
  if (!prog) throw new Error('WebGL program')
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, vs))
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, fs))
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(prog) ?? 'program link')
  }
  return prog
}

const QUAD_VS = `#version 300 es
precision highp float;
const vec2 POS[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
out vec2 vUv;
void main() {
  vec2 p = POS[gl_VertexID];
  vUv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`

const VAR_BLUR_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uTex;
uniform sampler2D uMask;
uniform vec2 uDirection;
uniform float uMaxRadius;
void main() {
  float coverage = texture(uMask, vUv).r;
  float radius = coverage * uMaxRadius;
  vec4 center = texture(uTex, vUv);
  if (radius < 0.35) {
    fragColor = center;
    return;
  }
  vec2 texel = uDirection / vec2(textureSize(uTex, 0));
  float sigma = max(radius * 0.38, 0.45);
  float twoSigma2 = 2.0 * sigma * sigma;
  vec4 acc = center;
  float wsum = 1.0;
  const int TAPS = 8;
  for (int i = 1; i <= TAPS; i++) {
    float x = float(i);
    float w = exp(-(x * x) / twoSigma2);
    vec2 off = texel * (x / float(TAPS)) * radius;
    acc += texture(uTex, vUv + off) * w;
    acc += texture(uTex, vUv - off) * w;
    wsum += 2.0 * w;
  }
  fragColor = acc / wsum;
}`

function createTexture(gl: WebGL2RenderingContext): WebGLTexture {
  const tex = gl.createTexture()
  if (!tex) throw new Error('texture')
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  return tex
}

function uploadSource(gl: WebGL2RenderingContext, tex: WebGLTexture, source: TexImageSource, flipY: boolean): void {
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flipY)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
}

function createFbo(gl: WebGL2RenderingContext, tex: WebGLTexture): WebGLFramebuffer {
  const fbo = gl.createFramebuffer()
  if (!fbo) throw new Error('fbo')
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
  return fbo
}

function blurMask(depth: DepthMap, focusDepth: number, amount: number): ImageData {
  const pixels = new Uint8ClampedArray(depth.width * depth.height * 4)
  const gain = 1.6 + 2.8 * amount
  const focusBand = 0.05
  for (let i = 0; i < depth.values.length; i++) {
    const delta = Math.max(0, Math.abs(depth.values[i]! - focusDepth) - focusBand)
    const coverage = Math.min(Math.max(delta * gain, 0), 1) * amount
    const a = Math.max(0, Math.min(255, Math.round(coverage * 255)))
    const offset = i * 4
    pixels[offset] = a
    pixels[offset + 1] = a
    pixels[offset + 2] = a
    pixels[offset + 3] = 255
  }
  return new ImageData(pixels, depth.width, depth.height)
}

function scaledSize(width: number, height: number): { width: number; height: number } {
  const longest = Math.max(width, height)
  const maxLongest = 1600
  if (longest <= maxLongest) return { width, height }
  const scale = maxLongest / longest
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

export async function applyBokeh(
  image: HTMLImageElement,
  depth: DepthMap,
  focus: { x: number; y: number },
  blurAmount: number
): Promise<HTMLCanvasElement> {
  const amount = Math.min(Math.max(blurAmount, 0), 1)
  const out = document.createElement('canvas')
  out.width = image.naturalWidth
  out.height = image.naturalHeight
  const outCtx = out.getContext('2d')
  if (!outCtx) return out
  outCtx.drawImage(image, 0, 0)
  if (amount <= 0.01) return out

  const working = scaledSize(image.naturalWidth, image.naturalHeight)
  const canvas = document.createElement('canvas')
  canvas.width = working.width
  canvas.height = working.height
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true })
  if (!gl) return out

  const longest = Math.max(image.naturalWidth, image.naturalHeight)
  const maxRadius = Math.min(longest * 0.028, 48) * amount
  const scaledRadius = maxRadius * (working.width / Math.max(image.naturalWidth, 1))
  const focusDepth = depth.sample(focus.x, focus.y)
  const mask = blurMask(depth, focusDepth, amount)

  const srcCanvas = document.createElement('canvas')
  srcCanvas.width = working.width
  srcCanvas.height = working.height
  const srcCtx = srcCanvas.getContext('2d')
  if (!srcCtx) return out
  srcCtx.drawImage(image, 0, 0, working.width, working.height)

  const maskCanvas = document.createElement('canvas')
  maskCanvas.width = depth.width
  maskCanvas.height = depth.height
  maskCanvas.getContext('2d')?.putImageData(mask, 0, 0)

  const sharpTex = createTexture(gl)
  uploadSource(gl, sharpTex, srcCanvas, true)
  const maskTex = createTexture(gl)
  uploadSource(gl, maskTex, maskCanvas, true)

  const ping = createTexture(gl)
  gl.bindTexture(gl.TEXTURE_2D, ping)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, working.width, working.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
  const pingFbo = createFbo(gl, ping)

  const blurProg = program(gl, QUAD_VS, VAR_BLUR_FS)
  const uDir = gl.getUniformLocation(blurProg, 'uDirection')
  const uMaxRadius = gl.getUniformLocation(blurProg, 'uMaxRadius')
  const uTex = gl.getUniformLocation(blurProg, 'uTex')
  const uMask = gl.getUniformLocation(blurProg, 'uMask')

  gl.useProgram(blurProg)
  gl.viewport(0, 0, working.width, working.height)
  gl.uniform1i(uTex, 0)
  gl.uniform1i(uMask, 1)
  gl.uniform1f(uMaxRadius, Math.max(scaledRadius, 1))
  gl.activeTexture(gl.TEXTURE1)
  gl.bindTexture(gl.TEXTURE_2D, maskTex)

  gl.bindFramebuffer(gl.FRAMEBUFFER, pingFbo)
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, sharpTex)
  gl.uniform2f(uDir, 1, 0)
  gl.drawArrays(gl.TRIANGLES, 0, 3)

  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  gl.clearColor(0, 0, 0, 1)
  gl.clear(gl.COLOR_BUFFER_BIT)
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, ping)
  gl.uniform2f(uDir, 0, 1)
  gl.drawArrays(gl.TRIANGLES, 0, 3)

  outCtx.drawImage(canvas, 0, 0, out.width, out.height)

  gl.deleteProgram(blurProg)
  gl.deleteTexture(sharpTex)
  gl.deleteTexture(maskTex)
  gl.deleteTexture(ping)
  gl.deleteFramebuffer(pingFbo)
  return out
}
