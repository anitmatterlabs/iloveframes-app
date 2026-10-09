// Dev harness: launches the built app, runs a scenario, saves screenshots.
const { _electron } = require('playwright-core')
const path = require('path')
const out = process.env.SHOT_DIR || path.join(__dirname, '..', '.shots')
require('fs').mkdirSync(out, { recursive: true })
;(async () => {
  const app = await _electron.launch({ args: [path.join(__dirname, '..')], env: { ...process.env } })
  app.process().stdout.on('data', (d) => process.stdout.write('[main] ' + d))
  app.process().stderr.on('data', (d) => process.stdout.write('[main:err] ' + d))
  const win = await app.firstWindow()
  win.on('console', (m) => console.log('[renderer]', m.type(), m.text()))
  win.on('pageerror', (e) => console.log('[pageerror]', e.message))
  await win.waitForTimeout(Number(process.env.WAIT || 5000))
  const scenario = process.argv[2] || 'home'
  const mod = require('./scenarios.cjs')
  await mod[scenario](app, win, out)
  await app.close()
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
