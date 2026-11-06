import { app } from 'electron'
import { execFile, spawn } from 'child_process'
import { join, dirname } from 'path'
import { homedir, tmpdir } from 'os'
import { promises as fsp, constants as fsc } from 'fs'
import type { Platform } from './types'
import { avfoundationScreens, cropFilter, hasEncoder } from '../ffmpeg'

const run = (cmd: string, args: string[]) => new Promise<string>((resolve) => execFile(cmd, args, (_e, out) => resolve(String(out ?? ''))))

const MIRROR = join(homedir(), 'Library', 'Application Support', '.com.iloveframes.state')

/** The running iloveframes.app bundle (…/iloveframes.app). */
const appBundle = () => join(process.execPath, '..', '..', '..')
/** Single-quote a path for /bin/sh. */
const sh = (p: string) => `'${p.replace(/'/g, `'\\''`)}'`

export const mac: Platform = {
  id: 'mac',
  stopShortcutLabel: '⌘ + Shift + 2',

  async captureAttempts(_display, idx, out, fps, crop) {
    // an optional area crop runs first, then the frame is kept to even dimensions
    const even = (crop ? cropFilter(crop) + ',' : '') + 'scale=trunc(iw/2)*2:trunc(ih/2)*2'
    const common = (rate: number) => ['-g', String(rate), '-stats_period', '0.05', '-movflags', '+faststart']
    const screens = await avfoundationScreens()
    const dev = screens[idx] ?? screens[0]
    if (dev === undefined) throw new Error('No capturable screen found. Allow Screen Recording for iloveframes in System Settings → Privacy & Security, then reopen the app.')
    const input = (rate: number, pix = true) => [
      '-f', 'avfoundation', '-capture_cursor', '0', '-capture_mouse_clicks', '0', '-framerate', String(rate),
      ...(pix ? ['-pixel_format', 'nv12'] : []),
      // a little headroom so a busy machine doesn't drop the first frames
      '-thread_queue_size', '512', '-i', `${dev}:none`
    ]
    const x264 = ['-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-crf', '16', '-pix_fmt', 'yuv420p']
    const attempts: string[][] = []
    // hardware H.264 (Apple Silicon + most Intel Macs): light on the CPU while you demo
    if (await hasEncoder('h264_videotoolbox')) attempts.push([...input(fps), '-vf', even, '-c:v', 'h264_videotoolbox', '-realtime', '1', '-b:v', '40M', '-maxrate', '60M', '-pix_fmt', 'yuv420p', ...common(fps), out])
    attempts.push([...input(fps), '-vf', even, ...x264, ...common(fps), out])
    // some displays / older Macs refuse 60 fps or nv12: settle for what the device offers
    if (fps > 30) attempts.push([...input(30), '-vf', even, ...x264, ...common(30), out])
    attempts.push([...input(30, false), '-vf', even, ...x264, ...common(30), out])
    return attempts
  },

  cursorWatcher(nativeDir) {
    // the parent pid lets the helper quit by itself if the app ever goes away without stopping it
    return { cmd: '/usr/bin/osascript', args: ['-l', 'JavaScript', join(nativeDir, 'cursor-mac.js'), String(process.pid)] }
  },

  async machineId() {
    const out = await run('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'])
    const m = /"IOPlatformUUID"\s*=\s*"([\w-]+)"/.exec(out)
    return m ? m[1] : ''
  },

  async mirrorRead() {
    try {
      return (await fsp.readFile(MIRROR, 'utf8')).trim() || null
    } catch {
      return null
    }
  },

  async mirrorWrite(data) {
    await fsp.mkdir(dirname(MIRROR), { recursive: true })
    await fsp.writeFile(MIRROR, data)
  },

  updateAsset: () => (process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64'),

  async updateBlocker() {
    const bundle = appBundle()
    // Gatekeeper runs quarantined apps from a random read-only copy until they are moved
    if (bundle.includes('/AppTranslocation/')) return 'Move iloveframes to your Applications folder (drag it from the window that opened it), then open it from there to get updates automatically.'
    if (bundle.startsWith('/Volumes/')) return 'iloveframes is running from the disk image. Drag it into Applications and open it from there to get updates automatically.'
    try {
      await fsp.access(dirname(bundle), fsc.W_OK)
      await fsp.access(bundle, fsc.W_OK)
    } catch {
      return 'This Mac account can’t replace iloveframes in its current folder. Download the new version from iloveframes.app, or move the app somewhere you can write to.'
    }
    return null
  },

  async installUpdate(file, relaunch = true) {
    // file is a .zip of iloveframes.app. Unpack and check it first; the swap happens after we
    // quit, keeps the old copy until the new one is fully in place, and rolls back on failure.
    const bundle = appBundle()
    const stage = await fsp.mkdtemp(join(tmpdir(), 'ilf-update-'))
    await new Promise<void>((resolve, reject) =>
      execFile('/usr/bin/ditto', ['-x', '-k', file, stage], (e) => (e ? reject(new Error('Couldn’t unpack the update: ' + e.message)) : resolve()))
    )
    const found = (await fsp.readdir(stage)).find((n) => n.endsWith('.app'))
    if (!found) throw new Error('The update download didn’t contain the app.')
    const next = join(stage, found)
    await fsp.access(join(next, 'Contents', 'MacOS'))
    const tmpNew = bundle + '.updating'
    const tmpOld = bundle + '.previous'
    const script = [
      `while kill -0 ${process.pid} 2>/dev/null; do sleep 0.2; done`,
      `rm -rf ${sh(tmpNew)} ${sh(tmpOld)}`,
      `if /usr/bin/ditto ${sh(next)} ${sh(tmpNew)} && [ -d ${sh(tmpNew + '/Contents/MacOS')} ]; then`,
      `  mv ${sh(bundle)} ${sh(tmpOld)} && mv ${sh(tmpNew)} ${sh(bundle)} || { rm -rf ${sh(bundle)}; mv ${sh(tmpOld)} ${sh(bundle)}; }`,
      `  rm -rf ${sh(tmpOld)}`,
      `else rm -rf ${sh(tmpNew)}; fi`,
      `/usr/bin/xattr -dr com.apple.quarantine ${sh(bundle)} 2>/dev/null`,
      relaunch ? `/usr/bin/open ${sh(bundle)}` : '',
      `rm -rf ${sh(stage)}`
    ].join('\n')
    spawn('/bin/sh', ['-c', script], { detached: true, stdio: 'ignore' }).unref()
    setTimeout(() => app.exit(0), 300)
  }
}
