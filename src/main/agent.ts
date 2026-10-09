/**
 * AI agent bridge: a small local server the iloveframes MCP server talks to.
 *
 * Safety:
 *  - off until the user turns on Account -> AI agents
 *  - listens on 127.0.0.1 only, on a random port, with a random key that changes every start
 *  - rejects anything a web page could send (Origin header, wrong Host), and wrong keys
 *  - only the editing tools in ALLOWED can be called; they run through the editor's own
 *    undoable actions. Nothing here touches licenses, settings, files or code.
 */
import { app, BrowserWindow, ipcMain } from 'electron'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { randomBytes, timingSafeEqual } from 'crypto'
import { existsSync, readFileSync, rmSync } from 'fs'
import { promises as fsp } from 'fs'
import { join } from 'path'

/** Tools an agent may call. Everything else is refused before it reaches the editor. */
const ALLOWED = new Set([
  'get_status', 'list_projects', 'open_project', 'get_project', 'preview_frame', 'list_backgrounds',
  'set_background', 'set_frame', 'set_cursor', 'set_camera', 'add_zoom', 'update_zoom', 'remove_zoom',
  'auto_zoom', 'set_zoom_style', 'split', 'remove_range', 'delete_clip', 'set_transition', 'set_sound',
  'undo', 'redo', 'export_video'
])

const settingsFile = () => join(app.getPath('userData'), 'agent.json')
const bridgeFile = () => join(app.getPath('userData'), 'agent-bridge.json')

let server: Server | null = null
let token = ''
let port = 0
let win: () => BrowserWindow | null = () => null
let listProjects: () => Promise<any[]> = async () => []
let lastCall: { tool: string; at: number } | null = null
const pending = new Map<string, (r: any) => void>()

function readEnabled() {
  try {
    return !!JSON.parse(readFileSync(settingsFile(), 'utf8')).enabled
  } catch {
    return false
  }
}

/** How an agent app should launch the MCP server for this install. */
export function mcpLaunch() {
  const script = app.isPackaged ? join(process.resourcesPath, 'mcp', 'iloveframes-mcp.cjs') : join(app.getAppPath(), 'resources', 'mcp', 'iloveframes-mcp.cjs')
  return {
    // through the app itself: nothing else to install
    app: { command: process.execPath, args: app.isPackaged ? ['--mcp'] : [app.getAppPath(), '--mcp'] },
    // or with Node.js, for agents that prefer it
    node: { command: 'node', args: [script] },
    script
  }
}

export function agentStatus() {
  return { enabled: !!server, port: server ? port : null, lastCall, launch: mcpLaunch() }
}

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

function authorized(req: IncomingMessage) {
  // browsers always send Origin on cross-site POSTs; agents don't
  if (req.headers.origin) return false
  if (req.headers.host !== `127.0.0.1:${port}`) return false
  const got = Buffer.from(String(req.headers.authorization ?? ''))
  const want = Buffer.from('Bearer ' + token)
  return got.length === want.length && timingSafeEqual(got, want)
}

/** Ask the editor window to run a tool and wait for its answer. */
function runInEditor(tool: string, args: unknown, timeoutMs: number): Promise<any> {
  const w = win()
  if (!w || w.isDestroyed()) return Promise.resolve({ ok: false, error: 'The iloveframes window is closed.' })
  const id = randomBytes(8).toString('hex')
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      resolve({ ok: false, error: 'The editor took too long to answer.' })
    }, timeoutMs)
    pending.set(id, (r) => {
      clearTimeout(timer)
      resolve(r)
    })
    w.webContents.send('agent:call', { id, tool, args })
  })
}

async function handleTool(tool: string, args: any) {
  lastCall = { tool, at: Date.now() }
  win()?.webContents.send('agent:activity', lastCall)
  if (tool === 'list_projects') {
    const limit = Math.max(1, Math.min(100, Math.floor(Number(args?.limit) || 20)))
    const all = await listProjects()
    return { ok: true, result: all.slice(0, limit).map((p) => ({ id: p.id, name: p.name, seconds: +Number(p.duration).toFixed(1), created: new Date(p.createdAt).toISOString() })) }
  }
  return runInEditor(tool, args ?? {}, tool === 'export_video' ? 30 * 60_000 : 45_000)
}

function onRequest(req: IncomingMessage, res: ServerResponse) {
  if (!authorized(req)) return json(res, 403, { ok: false, error: 'Not allowed.' })
  if (req.method !== 'POST' || req.url !== '/call') return json(res, 404, { ok: false, error: 'Not found.' })
  let size = 0
  const chunks: Buffer[] = []
  req.on('data', (c: Buffer) => {
    size += c.length
    if (size > 64 * 1024) req.destroy()
    else chunks.push(c)
  })
  req.on('end', async () => {
    let body: any
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      return json(res, 400, { ok: false, error: 'Bad request.' })
    }
    const tool = String(body?.tool ?? '')
    if (!ALLOWED.has(tool)) return json(res, 400, { ok: false, error: `"${tool}" is not something agents can do in iloveframes.` })
    try {
      json(res, 200, await handleTool(tool, body.args))
    } catch (e: any) {
      json(res, 200, { ok: false, error: e?.message ?? String(e) })
    }
  })
}

async function start() {
  if (server) return
  token = randomBytes(32).toString('hex')
  const s = createServer(onRequest)
  await new Promise<void>((resolve, reject) => {
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => resolve())
  })
  server = s
  port = (s.address() as any).port
  await fsp.writeFile(bridgeFile(), JSON.stringify({ port, token, pid: process.pid }), { mode: 0o600 })
}

async function stop() {
  const s = server
  server = null
  token = ''
  if (s) await new Promise<void>((r) => s.close(() => r()))
  await fsp.rm(bridgeFile(), { force: true }).catch(() => {})
}

export async function setAgentEnabled(on: boolean) {
  await fsp.writeFile(settingsFile(), JSON.stringify({ enabled: on }))
  if (on) await start()
  else await stop()
  return agentStatus()
}

export function initAgentBridge(o: { window: () => BrowserWindow | null; listProjects: () => Promise<any[]> }) {
  win = o.window
  listProjects = o.listProjects
  ipcMain.handle('agent:status', () => agentStatus())
  ipcMain.handle('agent:set-enabled', (_e, on: boolean) => setAgentEnabled(!!on))
  ipcMain.on('agent:result', (_e, id: string, r: any) => {
    const done = pending.get(id)
    if (!done) return
    pending.delete(id)
    done(r && typeof r === 'object' ? r : { ok: false, error: 'No answer.' })
  })
  // a stale file from a crash would point agents at a dead port
  try {
    if (existsSync(bridgeFile())) rmSync(bridgeFile(), { force: true })
  } catch {}
  if (readEnabled()) start().catch((e) => console.warn('[iloveframes] agent bridge failed to start', e))
  app.on('will-quit', () => {
    server?.close()
    try {
      rmSync(bridgeFile(), { force: true })
    } catch {}
  })
}
