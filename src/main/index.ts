import {
  app, BrowserWindow, ipcMain, screen, desktopCapturer, protocol, dialog, shell,
  systemPreferences, globalShortcut, session, Display, nativeImage, clipboard, net, Menu, Tray
} from 'electron'
import { join, extname, basename } from 'path'
import { CONFIG } from './config'
import { projectName } from '../shared/naming'
import { checkForUpdates, installNow, startAutoUpdates, updateState } from './updater'
import { promises as fsp, createReadStream, existsSync, statSync, mkdirSync } from 'fs'
import { Readable } from 'stream'
import { randomUUID } from 'crypto'
import { tmpdir } from 'os'
import { InputTracker, startNativeCapture } from './recorder'
import {
  runFfmpeg, LiveCapture, captureOutput, cropFilter, probeMedia, streamFrames, prepareFfmpeg, ffmpegErrorKind,
  newHandle, cancelHandle, CancelledError, type CropFrac, type FfmpegHandle, type MediaInfo
} from './ffmpeg'
import { initLicense, status as licenseStatus, isUnlocked, activate as licenseActivate, deactivate as licenseDeactivate, setName as licenseSetName } from './license'
import { importWallpapers, listWallpapers, removeWallpaper, importSounds, listSounds, removeSound, bundledWallpaperDir } from './library'
import { appendRecData, readRecData, readSiblingProject, nextNumber, peekName, commitName, pad3 } from './ilfdata'
import { initAgentBridge } from './agent'
import { normalizeVideo, audioSidecar, analyzeActivity, readActivity, writeActivity, UnreadableVideoError } from './media'
import { initTelemetry, setAway, track, trackError, trackOnce } from './telemetry'

const isMac = process.platform === 'darwin'
const devUrl = process.env['ELECTRON_RENDERER_URL']

protocol.registerSchemesAsPrivileged([
  { scheme: 'ilf', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true, corsEnabled: true } }
])

let mainWin: BrowserWindow | null = null
let controlWin: BrowserWindow | null = null

// one copy of the app at a time: a second launch (or a video opened with iloveframes) goes to this one
const VIDEO_EXT = ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi']
const isVideoPath = (p: string) => VIDEO_EXT.includes(extname(p).slice(1).toLowerCase())
/** videos handed to the app (dock drop, "Open with", second launch) before the window was ready */
const pendingOpen: string[] = []
const hasLock = app.requestSingleInstanceLock()
if (!hasLock) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    const vids = argv.slice(1).filter((a) => !a.startsWith('-') && isVideoPath(a) && existsSync(a))
    if (vids.length) openVideos(vids)
    else focusMain()
  })
}
// macOS: files dropped on the dock icon / "Open with iloveframes" (can arrive before ready)
app.on('open-file', (e, path) => {
  e.preventDefault()
  if (isVideoPath(path)) openVideos([path])
})

function focusMain() {
  if (rec) return // stay out of the way while recording
  if (!mainWin) {
    if (app.isReady()) createMainWindow()
    return
  }
  if (mainWin.isMinimized()) mainWin.restore()
  mainWin.show()
  mainWin.focus()
  if (isMac) app.focus({ steal: true })
}

/** Ask the renderer to make a new project from these videos (it shows progress and opens the editor). */
function openVideos(paths: string[]) {
  pendingOpen.push(...paths)
  if (!mainWin || mainWin.webContents.isLoading() || !pendingOpen.length) return
  focusMain()
  const list = pendingOpen.splice(0)
  mainWin.webContents.send('media:open-request', list)
}

const projectsRoot = () => {
  const dir = join(app.getPath('videos'), 'iloveframes')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function loadRoute(win: BrowserWindow, route: string) {
  if (devUrl) win.loadURL(devUrl + '#' + route)
  else win.loadFile(join(__dirname, '../renderer/index.html'), { hash: route })
}

function createMainWindow() {
  mainWin = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: '#07070a',
    title: 'iloveframes',
    icon: app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(__dirname, '../../resources/icon.png'),
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    trafficLightPosition: { x: 16, y: 16 },
    titleBarOverlay: isMac ? undefined : { color: '#07070a', symbolColor: '#a1a1aa', height: 44 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      backgroundThrottling: false,
      devTools: !app.isPackaged
    }
  })
  mainWin.once('ready-to-show', () => mainWin?.show())
  mainWin.webContents.on('render-process-gone', (_e, d) => {
    console.error('[iloveframes] renderer gone', d.reason, d.exitCode)
    if (d.reason !== 'clean-exit') setTimeout(() => mainWin && loadRoute(mainWin, '/'), 500)
  })
  // links never open inside the app: web pages go to the browser, everything else is ignored
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url) || url.startsWith('mailto:')) shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWin.webContents.on('will-navigate', (e, url) => {
    const ok = devUrl ? url.startsWith(devUrl) : url.startsWith('file:')
    if (!ok) {
      e.preventDefault()
      if (/^https?:\/\//i.test(url)) shell.openExternal(url)
    }
  })
  // a frozen editor is worth knowing about (it usually means a huge file or a GPU problem)
  let frozeAt = 0
  mainWin.on('unresponsive', () => (frozeAt = Date.now()))
  mainWin.on('responsive', () => {
    if (frozeAt) track('freeze', { ms: Date.now() - frozeAt })
    frozeAt = 0
  })
  mainWin.webContents.once('did-finish-load', () => {
    if (pendingOpen.length) setTimeout(() => openVideos([]), 600)
  })
  mainWin.on('closed', () => {
    mainWin = null
    controlWin?.close()
  })
  loadRoute(mainWin, '/')
}

// ---------------------------------------------------------------------------
// Media protocol with Range support (smooth seeking in <video>)
// ---------------------------------------------------------------------------
const MIME: Record<string, string> = { '.webp': 'image/webp', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.mp4': 'video/mp4', '.webm': 'video/webm', '.jpg': 'image/jpeg', '.png': 'image/png', '.json': 'application/json', '.wav': 'audio/wav' }

function registerMediaProtocol() {
  protocol.handle('ilf', async (req) => {
    const url = new URL(req.url)
    // ilf://media/<abs path encoded>, or ilf://wallpaper/<file> for the wallpapers that ship with the app
    const rest = decodeURIComponent(url.pathname.replace(/^\//, ''))
    const file = url.hostname === 'wallpaper' ? join(bundledWallpaperDir(), basename(rest)) : rest
    if (!existsSync(file)) return new Response('not found', { status: 404 })
    const size = statSync(file).size
    const type = MIME[extname(file).toLowerCase()] || 'application/octet-stream'
    const range = req.headers.get('range')
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range)!
      const start = m[1] ? parseInt(m[1]) : 0
      const end = m[2] ? Math.min(parseInt(m[2]), size - 1) : size - 1
      const stream = Readable.toWeb(createReadStream(file, { start, end })) as any
      return new Response(stream, {
        status: 206,
        headers: { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1) }
      })
    }
    const stream = Readable.toWeb(createReadStream(file)) as any
    return new Response(stream, { headers: { 'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes' } })
  })
}

// ---------------------------------------------------------------------------
// Recording session
// ---------------------------------------------------------------------------
interface Session {
  id: string
  dir: string
  display: Display
  tracker: InputTracker
  capture: LiveCapture | null
  engine: 'native' | 'browser'
  mode: 'auto' | 'manual'
  stopping: boolean
  stopWall: number
  captureStopped: Promise<void>
  name: string
  /** recorded area as fractions of the display, or null for the full screen */
  area: CropFrac | null
}
let rec: Session | null = null
let areaWin: BrowserWindow | null = null

/** Area in DIPs relative to the display -> fractions, clamped and at least 64 px. */
function toFrac(display: Display, a?: { x: number; y: number; w: number; h: number } | null): CropFrac | null {
  if (!a) return null
  const W = display.size.width
  const H = display.size.height
  const x = Math.max(0, Math.min(a.x, W - 64))
  const y = Math.max(0, Math.min(a.y, H - 64))
  const w = Math.max(64, Math.min(a.w, W - x))
  const h = Math.max(64, Math.min(a.h, H - y))
  if (w >= W - 2 && h >= H - 2) return null // the whole screen is just "full screen"
  return { x: x / W, y: y / H, w: w / W, h: h / H }
}

