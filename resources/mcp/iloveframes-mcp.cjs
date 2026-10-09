#!/usr/bin/env node
/**
 * iloveframes MCP server (stdio).
 *
 * Lets an AI agent (Claude, Cursor, ...) edit videos in the iloveframes app that
 * is open on this computer. It can only call the editing tools listed below; it
 * has no access to licenses, settings, code or files.
 *
 * How it reaches the app: when "AI agents" is turned on in iloveframes
 * (Account -> AI agents), the app listens on 127.0.0.1 and writes the port and a
 * random key to agent-bridge.json in its data folder. This server reads that
 * file and forwards each tool call. Nothing leaves the computer.
 *
 * Run with Node (`node iloveframes-mcp.cjs`) or through the app (`iloveframes --mcp`).
 * No dependencies.
 */
'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')

const VERSION = '1.0.0'
const NOT_RUNNING =
  'iloveframes is not reachable. Open the iloveframes app and turn on Account -> AI agents, then try again.'

function dataDir() {
  if (process.env.ILF_USER_DATA) return process.env.ILF_USER_DATA
  const home = os.homedir()
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'iloveframes')
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'iloveframes')
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'iloveframes')
}

function bridge() {
  try {
    const b = JSON.parse(fs.readFileSync(path.join(dataDir(), 'agent-bridge.json'), 'utf8'))
    if (b && Number.isInteger(b.port) && typeof b.token === 'string') return b
  } catch {}
  return null
}

function callApp(tool, args, timeoutMs) {
  const b = bridge()
  if (!b) return Promise.resolve({ ok: false, error: NOT_RUNNING })
  const body = JSON.stringify({ tool, args: args || {} })
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: b.port,
        path: '/call',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), Authorization: 'Bearer ' + b.token },
        timeout: timeoutMs
      },
      (res) => {
        let data = ''
        res.setEncoding('utf8')
        res.on('data', (c) => (data += c))
        res.on('end', () => {
          try {
            resolve(JSON.parse(data))
          } catch {
            resolve({ ok: false, error: 'Unexpected reply from iloveframes (HTTP ' + res.statusCode + ').' })
          }
        })
      }
    )
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', (e) => resolve({ ok: false, error: e.message === 'timeout' ? 'iloveframes took too long to answer.' : NOT_RUNNING }))
    req.end(body)
  })
}

// ---------------------------------------------------------------------------
// Tools. Times are seconds on the edited timeline; x / y are 0..1 across the recording.
// ---------------------------------------------------------------------------
const num = (description, extra) => Object.assign({ type: 'number', description }, extra || {})
const str = (description, values) => (values ? { type: 'string', enum: values, description } : { type: 'string', description })
const bool = (description) => ({ type: 'boolean', description })
const obj = (properties, required) => ({ type: 'object', properties, required: required || [], additionalProperties: false })

