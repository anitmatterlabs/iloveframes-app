import type { EditState } from './types'
import { backgroundCanvas } from './backgrounds'

/** Settings for a beautified screenshot. Crop is normalized to the source image. */
export interface ShotSettings {
  background: EditState['background']
  aspect: 'auto' | '16:9' | '4:3' | '1:1' | '4:5' | '9:16'
  padding: number
  radius: number
  shadow: number
  border: 'glass' | 'white' | 'dark' | 'none'
  borderWidth: number
  crop: { x: number; y: number; w: number; h: number }
  scale: 1 | 2
  format: 'png' | 'jpg'
}

export const defaultShot = (): ShotSettings => ({
  background: { kind: 'wallpaper', value: 's-silk-ocean', blur: 0 },
  aspect: 'auto',
  padding: 0.08,
  radius: 16,
  shadow: 0.7,
  border: 'glass',
  borderWidth: 1.5,
  crop: { x: 0, y: 0, w: 1, h: 1 },
  scale: 2,
  format: 'png'
})

const RATIOS: Record<string, number> = { '16:9': 16 / 9, '4:3': 4 / 3, '1:1': 1, '4:5': 4 / 5, '9:16': 9 / 16 }

/** Final image size (at 1×) and where the screenshot sits inside it. */
export function shotLayout(img: { width: number; height: number }, s: ShotSettings) {
  const cw = Math.max(1, Math.round(s.crop.w * img.width))
  const ch = Math.max(1, Math.round(s.crop.h * img.height))
  const base = Math.max(cw, ch)
  const pad = s.padding * base
  let W = cw + pad * 2
  let H = ch + pad * 2
  if (s.aspect !== 'auto') {
    const r = RATIOS[s.aspect]
    if (W / H < r) W = H * r
    else H = W / r
  }
  return { W: Math.round(W), H: Math.round(H), frame: { x: (W - cw) / 2, y: (H - ch) / 2, w: cw, h: ch }, k: base / 1080 }
}

/** Draws the finished screenshot into ctx at `scale` (1 = full source resolution). */
export function drawShot(ctx: CanvasRenderingContext2D, img: CanvasImageSource & { width: number; height: number }, s: ShotSettings, scale: number) {
  const L = shotLayout(img, s)
  const W = L.W * scale
  const H = L.H * scale
  const f = { x: L.frame.x * scale, y: L.frame.y * scale, w: L.frame.w * scale, h: L.frame.h * scale }
  const k = L.k * scale
  const r = Math.min(s.radius * k * 2, f.w / 2, f.h / 2)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  const bg = backgroundCanvas(s.background, W, H)
  if (bg) ctx.drawImage(bg, 0, 0, W, H)
  else {
    ctx.fillStyle = '#111'
    ctx.fillRect(0, 0, W, H)
  }
  const path = () => {
    ctx.beginPath()
    ctx.roundRect(f.x, f.y, f.w, f.h, r)
  }
  if (s.shadow > 0 && s.padding > 0.005) {
    ctx.save()
    path()
    ctx.shadowColor = `rgba(0,0,0,${0.5 * s.shadow})`
    ctx.shadowBlur = 80 * k * s.shadow
    ctx.shadowOffsetY = 26 * k * s.shadow
    ctx.fillStyle = '#000'
    ctx.fill()
    ctx.restore()
  }
  ctx.save()
  path()
  ctx.clip()
  ctx.drawImage(img, s.crop.x * img.width, s.crop.y * img.height, s.crop.w * img.width, s.crop.h * img.height, f.x, f.y, f.w, f.h)
  ctx.restore()
  if (s.border !== 'none') {
    const bw = Math.max(1, s.borderWidth * k * 2)
    ctx.save()
    ctx.beginPath()
    ctx.roundRect(f.x + bw / 2, f.y + bw / 2, f.w - bw, f.h - bw, Math.max(0, r - bw / 2))
    ctx.lineWidth = bw
    ctx.strokeStyle = s.border === 'glass' ? 'rgba(255,255,255,0.18)' : s.border === 'white' ? 'rgba(255,255,255,0.95)' : 'rgba(10,10,14,0.9)'
    ctx.stroke()
    ctx.restore()
  }
  return { W, H }
}
