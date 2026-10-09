import { useEffect, useState } from 'react'
import { create } from 'zustand'

export interface LicenseStatus {
  state: 'licensed' | 'trial' | 'expired'
  trialEndsAt: number
  remainingMs: number
  name: string
  online: boolean
  tampered: boolean
  license?: { keyMasked: string; activatedAt: number; customerName?: string; customerEmail?: string; lastValidated: number }
}

/** Renderer mirror of the main-process licence state (main is always the source of truth). */
export const useLicenseStore = create<{ status: LicenseStatus | null; at: number }>(() => ({ status: null, at: 0 }))

let started = false
function start() {
  if (started) return
  started = true
  const set = (s: LicenseStatus) => useLicenseStore.setState({ status: s, at: performance.now() })
  window.ilf.license.status().then(set)
  window.ilf.license.onChange(set)
  setInterval(() => window.ilf.license.status().then(set), 60_000)
}

export function useLicense() {
  start()
  return useLicenseStore((s) => s.status)
}

/** Remaining trial time, ticking smoothly between main-process refreshes. */
export function useTrialRemaining() {
  const st = useLicenseStore((s) => s.status)
  const at = useLicenseStore((s) => s.at)
  const [, tick] = useState(0)
  useEffect(() => {
    const iv = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(iv)
  }, [])
  if (!st) return 0
  return Math.max(0, st.remainingMs - (performance.now() - at))
}

export function fmtRemaining(ms: number) {
  const m = Math.floor(ms / 60000)
  const h = Math.floor(m / 60)
  if (h >= 1) return `${h}h ${m % 60}m`
  if (m >= 1) return `${m}m`
  return `${Math.ceil(ms / 1000)}s`
}
