import { join } from 'node:path'

/**
 * Where the running app advertises its local MCP pipe. Shared by the app and the stdio bridge,
 * so it must not import electron.
 */
export interface PipeEndpoint {
  pipe: string
  token: string
  pid: number
}

/** %APPDATA%\MailSort, or MAILSORT_DATA_DIR when set (separate profiles, testing). */
export function appDataDir(): string {
  if (process.env.MAILSORT_DATA_DIR) return process.env.MAILSORT_DATA_DIR
  const base = process.env.APPDATA ?? join(process.env.HOME ?? '.', '.config')
  return join(base, 'MailSort')
}

export function endpointFile(dataDir = appDataDir()): string {
  return join(dataDir, 'mcp-endpoint.json')
}
