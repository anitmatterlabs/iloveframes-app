import { STUDIO } from './studio'
import type { EditState } from './types'

type Blob = [number, number, number, string] // x, y, radius (rel. to diag), color
export interface Wallpaper {
  id: string
  name: string
  base: string
  blobs: Blob[]
  grain?: number
}

export const WALLPAPERS: Wallpaper[] = [
  { id: 'iris', name: 'Iris', base: '#1a0b2e', blobs: [[0.15, 0.2, 0.55, '#ff4d8d'], [0.85, 0.15, 0.5, '#8b5cf6'], [0.7, 0.9, 0.6, '#3b82f6'], [0.2, 0.95, 0.45, '#f472b6']] },
  { id: 'aurora', name: 'Aurora', base: '#050b1f', blobs: [[0.1, 0.1, 0.55, '#00d4ff'], [0.9, 0.3, 0.55, '#7c3aed'], [0.4, 0.95, 0.6, '#10b981'], [0.95, 0.95, 0.4, '#ec4899']] },
  { id: 'sunset', name: 'Sunset', base: '#2b0f2e', blobs: [[0.1, 0.9, 0.6, '#ff7a18'], [0.6, 0.1, 0.55, '#ff3d77'], [0.95, 0.75, 0.5, '#ffd166'], [0.3, 0.3, 0.4, '#c026d3']] },
  { id: 'lagoon', name: 'Lagoon', base: '#02232a', blobs: [[0.2, 0.15, 0.6, '#06b6d4'], [0.85, 0.5, 0.55, '#10b981'], [0.3, 0.95, 0.5, '#2563eb']] },
  { id: 'candy', name: 'Candy', base: '#ffe4f1', blobs: [[0.1, 0.1, 0.55, '#ffb3d1'], [0.9, 0.2, 0.55, '#c4b5fd'], [0.6, 0.95, 0.6, '#fed7aa'], [0.05, 0.9, 0.4, '#a5f3fc']] },
  { id: 'midnight', name: 'Midnight', base: '#04050b', blobs: [[0.2, 0.2, 0.6, '#1e3a8a'], [0.85, 0.85, 0.6, '#312e81'], [0.9, 0.1, 0.35, '#0f766e']] },
  { id: 'ember', name: 'Ember', base: '#160300', blobs: [[0.15, 0.85, 0.6, '#dc2626'], [0.8, 0.2, 0.55, '#ea580c'], [0.6, 0.8, 0.4, '#facc15']] },
  { id: 'mint', name: 'Mint', base: '#e9fff7', blobs: [[0.1, 0.2, 0.6, '#99f6e4'], [0.9, 0.3, 0.55, '#bae6fd'], [0.5, 1, 0.55, '#d9f99d']] },
  { id: 'grape', name: 'Grape', base: '#14062e', blobs: [[0.2, 0.7, 0.6, '#9333ea'], [0.8, 0.2, 0.55, '#db2777'], [0.9, 0.95, 0.4, '#4f46e5']] },
  { id: 'ocean', name: 'Ocean', base: '#001428', blobs: [[0.1, 0.1, 0.6, '#0ea5e9'], [0.9, 0.9, 0.6, '#1d4ed8'], [0.7, 0.2, 0.4, '#22d3ee']] },
  { id: 'peach', name: 'Peach', base: '#fff1e6', blobs: [[0.1, 0.9, 0.6, '#fdba74'], [0.85, 0.15, 0.55, '#fda4af'], [0.6, 0.6, 0.4, '#fde68a']] },
  { id: 'forest', name: 'Forest', base: '#03120a', blobs: [[0.15, 0.2, 0.6, '#166534'], [0.85, 0.8, 0.6, '#0d9488'], [0.8, 0.1, 0.35, '#65a30d']] },
  { id: 'sky', name: 'Sky', base: '#eaf4ff', blobs: [[0.1, 0.15, 0.6, '#93c5fd'], [0.9, 0.85, 0.6, '#c7d2fe'], [0.7, 0.1, 0.4, '#a5f3fc']] },
  { id: 'mono', name: 'Graphite', base: '#0a0a0a', blobs: [[0.2, 0.15, 0.6, '#3f3f46'], [0.85, 0.9, 0.55, '#27272a'], [0.9, 0.2, 0.35, '#52525b']] },
  { id: 'nebula', name: 'Nebula', base: '#07031a', blobs: [[0.25, 0.3, 0.45, '#6d28d9'], [0.75, 0.65, 0.45, '#be185d'], [0.5, 0.5, 0.25, '#f0abfc'], [0.95, 0.05, 0.4, '#0891b2']] },
  { id: 'citrus', name: 'Citrus', base: '#fff9db', blobs: [[0.1, 0.1, 0.55, '#fde047'], [0.9, 0.5, 0.6, '#fb923c'], [0.3, 1, 0.5, '#a3e635']] }
]