/** A thin outline around the recorded area. Excluded from the capture, ignores the mouse. */
function showAreaOutline(display: Display, f: CropFrac) {
  const b = display.bounds
  const pad = 3
  const r = { x: Math.round(b.x + f.x * b.width) - pad, y: Math.round(b.y + f.y * b.height) - pad, width: Math.round(f.w * b.width) + pad * 2, height: Math.round(f.h * b.height) + pad * 2 }
  areaWin = new BrowserWindow({
    ...r, frame: false, transparent: true, resizable: false, movable: false, focusable: false, skipTaskbar: true, hasShadow: false, alwaysOnTop: true, show: false,
    webPreferences: { sandbox: true }
  })
  areaWin.setIgnoreMouseEvents(true)
  areaWin.setAlwaysOnTop(true, 'screen-saver')
  areaWin.setContentProtection(true)
  areaWin.loadURL('data:text/html,' + encodeURIComponent(
    '<html><body style="margin:0;background:transparent;overflow:hidden"><div style="position:fixed;inset:0;border:2px dashed rgba(255,77,141,.9);border-radius:6px;box-shadow:0 0 0 1px rgba(0,0,0,.35)"></div></body></html>'
  ))
  areaWin.once('ready-to-show', () => {
    areaWin?.showInactive()
    areaWin?.setContentProtection(true)
  })
  areaWin.on('closed', () => (areaWin = null))
}

function displayFor(id: string | number): Display {
  return screen.getAllDisplays().find((d) => String(d.id) === String(id)) ?? screen.getPrimaryDisplay()
}

async function showCountdown(display: Display, seconds: number) {
  if (seconds <= 0) return
  const b = display.bounds
  const w = new BrowserWindow({
    x: b.x, y: b.y, width: b.width, height: b.height,
    transparent: true, frame: false, alwaysOnTop: true, skipTaskbar: true, focusable: false,
    resizable: false, hasShadow: false, show: false,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false, devTools: !app.isPackaged }
  })
  w.setContentProtection(true)
  w.setIgnoreMouseEvents(true)
  w.setAlwaysOnTop(true, 'screen-saver')
  loadRoute(w, `/countdown?n=${seconds}`)
  await new Promise<void>((r) => w.once('ready-to-show', () => r()))
  w.showInactive()
  w.setContentProtection(true) // must be applied after show on Windows to exclude from capture
  await new Promise((r) => setTimeout(r, seconds * 1000 + 150))
  w.destroy()
  await new Promise((r) => setTimeout(r, 120))
}

function openControlBar(display: Display, startWall: number) {
  // a slim vertical pill on the right edge, out of the way of what you're showing
  const W = 84
  const H = 324
  const b = display.workArea
  controlWin = new BrowserWindow({
    x: Math.round(b.x + b.width - W - 12),
    y: Math.round(b.y + b.height / 2 - H / 2),
    width: W, height: H, frame: false, transparent: true, resizable: false, alwaysOnTop: true,
    skipTaskbar: true, hasShadow: false, minimizable: false, maximizable: false, fullscreenable: false, show: false,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false, devTools: !app.isPackaged }
  })
  controlWin.setContentProtection(true)
  controlWin.setAlwaysOnTop(true, 'screen-saver')
  // macOS: without skipTransformProcessType the Dock icon blinks away and the app loses focus
  controlWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
  loadRoute(controlWin, `/controlbar?start=${startWall}`)
  controlWin.once('ready-to-show', () => {
    controlWin?.showInactive()
    controlWin?.setContentProtection(true) // after show, or Windows still captures it
  })
  controlWin.on('closed', () => (controlWin = null))
  // clicks on the bar aren't part of the demo, wherever it has been dragged to
  if (rec) rec.tracker.ignoreRects = () => (controlWin && !controlWin.isDestroyed() ? [controlWin.getBounds()] : [])
}

/**
 * A menu-bar (macOS) / tray (Windows) item while recording: the elapsed time
 * and Stop / Discard, always reachable even if the floating bar is in the way
 * or has been dragged off screen.
 */
let recTray: Tray | null = null
let recTrayTimer: ReturnType<typeof setInterval> | null = null
function showRecordingTray(startWall: number) {
  try {
    const base = nativeImage.createFromPath(app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(__dirname, '../../resources/icon.png'))
    const img = base.isEmpty() ? nativeImage.createEmpty() : base.resize({ width: isMac ? 18 : 16, height: isMac ? 18 : 16 })
    recTray = new Tray(img)
    const menu = Menu.buildFromTemplate([
      { label: `Stop recording (${isMac ? '⌘' : 'Ctrl'}+Shift+2)`, click: () => beginStop() },
      { label: 'Discard recording', click: () => ipcMain.emit('rec:cancel') },
      { type: 'separator' },
      { label: 'Recording… iloveframes', enabled: false }
    ])
    recTray.setContextMenu(menu)
    recTray.setToolTip('iloveframes is recording. Click to stop.')
    if (!isMac) recTray.on('click', () => beginStop())
    const tick = () => {
      const sec = Math.max(0, Math.round((Date.now() - startWall) / 1000))
      if (isMac) recTray?.setTitle(` ● ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`)
    }
    tick()
    recTrayTimer = setInterval(tick, 1000)
  } catch (err) {
    trackError('tray', err)
  }
}
function hideRecordingTray() {
  if (recTrayTimer) clearInterval(recTrayTimer)
  recTrayTimer = null
  try {
    recTray?.destroy()
  } catch {}
  recTray = null
}

async function beginStop() {
  if (!rec || rec.stopping) return
  rec.stopping = true
  rec.stopWall = Date.now()
  rec.tracker.stop()
  globalShortcut.unregister('CommandOrControl+Shift+2')
  hideRecordingTray()
  controlWin?.close()
  areaWin?.close()
  // stop the screen capture right away, before any iloveframes window comes back
  rec.captureStopped = rec.capture ? rec.capture.stop() : Promise.resolve()
  // tell the main renderer to flush camera/mic recorders, it then calls rec:finalize
  mainWin?.webContents.send('rec:stop')
}

/** macOS privacy state that decides whether a recording can work at all. */
function macPerms() {
  if (!isMac) return null
  return {
    screen: systemPreferences.getMediaAccessStatus('screen'),
    camera: systemPreferences.getMediaAccessStatus('camera'),
    microphone: systemPreferences.getMediaAccessStatus('microphone'),
    accessibility: systemPreferences.isTrustedAccessibilityClient(false)
  }
}
const SCREEN_DENIED =
  'iloveframes needs Screen Recording permission. Open System Settings → Privacy & Security → Screen & System Audio Recording, turn on iloveframes, then quit and reopen the app.'

