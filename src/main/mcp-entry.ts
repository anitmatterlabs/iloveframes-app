/**
 * `iloveframes --mcp`: speaks MCP over stdio for an AI agent and relays each tool
 * call to the running iloveframes app (see agent.ts). Opens no windows.
 */
import { app } from 'electron'
import { join } from 'path'
import { createRequire } from 'module'

app.dock?.hide()
const script = app.isPackaged ? join(process.resourcesPath, 'mcp', 'iloveframes-mcp.cjs') : join(app.getAppPath(), 'resources', 'mcp', 'iloveframes-mcp.cjs')
createRequire(__filename)(script).start()
