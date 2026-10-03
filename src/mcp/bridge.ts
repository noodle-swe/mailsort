/**
 * stdio MCP entry for other MCP clients (Claude Desktop, mcphost, Open WebUI, the MCP Inspector…).
 *
 * Electron's main process cannot read stdin on Windows, so MCP clients start this script in Node
 * mode instead (ELECTRON_RUN_AS_NODE=1 with the MailSort/Electron binary). It pipes stdin/stdout to
 * the running app's local MCP pipe, starting the app in the background if needed. The app stays the
 * only owner of the database, sync and encrypted tokens.
 */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { connect, type Socket } from 'node:net'
import { resolve } from 'node:path'
import { endpointFile, type PipeEndpoint } from './endpoint'

const log = (msg: string) => process.stderr.write(`[mailsort-bridge] ${msg}\n`)

function readEndpoint(): PipeEndpoint | null {
  try {
    return JSON.parse(readFileSync(endpointFile(), 'utf8')) as PipeEndpoint
  } catch {
    return null
  }
}

function tryConnect(ep: PipeEndpoint): Promise<Socket | null> {
  return new Promise((done) => {
    const socket = connect(ep.pipe)
    socket.once('connect', () => done(socket))
    socket.once('error', () => done(null))
  })
}

/** Starts the app without a window. Packaged: MailSort.exe; dev: electron.exe <project>. */
function launchApp(): void {
  // out/main/mcp-bridge.js → app root (project dir, or resources/app.asar.unpacked when packaged).
  const appRoot = resolve(__dirname, '..', '..')
  const packaged = /\.asar(\.unpacked)?$/.test(appRoot)
  const args = packaged ? ['--background'] : [appRoot, '--background']
  // Under plain Node (dev: `npm run mcp:stdio`) the electron package resolves to its binary path.
  const binary = process.versions.electron ? process.execPath : (require('electron') as unknown as string)
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(binary, args, { detached: true, stdio: 'ignore', env, windowsHide: true })
  child.unref()
}

async function connectToApp(): Promise<Socket> {
  let launched = false
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const ep = readEndpoint()
    const socket = ep ? await tryConnect(ep) : null
    if (socket && ep) {
      socket.write(ep.token + '\n')
      return socket
    }
    if (!launched) {
      log('MailSort is not running; starting it in the background')
      launchApp()
      launched = true
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error('Timed out waiting for MailSort to start')
}

connectToApp()
  .then((socket) => {
    process.stdin.pipe(socket)
    socket.pipe(process.stdout)
    process.stdin.once('end', () => socket.end())
    socket.once('close', () => process.exit(0))
    socket.once('error', (err) => {
      log(`connection error: ${err.message}`)
      process.exit(1)
    })
  })
  .catch((err: Error) => {
    log(err.message)
    process.exit(1)
  })