ipcMain.handle('rec:prepare', async (_e, opts: { displayId: string; countdown: number; mode: 'auto' | 'manual'; fps: number; area?: { x: number; y: number; w: number; h: number } | null }) => {
  requireUnlocked()
  // a take whose finishing step never arrived (renderer reloaded mid-stop) shouldn't block recording forever
  if (rec && rec.stopping && Date.now() - rec.stopWall > 120_000) rec = null
  if (rec) throw new Error('Already recording')
  const perms = macPerms()
  if (perms) {
    track('mac_permissions', { screen: perms.screen, camera: perms.camera, mic: perms.microphone, ax: perms.accessibility })
    // a denied screen permission makes macOS hand back only the wallpaper: stop early with a clear fix
    if (perms.screen === 'not-determined') {
      // first take on this Mac: let macOS ask now (it only applies after the app restarts)
      await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } }).catch(() => {})
      perms.screen = systemPreferences.getMediaAccessStatus('screen')
      if (perms.screen !== 'granted') {
        track('recording_blocked', { why: 'screen_permission_asked' })
        throw new Error('Allow Screen Recording for iloveframes in the window macOS just showed (or System Settings → Privacy & Security), then quit and reopen iloveframes to record.')
      }
    }
    if (perms.screen === 'denied' || perms.screen === 'restricted') {
      track('recording_blocked', { why: 'screen_permission' })
      shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture').catch(() => {})
      throw new Error(SCREEN_DENIED)
    }
  }
  const display = displayFor(opts.displayId)
  const id = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '-' + randomUUID().slice(0, 4)
  const dir = join(projectsRoot(), id)
  await fsp.mkdir(dir, { recursive: true })
  const name = projectName(id)

  track('recording_started', { fps: opts.fps, area: !!opts.area, mode: opts.mode, countdown: opts.countdown, displays: screen.getAllDisplays().length, sf: display.scaleFactor })
  mainWin?.hide()
  try {
    await showCountdown(display, opts.countdown)

    const tracker = new InputTracker(display)
    const area = toFrac(display, opts.area)
    rec = { id, dir, display, tracker, capture: null, engine: 'native', mode: opts.mode, stopping: false, stopWall: 0, name, captureStopped: Promise.resolve(), area }
    tracker.start()
    if (isMac && !tracker.hooked) track('clicks_unavailable', { why: 'accessibility' })

    let sourceId: string | null = null
    const t0 = Date.now()
    try {
      rec.capture = await startNativeCapture(display, dir, opts.fps || 60, area ?? undefined)
      track('capture_started', { engine: 'native', ms: Date.now() - t0, fps: opts.fps })
    } catch (err: any) {
      console.warn('[iloveframes] native capture failed, falling back to browser capture', err)
      track('capture_fallback', { kind: ffmpegErrorKind(err?.message ?? ''), msg: String(err?.message ?? err).slice(-100), ms: Date.now() - t0 })
      rec.engine = 'browser'
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } })
      const src = sources.find((s) => s.display_id === String(display.id)) ?? sources[0]
      sourceId = src?.id ?? null
      if (!sourceId) throw new Error(isMac ? SCREEN_DENIED : 'Couldn’t find a screen to record.')
    }
    const startWall = rec.capture?.startWall() ?? Date.now()
    openControlBar(display, startWall)
    showRecordingTray(startWall)
    if (area) showAreaOutline(display, area)
    if (!globalShortcut.register('CommandOrControl+Shift+2', () => beginStop())) track('shortcut_taken', { key: 'stop' })
    const cap = rec.capture
    cap?.exited.then((code) => {
      if (rec && rec.capture === cap && !rec.stopping) {
        // capture died unexpectedly (display unplugged, permission revoked, disk full)
        track('capture_died', { code: code ?? -1, kind: ffmpegErrorKind(cap.log()), secs: Math.round((Date.now() - startWall) / 1000) })
        beginStop()
      }
    })
    return { id, dir, engine: rec.engine, sourceId, startWall, display: { width: display.size.width, height: display.size.height, scaleFactor: display.scaleFactor } }
  } catch (err) {
    // never leave a half-started take behind: no hidden window, no stuck "Already recording"
    trackError('rec_prepare', err)
    const r = rec
    rec = null
    r?.tracker.stop()
    r?.capture?.kill()
    hideRecordingTray()
    controlWin?.close()
    areaWin?.close()
    globalShortcut.unregister('CommandOrControl+Shift+2')
    focusMain()
    setTimeout(() => fsp.rm(dir, { recursive: true, force: true }).catch(() => {}), 1500)
    throw err
  }
})

const writeChains = new Map<string, Promise<void>>()
ipcMain.on('rec:chunk', (_e, kind: string, data: ArrayBuffer) => {
  if (!rec) return
  const file = join(rec.dir, kind + '.webm')
  const next = (writeChains.get(file) ?? Promise.resolve()).then(() => fsp.appendFile(file, Buffer.from(data))).catch(() => {})
  writeChains.set(file, next)
})

ipcMain.on('rec:request-stop', () => beginStop())

/**
 * Let the user drag out the area to record on a display. The picker is a
 * transparent window over that display; the main window steps aside meanwhile.
 * Resolves to the area in DIPs relative to the display, or null if cancelled.
 */
let picking: ((v: any) => void) | null = null
ipcMain.handle('area:pick', async (_e, displayId: string, current?: { x: number; y: number; w: number; h: number } | null) => {
  if (picking || rec) return null
  const display = displayFor(displayId)
  const b = display.bounds
  const wasVisible = !!mainWin?.isVisible()
  mainWin?.hide()
  await new Promise((r) => setTimeout(r, 180))
  const w = new BrowserWindow({
    x: b.x, y: b.y, width: b.width, height: b.height, frame: false, transparent: true, resizable: false, movable: false,
    alwaysOnTop: true, skipTaskbar: true, hasShadow: false, fullscreenable: false, show: false, enableLargerThanScreen: true,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false, devTools: !app.isPackaged }
  })
  w.setAlwaysOnTop(true, 'screen-saver')
  const q = new URLSearchParams({ w: String(b.width), h: String(b.height), sf: String(display.scaleFactor) })
  if (current) q.set('cur', JSON.stringify(current))
  loadRoute(w, '/area?' + q.toString())
  // where the picker really ended up: macOS may keep a window below the menu bar, so the
  // picked rectangle is offset by however far the window was moved from the display edge
  let offset = { x: 0, y: 0 }
  const result = await new Promise<any>((resolve) => {
    picking = (v: any) => {
      if (!w.isDestroyed()) {
        const cb = w.getContentBounds()
        offset = { x: cb.x - b.x, y: cb.y - b.y }
      }
      resolve(v)
    }
    w.once('ready-to-show', () => {
      w.setBounds(b) // re-assert the full-display frame once shown
      w.show()
      w.focus()
    })
    w.on('closed', () => resolve(null))
  })
  picking = null
  if (!w.isDestroyed()) w.destroy()
  if (wasVisible) mainWin?.show()
  if (!result) return null
  if (offset.x || offset.y) track('area_offset', { dx: offset.x, dy: offset.y })
  const x = Math.max(0, Math.round(result.x + offset.x)), y = Math.max(0, Math.round(result.y + offset.y))
  return { x, y, w: Math.round(Math.min(result.w, b.width - x)), h: Math.round(Math.min(result.h, b.height - y)), W: b.width, H: b.height }
})
ipcMain.on('area:done', (_e, area: { x: number; y: number; w: number; h: number } | null) => picking?.(area && [area.x, area.y, area.w, area.h].every(Number.isFinite) ? area : null))

ipcMain.on('rec:cancel', async () => {
  if (!rec) return
  track('recording_cancelled')
  const r = rec
  r.stopping = true
  r.tracker.stop()
  globalShortcut.unregister('CommandOrControl+Shift+2')
  hideRecordingTray()
  controlWin?.close()
  areaWin?.close()
  r.capture?.kill()
  await r.capture?.exited
  rec = null
  mainWin?.webContents.send('rec:cancelled')
  focusMain()
  setTimeout(() => fsp.rm(r.dir, { recursive: true, force: true }).catch(() => {}), 1500)
})