export const GRADIENTS: { id: string; name: string; angle: number; stops: string[] }[] = [
  { id: 'g-rose', name: 'Rose', angle: 135, stops: ['#ff4d8d', '#8b5cf6'] },
  { id: 'g-dusk', name: 'Dusk', angle: 135, stops: ['#0f172a', '#6d28d9', '#db2777'] },
  { id: 'g-sea', name: 'Sea', angle: 160, stops: ['#0ea5e9', '#22d3ee', '#a7f3d0'] },
  { id: 'g-flame', name: 'Flame', angle: 120, stops: ['#f97316', '#ef4444', '#be123c'] },
  { id: 'g-lilac', name: 'Lilac', angle: 135, stops: ['#e0c3fc', '#8ec5fc'] },
  { id: 'g-night', name: 'Night', angle: 180, stops: ['#020617', '#1e293b'] },
  { id: 'g-lime', name: 'Lime', angle: 135, stops: ['#d9f99d', '#34d399'] },
  { id: 'g-gold', name: 'Gold', angle: 135, stops: ['#fde68a', '#f59e0b', '#b45309'] },
  { id: 'g-cotton', name: 'Cotton', angle: 135, stops: ['#fbc2eb', '#a6c1ee'] },
  { id: 'g-steel', name: 'Steel', angle: 160, stops: ['#e2e8f0', '#94a3b8'] }
]

export const SOLIDS = ['#ffffff', '#f4f4f5', '#18181b', '#000000', '#ff4d8d', '#8b5cf6', '#2563eb', '#10b981', '#f59e0b', '#fde2e4']

export type AnyCanvas = HTMLCanvasElement | OffscreenCanvas
type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

/** Works on the main thread and inside the export worker. */
export function makeCanvas(w: number, h: number): AnyCanvas {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    return c
  }
  return new OffscreenCanvas(w, h)
}
const ctx2d = (c: AnyCanvas) => c.getContext('2d') as Ctx2D

