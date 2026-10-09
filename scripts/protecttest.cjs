const { app, BrowserWindow, screen } = require('electron')
const { execFileSync } = require('child_process')
const ff = require('ffmpeg-static')
app.whenReady().then(async () => {
  const w = new BrowserWindow({ x: 100, y: 100, width: 400, height: 300, frame: false, alwaysOnTop: true, backgroundColor: '#ff0000', show: false })
  w.setContentProtection(true)
  w.loadURL('data:text/html,<body style="background:red">')
  w.showInactive()
  await new Promise(r => setTimeout(r, 500))
  w.setContentProtection(true)
  await new Promise(r => setTimeout(r, 1000))
  const tmp = process.env.TEMP
  const grab = (name, args) => {
    const t = Date.now()
    try { execFileSync(ff, ['-hide_banner', '-loglevel', 'error', '-y', ...args, '-frames:v', '1', tmp + '/' + name + '.png']) } catch (e) { console.log(name, 'ERR', String(e.stderr || e).slice(0, 200)) }
    try {
      const out = execFileSync(ff, ['-hide_banner', '-i', tmp + '/' + name + '.png', '-vf', 'crop=200:150:200:200,signalstats,metadata=print:key=lavfi.signalstats.VAVG', '-f', 'null', '-'], { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch {}
    const r = require('child_process').spawnSync(ff, ['-hide_banner', '-i', tmp + '/' + name + '.png', '-vf', 'crop=200:150:200:200,signalstats,metadata=print:key=lavfi.signalstats.VAVG', '-f', 'null', '-'])
    const m = /VAVG=([\d.]+)/.exec(r.stderr.toString())
    console.log(name, 'VAVG(red≈240)', m && m[1], (Date.now() - t) + 'ms')
  }
  const s = screen.getPrimaryDisplay().scaleFactor
  grab('dda', ['-f', 'lavfi', '-i', 'ddagrab=output_idx=0:draw_mouse=0', '-vf', 'hwdownload,format=bgra'])
  grab('gdi', ['-f', 'gdigrab', '-draw_mouse', '0', '-i', 'desktop'])
  console.log('scale', s)
  app.quit()
})
