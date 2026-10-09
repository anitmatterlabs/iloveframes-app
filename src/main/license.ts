import { app, net, BrowserWindow } from 'electron'
import { join } from 'path'
import { promises as fsp, existsSync } from 'fs'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto'
import { hostname, userInfo } from 'os'
import { CONFIG } from './config'
import { platform } from './platform'

/**
 * Trial + licence state.
 *
 * - State is AES-256-GCM encrypted with a key bound to this machine, so it
 *   can't be edited (GCM detects any change) or copied to another computer.
 * - It is written to two places (app data + an OS-level mirror); the earliest
 *   trial start always wins, so deleting one copy doesn't reset the trial.
 * - Time comes from HTTPS servers when online. Offline, time may only move
 *   forward from the last moment we saw, so turning the clock back gains nothing.
 * - Licences are validated against Dodo Payments on launch and every 6 hours.
 */

interface LicenseRecord {
  key: string
  instanceId: string
  activatedAt: number
  lastValidated: number
  customerName?: string
  customerEmail?: string
}

interface State {
  v: 1
  firstRun: number
  lastSeen: number
  name: string
  license?: LicenseRecord
}

export type LicenseStatus = {
  state: 'licensed' | 'trial' | 'expired'
  trialEndsAt: number
  remainingMs: number
  name: string
  online: boolean
  tampered: boolean
  license?: { keyMasked: string; activatedAt: number; customerName?: string; customerEmail?: string; lastValidated: number }
}

// Mixed into the machine-bound key. Changing it invalidates every stored state.
const APP_SECRET = 'ilf::7c1f0e9a4b6d2e8f::frames-love::v1'
const FILE = () => join(app.getPath('userData'), 'session.bin')

let key: Buffer
let state: State
let tampered = false
let online = false
// trusted clock = base + monotonic elapsed (immune to clock changes while running)
let clockBase = 0
let perfBase = 0
const now = () => clockBase + (performance.now() - perfBase)

// ------------------------------------------------------------------ crypto
function seal(s: State): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([c.update(JSON.stringify(s), 'utf8'), c.final()])
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64')
}

function open(b64: string | null): State | null | 'bad' {
  if (!b64) return null
  try {
    const raw = Buffer.from(b64.trim(), 'base64')
    const d = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12))
    d.setAuthTag(raw.subarray(12, 28))
    const s = JSON.parse(Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8'))
    if (s?.v !== 1 || typeof s.firstRun !== 'number') return 'bad'
    return s
  } catch {
    return 'bad'
  }
}

async function persist() {
  state.lastSeen = Math.max(state.lastSeen, now())
  const data = seal(state)
  await fsp.writeFile(FILE(), data).catch(() => {})
  await platform.mirrorWrite(data).catch(() => {})
}

// ------------------------------------------------------------------ time
async function serverTime(): Promise<number | null> {
  const urls = ['https://live.dodopayments.com/', 'https://www.cloudflare.com/', 'https://www.google.com/']
  const one = async (url: string) => {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 3500)
    try {
      const res = await net.fetch(url, { method: 'HEAD', signal: ctrl.signal, cache: 'no-store' } as any)
      const ms = Date.parse(res.headers.get('date') ?? '')
      if (!isFinite(ms)) throw new Error('no date')
      return ms
    } finally {
      clearTimeout(t)
    }
  }
  try {
    return await Promise.any(urls.map(one))
  } catch {
    return null
  }
}

async function syncClock() {
  const t = await serverTime()
  online = t !== null
  // offline: never earlier than the last moment we have seen
  const base = t ?? Math.max(Date.now(), state?.lastSeen ?? 0)
  clockBase = base
  perfBase = performance.now()
}

// ------------------------------------------------------------------ dodo
const api = () => (CONFIG.dodoEnv === 'live' ? 'https://live.dodopayments.com' : 'https://test.dodopayments.com')

async function post(path: string, body: unknown): Promise<{ status: number; json: any }> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 12000)
  try {
    const res = await net.fetch(api() + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal } as any)
    const text = await res.text()
    let json: any = null
    try {
      json = JSON.parse(text)
    } catch {}
    return { status: res.status, json }
  } finally {
    clearTimeout(t)
  }
}

const mask = (k: string) => (k.length <= 8 ? '••••' : k.slice(0, 4) + '••••••••' + k.slice(-4))

// ------------------------------------------------------------------ public
export function status(): LicenseStatus {
  const t = now()
  const trialEndsAt = state.firstRun + CONFIG.trialMs
  const L = state.license
  const licensed = !!L && t - L.lastValidated < CONFIG.offlineGraceMs
  const inTrial = !tampered && t < trialEndsAt
  return {
    state: licensed ? 'licensed' : inTrial ? 'trial' : 'expired',
    trialEndsAt,
    remainingMs: Math.max(0, trialEndsAt - t),
    name: state.name,
    online,
    tampered,
    license: L ? { keyMasked: mask(L.key), activatedAt: L.activatedAt, customerName: L.customerName, customerEmail: L.customerEmail, lastValidated: L.lastValidated } : undefined
  }
}

