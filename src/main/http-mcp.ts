import { createServer, type Server } from 'node:http'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { Core } from '../core/core'
import { createMailMcpServer } from '../mcp/server'

/**
 * Stateless Streamable HTTP endpoint at http://127.0.0.1:<port>/mcp for other MCP clients.
 * Bound to loopback only, with DNS-rebinding protection.
 */
export class HttpMcpServer {
  private server: Server | null = null
  private port = 0

  constructor(private readonly core: Core) {}

  get url(): string | null {
    return this.server ? `http://127.0.0.1:${this.port}/mcp` : null
  }

  async start(port: number): Promise<void> {
    if (this.server && this.port === port) return
    await this.stop()
    const server = createServer(async (req, res) => {
      if (!req.url?.startsWith('/mcp')) {
        res.writeHead(404).end()
        return
      }
      const mcp = createMailMcpServer(this.core)
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableDnsRebindingProtection: true,
        allowedHosts: [`127.0.0.1:${port}`, `localhost:${port}`]
      })
      res.on('close', () => {
        void transport.close()
        void mcp.close()
      })
      try {
        await mcp.connect(transport)
        await transport.handleRequest(req, res)
      } catch (err) {
        if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: (err as Error).message }, id: null }))
      }
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, '127.0.0.1', () => resolve())
    })
    this.server = server
    this.port = port
  }

  async stop(): Promise<void> {
    const s = this.server
    this.server = null
    if (s) await new Promise<void>((resolve) => s.close(() => resolve()))
  }
}
