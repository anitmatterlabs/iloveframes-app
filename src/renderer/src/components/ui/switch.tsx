import * as React from 'react'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import { cn } from '@/lib/utils'

export const Switch = React.forwardRef<React.ElementRef<typeof SwitchPrimitive.Root>, React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>>(
  ({ className, ...props }, ref) => (
    <SwitchPrimitive.Root
      ref={ref}
      className={cn(
        'peer inline-flex h-[20px] w-[34px] shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40 data-[state=checked]:bg-gradient-to-r data-[state=checked]:from-brand-pink data-[state=checked]:via-brand-orchid data-[state=checked]:to-brand-violet data-[state=unchecked]:bg-white/[0.1]',
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block h-4 w-4 rounded-full bg-white shadow-md transition-transform duration-200 data-[state=checked]:translate-x-[15px] data-[state=unchecked]:translate-x-[1px]" />
    </SwitchPrimitive.Root>
  )
)
Switch.displayName = 'Switch'

export function SwitchRow({ label, hint, checked, onChange, disabled }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={cn('flex cursor-pointer items-center justify-between gap-3', disabled && 'cursor-not-allowed opacity-50')}>
      <div className="min-w-0">
        <div className="text-[12.5px] text-zinc-300">{label}</div>
        {hint && <div className="mt-0.5 text-[11px] leading-snug text-zinc-500">{hint}</div>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </label>
  )
}
