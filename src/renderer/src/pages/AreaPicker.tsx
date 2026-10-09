import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Check, Maximize, MousePointer2, X } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Full-display transparent overlay for choosing the area to record.
 * Drag to draw, drag inside to move, handles to resize, Enter to confirm,
 * Esc to cancel, arrow keys to nudge. Works in DIPs relative to the display.
 */
type Rect = { x: number; y: number; w: number; h: number }
type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
const ASPECTS: { id: string; label: string; r: number | null }[] = [
  { id: 'free', label: 'Free', r: null },
  { id: '16:9', label: '16:9', r: 16 / 9 },
  { id: '4:3', label: '4:3', r: 4 / 3 },
  { id: '1:1', label: '1:1', r: 1 },
  { id: '9:16', label: '9:16', r: 9 / 16 }
]
const MIN = 120

export default function AreaPicker({ W, H, sf, initial }: { W: number; H: number; sf: number; initial: Rect | null }) {
  const [rect, setRect] = useState<Rect | null>(initial)
  const [aspect, setAspect] = useState<string>('free')
  const [busy, setBusy] = useState(false) // drawing / dragging: hide the toolbar
  const drag = useRef<{ kind: 'new' | 'move' | Handle; ox: number; oy: number; start: Rect } | null>(null)
  const ratio = ASPECTS.find((a) => a.id === aspect)!.r

  useEffect(() => {
    document.body.classList.add('transparent')
  }, [])

  const clamp = useCallback(
    (r: Rect): Rect => {
      const w = Math.max(MIN, Math.min(r.w, W))
      const h = Math.max(MIN, Math.min(r.h, H))
      return { x: Math.max(0, Math.min(r.x, W - w)), y: Math.max(0, Math.min(r.y, H - h)), w, h }
    },
    [W, H]
  )

  const done = (r: Rect | null) => window.ilf.area.done(r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) } : null)

  // fit the current rect to a newly chosen aspect, keeping its centre
  const pickAspect = (id: string) => {
    setAspect(id)
    const r = ASPECTS.find((a) => a.id === id)!.r
    if (!r) return
    setRect((cur) => {
      const base = cur ?? { x: W * 0.2, y: H * 0.2, w: W * 0.6, h: H * 0.6 }
      let w = base.w
      let h = w / r
      if (h > H * 0.9) {
        h = H * 0.9
        w = h * r
      }
      return clamp({ x: base.x + base.w / 2 - w / 2, y: base.y + base.h / 2 - h / 2, w, h })
    })
  }

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current
      if (!d) return
      const dx = e.clientX - d.ox
      const dy = e.clientY - d.oy
      const s = d.start
      let r: Rect
      if (d.kind === 'new') {
        let w = Math.abs(dx)
        let h = Math.abs(dy)
        if (ratio) h = w / ratio
        r = { x: dx < 0 ? d.ox - w : d.ox, y: dy < 0 ? d.oy - h : d.oy, w, h }
        r = { x: Math.max(0, r.x), y: Math.max(0, r.y), w: Math.min(r.w, W - Math.max(0, r.x)), h: Math.min(r.h, H - Math.max(0, r.y)) }
        setRect(r)
        return
      }
      if (d.kind === 'move') {
        setRect(clamp({ ...s, x: s.x + dx, y: s.y + dy }))
        return
      }
      let { x, y, w, h } = s
      if (d.kind.includes('e')) w = s.w + dx
      if (d.kind.includes('s')) h = s.h + dy
      if (d.kind.includes('w')) {
        w = s.w - dx
        x = s.x + dx
      }
      if (d.kind.includes('n')) {
        h = s.h - dy
        y = s.y + dy
      }
      if (ratio) {
        // keep the ratio, driven by whichever side moved most
        if (d.kind === 'n' || d.kind === 's') w = h * ratio
        else h = w / ratio
        if (d.kind.includes('n')) y = s.y + s.h - h
        if (d.kind.includes('w')) x = s.x + s.w - w
        if (d.kind === 'n' || d.kind === 's') x = s.x + s.w / 2 - w / 2
        if (d.kind === 'e' || d.kind === 'w') y = s.y + s.h / 2 - h / 2
      }
      if (w < MIN) {
        if (d.kind.includes('w')) x -= MIN - w
        w = MIN
      }
      if (h < MIN) {
        if (d.kind.includes('n')) y -= MIN - h
        h = MIN
      }
      setRect(clamp({ x, y, w, h }))
    }
    const up = () => {
      const d = drag.current
      drag.current = null
      setBusy(false)
      if (d?.kind === 'new') setRect((r) => (r && r.w > 24 && r.h > 24 ? clamp(r) : d.start.w ? d.start : null))
    }
    addEventListener('pointermove', move)
    addEventListener('pointerup', up)
    return () => {
      removeEventListener('pointermove', move)
      removeEventListener('pointerup', up)
    }
  }, [ratio, clamp, W, H])

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') done(null)
      else if (e.key === 'Enter' && rect) done(rect)
      else if (rect && e.key.startsWith('Arrow')) {
        e.preventDefault()
        const n = e.shiftKey ? 10 : 1
        const dx = e.key === 'ArrowLeft' ? -n : e.key === 'ArrowRight' ? n : 0
        const dy = e.key === 'ArrowUp' ? -n : e.key === 'ArrowDown' ? n : 0
        setRect(clamp({ ...rect, x: rect.x + dx, y: rect.y + dy }))
      }
    }
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  })

  const start = (kind: 'new' | 'move' | Handle) => (e: React.PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    drag.current = { kind, ox: e.clientX, oy: e.clientY, start: kind === 'new' ? rect ?? { x: 0, y: 0, w: 0, h: 0 } : rect! }
    setBusy(true)
    if (kind === 'new') setRect({ x: e.clientX, y: e.clientY, w: 0, h: 0 })
  }

  // toolbar sits under the area, or above it when there's no room
  const barH = 52
  const below = rect ? rect.y + rect.h + 14 + barH < H : true
  const barY = rect ? (below ? rect.y + rect.h + 14 : Math.max(12, rect.y - 14 - barH)) : H - barH - 40
  const barX = rect ? Math.max(12, Math.min(W - 12, rect.x + rect.w / 2)) : W / 2

  const handles: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
  const hpos = (h: Handle) => ({
    left: h.includes('w') ? 0 : h.includes('e') ? '100%' : '50%',
    top: h.includes('n') ? 0 : h.includes('s') ? '100%' : '50%',
    cursor: h === 'n' || h === 's' ? 'ns-resize' : h === 'e' || h === 'w' ? 'ew-resize' : h === 'nw' || h === 'se' ? 'nwse-resize' : 'nesw-resize'
  })

  return (
    <div className="fixed inset-0 cursor-crosshair select-none" onPointerDown={start('new')}>
      {!rect && <div className="pointer-events-none absolute inset-0 bg-[rgba(8,6,14,.5)]" />}
      {rect && (
        <div
          className="absolute"
          style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, boxShadow: '0 0 0 9999px rgba(8,6,14,.55)' }}
        >
          <div className="absolute inset-0 cursor-move rounded-[3px] ring-2 ring-brand-orchid shadow-[0_0_0_1px_rgba(0,0,0,.4),0_0_40px_rgba(214,77,170,.35)]" onPointerDown={start('move')} />
          {busy && (
            <div className="pointer-events-none absolute inset-0 [background:linear-gradient(to_right,transparent_33.2%,rgba(255,255,255,.28)_33.3%,transparent_33.5%,transparent_66.5%,rgba(255,255,255,.28)_66.6%,transparent_66.8%),linear-gradient(to_bottom,transparent_33.2%,rgba(255,255,255,.28)_33.3%,transparent_33.5%,transparent_66.5%,rgba(255,255,255,.28)_66.6%,transparent_66.8%)]" />
          )}
          <div className="pointer-events-none absolute left-0 top-0 -translate-y-[calc(100%+8px)] rounded-lg bg-[#0d0c12]/90 px-2.5 py-1 text-[12px] font-semibold tabular-nums text-white shadow-lg ring-1 ring-white/10">
            {Math.round(rect.w * sf)} × {Math.round(rect.h * sf)}
          </div>
          {!busy &&
            handles.map((h) => (
              <span
                key={h}
                onPointerDown={start(h)}
                className={cn('absolute z-10 -translate-x-1/2 -translate-y-1/2 border-2 border-white bg-brand shadow-[0_2px_8px_rgba(0,0,0,.5)]', h.length === 2 ? 'h-3.5 w-3.5 rounded-full' : 'h-2.5 w-6 rounded-full', (h === 'e' || h === 'w') && 'h-6 w-2.5')}
                style={hpos(h)}
              />
            ))}
        </div>
      )}

      {!rect && !busy && (
        <motion.div initial={{ opacity: 0, x: '-50%', y: 'calc(-50% + 8px)' }} animate={{ opacity: 1, x: '-50%', y: '-50%' }} className="pointer-events-none absolute left-1/2 top-1/2 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand text-white shadow-glow">
            <MousePointer2 className="h-6 w-6" />
          </div>
          <div className="mt-4 text-[20px] font-semibold tracking-[-0.02em] text-white drop-shadow">Drag to select the area to record</div>
          <div className="mt-1.5 text-[13px] text-white/70 drop-shadow">Esc to cancel</div>
        </motion.div>
      )}

      {!busy && (
        <motion.div
          initial={{ opacity: 0, x: '-50%', y: 6 }}
          animate={{ opacity: 1, x: '-50%', y: 0 }}
          className="absolute flex items-center gap-1.5 rounded-2xl border border-white/10 bg-[#0d0c12]/95 p-1.5 shadow-[0_18px_50px_-12px_rgba(0,0,0,.8)] backdrop-blur-xl"
          style={{ left: barX, top: barY }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-0.5 rounded-xl bg-white/[0.04] p-0.5">
            {ASPECTS.map((a) => (
              <button
                key={a.id}
                onClick={() => pickAspect(a.id)}
                className={cn('h-8 rounded-[9px] px-2.5 text-[12px] font-medium transition-colors', aspect === a.id ? 'bg-white/[0.12] text-white' : 'text-zinc-400 hover:text-white')}
              >
                {a.label}
              </button>
            ))}
          </div>
          <div className="mx-1 h-5 w-px bg-white/10" />
          <button onClick={() => done({ x: 0, y: 0, w: W, h: H })} className="flex h-8 items-center gap-1.5 rounded-[9px] px-2.5 text-[12px] font-medium text-zinc-300 hover:bg-white/[0.08] hover:text-white">
            <Maximize className="h-3.5 w-3.5" /> Full screen
          </button>
          <button onClick={() => done(null)} className="grid h-8 w-8 place-items-center rounded-[9px] text-zinc-400 hover:bg-white/[0.08] hover:text-white" title="Cancel (Esc)">
            <X className="h-4 w-4" />
          </button>
          <button
            disabled={!rect}
            onClick={() => rect && done(rect)}
            className="bg-brand flex h-8 items-center gap-1.5 rounded-[9px] px-3 text-[12px] font-semibold text-white shadow-glow transition-[filter,opacity] hover:brightness-110 disabled:opacity-40"
          >
            <Check className="h-3.5 w-3.5" strokeWidth={3} /> Use this area
          </button>
        </motion.div>
      )}
    </div>
  )
}