const TOOLS = [
  {
    name: 'get_status',
    description: 'Check that iloveframes is running and which project is open in the editor.',
    inputSchema: obj({})
  },
  {
    name: 'list_projects',
    description: 'List recordings / projects saved in iloveframes, newest first (id, name, length, date).',
    inputSchema: obj({ limit: num('How many to return (default 20, max 100).', { minimum: 1, maximum: 100 }) })
  },
  {
    name: 'open_project',
    description: 'Open a project in the editor so it can be edited. Use an id from list_projects.',
    inputSchema: obj({ id: str('Project id.') }, ['id'])
  },
  {
    name: 'get_project',
    description:
      'Describe the project open in the editor: length, clips, zooms, clicks, background, frame / device, cursor, camera, sounds and transitions. Call this before editing.',
    inputSchema: obj({})
  },
  {
    name: 'preview_frame',
    description: 'Render the edited video at a moment and return it as an image, to see what the result looks like.',
    inputSchema: obj({ time: num('Seconds into the edited video.', { minimum: 0 }) }, ['time'])
  },
  {
    name: 'list_backgrounds',
    description: 'List background choices: built-in wallpapers, gradients, solid colors and the wallpaper library (incl. macOS wallpapers).',
    inputSchema: obj({})
  },
  {
    name: 'set_background',
    description: 'Change the background behind the recording. kind=wallpaper|gradient use ids from list_backgrounds; kind=library uses a library wallpaper id; kind=solid takes a hex color.',
    inputSchema: obj(
      {
        kind: str('Background type.', ['wallpaper', 'gradient', 'solid', 'library']),
        value: str('Wallpaper / gradient / library id, or a hex color like #101014 for solid.'),
        blur: num('Blur for library photos (0-6).', { minimum: 0, maximum: 6 })
      },
      ['kind', 'value']
    )
  },
  {
    name: 'set_frame',
    description: 'Framing of the recording: aspect ratio, padding, corner radius, shadow, glass edge, and showing it on a laptop (device).',
    inputSchema: obj({
      aspect: str('Output shape.', ['16:9', '9:16', '1:1', '4:3', '4:5', 'auto']),
      padding: num('Space around the recording, 0-0.22 (0.08 is the default).', { minimum: 0, maximum: 0.22 }),
      radius: num('Corner radius in px, 0-48.', { minimum: 0, maximum: 48 }),
      shadow: num('Shadow strength 0-1.', { minimum: 0, maximum: 1 }),
      glass_edge: bool('Subtle inner highlight around the frame.'),
      device: str('Show the recording on a laptop.', ['none', 'macbook', 'laptop']),
      device_color: str('Laptop finish.', ['dark', 'light'])
    })
  },
  {
    name: 'set_cursor',
    description: 'Cinematic cursor settings.',
    inputSchema: obj({
      enabled: bool('Show the smoothed cursor.'),
      style: str('Cursor look.', ['auto', 'mac', 'light', 'ring']),
      size: num('Size multiplier 0.8-3.', { minimum: 0.8, maximum: 3 }),
      smoothing: num('Movement smoothing 0-1.', { minimum: 0, maximum: 1 }),
      click_effect: str('Effect on clicks.', ['ripple', 'pulse', 'none']),
      hide_idle: bool('Fade the cursor out when it rests.'),
      hide_typing: bool('Fade the cursor out while typing.')
    })
  },
  {
    name: 'set_camera',
    description: 'Webcam bubble settings (only matters if the recording has a webcam).',
    inputSchema: obj({
      enabled: bool('Show the webcam.'),
      shape: str('Bubble shape.', ['circle', 'rounded', 'portrait']),
      size: num('Size as a fraction of the video, 0.1-0.45.', { minimum: 0.1, maximum: 0.45 }),
      position: str('Corner: br, bl, tr, tl.', ['br', 'bl', 'tr', 'tl']),
      mirror: bool('Mirror the webcam.'),
      border: bool('White border around the bubble.'),
      shrink_on_zoom: bool('Make the bubble smaller while zoomed in.')
    })
  },
  {
    name: 'add_zoom',
    description: 'Add a zoom between start and end. By default it follows the cursor; give x and y to lock onto a spot instead.',
    inputSchema: obj(
      {
        start: num('Start, seconds.', { minimum: 0 }),
        end: num('End, seconds.', { minimum: 0 }),
        scale: num('Zoom amount 1.1-4 (2 is typical).', { minimum: 1.1, maximum: 4 }),
        x: num('Fixed point 0..1 across.', { minimum: 0, maximum: 1 }),
        y: num('Fixed point 0..1 down.', { minimum: 0, maximum: 1 })
      },
      ['start', 'end']
    )
  },
  {
    name: 'update_zoom',
    description: 'Change an existing zoom (ids come from get_project).',
    inputSchema: obj(
      {
        id: str('Zoom id.'),
        start: num('Start, seconds.', { minimum: 0 }),
        end: num('End, seconds.', { minimum: 0 }),
        scale: num('Zoom amount 1.1-4.', { minimum: 1.1, maximum: 4 }),
        follow_cursor: bool('Follow the cursor (true) or stay on x/y (false).'),
        x: num('Fixed point 0..1 across.', { minimum: 0, maximum: 1 }),
        y: num('Fixed point 0..1 down.', { minimum: 0, maximum: 1 })
      },
      ['id']
    )
  },
  {
    name: 'remove_zoom',
    description: 'Remove one zoom by id, or all zooms with all=true.',
    inputSchema: obj({ id: str('Zoom id.'), all: bool('Remove every zoom.') })
  },
  {
    name: 'auto_zoom',
    description: 'Replace the zooms with automatic ones generated from the recorded clicks.',
    inputSchema: obj({ scale: num('Zoom amount for the generated zooms (default 2).', { minimum: 1.1, maximum: 4 }) })
  },
  {
    name: 'set_zoom_style',
    description: 'How zooms move.',
    inputSchema: obj({ speed: str('Zoom in/out speed.', ['slow', 'normal', 'fast']), follow_smoothness: num('How smoothly zooms follow the cursor, 0-1.', { minimum: 0, maximum: 1 }) })
  },
  {
    name: 'split',
    description: 'Cut the video into two clips at a time.',
    inputSchema: obj({ time: num('Seconds into the edited video.', { minimum: 0 }) }, ['time'])
  },
  {
    name: 'remove_range',
    description: 'Cut out a stretch of the video (e.g. dead air) and close the gap.',
    inputSchema: obj({ start: num('Start, seconds.', { minimum: 0 }), end: num('End, seconds.', { minimum: 0 }) }, ['start', 'end'])
  },
  {
    name: 'delete_clip',
    description: 'Delete a whole clip by id (from get_project).',
    inputSchema: obj({ id: str('Clip id.') }, ['id'])
  },
  {
    name: 'set_transition',
    description: 'Transition into a clip (from the one before it), or into every cut with all=true. kind=none removes it.',
    inputSchema: obj(
      {
        clip_id: str('Clip the transition leads into.'),
        all: bool('Apply to every cut.'),
        kind: str('Transition.', ['fade', 'blur', 'zoom', 'push', 'wipe', 'dip', 'none']),
        duration: num('Seconds, 0.2-1.5.', { minimum: 0.2, maximum: 1.5 })
      },
      ['kind']
    )
  },
  {
    name: 'set_sound',
    description: 'Mic volume and the click / typing / zoom sound effects.',
    inputSchema: obj({
      mic_volume: num('Mic volume 0-2.', { minimum: 0, maximum: 2 }),
      mute: bool('Mute the mic.'),
      click_sounds: bool('Click sound effects.'),
      click_volume: num('0-1', { minimum: 0, maximum: 1 }),
      typing_sounds: bool('Typing sound effects.'),
      typing_volume: num('0-1', { minimum: 0, maximum: 1 }),
      zoom_sounds: bool('Whoosh on zooms.'),
      zoom_volume: num('0-1', { minimum: 0, maximum: 1 })
    })
  },
  {
    name: 'undo',
    description: 'Undo the last change (same as Ctrl/Cmd+Z in the editor).',
    inputSchema: obj({ steps: num('How many steps (default 1, max 20).', { minimum: 1, maximum: 20 }) })
  },
  {
    name: 'redo',
    description: 'Redo what undo took back.',
    inputSchema: obj({ steps: num('How many steps (default 1, max 20).', { minimum: 1, maximum: 20 }) })
  },
  {
    name: 'export_video',
    description:
      'Export the edited video to the Downloads folder (named ilfvid_NNN). Returns the file path when done. Uses the same rules as exporting from the app.',
    inputSchema: obj({
      format: str('File type.', ['mp4', 'gif']),
      resolution: str('Height in px.', ['720', '1080', '1440', '2160']),
      fps: str('Frames per second.', ['30', '60']),
      quality: str('Encoding quality.', ['standard', 'high', 'ultra'])
    })
  }
]
const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]))

