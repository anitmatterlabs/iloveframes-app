import { cn, isMac } from '@/lib/utils'

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn('h-7 w-7', className)} fill="none">
      <defs>
        <linearGradient id="lg-a" x1="4" y1="4" x2="60" y2="60" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ff4d8d" />
          <stop offset=".35" stopColor="#c026d3" />
          <stop offset=".7" stopColor="#7c3aed" />
          <stop offset="1" stopColor="#2563eb" />
        </linearGradient>
        <radialGradient id="lg-b" cx="50" cy="12" r="22" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ffb347" stopOpacity=".85" />
          <stop offset="1" stopColor="#ffb347" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="4" y="4" width="56" height="56" rx="15" fill="url(#lg-a)" />
      <rect x="4" y="4" width="56" height="56" rx="15" fill="url(#lg-b)" />
      <rect x="4.5" y="4.5" width="55" height="55" rx="14.5" stroke="white" strokeOpacity=".18" />
      <path d="M15 23v-4.5a3.5 3.5 0 0 1 3.5-3.5H23M41 15h4.5a3.5 3.5 0 0 1 3.5 3.5V23M49 41v4.5a3.5 3.5 0 0 1-3.5 3.5H41M23 49h-4.5a3.5 3.5 0 0 1-3.5-3.5V41" stroke="white" strokeWidth="3.4" strokeLinecap="round" />
      <path d="M32 43.5s-10.5-6.2-10.5-13.2c0-3.4 2.6-5.8 5.6-5.8 2.1 0 3.9 1.1 4.9 2.8 1-1.7 2.8-2.8 4.9-2.8 3 0 5.6 2.4 5.6 5.8 0 7-10.5 13.2-10.5 13.2Z" fill="white" />
    </svg>
  )
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('text-[15px] font-semibold tracking-[-0.02em] text-white', className)}>
      ilove<span className="text-gradient">frames</span>
    </span>
  )
}

/** Window title bar: drag region with room for native controls. */
export function Titlebar({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('drag relative z-20 flex h-11 shrink-0 items-center gap-3 border-b border-white/[0.05]', isMac ? 'pl-[84px] pr-3' : 'pl-4 pr-[150px]', className)}>
      {children}
    </div>
  )
}
