import { app, net, BrowserWindow } from 'electron'
import { createHash, createPublicKey, verify } from 'crypto'
import { createWriteStream, promises as fsp } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { CONFIG } from './config'
import { platform } from './platform'

/**
 * Over-the-air updates for Windows and macOS.
 *
 * latest.json = { payload: "<json string>", signature: "<base64 ed25519>" }
 * payload     = { version, notes, date, assets: { win|mac-arm64|mac-x64: { url, sha512, size } } }
 *
 * The payload must be signed with the private key in keys/ (see scripts/release.cjs)
 * and every download must match its SHA-512, so a compromised host can't push code.
 */

export type UpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'none'; version: string }
  | { kind: 'downloading'; version: string; p: number }
  | { kind: 'ready'; version: string; notes: string }
  | { kind: 'manual'; version: string; notes: string; url: string }
  | { kind: 'error'; message: string }

let st: UpdateState = { kind: 'idle' }
let readyFile: string | null = null
let busy = false

const push = (s: UpdateState) => {
  st = s
  BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('update:state', s))
}
export const updateState = () => st

function newer(a: string, b: string) {
  const pa = a.split(/[.-]/).map((x) => parseInt(x) || 0)
  const pb = b.split(/[.-]/).map((x) => parseInt(x) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0)
  }
  return false
}

async function fetchManifest() {
  // ILF_UPDATE_URL lets you stage updates from a test server; the signature check still applies
  const url = process.env.ILF_UPDATE_URL || CONFIG.updateUrl
  const res = await net.fetch(url + '?t=' + Date.now(), { cache: 'no-store' } as any)
  if (!res.ok) throw new Error(`Update server returned ${res.status}`)
  const m = await res.json()
  if (typeof m?.payload !== 'string' || typeof m?.signature !== 'string') throw new Error('Malformed update manifest')
  const ok = verify(null, Buffer.from(m.payload, 'utf8'), createPublicKey(CONFIG.updatePublicKey), Buffer.from(m.signature, 'base64'))
  if (!ok) throw new Error('Update signature is invalid. Ignoring this update.')
  return JSON.parse(m.payload) as { version: string; notes?: string; assets: Record<string, { url: string; sha512: string; size?: number }> }
}

async function download(url: string, sha512: string, version: string) {
  const name = decodeURIComponent(url.split('/').pop()!.split('?')[0])
  const file = join(tmpdir(), `ilf-update-${version}-${name}`)
  const res = await net.fetch(url)
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`)
  const total = Number(res.headers.get('content-length')) || 0
  const hash = createHash('sha512')
  const out = createWriteStream(file)
  const reader = res.body.getReader()
  let got = 0
  let last = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    hash.update(value)
    got += value.byteLength
    if (!out.write(Buffer.from(value))) await new Promise((r) => out.once('drain', r))
    if (total && Date.now() - last > 250) {
      last = Date.now()
      push({ kind: 'downloading', version, p: got / total })
    }
  }
  await new Promise<void>((r) => out.end(r))
  const digest = hash.digest('base64')
  if (digest !== sha512) {
    await fsp.rm(file, { force: true })
    throw new Error('Downloaded update failed its integrity check.')
  }
  return file
}

export async function checkForUpdates(manual = false) {
  if (busy || !app.isPackaged) {
    if (manual && !app.isPackaged) push({ kind: 'error', message: 'Updates only run in the installed app.' })
    return
  }
  busy = true
  try {
    push({ kind: 'checking' })
    const m = await fetchManifest()
    if (!newer(m.version, app.getVersion())) return push({ kind: 'none', version: app.getVersion() })
    const asset = m.assets[platform.updateAsset()]
    if (!asset) return push({ kind: 'none', version: app.getVersion() })
    // the portable .exe can't replace itself: point people at the download instead
    if (process.env.PORTABLE_EXECUTABLE_FILE) return push({ kind: 'manual', version: m.version, notes: m.notes ?? '', url: asset.url })
    readyFile = await download(asset.url, asset.sha512, m.version)
    push({ kind: 'ready', version: m.version, notes: m.notes ?? '' })
    if (process.env.ILF_AUTO_INSTALL === '1') await installNow()
  } catch (e: any) {
    push(manual ? { kind: 'error', message: e?.message ?? String(e) } : { kind: 'idle' })
  } finally {
    busy = false
  }
}

export async function installNow() {
  if (!readyFile) return
  await platform.installUpdate(readyFile)
}

export function startAutoUpdates() {
  setTimeout(() => checkForUpdates(false), process.env.ILF_UPDATE_URL ? 3_000 : 15_000)
  setInterval(() => checkForUpdates(false), 4 * 60 * 60 * 1000)
}