/** Light check against the schema so obviously wrong calls fail with a clear message. */
function validate(tool, args) {
  const s = tool.inputSchema
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return 'Arguments must be an object.'
  for (const k of Object.keys(args)) if (!s.properties[k]) return `Unknown argument "${k}".`
  for (const k of s.required) if (args[k] === undefined) return `Missing "${k}".`
  for (const [k, v] of Object.entries(args)) {
    const p = s.properties[k]
    if (p.type === 'number' && (typeof v !== 'number' || !isFinite(v))) return `"${k}" must be a number.`
    if (p.type === 'boolean' && typeof v !== 'boolean') return `"${k}" must be true or false.`
    if (p.type === 'string' && typeof v !== 'string') return `"${k}" must be text.`
    if (p.enum && !p.enum.includes(v)) return `"${k}" must be one of: ${p.enum.join(', ')}.`
    if (typeof v === 'string' && v.length > 300) return `"${k}" is too long.`
  }
  return null
}

const text = (t, isError) => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError: true } : {}) })

async function callTool(name, args) {
  const tool = BY_NAME.get(name)
  if (!tool) return text(`Unknown tool "${name}".`, true)
  const err = validate(tool, args || {})
  if (err) return text(err, true)
  const r = await callApp(name, args || {}, name === 'export_video' ? 30 * 60_000 : 60_000)
  if (!r || !r.ok) return text((r && r.error) || 'Something went wrong.', true)
  if (r.image) return { content: [{ type: 'image', data: r.image, mimeType: r.mimeType || 'image/jpeg' }, ...(r.text ? [{ type: 'text', text: r.text }] : [])] }
  return text(typeof r.result === 'string' ? r.result : JSON.stringify(r.result, null, 2))
}

// ---------------------------------------------------------------------------
// JSON-RPC over stdio (one message per line)
// ---------------------------------------------------------------------------
const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n')
const reply = (id, result) => send({ jsonrpc: '2.0', id, result })
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } })

async function handle(msg) {
  const { id, method, params } = msg
  const isRequest = id !== undefined && id !== null
  try {
    switch (method) {
      case 'initialize':
        return reply(id, {
          protocolVersion: (params && params.protocolVersion) || '2025-06-18',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'iloveframes', title: 'iloveframes', version: VERSION },
          instructions:
            'Edits screen recordings in the iloveframes app on this computer. Start with get_status, then list_projects / open_project, then get_project before changing anything. Every change can be undone. Use preview_frame to look at the result, and export_video when the user is happy.'
        })
      case 'ping':
        return isRequest && reply(id, {})
      case 'tools/list':
        return reply(id, { tools: TOOLS })
      case 'tools/call':
        return reply(id, await callTool(params && params.name, (params && params.arguments) || {}))
      default:
        if (isRequest) fail(id, -32601, 'Method not found: ' + method)
    }
  } catch (e) {
    if (isRequest) fail(id, -32603, String((e && e.message) || e))
  }
}

function start() {
  let buf = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk) => {
    buf += chunk
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (!line) continue
      let msg
      try {
        msg = JSON.parse(line)
      } catch {
        send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
        continue
      }
      for (const m of Array.isArray(msg) ? msg : [msg]) handle(m)
    }
  })
  process.stdin.on('end', () => process.exit(0))
}

module.exports = { start, TOOLS }
if (require.main === module) start()
