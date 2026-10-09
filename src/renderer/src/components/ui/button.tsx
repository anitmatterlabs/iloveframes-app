import * as React from 'react'
import { cn } from '@/lib/utils'

type Variant = 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger' | 'record'
type Size = 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm'

const variants: Record<Variant, string> = {
  primary: 'bg-brand text-white shadow-glow hover:brightness-110 active:brightness-95',
  secondary: 'bg-white/[0.06] text-zinc-100 hover:bg-white/[0.1] border border-white/[0.06]',
  ghost: 'text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06]',
  outline: 'border border-white/10 text-zinc-200 hover:bg-white/[0.05] hover:border-white/20',
  danger: 'bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20',
  record: 'bg-[#ff3b5c] text-white hover:bg-[#ff4d6b] shadow-[0_10px_40px_-8px_rgba(255,59,92,.7)]'
}
const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-[12.5px] gap-1.5 rounded-lg',
  md: 'h-9 px-4 text-[13px] gap-2 rounded-[10px]',
  lg: 'h-12 px-6 text-[15px] gap-2.5 rounded-xl',
  icon: 'h-9 w-9 rounded-[10px]',
  'icon-sm': 'h-7 w-7 rounded-lg'
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant = 'secondary', size = 'md', ...props }, ref) => (
  <button
    ref={ref}
    className={cn(
      'inline-flex select-none items-center justify-center whitespace-nowrap font-medium transition-all duration-150 disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50 active:scale-[0.98]',
      variants[variant],
      sizes[size],
      className
    )}
    {...props}
  />
))
Button.displayName = 'Button'
