// Harden the packaged Electron binary (both Windows and macOS).
const path = require('path')
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses')

exports.default = async function (ctx) {
  const name = ctx.packager.appInfo.productFilename
  const bin =
    ctx.electronPlatformName === 'darwin'
      ? path.join(ctx.appOutDir, `${name}.app`, 'Contents', 'MacOS', name)
      : path.join(ctx.appOutDir, `${name}.exe`)
  await flipFuses(bin, {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature: ctx.electronPlatformName === 'darwin',
    [FuseV1Options.RunAsNode]: false, // can't be run as a plain Node.js script
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false, // no NODE_OPTIONS injection
    [FuseV1Options.EnableNodeCliInspectArguments]: false, // no --inspect debugger attach
    [FuseV1Options.OnlyLoadAppFromAsar]: true, // ignore loose app folders next to the binary
    [FuseV1Options.EnableCookieEncryption]: true
  })
  console.log('  • fuses flipped for', path.basename(bin))
}