ipcMain.handle('rec:finalize', async (_e, meta: { cameraStart?: number; micStart?: number; screenStart?: number; hasCamera: boolean; hasMic: boolean }) => {
  if (!rec) throw new Error('No recording')
  const r = rec
  const t0 = Date.now()
  let stage = 'flush'
  const step = (label: string, name: string) => {
    stage = name
    mainWin?.webContents.send('rec:processing', label)
  }
  try {
    await Promise.all(writeChains.values())
    writeChains.clear()
    step('Finishing capture', 'capture')
    await r.captureStopped
    focusMainAfterRecording()
    const screenStart = r.engine === 'native' ? r.capture!.startWall() ?? r.stopWall : meta.screenStart ?? r.stopWall

    if (r.engine === 'browser') {
      step('Converting screen capture', 'convert')
      await runFfmpeg(['-i', join(r.dir, 'screen.webm'), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-pix_fmt', 'yuv420p', '-vf', (r.area ? cropFilter(r.area) + ',' : '') + 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-g', '60', '-an', '-movflags', '+faststart', join(r.dir, 'screen.mp4')])
      await fsp.rm(join(r.dir, 'screen.webm'), { force: true })
    }
    if (!existsSync(join(r.dir, 'screen.mp4'))) throw new Error('The screen capture is empty. Check Screen Recording permission and try again.')
    // camera and mic are extras: if one of them can't be processed, keep the take without it
    let camOk = false
    if (meta.hasCamera && existsSync(join(r.dir, 'camera.webm'))) {
      step('Processing camera', 'camera')
      camOk = await runFfmpeg(['-i', join(r.dir, 'camera.webm'), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-pix_fmt', 'yuv420p', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-g', '10', '-an', '-movflags', '+faststart', join(r.dir, 'camera.mp4')])
        .then(() => true)
        .catch((err) => (trackError('rec_camera', err, { kind: ffmpegErrorKind(err?.message) }), false))
    }
    let micOk = false
    if (meta.hasMic && existsSync(join(r.dir, 'mic.webm'))) {
      step('Processing audio', 'mic')
      micOk = await runFfmpeg(['-i', join(r.dir, 'mic.webm'), '-vn', '-ac', '2', '-ar', '48000', '-c:a', 'pcm_s16le', join(r.dir, 'mic.wav')])
        .then(() => true)
        .catch((err) => (trackError('rec_mic', err, { kind: ffmpegErrorKind(err?.message) }), false))
    }
    step('Generating preview', 'thumb')
    await runFfmpeg(['-ss', '0.5', '-i', join(r.dir, 'screen.mp4'), '-frames:v', '1', '-vf', 'scale=720:-2', '-q:v', '3', join(r.dir, 'thumb.jpg')]).catch(() => {})

    const rel = (t: number) => +((t - screenStart) / 1000).toFixed(4)
    const ev = r.tracker.events
    const duration = +((r.stopWall - screenStart) / 1000).toFixed(3)
    const camera = camOk && existsSync(join(r.dir, 'camera.mp4')) ? { file: 'camera.mp4', offset: rel(meta.cameraStart ?? screenStart) } : null
    const mic = micOk && existsSync(join(r.dir, 'mic.wav')) ? { file: 'mic.wav', offset: rel(meta.micStart ?? screenStart) } : null
    // with an area, positions are re-expressed inside that area (0..1 = its edges), so
    // smart zoom and the cinematic cursor work exactly as for a full-screen take
    const A = r.area ?? { x: 0, y: 0, w: 1, h: 1 }
    const ax = (x: number) => +((x - A.x) / A.w).toFixed(5)
    const ay = (y: number) => +((y - A.y) / A.h).toFixed(5)
    const inside = (x: number, y: number) => x >= A.x && x <= A.x + A.w && y >= A.y && y <= A.y + A.h
    const events = {
      cursor: ev.cursor.map(([t, x, y]) => [rel(t), ax(x), ay(y)]),
      cursorTypes: ev.cursorTypes.map(([t, k]) => [rel(t), k] as [number, string]),
      // clicks outside the area weren't recorded, so they shouldn't pull a zoom there
      clicks: ev.clicks.filter(([, x, y]) => inside(x, y)).map(([t, x, y, b]) => [rel(t), ax(x), ay(y), b]),
      keys: ev.keys.map(rel)
    }
    const display = {
      width: Math.round(r.display.size.width * A.w),
      height: Math.round(r.display.size.height * A.h),
      scaleFactor: r.display.scaleFactor
    }

    // one self-contained file: screen + webcam track + mic audio + all tracking data
    step('Saving recording', 'pack')
    const screenFile = `ilfsrec_${pad3(await nextNumber('rec', [projectsRoot()], true))}.mp4`
    await packRecording(r.dir, screenFile, duration, camera, mic)
    await appendRecData(join(r.dir, screenFile), {
      v: 1, recId: r.id, name: r.name, createdAt: Date.now(), duration, display, cursorBaked: r.engine === 'browser', events,
      camera: camera ? { offset: camera.offset } : null, mic: !!mic
    }).catch((e) => console.warn('[iloveframes] could not embed recording data', e))

    const project = {
      id: r.id,
      recId: r.id,
      screenFile,
      area: r.area,
      name: r.name,
      createdAt: Date.now(),
      mode: r.mode,
      engine: r.engine,
      cursorBaked: r.engine === 'browser',
      display,
      duration,
      camera,
      mic,
      events,
      edit: null
    }
    stage = 'save'
    await fsp.writeFile(join(r.dir, 'project.json'), JSON.stringify(project))
    for (const f of ['camera.webm', 'mic.webm']) await fsp.rm(join(r.dir, f), { force: true }).catch(() => {})
    track('recording_finished', {
      dur: duration, camera: !!camera, mic: !!mic, area: !!r.area, engine: r.engine, mode: r.mode,
      clicks: events.clicks.length, keys: events.keys.length, ms: Date.now() - t0,
      camLost: meta.hasCamera && !camera, micLost: meta.hasMic && !mic
    })
    return { ...project, dir: r.dir }
  } catch (err: any) {
    track('recording_failed', { stage, kind: ffmpegErrorKind(err?.message ?? ''), msg: String(err?.message ?? err).slice(-100), engine: r.engine })
    focusMainAfterRecording()
    throw err
  } finally {
    // whatever happened, the app can record again
    if (rec === r) rec = null
    writeChains.clear()
  }
})

/** Bring the main window back after a take, in front, with focus (macOS doesn't do that on show alone). */
function focusMainAfterRecording() {
  if (!mainWin) return createMainWindow()
  mainWin.show()
  mainWin.focus()
  if (isMac) app.focus({ steal: true })
}

/** Audio filter that lines a separately recorded track up with the screen (starts at 0). */
const alignAudio = (input: number, offset: number, duration: number) =>
  (offset >= 0 ? `[${input}:a]adelay=${Math.round(offset * 1000)}:all=1` : `[${input}:a]atrim=start=${(-offset).toFixed(4)},asetpts=PTS-STARTPTS`) +
  `,apad=whole_dur=${duration.toFixed(3)},atrim=end=${duration.toFixed(3)}[a]`

/**
 * Turn the raw capture into the final `ilfsrec_NNN.mp4`: the screen as the main
 * video track, the webcam as a second (non-default) video track and the mic,
 * already aligned, as the audio track. Streams are copied, only the mic is
 * encoded, so this takes a second or two. Falls back to a plain rename.
 */
