import { app, nativeImage } from 'electron'
import { join, basename, extname } from 'path'
import { promises as fsp, existsSync, mkdirSync } from 'fs'
import { randomUUID } from 'crypto'

/**
 * Wallpaper library: photos the user imports live in userData (never inside
 * the installer). Each entry gets a ≤4K JPG for rendering and a small thumb.
 */
export interface Wallpaper {
  id: string
  name: string
  group: string
  file: string
  thumb: string
  width: number
  height: number
  /** stable address for wallpapers that ship with the app (independent of the install folder) */
  url?: string
  thumbUrl?: string
}

const MAX_W = 3840
const THUMB_W = 320
const THUMB_H = 200

function dir() {
  const d = join(app.getPath('userData'), 'wallpapers')
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  return d
}
const indexFile = () => join(dir(), 'library.json')

async function readIndex(): Promise<Wallpaper[]> {
  try {
    return JSON.parse(await fsp.readFile(indexFile(), 'utf8'))
  } catch {
    return []
  }
}

/** Center-crop to the thumb aspect, then downscale. */
function makeThumb(img: Electron.NativeImage) {
  const { width: w, height: h } = img.getSize()
  const target = THUMB_W / THUMB_H
  let cw = w, ch = h
  if (w / h > target) cw = Math.round(h * target)
  else ch = Math.round(w / target)
  const cropped = img.crop({ x: Math.round((w - cw) / 2), y: Math.round((h - ch) / 2), width: cw, height: ch })
  return cropped.resize({ width: THUMB_W, height: THUMB_H, quality: 'best' }).toJPEG(86)
}

const prettyName = (file: string) =>
  basename(file, extname(file))
    .replace(/[-_]+/g, ' ')
    .replace(/\b(thumb|thumbnail|thumbnails|\d+k)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()

export async function importWallpapers(paths: string[], group = 'Library', names?: Record<string, string>): Promise<Wallpaper[]> {
  const list = await readIndex()
  const added: Wallpaper[] = []
  for (const p of paths) {
    const img = nativeImage.createFromPath(p)
    if (img.isEmpty()) continue
    const { width, height } = img.getSize()
    const id = randomUUID().slice(0, 12)
    const full = width > MAX_W ? img.resize({ width: MAX_W, quality: 'best' }) : img
    const file = join(dir(), id + '.jpg')
    const thumb = join(dir(), id + '-thumb.jpg')
    await fsp.writeFile(file, full.toJPEG(93))
    await fsp.writeFile(thumb, makeThumb(img))
    const size = full.getSize()
    const w: Wallpaper = { id, name: names?.[basename(p)] ?? prettyName(p), group, file, thumb, width: size.width, height: size.height }
    list.push(w)
    added.push(w)
  }
  await fsp.writeFile(indexFile(), JSON.stringify(list, null, 1))
  return added
}

/** Wallpapers that ship with the app (resources/wallpapers), on every platform. */
export const bundledWallpaperDir = () => (app.isPackaged ? join(process.resourcesPath, 'wallpapers') : join(app.getAppPath(), 'resources', 'wallpapers'))

async function bundled(): Promise<Wallpaper[]> {
  const base = bundledWallpaperDir()
  try {
    const m = JSON.parse(await fsp.readFile(join(base, 'manifest.json'), 'utf8'))
    return (m.items as any[]).map((w) => ({
      id: 'b-' + w.id, name: w.name, group: m.group, file: join(base, w.file), thumb: join(base, w.thumb), width: w.width, height: w.height,
      url: 'ilf://wallpaper/' + encodeURIComponent(w.file), thumbUrl: 'ilf://wallpaper/' + encodeURIComponent(w.thumb)
    }))
  } catch {
    return []
  }
}

export async function listWallpapers(): Promise<Wallpaper[]> {
  const built = (await bundled()).filter((w) => existsSync(w.file))
  // an earlier import of the same picture shouldn't show up twice
  const taken = new Set(built.map((w) => w.group + '/' + w.name))
  const mine = (await readIndex()).filter((w) => existsSync(w.file) && !taken.has(w.group + '/' + w.name))
  return [...built, ...mine]
}

export async function removeWallpaper(id: string) {
  const list = await readIndex()
  const w = list.find((x) => x.id === id)
  if (!w) return
  await fsp.rm(w.file, { force: true })
  await fsp.rm(w.thumb, { force: true })
  await fsp.writeFile(indexFile(), JSON.stringify(list.filter((x) => x.id !== id), null, 1))
}

// ---------------------------------------------------------------------------
// Sound library: user audio files, copied into userData/sounds
// ---------------------------------------------------------------------------
export interface UserSound {
  id: string
  name: string
  file: string
  duration: number
}

function soundDir() {
  const d = join(app.getPath('userData'), 'sounds')
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  return d
}
const soundIndex = () => join(soundDir(), 'sounds.json')

async function readSounds(): Promise<UserSound[]> {
  try {
    return JSON.parse(await fsp.readFile(soundIndex(), 'utf8'))
  } catch {
    return []
  }
}

export async function importSounds(paths: string[], probe: (file: string) => Promise<number>): Promise<UserSound[]> {
  const list = await readSounds()
  const added: UserSound[] = []
  for (const p of paths) {
    const id = randomUUID().slice(0, 12)
    const file = join(soundDir(), id + extname(p).toLowerCase())
    await fsp.copyFile(p, file)
    const duration = await probe(file)
    if (!(duration > 0)) {
      await fsp.rm(file, { force: true })
      continue
    }
    const s: UserSound = { id, name: basename(p, extname(p)).replace(/[-_]+/g, ' ').trim(), file, duration }
    list.push(s)
    added.push(s)
  }
  await fsp.writeFile(soundIndex(), JSON.stringify(list, null, 1))
  return added
}

export async function listSounds(): Promise<UserSound[]> {
  return (await readSounds()).filter((s) => existsSync(s.file))
}

export async function removeSound(id: string) {
  const list = await readSounds()
  const s = list.find((x) => x.id === id)
  if (s) await fsp.rm(s.file, { force: true })
  await fsp.writeFile(soundIndex(), JSON.stringify(list.filter((x) => x.id !== id), null, 1))
}
