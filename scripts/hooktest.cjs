const { app } = require('electron')
app.whenReady().then(() => {
  try {
    const { uIOhook } = require('uiohook-napi')
    let n = 0
    uIOhook.on('keydown', (e) => { n++; console.log('key', e.keycode) })
    uIOhook.on('mousedown', (e) => console.log('down', e.x, e.y))
    uIOhook.start()
    console.log('hook started')
    require('child_process').exec('powershell -Command "Add-Type -AssemblyName System.Windows.Forms; Start-Sleep -m 500; [System.Windows.Forms.SendKeys]::SendWait(\'+\')"')
    setTimeout(() => { console.log('total keys', n); uIOhook.stop(); app.quit() }, 4000)
  } catch (e) { console.log('ERR', e); app.quit() }
})