async function packRecording(dir: string, screenFile: string, duration: number, camera: { file: string } | null, mic: { file: string; offset: number } | null) {
  const src = join(dir, 'screen.mp4')
  const out = join(dir, screenFile)
  const args = ['-i', src]
  const maps = ['-map', '0:v:0']
  let n = 1
  let camIdx = -1
  if (camera) {
    args.push('-i', join(dir, camera.file))
    maps.push('-map', `${n}:v:0`)
    camIdx = n++
  }
  if (mic) {
    args.push('-i', join(dir, mic.file))
    args.push('-filter_complex', alignAudio(n, mic.offset, duration))
    maps.push('-map', '[a]')
    n++
  }
  try {
    await runFfmpeg([
      ...args, ...maps, '-c:v', 'copy', ...(mic ? ['-c:a', 'aac', '-b:a', '192k', '-ar', '48000'] : []),
      '-disposition:v:0', 'default', ...(camIdx > 0 ? ['-disposition:v:1', '0'] : []),
      '-movflags', '+faststart', out
    ])
    await fsp.rm(src, { force: true })
  } catch (err) {
    console.warn('[iloveframes] packing failed, keeping the plain capture', err)
    await fsp.rm(out, { force: true }).catch(() => {})
    await fsp.rename(src, out)
  }
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------
ipcMain.handle('projects:list', () => listProjects())
async function listProjects() {
  const root = projectsRoot()
  const out: any[] = []
  for (const id of await fsp.readdir(root).catch(() => [] as string[])) {
    const pj = join(root, id, 'project.json')
    if (!existsSync(pj)) continue
    try {
      const p = JSON.parse(await fsp.readFile(pj, 'utf8'))
      // give older generic names ("Recording 8 Oct, 7:41 pm") a unique, memorable one
      if (/^Recording \d/.test(p.name)) {
        p.name = projectName(p.id, new Date(p.createdAt))
        await fsp.writeFile(pj, JSON.stringify(p))
      }
      out.push({
        id: p.id, name: p.name, createdAt: p.createdAt, duration: p.duration, mode: p.mode, dir: join(root, id),
        thumb: existsSync(join(root, id, 'thumb.jpg')) ? join(root, id, 'thumb.jpg') : null,
        kind: p.engine === 'import' ? 'video' : 'recording',
        clips: 1 + (p.sources?.length ?? 0),
        edited: !!p.edit
      })
    } catch {}
  }
  return out.sort((a, b) => b.createdAt - a.createdAt)
}

ipcMain.handle('project:load', async (_e, id: string) => {
  const dir = join(projectsRoot(), basename(id))
  const p = JSON.parse(await fsp.readFile(join(dir, 'project.json'), 'utf8'))
  return { ...p, dir }
})

let saveChain: Promise<unknown> = Promise.resolve()
ipcMain.handle('project:save', (_e, id: string, patch: any) => {
  const run = async () => {
    const file = join(projectsRoot(), basename(id), 'project.json')
    const p = JSON.parse(await fsp.readFile(file, 'utf8'))
    Object.assign(p, patch)
    await fsp.writeFile(file + '.tmp', JSON.stringify(p))
    for (let i = 0; ; i++) {
      try {
        await fsp.rename(file + '.tmp', file)
        break
      } catch (err) {
        if (i > 8) throw err
        await new Promise((r) => setTimeout(r, 40))
      }
    }
    return true
  }
  const next = saveChain.then(run, run)
  saveChain = next.catch(() => {})
  return next
})

ipcMain.handle('project:delete', async (_e, id: string) => {
  await fsp.rm(join(projectsRoot(), basename(id)), { recursive: true, force: true })
  return true
})

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
ipcMain.handle('export:choose', async (_e, _hint: string, ext: 'mp4' | 'gif') => {
  requireUnlocked()
  const dir = process.env.ILF_EXPORT_DIR || app.getPath('downloads')
  const defaultName = await peekName('vid', [dir])
  if (process.env.ILF_EXPORT_DIR) {
    await commitName('vid', defaultName)
    return join(dir, defaultName + '.' + ext) // test harness
  }
  const r = await dialog.showSaveDialog(mainWin!, {
    title: 'Export video',
    defaultPath: join(dir, defaultName + '.' + ext),
    filters: [ext === 'gif' ? { name: 'GIF', extensions: ['gif'] } : { name: 'MP4 Video', extensions: ['mp4'] }]
  })
  if (r.canceled || !r.filePath) return null
  await commitName('vid', basename(r.filePath, extname(r.filePath)))
  return r.filePath
})

/** Where an agent's export goes: Downloads, next ilfvid_NNN. Same license rule as the export dialog. */
ipcMain.handle('agent:export-target', async (_e, ext: 'mp4' | 'gif') => {
  requireUnlocked()
  const dir = process.env.ILF_EXPORT_DIR || app.getPath('downloads')
  const name = await peekName('vid', [dir])
  await commitName('vid', name)
  return join(dir, name + '.' + (ext === 'gif' ? 'gif' : 'mp4'))
})

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------
const thumbCache = new Map<string, string>()

// instant: display info + last known thumbnails
ipcMain.handle('displays:list', () => {
  const primary = screen.getPrimaryDisplay()
  return screen.getAllDisplays().map((d, i) => ({
    id: String(d.id),
    name: d.id === primary.id ? 'Main display' : `Display ${i + 1}`,
    width: Math.round(d.size.width * d.scaleFactor),
    height: Math.round(d.size.height * d.scaleFactor),
    primary: d.id === primary.id,
    thumbnail: thumbCache.get(String(d.id)) ?? null
  }))
})

// slow (screen grab): fresh thumbnails keyed by display id
ipcMain.handle('displays:thumbs', async () => {
  const displays = screen.getAllDisplays()
  try {
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 640, height: 400 } })
    displays.forEach((d, i) => {
      const src = sources.find((s) => s.display_id === String(d.id)) ?? sources[i]
      if (src && !src.thumbnail.isEmpty()) thumbCache.set(String(d.id), src.thumbnail.toDataURL())
    })
  } catch {}
  return Object.fromEntries(thumbCache)
})

ipcMain.handle('perm:status', async () => {
  if (!isMac) return { screen: 'granted', camera: 'granted', microphone: 'granted', accessibility: true }
  return {
    screen: systemPreferences.getMediaAccessStatus('screen'),
    camera: systemPreferences.getMediaAccessStatus('camera'),
    microphone: systemPreferences.getMediaAccessStatus('microphone'),
    accessibility: systemPreferences.isTrustedAccessibilityClient(false)
  }
})

/** macOS only applies a new Screen Recording permission after a restart. */
ipcMain.handle('app:relaunch', () => {
  track('app_relaunch', { why: 'permissions' })
  app.relaunch()
  app.exit(0)
})
ipcMain.handle('perm:open-settings', (_e, pane: 'screen' | 'accessibility' | 'camera' | 'microphone') => {
  if (!isMac) return
  const id = { screen: 'Privacy_ScreenCapture', accessibility: 'Privacy_Accessibility', camera: 'Privacy_Camera', microphone: 'Privacy_Microphone' }[pane] ?? 'Privacy'
  return shell.openExternal('x-apple.systempreferences:com.apple.preference.security?' + id)
})

ipcMain.handle('perm:request', async (_e, kind: 'camera' | 'microphone' | 'accessibility' | 'screen') => {
  if (!isMac) return true
  if (kind === 'accessibility') {
    const ok = systemPreferences.isTrustedAccessibilityClient(true)
    if (!ok) shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility').catch(() => {})
    return ok
  }
  if (kind === 'screen') {
    // triggers the OS prompt the first time, then deep-link to settings
    await desktopCapturer.getSources({ types: ['screen'] }).catch(() => {})
    if (systemPreferences.getMediaAccessStatus('screen') !== 'granted')
      shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture')
    return systemPreferences.getMediaAccessStatus('screen') === 'granted'
  }
  // once denied, macOS never asks again: send people to the right switch instead
  if (systemPreferences.getMediaAccessStatus(kind) === 'denied') {
    shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_' + (kind === 'camera' ? 'Camera' : 'Microphone')).catch(() => {})
    return false
  }
  return systemPreferences.askForMediaAccess(kind)
})

ipcMain.handle('shell:reveal', (_e, p: string) => shell.showItemInFolder(p))
ipcMain.handle('shell:open', (_e, p: string) => shell.openPath(p))
ipcMain.handle('app:info', () => ({ platform: process.platform, version: app.getVersion(), projectsDir: projectsRoot() }))
ipcMain.handle('file:pick-image', async () => {
  const r = await dialog.showOpenDialog(mainWin!, { properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] })
  if (r.canceled || !r.filePaths[0]) return null
  const img = nativeImage.createFromPath(r.filePaths[0])
  const s = img.getSize()
  const scaled = s.width > 3840 ? img.resize({ width: 3840 }) : img
  return scaled.toDataURL()
})

ipcMain.handle('wallpapers:list', () => listWallpapers())
ipcMain.handle('wallpapers:remove', (_e, id: string) => removeWallpaper(id))
ipcMain.handle('wallpapers:import', async (_e, group?: string, paths?: string[], names?: Record<string, string>) => {
  if (!paths) {
    const r = await dialog.showOpenDialog(mainWin!, { title: 'Add wallpapers', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] })
    if (r.canceled) return []
    paths = r.filePaths
  }
  return importWallpapers(paths, group ?? 'Library', names)
})

// ---------------------------------------------------------------------------
// Video import (as clips, or as a brand new project from your own videos)
// ---------------------------------------------------------------------------
type Progress = { label: string; p: number; i?: number; n?: number; stage?: string } | null
const sendProgress = (p: Progress) => mainWin?.webContents.send('media:progress', p)

