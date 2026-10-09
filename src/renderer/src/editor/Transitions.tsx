import * as Popover from '@radix-ui/react-popover'
import type { Transition, TransitionKind } from '@/engine/types'
import { LabeledSlider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'
import { DEFAULT_TRANSITION, setAllTransitions, setTransition, updateEdit, useEditor } from './store'

export const TRANSITIONS: { kind: TransitionKind; label: string; hint: string }[] = [
  { kind: 'fade', label: 'Crossfade', hint: 'A soft dissolve between shots' },
  { kind: 'blur', label: 'Blur', hint: 'Defocus out, refocus into the next shot' },
  { kind: 'zoom', label: 'Zoom', hint: 'Fly through into the next shot' },
  { kind: 'push', label: 'Slide', hint: 'The new shot glides in and pushes the old one away' },
  { kind: 'wipe', label: 'Wipe', hint: 'Soft diagonal reveal with a light sweep' },
  { kind: 'dip', label: 'Dip', hint: 'Fade down to dark, then up into the next shot' }
]

export const transitionLabel = (t?: Transition) => (t ? TRANSITIONS.find((x) => x.kind === t.kind)?.label ?? 'Transition' : 'Cut')

/** The bow-tie mark used for transitions everywhere. */
export function TransitionIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={cn('h-3 w-3', className)} fill="currentColor">
      <path d="M2.2 3.6c0-.6.7-.9 1.1-.5l4 3.9c.3.3.3.8 0 1.1l-4 3.9c-.4.4-1.1.1-1.1-.5V3.6Zm11.6 0c0-.6-.7-.9-1.1-.5l-4 3.9c-.3.3-.3.8 0 1.1l4 3.9c.4.4 1.1.1 1.1-.5V3.6Z" />
    </svg>
  )
}

/** Tiny looping preview of a transition: two "screens" animating with CSS. */
function Tile({ kind, label, active, onClick, title }: { kind: TransitionKind | 'none'; label: string; active: boolean; onClick: () => void; title: string }) {
  return (
    <button onClick={onClick} title={title} className="group/tile flex flex-col items-center gap-1.5 outline-none">
      <div
        data-active={active}
        className={cn(
          'trp-tile relative aspect-[16/10] w-full overflow-hidden rounded-lg ring-1 transition-all duration-150',
          `trp-${kind}`,
          active ? 'ring-2 ring-brand-orchid shadow-[0_0_0_3px_rgba(192,132,252,.18)]' : 'ring-white/10 group-hover/tile:ring-white/30'
        )}
      >
        <div className="trp trp-a" />
        <div className="trp trp-b" />
        {kind === 'none' && <div className="absolute inset-y-0 left-1/2 w-px bg-white/70" />}
      </div>
      <span className={cn('text-[10.5px] font-medium transition-colors', active ? 'text-white' : 'text-zinc-500 group-hover/tile:text-zinc-300')}>{label}</span>
    </button>
  )
}

export function TransitionPicker({ value, onChange, onApplyAll }: { value?: Transition; onChange: (t: Transition | null, history?: boolean) => void; onApplyAll?: () => void }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-2">
        <Tile kind="none" label="Cut" title="Straight cut, no transition" active={!value} onClick={() => onChange(null)} />
        {TRANSITIONS.map((t) => (
          <Tile key={t.kind} kind={t.kind} label={t.label} title={t.hint} active={value?.kind === t.kind} onClick={() => onChange({ kind: t.kind, duration: value?.duration ?? DEFAULT_TRANSITION.duration })} />
        ))}
      </div>
      {value && (
        <LabeledSlider label="Duration" value={value.duration} min={0.2} max={1.5} step={0.05} onChange={(d) => onChange({ ...value, duration: d }, false)} format={(v) => v.toFixed(2) + 's'} />
      )}
      {onApplyAll && (
        <button onClick={onApplyAll} className="h-8 w-full rounded-lg text-[12px] font-medium text-zinc-400 ring-1 ring-white/[0.08] transition-colors hover:bg-white/[0.05] hover:text-zinc-100">
          Use this on every cut
        </button>
      )}
    </div>
  )
}

/** The button that sits on a cut in the timeline; opens the picker. */
export function TransitionHandle({ clipId, value, x, top }: { clipId: string; value?: Transition; x: number; top: number }) {
  const change = (t: Transition | null, history = true) => {
    if (history) setTransition(clipId, t)
    else updateEdit((e) => ({ ...e, clips: e.clips.map((c) => (c.id === clipId ? { ...c, tIn: t ?? undefined } : c)) }), false)
  }
  return (
    <Popover.Root onOpenChange={(o) => !o && useEditor.getState().checkpoint()}>
      <Popover.Trigger asChild>
        <button
          onPointerDown={(e) => e.stopPropagation()}
          className={cn(
            'absolute z-20 grid h-[22px] w-[22px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full transition-all duration-150 hover:scale-110',
            value ? 'bg-brand text-white shadow-glow' : 'bg-ink-800 text-zinc-400 ring-1 ring-white/15 hover:text-white hover:ring-brand-orchid/70'
          )}
          style={{ left: x, top }}
          title={value ? `${transitionLabel(value)} · ${value.duration.toFixed(2)}s` : 'Add a transition'}
        >
          <TransitionIcon />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="top" sideOffset={10} collisionPadding={12} className="anim-pop z-50 w-[300px] rounded-2xl border border-white/10 bg-ink-850/95 p-4 shadow-[0_24px_60px_-12px_rgba(0,0,0,.8)] backdrop-blur-xl">
          <div className="mb-3 flex items-center gap-2 text-[12.5px] font-semibold text-zinc-100">
            <span className="grid h-6 w-6 place-items-center rounded-lg bg-brand text-white">
              <TransitionIcon />
            </span>
            Transition
          </div>
          <TransitionPicker value={value} onChange={change} onApplyAll={() => setAllTransitions(value ?? DEFAULT_TRANSITION)} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
