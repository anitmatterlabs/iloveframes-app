// Unsigned builds: ad-hoc sign the macOS bundle so Apple Silicon will launch it.
const { execSync } = require('child_process')
const path = require('path')
exports.default = async function (ctx) {
  if (ctx.electronPlatformName !== 'darwin') return
  const app = path.join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.app`)
  execSync(`codesign --force --deep --sign - "${app}"`, { stdio: 'inherit' })
}