/** The import that's running now (one at a time), so "Cancel" can stop its ffmpeg. */
let importJob: FfmpegHandle | null = null
ipcMain.handle('media:cancel-import', () => {
  cancelHandle(importJob)
  return true
})
function beginImport() {
  if (importJob) throw new Error('Another import is still running. Wait for it to finish or cancel it first.')
  importJob = newHandle()
  return importJob
}

async function pickVideos(multi: boolean) {
  const r = await dialog.showOpenDialog(mainWin!, { title: multi ? 'Choose videos to edit' : 'Import video', properties: multi ? ['openFile', 'multiSelections'] : ['openFile'], filters: [{ name: 'Video', extensions: VIDEO_EXT }] })
  return r.canceled ? [] : r.filePaths
}

/**
 * An iloveframes recording brings its tracking data along: embedded in the
 * file, or (older takes) from the project folder it lives in. Streams are
 * copied, not re-encoded, so this is quick and lossless.
 */
async function importRecording(p: string, dir: string, id: string, progress: (x: number) => void, handle?: FfmpegHandle) {
  const data = await readRecData(p)
  const sib = data ? null : await readSiblingProject(p)
  if (!data && !sib) return null
  progress(0.1)
  const file = `src-${id}.mp4`
  let camera: { file: string; offset: number } | null = null
  if (data) {
    await runFfmpeg(['-i', p, '-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy', '-movflags', '+faststart', join(dir, file)], undefined, handle)
    if (data.camera) {
      progress(0.6)
      const cam = `cam-${id}.mp4`
      const off = data.camera.offset
      await runFfmpeg(['-i', p, '-map', '0:v:1', '-c', 'copy', '-movflags', '+faststart', join(dir, cam)], undefined, handle)
        .then(() => (camera = { file: cam, offset: off }))
        .catch((err) => {
          if (err instanceof CancelledError) throw err
        })
    }
  } else {
    const mic = sib.mic && existsSync(join(sib.dir, sib.mic.file)) ? sib.mic : null
    await runFfmpeg([
      '-i', p,
      ...(mic ? ['-i', join(sib.dir, mic.file), '-filter_complex', alignAudio(1, mic.offset, sib.duration), '-map', '0:v:0', '-map', '[a]', '-c:a', 'aac', '-b:a', '192k'] : ['-map', '0:v:0']),
      '-c:v', 'copy', '-movflags', '+faststart', join(dir, file)
    ], undefined, handle)
    if (sib.camera && existsSync(join(sib.dir, sib.camera.file))) {
      progress(0.6)
      await fsp.copyFile(join(sib.dir, sib.camera.file), join(dir, `cam-${id}.mp4`))
      camera = { file: `cam-${id}.mp4`, offset: sib.camera.offset }
    }
  }
  progress(0.9)
  const info = await probeMedia(join(dir, file))
  const audioFile = info.hasAudio ? await audioSidecar(join(dir, file), handle) : null
  const src: any = data ?? sib
  return {
    file,
    duration: info.duration || src.duration,
    width: info.width,
    height: info.height,
    hasAudio: info.hasAudio,
    audioFile,
    recId: (data?.recId ?? sib.recId ?? sib.id) as string,
    track: { events: src.events, display: src.display, cursorBaked: !!src.cursorBaked },
    camera: camera as { file: string; offset: number } | null
  }
}

/**
 * One file into a project folder as `src-<id>.mp4` (+ its audio sidecar): an
 * iloveframes recording keeps its smart data, anything else is normalised.
 */
async function importOne(p: string, dir: string, id: string, label: { i: number; n: number }, handle: FfmpegHandle) {
  const base = basename(p, extname(p))
  const progress = (x: number) => sendProgress({ label: base, p: x, i: label.i, n: label.n, stage: 'Preparing' })
  progress(0)
  const t0 = Date.now()
  const size = (await fsp.stat(p).catch(() => null))?.size ?? 0
  const recImport = await importRecording(p, dir, id, progress, handle)
  if (recImport) {
    // older takes are all called "screen.mp4": name them after their project
    const name = /^screen$/i.test(base) ? ((await readSiblingProject(p))?.name?.split(' · ')[0] ?? base) : base
    track('import_finished', { kind: 'recording', ms: Date.now() - t0, mb: Math.round(size / 1048576), len: Math.round(recImport.duration) })
    return { id, name, ...recImport }
  }
  const out = join(dir, `src-${id}.mp4`)
  const v = await normalizeVideo(p, out, (x) => sendProgress({ label: base, p: x, i: label.i, n: label.n, stage: 'Converting' }), handle)
  track('import_finished', {
    kind: 'video', ms: Date.now() - t0, mb: Math.round(size / 1048576), len: Math.round(v.duration), ext: extname(p).slice(1).toLowerCase(),
    codec: v.input.vcodec, fps: Math.round(v.input.fps), h: v.input.height, rot: v.input.rotation, audio: v.hasAudio
  })
  return { id, name: base, file: `src-${id}.mp4`, duration: v.duration, width: v.width, height: v.height, hasAudio: v.hasAudio, audioFile: v.audioFile }
}

/** Clean up after a failed / cancelled import of these files into a folder. */
async function removeImported(dir: string, ids: string[]) {
  const files = await fsp.readdir(dir).catch(() => [] as string[])
  await Promise.all(files.filter((f) => ids.some((id) => f.includes(`-${id}.`) || f.includes(`-${id}.audio`))).map((f) => fsp.rm(join(dir, f), { force: true }).catch(() => {})))
}

function importFailure(err: any, where: string) {
  if (err instanceof CancelledError || importJob?.cancelled) {
    track('import_cancelled', { where })
    return null
  }
  track('import_failed', { where, kind: ffmpegErrorKind(err?.message ?? ''), msg: String(err?.message ?? err).slice(-100) })
  const kind = ffmpegErrorKind(err?.message ?? '')
  if (err instanceof UnreadableVideoError) return err
  if (kind === 'disk_full') return new Error('Your disk is full. Free up some space and try again.')
  if (kind === 'unsupported_media') return new Error('This video uses a format iloveframes can’t read. Try exporting it as MP4 (H.264) first.')
  return err instanceof Error ? err : new Error(String(err))
}

/** Run a read-modify-write of project.json on the shared save chain. */
function patchProjectFile(projectId: string, fn: (p: any) => void) {
  const run = async () => {
    const file = join(projectsRoot(), basename(projectId), 'project.json')
    const p = JSON.parse(await fsp.readFile(file, 'utf8'))
    fn(p)
    await fsp.writeFile(file + '.tmp', JSON.stringify(p))
    for (let i = 0; ; i++) {
      try {
        await fsp.rename(file + '.tmp', file)
        break
      } catch (err) {
        if (i > 8) throw err
        await new Promise((r) => setTimeout(r, 40))
      }
    }
  }
  const next = saveChain.then(run, run)
  saveChain = next.catch(() => {})
  return next
}

ipcMain.handle('media:import', async (_e, projectId: string, paths?: string[]) => {
  requireUnlocked()
  paths = (paths ?? (await pickVideos(true))).filter(isVideoPath)
  if (!paths.length) return []
  const dir = join(projectsRoot(), basename(projectId))
  const job = beginImport()
  const added: any[] = []
  const ids: string[] = []
  try {
    for (let i = 0; i < paths.length; i++) {
      const id = randomUUID().slice(0, 8)
      ids.push(id)
      added.push(await importOne(paths[i], dir, id, { i: i + 1, n: paths.length }, job))
    }
    await patchProjectFile(projectId, (pj) => (pj.sources = [...(pj.sources ?? []), ...added]))
    return added
  } catch (err) {
    await removeImported(dir, ids)
    const e = importFailure(err, 'clips')
    if (!e) return []
    throw e
  } finally {
    importJob = null
    sendProgress(null)
  }
})

