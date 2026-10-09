# iloveframes

Beautiful product walkthrough recordings for Windows and macOS: cursor-free capture, smooth auto-zoom, cinematic cursor, premium backgrounds, multi-clip editing and fast MP4/GIF export.

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

## Platform code
OS-specific plumbing lives in `src/main/platform/win.ts` and `src/main/platform/mac.ts` behind one interface (`platform/types.ts`); the cursor-shape helpers are `resources/native/cursor-win.ps1` and `cursor-mac.js`. Features are identical on both.

## macOS first launch
The app is ad-hoc signed (no Apple Developer certificate). First launch: right-click the app → **Open**, or System Settings → Privacy & Security → **Open Anyway**. Then allow **Screen Recording** and **Accessibility** (for click capture) when asked.
