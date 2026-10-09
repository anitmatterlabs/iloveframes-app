/**
 * Entry point. `iloveframes --mcp` runs only the MCP relay for AI agents (stdio,
 * no windows, no second app instance); everything else starts the app.
 */
if (process.argv.includes('--mcp')) import('./mcp-entry')
else import('./index')
