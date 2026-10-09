import * as React from 'react'
import * as SliderPrimitive from '@radix-ui/react-slider'
import { cn } from '@/lib/utils'

export const Slider = React.forwardRef<React.ElementRef<typeof SliderPrimitive.Root>, React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>>(
  ({ className, ...props }, ref) => (
    <SliderPrimitive.Root ref={ref} className={cn('relative flex h-5 w-full touch-none select-none items-center', className)} {...props}>
      <SliderPrimitive.Track className="relative h-[5px] w-full grow overflow-hidden rounded-full bg-white/[0.08]">
        <SliderPrimitive.Range className="absolute h-full bg-gradient-to-r from-brand-pink via-brand-orchid to-brand-violet" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb className="block h-[15px] w-[15px] rounded-full bg-white shadow-[0_2px_8px_rgba(0,0,0,.5)] ring-0 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-violet-500/30" />
    </SliderPrimitive.Root>
  )
)
Slider.displayName = 'Slider'

export function LabeledSlider({ label, value, min, max, step = 0.01, onChange, format }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; format?: (v: number) => string }) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between text-[12px]">
        <span className="text-zinc-400">{label}</span>
        <span className="tabular-nums text-zinc-500">{format ? format(value) : value.toFixed(2)}</span>
      </div>
      <Slider value={[value]} min={min} max={max} step={step} onValueChange={(v) => onChange(v[0])} />
    </div>
  )
}
