/** Anonymous usage stats (see src/main/telemetry.ts). Never pass names, paths or text the user typed. */
export const track = (name: string, props?: Record<string, unknown>) => {
  try {
    window.ilf.telemetry?.track(name, props)
  } catch {}
}
const seen = new Set<string>()
/** Only the first time per app session (for things that can fire many times in a row). */
export const trackOncePerSession = (key: string, name: string, props?: Record<string, unknown>) => {
  if (seen.has(key)) return
  seen.add(key)
  track(name, props)
}