let grainCanvas: AnyCanvas | null = null
function grain(): AnyCanvas {
  if (grainCanvas) return grainCanvas
  const c = makeCanvas(256, 256)
  const ctx = ctx2d(c)
  const img = ctx.createImageData(256, 256)
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v
    img.data[i + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  grainCanvas = c
  return c
}

const imageCache = new Map<string, HTMLImageElement>()
const bitmapCache = new Map<string, ImageBitmap>()
/** Export worker: register decoded custom background images up front. */
export function registerBgBitmap(src: string, bmp: ImageBitmap) {
  bitmapCache.set(src, bmp)
}
export function loadBgImage(src: string): HTMLImageElement {
  let img = imageCache.get(src)
  if (!img) {
    img = new Image()
    img.src = src
    imageCache.set(src, img)
  }
  return img
}
function bgSource(src: string): { el: CanvasImageSource; w: number; h: number } | null {
  const bmp = bitmapCache.get(src)
  if (bmp) return { el: bmp, w: bmp.width, h: bmp.height }
  if (typeof Image === 'undefined') return null
  const img = loadBgImage(src)
  if (!img.complete || !img.naturalWidth) return null
  return { el: img, w: img.naturalWidth, h: img.naturalHeight }
}

function paintWallpaper(ctx: Ctx2D, w: number, h: number, wp: Wallpaper) {
  // paint the mesh on a small canvas, blur it, then upscale = buttery gradients
  const sw = 320
  const sh = Math.max(2, Math.round((sw * h) / w))
  const small = makeCanvas(sw, sh)
  const s = ctx2d(small)
  s.fillStyle = wp.base
  s.fillRect(0, 0, sw, sh)
  const diag = Math.hypot(sw, sh)
  for (const [x, y, r, color] of wp.blobs) {
    const g = s.createRadialGradient(x * sw, y * sh, 0, x * sw, y * sh, r * diag)
    g.addColorStop(0, color)
    g.addColorStop(1, color + '00')
    s.fillStyle = g
    s.fillRect(0, 0, sw, sh)
  }
  ctx.save()
  ctx.filter = `blur(${Math.round(w / 60)}px)`
  ctx.drawImage(small, -w * 0.05, -h * 0.05, w * 1.1, h * 1.1)
  ctx.restore()
}

function cssAngleLine(angle: number, w: number, h: number) {
  const a = ((angle - 90) * Math.PI) / 180
  const len = Math.abs(w * Math.cos(a)) + Math.abs(h * Math.sin(a))
  const cx = w / 2, cy = h / 2
  return [cx - (Math.cos(a) * len) / 2, cy - (Math.sin(a) * len) / 2, cx + (Math.cos(a) * len) / 2, cy + (Math.sin(a) * len) / 2] as const
}

const bgCache = new Map<string, AnyCanvas>()

/** Returns a cached canvas with the fully painted background at w x h. */
export function backgroundCanvas(bg: EditState['background'], w: number, h: number): AnyCanvas | null {
  w = Math.max(2, Math.round(w))
  h = Math.max(2, Math.round(h))
  const key = `${bg.kind}|${bg.kind === 'image' ? bg.value.length + bg.value.slice(-32) : bg.value}|${bg.blur}|${w}x${h}`
  const hit = bgCache.get(key)
  if (hit) return hit
  const c = makeCanvas(w, h)
  const ctx = ctx2d(c)
  if (bg.kind === 'wallpaper') {
    const studio = STUDIO.find((x) => x.id === bg.value)
    if (studio) studio.paint(ctx, w, h)
    else paintWallpaper(ctx, w, h, WALLPAPERS.find((x) => x.id === bg.value) ?? WALLPAPERS[0])
  } else if (bg.kind === 'gradient') {
    const g = GRADIENTS.find((x) => x.id === bg.value) ?? GRADIENTS[0]
    const [x0, y0, x1, y1] = cssAngleLine(g.angle, w, h)
    const lg = ctx.createLinearGradient(x0, y0, x1, y1)
    g.stops.forEach((s, i) => lg.addColorStop(i / (g.stops.length - 1), s))
    ctx.fillStyle = lg
    ctx.fillRect(0, 0, w, h)
  } else if (bg.kind === 'solid') {
    ctx.fillStyle = bg.value
    ctx.fillRect(0, 0, w, h)
  } else {
    const img = bgSource(bg.value)
    if (!img) return null // not ready, don't cache
    const s = Math.max(w / img.w, h / img.h)
    const iw = img.w * s, ih = img.h * s
    if (bg.blur > 0) ctx.filter = `blur(${(bg.blur * w) / 100}px)`
    ctx.drawImage(img.el, (w - iw) / 2 - (bg.blur ? w * 0.03 : 0), (h - ih) / 2 - (bg.blur ? h * 0.03 : 0), iw + (bg.blur ? w * 0.06 : 0), ih + (bg.blur ? h * 0.06 : 0))
    ctx.filter = 'none'
  }
  if (bg.kind === 'wallpaper' || bg.kind === 'gradient') {
    // film grain = premium, kills banding
    ctx.save()
    ctx.globalAlpha = 0.045
    ctx.globalCompositeOperation = 'overlay'
    const pat = ctx.createPattern(grain(), 'repeat')!
    ctx.fillStyle = pat
    ctx.fillRect(0, 0, w, h)
    ctx.restore()
  }
  if (bgCache.size > 12) bgCache.delete(bgCache.keys().next().value!)
  bgCache.set(key, c)
  return c
}

const thumbCache = new Map<string, string>()
export function backgroundThumb(bg: EditState['background']): string {
  const key = bg.kind + bg.value
  const hit = thumbCache.get(key)
  if (hit) return hit
  const c = backgroundCanvas(bg, 160, 100) as HTMLCanvasElement | null
  const url = c ? c.toDataURL('image/jpeg', 0.85) : ''
  if (url) thumbCache.set(key, url)
  return url
}
