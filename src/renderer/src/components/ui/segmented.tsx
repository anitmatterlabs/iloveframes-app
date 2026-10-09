import * as React from 'react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'

export function Segmented<T extends string>({ value, onChange, options, className, layoutId, size = 'md' }: { value: T; onChange: (v: T) => void; options: { value: T; label: React.ReactNode }[]; className?: string; layoutId: string; size?: 'sm' | 'md' }) {
  return (
    <div className={cn('flex rounded-[11px] border border-white/[0.06] bg-black/30 p-[3px]', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'relative flex flex-1 items-center justify-center gap-1.5 rounded-lg font-medium transition-colors',
            size === 'sm' ? 'h-7 px-2 text-[11.5px]' : 'h-8 px-3 text-[12.5px]',
            value === o.value ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'
          )}
        >
          {value === o.value && (
            <motion.span layoutId={layoutId} className="absolute inset-0 rounded-lg border border-white/[0.08] bg-white/[0.09] shadow-sm" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />
          )}
          <span className="relative z-10 flex items-center gap-1.5">{o.label}</span>
        </button>
      ))}
    </div>
  )
}
