#!/usr/bin/env node
/**
 * Builds the signed update manifest (latest.json) for the installers in release/<version>/.
 *
 *   node scripts/release.cjs [--base https://updates.example.com/1.0.1] [--notes "What's new"]
 *
 * Upload latest.json + the listed files to your update host. latest.json must live at
 * CONFIG.updateUrl (src/main/config.ts); file URLs default to the same folder + version.
 * Re-run after adding the Mac files (built on a Mac/CI) — existing entries are merged.
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const root = path.join(__dirname, '..')
const pkg = require(path.join(root, 'package.json'))
const version = pkg.version
const dir = path.join(root, 'release', version)
const arg = (k) => {
  const i = process.argv.indexOf(k)
  return i > 0 ? process.argv[i + 1] : undefined
}
const cfg = fs.readFileSync(path.join(root, 'src/main/config.ts'), 'utf8')
const updateUrl = /updateUrl:\s*'([^']+)'/.exec(cfg)[1]
const base = (arg('--base') || updateUrl.replace(/\/[^/]*$/, '') + '/' + version).replace(/\/$/, '')
const notes = arg('--notes') || ''

const keyPath = path.join(root, 'keys', 'update-private.pem')
if (!fs.existsSync(keyPath)) throw new Error('Missing keys/update-private.pem (the update signing key).')
if (!fs.existsSync(dir)) throw new Error(`No release folder at ${dir}. Build first (npm run dist:win / dist:mac).`)

const files = fs.readdirSync(dir)
const pick = (re) => files.find((f) => re.test(f))
const wanted = {
  win: pick(new RegExp(`^${pkg.productName}-${version}-Setup\\.exe$`)),
  'mac-arm64': pick(new RegExp(`^${pkg.productName}-${version}-mac-arm64\\.zip$`)),
  'mac-x64': pick(new RegExp(`^${pkg.productName}-${version}-mac-x64\\.zip$`))
}

const outFile = path.join(dir, 'latest.json')
let assets = {}
if (fs.existsSync(outFile)) {
  try {
    assets = JSON.parse(JSON.parse(fs.readFileSync(outFile, 'utf8')).payload).assets || {}
  } catch {}
}
for (const [k, f] of Object.entries(wanted)) {
  if (!f) continue
  const buf = fs.readFileSync(path.join(dir, f))
  assets[k] = { url: `${base}/${encodeURIComponent(f)}`, sha512: crypto.createHash('sha512').update(buf).digest('base64'), size: buf.length }
}
if (!Object.keys(assets).length) throw new Error('No installers found to publish.')

const payload = JSON.stringify({ version, notes, date: new Date().toISOString(), assets })
const signature = crypto.sign(null, Buffer.from(payload, 'utf8'), crypto.createPrivateKey(fs.readFileSync(keyPath))).toString('base64')
fs.writeFileSync(outFile, JSON.stringify({ payload, signature }, null, 2))

console.log(`latest.json for ${version} → ${path.relative(root, outFile)}`)
for (const [k, a] of Object.entries(assets)) console.log(`  ${k.padEnd(10)} ${a.url}`)
console.log(`\nUpload latest.json to ${updateUrl}\nand the files above to ${base}/`)
