import { useCallback, useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, Crop, RotateCcw, ShieldCheck, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { updateEdit, useEditor } from './store'
import { FULL, clipAt, cropOf, sourceInfo } from '@/engine/sequence'
import { track, trackOncePerSession } from '@/lib/telemetry'
import type { CropRect, EditState } from '@/engine/types'

/**
 * Non-destructive crop for a recording. The file and all of its smart data
 * (cursor path, clicks, typing) stay untouched; the crop is applied when the
 * frame is drawn, and positions are re-mapped into the cropped view.
 */
const useCrop = create<{ source: string | null; t: number }>(() => ({ source: null, t: 0 }))

/** Open the crop editor for whatever is under the playhead (or the selected clip). */
export function openCrop() {
  const { edit, time, selected } = useEditor.getState()
  if (!edit) return
  const sel = edit.clips.find((c) => c.id === selected)
  const hit = clipAt(edit.clips, time)
  const clip = sel ?? hit?.clip
  if (!clip) return
  const t = sel && hit?.clip.id !== sel.id ? sel.in : hit?.srcT ?? clip.in
  useCrop.setState({ source: clip.source, t })
}

const ASPECTS: { id: string; label: string; r: number | null }[] = [
  { id: 'free', label: 'Free', r: null },
  { id: 'orig', label: 'Original', r: -1 },
  { id: '16:9', label: '16:9', r: 16 / 9 },
  { id: '4:3', label: '4:3', r: 4 / 3 },
  { id: '1:1', label: '1:1', r: 1 },
  { id: '9:16', label: '9:16', r: 9 / 16 }
]
type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
const isFull = (c: CropRect) => c.x <= 0.0005 && c.y <= 0.0005 && c.w >= 0.999 && c.h >= 0.999

/** Changing the crop moves the coordinate frame: keep fixed-point zooms aimed at the same spot. */
function remapZooms(e: EditState, source: string, from: CropRect, to: CropRect): EditState['zoom'] {
  return {
    ...e.zoom,
    segments: e.zoom.segments.map((s) => {
      if (s.follow) return s
      const hit = clipAt(e.clips, (s.start + s.end) / 2)
      if (!hit || hit.clip.source !== source) return s
      const fx = from.x + s.x * from.w
      const fy = from.y + s.y * from.h
      return { ...s, x: Math.min(1, Math.max(0, (fx - to.x) / to.w)), y: Math.min(1, Math.max(0, (fy - to.y) / to.h)) }
    })
  }
}

export function CropEditor() {
  const source = useCrop((s) => s.source)
  const t = useCrop((s) => s.t)
  const project = useEditor((s) => s.project)
  const edit = useEditor((s) => s.edit)
  const [frame, setFrame] = useState<string | null>(null)
  const [rect, setRect] = useState<CropRect>(FULL)
  const [aspect, setAspect] = useState('free')
  const [dragging, setDragging] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ kind: 'new' | 'move' | Handle; px: number; py: number; start: CropRect } | null>(null)
  const info = project && source ? sourceInfo(project, source) : null
  const close = () => useCrop.setState({ source: null })

  // grab the frame under the playhead to crop against
  useEffect(() => {
    if (!source || !info || !edit) return
    setFrame(null)
    setRect(cropOf(edit.crops, source))
    setAspect('free')
    const v = document.createElement('video')
    v.muted = true
    v.preload = 'auto'
    v.src = info.url
    const grab = () => {
      const c = document.createElement('canvas')
      const k = Math.min(1, 1600 / (v.videoWidth || 1))
      c.width = Math.round(v.videoWidth * k)
      c.height = Math.round(v.videoHeight * k)
      c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height)
      setFrame(c.toDataURL('image/jpeg', 0.9))
      v.removeAttribute('src')
      v.load()
    }
    v.addEventListener('loadedmetadata', () => {
      v.addEventListener('seeked', grab, { once: true })
      v.currentTime = Math.min(Math.max(0, t), Math.max(0, (v.duration || t) - 0.05))
    }, { once: true })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source])

  const srcW = info?.width || 1920
  const srcH = info?.height || 1080
  // aspect ratios are in pixels; convert to a ratio of fractions for this source
  const fracRatio = (id: string) => {
    const r = ASPECTS.find((a) => a.id === id)!.r
    if (r === null) return null
    const px = r === -1 ? srcW / srcH : r
    return px * (srcH / srcW)
  }
  const ratio = fracRatio(aspect)
  const MINF = 0.08

  const clampR = useCallback((r: CropRect): CropRect => {
    const w = Math.max(MINF, Math.min(1, r.w))
    const h = Math.max(MINF, Math.min(1, r.h))
    return { x: Math.max(0, Math.min(r.x, 1 - w)), y: Math.max(0, Math.min(r.y, 1 - h)), w, h }
  }, [])

  const pickAspect = (id: string) => {
    setAspect(id)
    const fr = fracRatio(id)
    if (!fr) return
    setRect((cur) => {
      let w = cur.w
      let h = w / fr
      if (h > 1) {
        h = 1
        w = h * fr
      }
      if (w > 1) {
        w = 1
        h = w / fr
      }
      return clampR({ x: cur.x + cur.w / 2 - w / 2, y: cur.y + cur.h / 2 - h / 2, w, h })
    })
  }

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current
      const box = boxRef.current?.getBoundingClientRect()
      if (!d || !box) return
      const dx = (e.clientX - d.px) / box.width
      const dy = (e.clientY - d.py) / box.height
      const s = d.start
      if (d.kind === 'new') {
        const x0 = (d.px - box.left) / box.width
        const y0 = (d.py - box.top) / box.height
        let w = Math.abs(dx)
        let h = ratio ? w / ratio : Math.abs(dy)
        const x = dx < 0 ? x0 - w : x0
        const y = (ratio ? dy < 0 : dy < 0) ? y0 - h : y0
        w = Math.min(w, 1 - Math.max(0, x))
        h = Math.min(h, 1 - Math.max(0, y))
        setRect({ x: Math.max(0, x), y: Math.max(0, y), w, h })
        return
      }
      if (d.kind === 'move') return setRect(clampR({ ...s, x: s.x + dx, y: s.y + dy }))
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
        if (d.kind === 'n' || d.kind === 's') w = h * ratio
        else h = w / ratio
        if (d.kind.includes('n')) y = s.y + s.h - h
        if (d.kind.includes('w')) x = s.x + s.w - w
        if (d.kind === 'n' || d.kind === 's') x = s.x + s.w / 2 - w / 2
        if (d.kind === 'e' || d.kind === 'w') y = s.y + s.h / 2 - h / 2
      }
      if (w < MINF) {
        if (d.kind.includes('w')) x -= MINF - w
        w = MINF
      }
      if (h < MINF) {
        if (d.kind.includes('n')) y -= MINF - h
        h = MINF
      }
      setRect(clampR({ x, y, w, h }))
    }
    const up = () => {
      const d = drag.current
      drag.current = null
      setDragging(false)
      if (d?.kind === 'new') setRect((r) => (r.w > 0.03 && r.h > 0.03 ? clampR(r) : d.start))
    }
    addEventListener('pointermove', move)
    addEventListener('pointerup', up)
    return () => {
      removeEventListener('pointermove', move)
      removeEventListener('pointerup', up)
    }
  }, [ratio, clampR])

  const start = (kind: 'new' | 'move' | Handle) => (e: React.PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    drag.current = { kind, px: e.clientX, py: e.clientY, start: rect }
    setDragging(true)
  }

  const apply = (r: CropRect) => {
    track('crop_applied')
    if (!source || !edit) return
    const prev = cropOf(edit.crops, source)
    updateEdit((e) => {
      const crops = { ...(e.crops ?? {}) }
      if (isFull(r)) delete crops[source]
      else crops[source] = { x: +r.x.toFixed(5), y: +r.y.toFixed(5), w: +r.w.toFixed(5), h: +r.h.toFixed(5) }
      return { ...e, crops, zoom: remapZooms(e, source, prev, isFull(r) ? FULL : r) }
    })
    close()
  }

  const handles: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
  const hpos = (h: Handle) => ({
    left: h.includes('w') ? '0%' : h.includes('e') ? '100%' : '50%',
    top: h.includes('n') ? '0%' : h.includes('s') ? '100%' : '50%',
    cursor: h === 'n' || h === 's' ? 'ns-resize' : h === 'e' || h === 'w' ? 'ew-resize' : h === 'nw' || h === 'se' ? 'nwse-resize' : 'nesw-resize'
  })
  const pct = (v: number) => `${v * 100}%`

  return (
    <AnimatePresence>
      {source && info && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[90] grid place-items-center bg-black/75 backdrop-blur-md" onPointerDown={(e) => e.target === e.currentTarget && close()}>
          <motion.div
            initial={{ opacity: 0, y: 14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ type: 'spring', stiffness: 380, damping: 34 }}
            className="flex max-h-[92vh] w-[min(1080px,92vw)] flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#101016] shadow-[0_40px_120px_-20px_rgba(0,0,0,.9)]"
          >
            <div className="flex items-center justify-between px-6 pt-5">
              <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand text-white shadow-glow"><Crop className="h-4 w-4" /></span>
                <div>
                  <div className="text-[15px] font-semibold text-white">Crop video</div>
                  <div className="text-[12px] text-zinc-500">{info.name} · applies everywhere this recording is used</div>
                </div>
              </div>
              <button onClick={close} className="grid h-8 w-8 place-items-center rounded-lg text-zinc-500 hover:bg-white/10 hover:text-white"><X className="h-4 w-4" /></button>
            </div>

            <div className="relative mx-6 mt-4 grid min-h-[300px] flex-1 place-items-center overflow-hidden rounded-2xl bg-black/40 p-5 ring-1 ring-white/[0.06]">
              {!frame ? (
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-white" />
              ) : (
                <div ref={boxRef} className="relative cursor-crosshair select-none" style={{ aspectRatio: `${srcW} / ${srcH}`, width: `min(100%, calc((92vh - 260px) * ${srcW / srcH}))` }} onPointerDown={start('new')}>
                  <img src={frame} draggable={false} className="pointer-events-none block h-full w-full rounded-lg" />
                  <div className="absolute" style={{ left: pct(rect.x), top: pct(rect.y), width: pct(rect.w), height: pct(rect.h), boxShadow: '0 0 0 9999px rgba(6,5,10,.62)' }}>
                    <div className="absolute inset-0 cursor-move ring-2 ring-brand-orchid" onPointerDown={start('move')} />
                    {dragging && (
                      <div className="pointer-events-none absolute inset-0 [background:linear-gradient(to_right,transparent_33.2%,rgba(255,255,255,.3)_33.3%,transparent_33.5%,transparent_66.5%,rgba(255,255,255,.3)_66.6%,transparent_66.8%),linear-gradient(to_bottom,transparent_33.2%,rgba(255,255,255,.3)_33.3%,transparent_33.5%,transparent_66.5%,rgba(255,255,255,.3)_66.6%,transparent_66.8%)]" />
                    )}
                    <div className="pointer-events-none absolute left-1.5 top-1.5 rounded-md bg-black/70 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-white">
                      {Math.round(rect.w * srcW)} × {Math.round(rect.h * srcH)}
                    </div>
                    {handles.map((h) => (
                      <span
                        key={h}
                        onPointerDown={start(h)}
                        className={cn('absolute z-10 -translate-x-1/2 -translate-y-1/2 border-2 border-white bg-brand shadow-[0_2px_8px_rgba(0,0,0,.5)]', h.length === 2 ? 'h-3.5 w-3.5 rounded-full' : h === 'e' || h === 'w' ? 'h-6 w-2.5 rounded-full' : 'h-2.5 w-6 rounded-full')}
                        style={hpos(h)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3 px-6 py-4">
              <div className="flex items-center gap-0.5 rounded-xl bg-white/[0.04] p-0.5 ring-1 ring-white/[0.06]">
                {ASPECTS.map((a) => (
                  <button key={a.id} onClick={() => pickAspect(a.id)} className={cn('h-8 rounded-[9px] px-3 text-[12px] font-medium transition-colors', aspect === a.id ? 'bg-white/[0.12] text-white' : 'text-zinc-400 hover:text-white')}>
                    {a.label}
                  </button>
                ))}
              </div>
              <span className="flex items-center gap-1.5 text-[11.5px] text-zinc-500">
                <ShieldCheck className="h-3.5 w-3.5 text-brand-lilac" /> Your recording and its smart data stay untouched
              </span>
              <div className="flex-1" />
              <Button variant="ghost" size="sm" onClick={() => setRect(FULL)}><RotateCcw className="h-3.5 w-3.5" /> Reset</Button>
              <Button variant="secondary" size="sm" onClick={close}>Cancel</Button>
              <Button variant="primary" size="sm" disabled={!frame} onClick={() => apply(rect)}><Check className="h-3.5 w-3.5" strokeWidth={3} /> Apply crop</Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