export const isUnlocked = () => status().state !== 'expired'

function broadcast() {
  const s = status()
  BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('license:changed', s))
}

/** Re-check a stored licence with Dodo. Removes it only on an explicit "not valid". */
async function revalidate() {
  const L = state.license
  if (!L) return
  try {
    const r = await post('/licenses/validate', { license_key: L.key, license_key_instance_id: L.instanceId })
    if (r.status === 200 && r.json?.valid === true) {
      L.lastValidated = now()
      online = true
    } else if (r.status === 200 && r.json?.valid === false) {
      state.license = undefined // revoked, refunded, expired or deactivated elsewhere
    }
  } catch {
    // offline: keep it until the grace period runs out
  }
  await persist()
  broadcast()
}

export async function activate(rawKey: string, name: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const licenseKey = rawKey.trim()
  if (licenseKey.length < 8) return { ok: false, error: 'That doesn’t look like a license key.' }
  if (name.trim()) state.name = name.trim().slice(0, 60)
  const device = `${state.name || userInfo().username} · ${hostname()} (${platform.id === 'mac' ? 'Mac' : 'Windows'})`
  let r: { status: number; json: any }
  try {
    r = await post('/licenses/activate', { license_key: licenseKey, name: device })
  } catch {
    return { ok: false, error: 'Can’t reach the license server. Check your internet connection and try again.' }
  }
  if (r.status === 404) return { ok: false, error: 'License key not found. Check it matches the one in your email.' }
  if (r.status === 403) return { ok: false, error: 'This license key isn’t active (it may be expired, refunded or disabled).' }
  if (r.status === 422) return { ok: false, error: 'This key has reached its device limit. Deactivate it on another computer first.' }
  if (r.status !== 200 && r.status !== 201) return { ok: false, error: `Activation failed (${r.status}). Please try again.` }
  const inst = r.json
  if (CONFIG.dodoProductId && inst?.product?.product_id && inst.product.product_id !== CONFIG.dodoProductId) {
    await post('/licenses/deactivate', { license_key: licenseKey, license_key_instance_id: inst.id }).catch(() => {})
    return { ok: false, error: 'This key belongs to a different product.' }
  }
  const t = now()
  state.license = {
    key: licenseKey,
    instanceId: inst.id,
    activatedAt: t,
    lastValidated: t,
    customerName: inst?.customer?.name,
    customerEmail: inst?.customer?.email
  }
  online = true
  await persist()
  broadcast()
  return { ok: true }
}

export async function deactivate(): Promise<{ ok: true } | { ok: false; error: string }> {
  const L = state.license
  if (!L) return { ok: true }
  try {
    const r = await post('/licenses/deactivate', { license_key: L.key, license_key_instance_id: L.instanceId })
    if (r.status !== 200 && r.status !== 403 && r.status !== 404) return { ok: false, error: `Couldn’t deactivate (${r.status}). Try again.` }
  } catch {
    return { ok: false, error: 'Can’t reach the license server. Connect to the internet to free this device.' }
  }
  state.license = undefined
  await persist()
  broadcast()
  return { ok: true }
}

export async function setName(name: string) {
  state.name = name.trim().slice(0, 60)
  await persist()
  broadcast()
}

export async function initLicense() {
  const mid = (await platform.machineId().catch(() => '')) || `${hostname()}|${userInfo().username}`
  key = createHash('sha256').update(APP_SECRET + '|' + mid).digest()

  const fromFile = existsSync(FILE()) ? open(await fsp.readFile(FILE(), 'utf8').catch(() => null)) : null
  const fromMirror = open(await platform.mirrorRead().catch(() => null))
  const good = [fromFile, fromMirror].filter((s): s is State => !!s && s !== 'bad')
  // something exists but can't be decrypted = edited or copied from another machine
  tampered = good.length === 0 && (fromFile === 'bad' || fromMirror === 'bad')

  state = { v: 1, firstRun: 0, lastSeen: 0, name: '' }
  if (good.length) {
    state.firstRun = Math.min(...good.map((s) => s.firstRun))
    state.lastSeen = Math.max(...good.map((s) => s.lastSeen))
    state.name = good.find((s) => s.name)?.name ?? ''
    state.license = good.map((s) => s.license).filter(Boolean).sort((a, b) => b!.lastValidated - a!.lastValidated)[0]
  }
  await syncClock()
  if (!state.firstRun) state.firstRun = tampered ? now() - CONFIG.trialMs : now()
  // a clock pushed into the future on first launch can't stretch the trial
  if (online && state.firstRun > now()) state.firstRun = now()
  await persist()

  revalidate()
  // keep the clock honest and the status fresh while running
  setInterval(async () => {
    const before = status().state
    await persist()
    if (status().state !== before) broadcast()
  }, 60_000)
  setInterval(async () => {
    await syncClock()
    await revalidate()
  }, 6 * 60 * 60 * 1000)
}