/** Previous recordings, for "add from your recordings" in the editor. */
ipcMain.handle('recordings:list', async (_e, exceptId?: string) => {
  const root = projectsRoot()
  const out: any[] = []
  for (const id of await fsp.readdir(root).catch(() => [] as string[])) {
    if (id === exceptId) continue
    const pj = join(root, id, 'project.json')
    if (!existsSync(pj)) continue
    try {
      const p = JSON.parse(await fsp.readFile(pj, 'utf8'))
      const file = join(root, id, p.screenFile ?? 'screen.mp4')
      if (!existsSync(file)) continue
      const tracked = !!(p.events?.cursor?.length || p.events?.clicks?.length)
      out.push({ id: p.id, name: p.name, file, fileName: basename(file), duration: p.duration, createdAt: p.createdAt, tracked, thumb: existsSync(join(root, id, 'thumb.jpg')) ? join(root, id, 'thumb.jpg') : null })
    } catch {}
  }
  return out.sort((a, b) => b.createdAt - a.createdAt)
})

/**
 * A brand new project from your own videos. The first one becomes the main
 * video; any others are added after it as clips. An iloveframes recording
 * opens as a full project, tracking data included.
 */
ipcMain.handle('project:import-video', async (_e, paths?: string[]) => {
  requireUnlocked()
  const list = (paths ?? (await pickVideos(true))).filter(isVideoPath)
  if (!list.length) return null
  const job = beginImport()
  const id = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '-' + randomUUID().slice(0, 4)
  const dir = join(projectsRoot(), id)
  await fsp.mkdir(dir, { recursive: true }).catch((err) => {
    importJob = null
    throw err
  })
  const t0 = Date.now()
  track('project_import_started', { n: list.length })
  try {
    const first = list[0]
    const firstName = basename(first, extname(first))
    const label = { i: 1, n: list.length }
    const recImport = await importRecording(first, dir, 'main', (x) => sendProgress({ label: firstName, p: x, ...label, stage: 'Preparing' }), job)
    let project: any
    if (recImport) {
      await fsp.rename(join(dir, recImport.file), join(dir, 'screen.mp4'))
      if (recImport.audioFile) await fsp.rename(join(dir, recImport.audioFile), join(dir, 'screen.audio.m4a')).catch(() => {})
      if (recImport.camera) await fsp.rename(join(dir, recImport.camera.file), join(dir, 'camera.mp4'))
      project = {
        id, recId: recImport.recId, name: projectName(id), createdAt: Date.now(), mode: 'auto', engine: 'native', cursorBaked: recImport.track.cursorBaked,
        screenAudio: recImport.hasAudio, screenAudioFile: recImport.audioFile ? 'screen.audio.m4a' : null, display: recImport.track.display, duration: recImport.duration,
        camera: recImport.camera ? { file: 'camera.mp4', offset: recImport.camera.offset } : null, mic: null, events: recImport.track.events, edit: null, sources: []
      }
    } else {
      const v = await normalizeVideo(first, join(dir, 'screen.mp4'), (x) => sendProgress({ label: firstName, p: x, ...label, stage: 'Converting' }), job)
      track('import_finished', { kind: 'video', ms: Date.now() - t0, len: Math.round(v.duration), ext: extname(first).slice(1).toLowerCase(), codec: v.input.vcodec, fps: Math.round(v.input.fps), h: v.input.height, rot: v.input.rotation, audio: v.hasAudio })
      project = {
        id, name: firstName, createdAt: Date.now(), mode: 'manual', engine: 'import', cursorBaked: true, screenAudio: v.hasAudio, screenAudioFile: v.audioFile,
        display: { width: v.width, height: v.height, scaleFactor: 1 },
        duration: v.duration, camera: null, mic: null, events: { cursor: [], cursorTypes: [], clicks: [], keys: [] }, edit: null, sources: []
      }
    }
    // the rest of the selection follows as clips
    for (let i = 1; i < list.length; i++) project.sources.push(await importOne(list[i], dir, randomUUID().slice(0, 8), { i: i + 1, n: list.length }, job))
    if (list.length > 1) project.name = `${project.name} + ${list.length - 1} more`
    await runFfmpeg(['-ss', String(Math.min(0.5, project.duration / 2)), '-i', join(dir, 'screen.mp4'), '-frames:v', '1', '-vf', 'scale=720:-2', '-q:v', '3', join(dir, 'thumb.jpg')]).catch(() => {})
    await fsp.writeFile(join(dir, 'project.json'), JSON.stringify(project))
    track('project_imported', { n: list.length, ms: Date.now() - t0, recording: !!recImport, len: Math.round(project.duration) })
    return id
  } catch (err) {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {})
    const e = importFailure(err, 'project')
    if (!e) return null
    throw e
  } finally {
    importJob = null
    sendProgress(null)
  }
})

/**
 * Motion analysis for a plain video source (no cursor data): where on screen
 * things change over time. Cached next to the project, so it runs once.
 */
const analyzing = new Map<string, Promise<any>>()
ipcMain.handle('media:activity', async (_e, projectId: string, sourceId: string) => {
  const dir = join(projectsRoot(), basename(projectId))
  const key = dir + '|' + sourceId
  const cached = await readActivity(dir, sourceId)
  if (cached) return cached
  if (analyzing.has(key)) return analyzing.get(key)
  const run = (async () => {
    const pj = JSON.parse(await fsp.readFile(join(dir, 'project.json'), 'utf8'))
    const src = sourceId === 'main' ? { file: pj.screenFile ?? 'screen.mp4', duration: pj.duration, name: pj.name } : pj.sources?.find((x: any) => x.id === sourceId)
    if (!src) throw new Error('Unknown source')
    const t0 = Date.now()
    const handle = newHandle()
    const label = String(src.name || 'video').split(' · ')[0]
    try {
      const a = await analyzeActivity(join(dir, src.file), src.duration || 1, (p) => sendProgress({ label, p, stage: 'Finding the action' }), handle)
      await writeActivity(dir, sourceId, a)
      track('motion_analyzed', { ms: Date.now() - t0, len: Math.round(src.duration || 0), frames: a.frames.length })
      return a
    } catch (err) {
      trackError('motion_analysis', err, { kind: ffmpegErrorKind((err as any)?.message ?? '') })
      throw err
    } finally {
      sendProgress(null)
    }
  })()
  analyzing.set(key, run)
  try {
    return await run
  } finally {
    analyzing.delete(key)
  }
})

