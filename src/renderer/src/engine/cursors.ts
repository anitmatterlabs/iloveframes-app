/**
 * macOS-style cursor artwork as vectors (crisp at any zoom).
 * Each shape is drawn so (0,0) is its hotspot.
 */
type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
export type CursorKind = 'arrow' | 'hand' | 'text'

const ARROW = new Path2D('M4 2.5 L4 20.2 L8.6 16 L11.7 22.8 L14.9 21.4 L11.9 14.8 L18 14.8 Z')

const HAND = new Path2D(
  'M10.2 20.4 V8 A2.3 2.3 0 0 1 14.8 8 V13.4 A1.95 1.95 0 0 1 18.7 13.5 V13.8 A1.9 1.9 0 0 1 22.5 14 V14.4 A1.6 1.6 0 0 1 25.7 14.6 V21.5 ' +
    'C25.7 25.6 23.2 28.6 19.8 28.6 H15.6 C13.7 28.6 12.3 27.8 11.3 26.5 L7.3 21.1 A1.75 1.75 0 0 1 9.9 18.8 Z'
)
const HAND_LINES = new Path2D('M14.8 13.4 V17.2 M18.7 13.8 V17.3 M22.5 14.4 V17.4')

const IBEAM = new Path2D('M8.5 3.5 C10.6 3.5 12 4.3 12 6.2 C12 4.3 13.4 3.5 15.5 3.5 M12 6.2 V17.8 M8.5 20.5 C10.6 20.5 12 19.7 12 17.8 C12 19.7 13.4 20.5 15.5 20.5')

function shadow(ctx: Ctx, on: boolean) {
  ctx.shadowColor = on ? 'rgba(0,0,0,0.38)' : 'transparent'
  ctx.shadowBlur = on ? 5 : 0
  ctx.shadowOffsetY = on ? 1.6 : 0
}

/** `size` is the on-screen arrow height in px; other shapes are matched optically. */
export function drawMacCursor(ctx: Ctx, kind: CursorKind, size: number, opts: { light?: boolean; press?: number } = {}) {
  const press = opts.press ?? 0
  const s = (size / 24) * (1 - press * 0.16)
  ctx.save()
  ctx.scale(s, s)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  if (kind === 'arrow') {
    ctx.translate(-4, -2.5)
    const dark = !opts.light
    shadow(ctx, true)
    ctx.lineWidth = 1.7
    ctx.strokeStyle = dark ? '#ffffff' : '#111114'
    ctx.stroke(ARROW)
    shadow(ctx, false)
    ctx.fillStyle = dark ? '#111114' : '#ffffff'
    ctx.fill(ARROW)
  } else if (kind === 'hand') {
    ctx.scale(0.92, 0.92)
    ctx.translate(-12.5, -5.7)
    shadow(ctx, true)
    ctx.fillStyle = '#ffffff'
    ctx.fill(HAND)
    shadow(ctx, false)
    ctx.lineWidth = 1.15
    ctx.strokeStyle = '#111114'
    ctx.stroke(HAND)
    ctx.lineWidth = 0.9
    ctx.stroke(HAND_LINES)
  } else {
    ctx.translate(-12, -12)
    shadow(ctx, true)
    ctx.lineWidth = 3.4
    ctx.strokeStyle = '#ffffff'
    ctx.stroke(IBEAM)
    shadow(ctx, false)
    ctx.lineWidth = 1.5
    ctx.strokeStyle = '#111114'
    ctx.stroke(IBEAM)
  }
  ctx.restore()
}
