# iloveframes

Beautiful product walkthrough recordings for Windows and macOS: cursor-free capture, smooth auto-zoom, cinematic cursor, premium backgrounds, multi-clip editing and fast MP4/GIF export.

**Edit your own videos too:** Home → *Edit your own video* (or drop files on the window / the Dock icon, or File → Edit Your Own Video…). Several files become one project, in order. Any format ffmpeg reads (MP4, MOV, WebM, MKV, M4V, AVI) is converted once so it scrubs smoothly; an iloveframes recording keeps its click and cursor data. Plain videos get **motion smart zoom**: a quick analysis finds where things happen on screen (menus, typing, buttons) and adds zooms there (`src/main/media.ts`, `motionZoomSegments` in `src/renderer/src/engine/motion.ts`).

## Develop
```bash
npm install
npm run dev
```

## Build installers
- **Windows** (on Windows): `npm run dist:win` → `release/<version>/iloveframes-<version>-Setup.exe` and `-Portable.exe`
- **macOS** (needs a Mac): push this repo to GitHub, open **Actions → Build macOS → Run workflow**, download the `.dmg`/`.zip` artifacts. Or run `npm run dist:mac` on a Mac.

## Before shipping
Edit `src/main/config.ts`:
- `dodoEnv` – `'live'` for real customers (`'test'` while testing with test-mode keys)
- `dodoProductId` – optional, only accept keys for your iloveframes product
- `buyUrl` – your Dodo checkout / payment link
- `updateUrl` – where `latest.json` will be hosted

## Ship an update (OTA)
1. Bump `version` in `package.json`.
2. Build Windows (`npm run dist:win`) and macOS (GitHub Action), put the Mac `.zip` files into `release/<version>/`.
3. `npm run release -- --notes "What's new"` → writes a signed `release/<version>/latest.json`.
4. Upload `latest.json` to `updateUrl` and the installers to the folder printed by the script.

Installed apps check every 4 hours, download in the background, verify the Ed25519 signature + SHA-512, then install on restart.

**Keep `keys/update-private.pem` secret and backed up.** Without it you can't sign updates; if it leaks, someone could sign one.

## Platform code (Windows vs macOS)
One codebase, two platforms. About 95% of the app is shared; everything that differs sits behind one interface so the two builds never drift apart.

| Area | Windows | macOS | Shared |
|---|---|---|---|
| OS plumbing (capture devices, cursor watcher, machine id, licence mirror, update install) | `src/main/platform/win.ts` | `src/main/platform/mac.ts` | contract in `src/main/platform/types.ts`, picked in `platform/index.ts` |
| Cursor-shape helper | `resources/native/cursor-win.ps1` | `resources/native/cursor-mac.js` | |
| Screen capture backend | ffmpeg `ddagrab` / `gdigrab` | ffmpeg `avfoundation` | `src/main/recorder.ts`, `src/main/ffmpeg.ts` |
| Installer | NSIS `.exe` + portable `.exe` (`electron-builder.yml` → `win`, `nsis`, `portable`) | `.dmg` + `.zip`, ad-hoc signed (`mac`, `dmg`, `scripts/adhoc-sign.cjs`) | |
| CI build | `.github/workflows/build-windows.yml` | `.github/workflows/build-mac.yml` | |
| In-app update asset | `win` (Setup.exe, run silently) | `mac-arm64` / `mac-x64` (.zip, bundle swap) | signed `latest.json`, `src/main/updater.ts` |

Editor, engine, UI, licensing, recording data and export (`src/renderer`, `src/main/index.ts`, `src/main/license.ts`, `src/main/ilfdata.ts`) are identical on both.

Releases: every version is tagged `vX.Y.Z` and has a GitHub Release with the Windows and macOS files grouped separately.

## Monitoring
The app reports anonymous usage and health events to Pulse (`src/main/telemetry.ts`): capture engine and fallbacks with reasons, failed takes by stage, imports, updates, freezes, memory, React crashes. Pulse's **Health** tab shows crash-free installs, release health per version, Windows vs Mac quality, and alerts; a cron checks every 30 minutes and posts to Slack/Discord (see the pulse-analytics repo).

CI (`.github/workflows/ci.yml`) type-checks and builds every push, and packages a signed macOS app to make sure the bundled ffmpeg runs.

## macOS first launch
The app is ad-hoc signed (no Apple Developer certificate); every bundled binary (ffmpeg, native modules) is signed too (`scripts/adhoc-sign.cjs`). First launch: right-click the app → **Open**, or System Settings → Privacy & Security → **Open Anyway**. Then allow **Screen Recording** and **Accessibility** (for click capture) when asked. macOS applies Screen Recording only after a restart: Home shows a *Restart iloveframes* button for that. Move the app to Applications: copies running from Downloads or the disk image can't update themselves, and the app says so.