const AUDIO_EXT = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'webm']
async function probeDuration(file: string) {
  const out = await captureOutput(['-i', file])
  const m = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(out)
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0
}
ipcMain.handle('sounds:list', () => listSounds())
ipcMain.handle('sounds:remove', (_e, id: string) => removeSound(id))
ipcMain.handle('sounds:import', async (_e, paths?: string[]) => {
  if (!paths) {
    const r = await dialog.showOpenDialog(mainWin!, { title: 'Add sounds', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Audio', extensions: AUDIO_EXT }] })
    if (r.canceled) return []
    paths = r.filePaths
  }
  return importSounds(paths.filter((p) => AUDIO_EXT.includes(extname(p).slice(1).toLowerCase())), probeDuration)
})

// ---------------------------------------------------------------------------
// Licensing
// ---------------------------------------------------------------------------
ipcMain.handle('license:status', () => {
  const st = licenseStatus()
  if (st.state === 'expired') trackOnce('trial_expired', 'trial_expired')
  return st
})
ipcMain.handle('license:activate', async (_e, key: string, name: string) => {
  const r = await licenseActivate(String(key ?? ''), String(name ?? ''))
  track(r.ok ? 'license_activated' : 'license_activate_failed', r.ok ? undefined : { msg: (r as any).error })
  return r
})
ipcMain.handle('license:deactivate', async () => {
  const r = await licenseDeactivate()
  if (r.ok) track('license_deactivated')
  return r
})
ipcMain.handle('license:set-name', (_e, name: string) => licenseSetName(String(name ?? '')))
ipcMain.on('license:allowed', (e) => (e.returnValue = isUnlocked()))
ipcMain.handle('license:buy', () => {
  track('buy_click')
  return shell.openExternal(CONFIG.buyUrl)
})

// In-app feedback: posted from main so it isn't subject to page CORS rules.
ipcMain.handle('feedback:send', async (_e, f: { kind?: string; message?: string; email?: string; name?: string }) => {
  const message = String(f?.message ?? '').trim().slice(0, 4000)
  if (message.length < 3) return { ok: false, error: 'Please write a little more.' }
  track('feedback_sent', { kind: String(f?.kind ?? 'idea').slice(0, 20) })
  const body = {
    kind: String(f?.kind ?? 'idea').slice(0, 20),
    message,
    email: String(f?.email ?? '').trim().slice(0, 200),
    name: String(f?.name ?? '').trim().slice(0, 80),
    version: app.getVersion(),
    os: `${process.platform} ${process.getSystemVersion?.() ?? ''} ${process.arch}`.trim(),
    plan: licenseStatus().state
  }
  // two tries, a moment apart; failures are reported (status only) so we can see what goes wrong
  let status = 0
  let why = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await net.fetch(CONFIG.feedbackUrl, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ilf-app': app.getVersion() }, body: JSON.stringify(body) })
      if (res.ok) return { ok: true }
      status = res.status
      why = 'http'
      if (status === 429) break
    } catch (e: any) {
      why = String(e?.message || e).slice(0, 80)
    }
    await new Promise((r) => setTimeout(r, 1200))
  }
  track('feedback_failed', { status, why })
  return { ok: false, error: status === 429 ? 'That’s a lot of messages at once. Try again in a minute, or email it instead.' : status ? `Couldn’t send it (error ${status}). You can email it instead.` : 'Couldn’t reach our server. You can email it instead.' }
})

// open the user's mail app (only mailto: links)
ipcMain.handle('shell:mail', (_e, url: string) => {
  if (typeof url === 'string' && url.startsWith('mailto:')) return shell.openExternal(url)
})

ipcMain.handle('update:state', () => updateState())
ipcMain.handle('update:check', () => checkForUpdates(true))
ipcMain.handle('update:install', () => installNow())
ipcMain.handle('app:version', () => app.getVersion())

// ---------------------------------------------------------------------------
// Screenshot studio
// ---------------------------------------------------------------------------
const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif']
function imageFile(p: string) {
  const img = nativeImage.createFromPath(p)
  if (img.isEmpty()) throw new Error('Couldn’t open that image.')
  return { dataUrl: img.toDataURL(), name: basename(p, extname(p)) }
}
ipcMain.handle('shot:open', async () => {
  const r = await dialog.showOpenDialog(mainWin!, { title: 'Open screenshot', properties: ['openFile'], filters: [{ name: 'Images', extensions: IMAGE_EXT }] })
  return r.canceled || !r.filePaths[0] ? null : imageFile(r.filePaths[0])
})
ipcMain.handle('shot:load', (_e, p: string) => (IMAGE_EXT.includes(extname(p).slice(1).toLowerCase()) ? imageFile(p) : null))
ipcMain.handle('shot:paste', () => {
  const img = clipboard.readImage()
  return img.isEmpty() ? null : { dataUrl: img.toDataURL(), name: 'Pasted screenshot' }
})
ipcMain.handle('shot:save', async (_e, data: ArrayBuffer, _hint: string, ext: 'png' | 'jpg') => {
  requireUnlocked()
  const dir = process.env.ILF_EXPORT_DIR || app.getPath('downloads')
  const name = await peekName('shot', [dir])
  if (process.env.ILF_EXPORT_DIR) {
    // test harness: skip the dialog
    const f = join(dir, `${name}.${ext}`)
    await fsp.writeFile(f, Buffer.from(data))
    await commitName('shot', name)
    return f
  }
  const r = await dialog.showSaveDialog(mainWin!, {
    title: 'Export image',
    defaultPath: join(dir, `${name}.${ext}`),
    filters: [ext === 'png' ? { name: 'PNG image', extensions: ['png'] } : { name: 'JPEG image', extensions: ['jpg', 'jpeg'] }]
  })
  if (r.canceled || !r.filePath) return null
  await fsp.writeFile(r.filePath, Buffer.from(data))
  await commitName('shot', basename(r.filePath, extname(r.filePath)))
  return r.filePath
})
ipcMain.handle('shot:copy', (_e, png: ArrayBuffer) => {
  requireUnlocked()
  clipboard.writeImage(nativeImage.createFromBuffer(Buffer.from(png)))
  return true
})

const LOCKED = 'Your free trial has ended. Activate a license to keep using iloveframes.'
function requireUnlocked() {
  if (!isUnlocked()) throw new Error(LOCKED)
}

// ---------------------------------------------------------------------------
// App menu. macOS needs one for ⌘C / ⌘V / ⌘Q to work in text fields; on both
// systems it replaces Electron's default, which could reload the window mid-edit.
// ---------------------------------------------------------------------------
function buildMenu() {
  const send = (channel: string, ...args: unknown[]) => () => {
    focusMain()
    mainWin?.webContents.send(channel, ...args)
  }
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: 'about' as const },
            { label: 'Check for Updates…', click: () => checkForUpdates(true) },
            { type: 'separator' as const },
            { label: 'Account & License…', accelerator: 'Cmd+,', click: send('menu:navigate', '/account') },
            { type: 'separator' as const },
            { role: 'services' as const },
            { type: 'separator' as const },
            { role: 'hide' as const },
            { role: 'hideOthers' as const },
            { role: 'unhide' as const },
            { type: 'separator' as const },
            { role: 'quit' as const }
          ]
        }]
      : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Recording', accelerator: 'CmdOrCtrl+N', click: send('menu:navigate', '/') },
        { label: 'Edit Your Own Video…', accelerator: 'CmdOrCtrl+O', click: send('menu:import-video') },
        { label: 'Screenshot Studio', accelerator: 'CmdOrCtrl+Shift+S', click: send('menu:navigate', '/shot') },
        { type: 'separator' },
        { label: 'Open Recordings Folder', click: () => shell.openPath(projectsRoot()) },
        ...(isMac ? [{ type: 'separator' as const }, { role: 'close' as const }] : [{ type: 'separator' as const }, { role: 'quit' as const }])
      ]
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(!app.isPackaged ? [{ type: 'separator' as const }, { role: 'reload' as const }, { role: 'toggleDevTools' as const }] : [])
      ]
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'Send Feedback…', click: send('menu:feedback') },
        { label: 'iloveframes Website', click: () => shell.openExternal('https://iloveframes.app') },
        ...(isMac ? [{ label: 'Privacy & Security Settings…', click: () => shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture') }] : [])
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.whenReady().then(async () => {
  if (!hasLock) return
  // macOS: make sure the bundled ffmpeg can run before anything needs it
  prepareFfmpeg()
    .then((r) => {
      if (r.fixed.length) track('ffmpeg_fixed', { what: r.fixed.join('+') })
      if (!r.ok) track('ffmpeg_missing')
    })
    .catch(() => {})
  initAgentBridge({ window: () => mainWin, listProjects })
  await initLicense()
  initTelemetry({ license: () => { const st = licenseStatus().state; return st === 'licensed' ? 'pro' : st } })
  startAutoUpdates()
  registerMediaProtocol()
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(true))
  session.defaultSession.setPermissionCheckHandler(() => true)
  buildMenu()
  createMainWindow()
  // Windows: a video opened with iloveframes arrives as an argument on first launch
  const fromArgs = process.argv.slice(1).filter((a) => !a.startsWith('-') && isVideoPath(a) && existsSync(a))
  if (fromArgs.length) pendingOpen.push(...fromArgs)
  app.on('activate', () => {
    // Dock click: bring the editor back (never while a recording is running)
    if (rec) return
    if (!mainWin) createMainWindow()
    else focusMain()
  })
})

app.on('will-quit', () => globalShortcut.unregisterAll())
app.on('window-all-closed', () => {
  if (rec) rec.capture?.kill()
  if (!isMac) app.quit()
  else setAway(true)
})
