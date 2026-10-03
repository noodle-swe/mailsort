import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { Core } from '../core/core'
import { OllamaClient, OllamaError, type OllamaMessage, type OllamaTool, type OllamaToolCall } from '../core/ollama'
import { tagDefinitionsText } from '../core/tags'
import { createMailMcpServer } from '../mcp/server'
import type { ChatEvent, ChatTurn } from '../preload/api'

const MAX_STEPS = 6
const MAX_TOOL_RESULT = 6000
const TOOL_TIMEOUT_MS = 30 * 60_000

/** Requests answered by calling a tool directly, without a model round-trip. */
const SHORTCUTS: { re: RegExp; tool: string; args: Record<string, unknown> }[] = [
  { re: /^\s*(please\s+)?(tag|sort|categori[sz]e|label|classify)\s+(all\s+)?(the\s+|my\s+|new\s+)*(e-?mails?|inbox|messages?|mail)\s*[.!]?\s*$/i, tool: 'tag_emails', args: {} },
  { re: /^\s*(show\s+)?(tag\s+)?summary\s*[.!?]?\s*$|^\s*what\s+needs\s+(my\s+)?(attention|action)\s*\??\s*$/i, tool: 'tag_summary', args: {} }
]

function systemPrompt(): string {
  return `You are the assistant inside MailSort, an email app for a job seeker with Gmail and Outlook accounts.
Use the tools to read and organize their mail. Never invent emails; only report what the tools return.
Tags:
${tagDefinitionsText()}
- When asked to tag, sort or categorize emails, call tag_emails.
- For an overview or "what needs my attention", call tag_summary.
- To find emails call search_emails; to read one call get_email with its id.
Keep answers short and use plain sentences or short lists. Today is ${new Date().toDateString()}.`
}

type Emit = (e: ChatEvent) => void

export class ChatAgent {
  private client: Client | null = null
  private tools: OllamaTool[] = []
  private readonly runs = new Map<string, AbortController>()

  constructor(private readonly core: Core) {}

  private async connect(): Promise<Client> {
    if (this.client) return this.client
    const [serverSide, clientSide] = InMemoryTransport.createLinkedPair()
    await createMailMcpServer(this.core).connect(serverSide)
    const client = new Client({ name: 'mailsort-chat', version: '0.1.0' })
    await client.connect(clientSide)
    this.tools = (await client.listTools()).tools.map((t) => ({
      type: 'function' as const,
      function: { name: t.name, description: t.description, parameters: t.inputSchema as Record<string, unknown> }
    }))
    this.client = client
    return client
  }

  cancel(runId: string): void {
    this.runs.get(runId)?.abort()
  }

  /** Starts a chat run; events stream through emit. Resolves when the run ends. */
  async run(runId: string, turns: ChatTurn[], emit: Emit): Promise<void> {
    const controller = new AbortController()
    this.runs.set(runId, controller)
    const send = (e: Record<string, unknown>) => emit({ type: 'chat', runId, ...e } as ChatEvent)
    try {
      const client = await this.connect()
      const last = turns.at(-1)?.content ?? ''
      const shortcut = SHORTCUTS.find((s) => s.re.test(last))
      if (shortcut) {
        const text = await this.callTool(client, shortcut.tool, shortcut.args, send, controller.signal)
        send({ kind: 'done', text })
        return
      }
      await this.loop(client, turns, send, controller.signal)
    } catch (err) {
      const msg =
        err instanceof OllamaError && err.kind === 'aborted'
          ? 'Stopped.'
          : /does not support tools/i.test((err as Error).message)
            ? `The chat model "${this.core.store.getSettings().chatModel}" does not support tool calling. Pick a model like qwen2.5:7b or llama3.1:8b in Settings.`
            : (err as Error).message
      send({ kind: 'error', error: msg })
    } finally {
      this.runs.delete(runId)
    }
  }

  private async loop(client: Client, turns: ChatTurn[], send: (e: Record<string, unknown>) => void, signal: AbortSignal): Promise<void> {
    const settings = this.core.store.getSettings()
    const ollama = new OllamaClient(settings.ollamaUrl)
    const messages: OllamaMessage[] = [{ role: 'system', content: systemPrompt() }, ...turns.slice(-12)]

    for (let step = 0; step < MAX_STEPS; step++) {
      let content = ''
      const toolCalls: OllamaToolCall[] = []
      for await (const chunk of ollama.chatStream(
        { model: settings.chatModel, messages, tools: this.tools, options: { temperature: 0.2, num_ctx: 8192 }, keep_alive: '30m' },
        signal
      )) {
        if (chunk.message.content) {
          content += chunk.message.content
          send({ kind: 'token', text: chunk.message.content })
        }
        if (chunk.message.tool_calls?.length) toolCalls.push(...chunk.message.tool_calls)
      }
      messages.push({ role: 'assistant', content, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) })
      if (!toolCalls.length) {
        send({ kind: 'done', text: content })
        return
      }
      for (const call of toolCalls) {
        const result = await this.callTool(client, call.function.name, call.function.arguments ?? {}, send, signal)
        messages.push({ role: 'tool', tool_name: call.function.name, content: result.slice(0, MAX_TOOL_RESULT) })
      }
    }
    send({ kind: 'done', text: '(Stopped after several tool steps. Try a more specific request.)' })
  }

  private async callTool(
    client: Client,
    name: string,
    args: Record<string, unknown>,
    send: (e: Record<string, unknown>) => void,
    signal: AbortSignal
  ): Promise<string> {
    send({ kind: 'tool-start', name, args })
    try {
      const res = await client.callTool({ name, arguments: args }, undefined, {
        signal,
        timeout: TOOL_TIMEOUT_MS,
        resetTimeoutOnProgress: true,
        onprogress: (p) => send({ kind: 'tool-progress', name, progress: p.progress, total: p.total })
      })
      const text = (res.content as { type: string; text?: string }[])
        .filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join('\n')
      send({ kind: 'tool-end', name, ok: !res.isError })
      return text
    } catch (err) {
      if (signal.aborted) throw new OllamaError('Request cancelled', 'aborted')
      send({ kind: 'tool-end', name, ok: false })
      return `Error: ${(err as Error).message}`
    }
  }
}
