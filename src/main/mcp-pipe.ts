import { randomBytes, timingSafeEqual } from 'node:crypto'
import { rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server, type Socket } from 'node:net'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { Core } from '../core/core'
import { endpointFile, type PipeEndpoint } from '../mcp/endpoint'
import { createMailMcpServer } from '../mcp/server'

/**
 * Local MCP endpoint for the stdio bridge (src/mcp/bridge.ts): a named pipe speaking
 * newline-delimited JSON-RPC, the same framing as stdio. The first line a client sends must be
 * the secret token from mcp-endpoint.json, which only this Windows user can read.
 */
export class PipeMcpServer {
  private server: Server | null = null
  private connections = 0
  private readonly token = randomBytes(24).toString('hex')
  private readonly pipe = `\\\\.\\pipe\\mailsort-mcp-${randomBytes(8).toString('hex')}`

  constructor(
    private readonly core: Core,
    private readonly dataDir: string,
    private readonly onConnectionsChanged: (count: number) => void = () => {}
  ) {}

  get activeConnections(): number {
    return this.connections
  }

  async start(): Promise<void> {
    const server = createServer((socket) => this.accept(socket))
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(this.pipe, () => resolve())
    })
    this.server = server
    const endpoint: PipeEndpoint = { pipe: this.pipe, token: this.token, pid: process.pid }
    writeFileSync(endpointFile(this.dataDir), JSON.stringify(endpoint), { mode: 0o600 })
  }

  stop(): void {
    this.server?.close()
    this.server = null
    rmSync(endpointFile(this.dataDir), { force: true })
  }

  private accept(socket: Socket): void {
    let buffer = Buffer.alloc(0)
    const timer = setTimeout(() => socket.destroy(), 5000)
    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk])
      const nl = buffer.indexOf(0x0a)
      if (nl < 0) {
        if (buffer.length > 1024) socket.destroy()
        return
      }
      socket.off('data', onData)
      socket.pause()
      clearTimeout(timer)
      const given = Buffer.from(buffer.subarray(0, nl).toString('utf8').trim())
      const expected = Buffer.from(this.token)
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
        socket.destroy()
        return
      }
      const rest = buffer.subarray(nl + 1)
      if (rest.length) socket.unshift(rest)
      void this.serve(socket)
    }
    socket.on('data', onData)
    socket.on('error', () => socket.destroy())
  }

  private async serve(socket: Socket): Promise<void> {
    const server = createMailMcpServer(this.core)
    const transport = new StdioServerTransport(socket, socket)
    this.connections++
    this.onConnectionsChanged(this.connections)
    socket.once('close', () => {
      void server.close()
      this.connections--
      this.onConnectionsChanged(this.connections)
    })
    await server.connect(transport)
    socket.resume()
  }
}
