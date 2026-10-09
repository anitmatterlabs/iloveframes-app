const { app, BrowserWindow } = require('electron')
if (process.env.FLAGS) for (const f of process.env.FLAGS.split(' ')) { const [k, v] = f.split('='); app.commandLine.appendSwitch(k, v) }
app.whenReady().then(async () => {
  console.log('status', JSON.stringify(app.getGPUFeatureStatus()))
  const w = new BrowserWindow({ show: false })
  await w.loadURL('data:text/html,<p>x')
  const r = await w.webContents.executeJavaScript(`(async()=>{const o=[];for(const c of ['avc1.640028','avc1.42E01F','avc1.4D0028']){const s=await VideoEncoder.isConfigSupported({codec:c,width:1920,height:1080,bitrate:2e7,framerate:60,hardwareAcceleration:'prefer-hardware'});o.push(c+':'+s.supported)}return o.join(' ')})()`)
  console.log('hw', r)
  const info = await app.getGPUInfo('basic')
  console.log('gpus', JSON.stringify(info.gpuDevice.map(g => g.vendorId + ':' + g.deviceId + ':' + (g.active ? 'A' : ''))))
  app.quit()
})
