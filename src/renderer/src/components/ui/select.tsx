import * as React from 'react'
import * as SelectPrimitive from '@radix-ui/react-select'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export function Select({ value, onChange, options, placeholder, className, icon }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; placeholder?: string; className?: string; icon?: React.ReactNode }) {
  return (
    <SelectPrimitive.Root value={value} onValueChange={onChange}>
      <SelectPrimitive.Trigger
        className={cn(
          'flex h-9 w-full items-center justify-between gap-2 rounded-[10px] border border-white/[0.07] bg-white/[0.04] px-3 text-left text-[12.5px] text-zinc-200 outline-none transition-colors hover:bg-white/[0.07] data-[placeholder]:text-zinc-500',
          className
        )}
      >
        <span className="flex min-w-0 items-center gap-2 truncate">
          {icon}
          <SelectPrimitive.Value placeholder={placeholder} />
        </span>
        <SelectPrimitive.Icon>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content position="popper" sideOffset={6} className="anim-pop z-50 max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-xl border border-white/10 bg-ink-800/95 p-1 shadow-2xl backdrop-blur-xl">
          <SelectPrimitive.Viewport>
            {options.map((o) => (
              <SelectPrimitive.Item
                key={o.value}
                value={o.value}
                className="relative flex cursor-pointer select-none items-center rounded-lg py-2 pl-8 pr-3 text-[12.5px] text-zinc-300 outline-none data-[highlighted]:bg-white/[0.07] data-[highlighted]:text-white"
              >
                <SelectPrimitive.ItemIndicator className="absolute left-2.5">
                  <Check className="h-3.5 w-3.5 text-brand-orchid" />
                </SelectPrimitive.ItemIndicator>
                <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  )
}
