// Unsigned builds: ad-hoc sign the macOS bundle so Apple Silicon will launch it.
//
// `codesign --deep` only signs nested bundles and frameworks. Loose executables
// in Resources (the bundled ffmpeg, native .node modules) keep whatever
// signature they shipped with, and on Apple Silicon a missing or broken one
// makes macOS kill them on launch ("killed: 9"): capture, import and export
// would all fail. So every Mach-O file is signed on its own first, inside out,
// then the app itself, and the result is verified.
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const MAGIC = new Set(['feedfacf', 'cffaedfe', 'feedface', 'cefaedfe', 'cafebabe', 'bebafeca'])

function isMachO(file) {
  let fd
  try {
    fd = fs.openSync(file, 'r')
    const b = Buffer.alloc(4)
    if (fs.readSync(fd, b, 0, 4, 0) < 4) return false
    return MAGIC.has(b.toString('hex'))
  } catch {
    return false
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isSymbolicLink()) continue
    if (e.isDirectory()) walk(p, out)
    else if (e.isFile() && isMachO(p)) out.push(p)
  }
  return out
}

exports.default = async function (ctx) {
  if (ctx.electronPlatformName !== 'darwin') return
  const app = path.join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.app`)
  const resources = path.join(app, 'Contents', 'Resources')
  const loose = fs.existsSync(resources) ? walk(resources) : []
  for (const f of loose) {
    try {
      fs.chmodSync(f, fs.statSync(f).mode | 0o755)
    } catch {}
    execFileSync('codesign', ['--force', '--sign', '-', '--timestamp=none', f], { stdio: 'inherit' })
    console.log('  • signed', path.relative(app, f))
  }
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', '--timestamp=none', app], { stdio: 'inherit' })
  try {
    execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app], { stdio: 'inherit' })
  } catch (e) {
    console.warn('  ! codesign verify reported a problem (build continues):', e.message)
  }
  // and the bundled ffmpeg must actually run on this architecture
  const ffmpeg = loose.find((f) => /ffmpeg-static[\\/]ffmpeg$/.test(f))
  if (ffmpeg && process.arch === (ctx.arch === 1 ? 'x64' : ctx.arch === 3 ? 'arm64' : process.arch)) {
    execFileSync(ffmpeg, ['-hide_banner', '-version'], { stdio: 'ignore' })
    console.log('  • bundled ffmpeg runs')
  }
}
