import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowsClockwiseIcon, CheckIcon, PaperPlaneRightIcon, StopIcon, WarningCircleIcon, XIcon } from '@phosphor-icons/react'
import type { ChatTurn } from '../../../preload/api'
import { api, useAppEvents } from '../lib/api'
import { cleanError } from '../lib/format'
import AssistantMessage from './AssistantMessage'

interface ToolActivity {
  name: string
  status: 'running' | 'ok' | 'error'
  progress?: number
  total?: number
}

interface Item {
  role: 'user' | 'assistant'
  content: string
  tools?: ToolActivity[]
  error?: string
  pending?: boolean
}

/** One label per intent: "Tag new emails" matches the sidebar button. */
const QUICK = [
  { label: 'Tag new emails', prompt: 'tag new emails' },
  { label: 'What needs my attention?', prompt: 'What needs my attention?' },
  { label: 'Interview invites this week', prompt: 'Show my interview invites from the last 7 days' }
]

const TOOL_LABEL: Record<string, string> = {
  tag_emails: 'Tagging emails',
  tag_summary: 'Summarizing tags',
  search_emails: 'Searching mail',
  get_email: 'Reading an email',
  set_tag: 'Changing tags',
  sync_mail: 'Syncing mail',
  list_accounts: 'Listing accounts'
}

export default function ChatPanel({ onClose }: { onClose: () => void }) {
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.getSettings })
  const [items, setItems] = useState<Item[]>([])
  const [input, setInput] = useState('')
  // 'pending' between sending and learning the run id, so early events are not dropped.
  const activeRun = useRef<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const busy = items.at(-1)?.pending ?? false

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [items])

  const updateLast = (fn: (it: Item) => Item) => setItems((list) => [...list.slice(0, -1), fn(list[list.length - 1])])

  useAppEvents((e) => {
    if (e.type !== 'chat' || !activeRun.current || (activeRun.current !== 'pending' && activeRun.current !== e.runId)) return
    switch (e.kind) {
      case 'token':
        updateLast((it) => ({ ...it, content: it.content + e.text }))
        break
      case 'tool-start':
        updateLast((it) => ({ ...it, tools: [...(it.tools ?? []), { name: e.name, status: 'running' }] }))
        break
      case 'tool-progress':
        updateLast((it) => ({
          ...it,
          tools: it.tools?.map((t, i, all) => (i === all.length - 1 ? { ...t, progress: e.progress, total: e.total } : t))
        }))
        break
      case 'tool-end':
        updateLast((it) => ({
          ...it,
          tools: it.tools?.map((t, i, all) => (i === all.length - 1 ? { ...t, status: e.ok ? 'ok' : 'error' } : t))
        }))
        break
      case 'done':
        activeRun.current = null
        updateLast((it) => ({ ...it, pending: false, content: it.content.trim() ? it.content : e.text }))
        break
      case 'error':
        activeRun.current = null
        updateLast((it) => ({ ...it, pending: false, error: e.error }))
        break
    }
  })

  const send = async (text: string) => {
    const content = text.trim()
    if (!content || busy) return
    const history: ChatTurn[] = items.filter((i) => !i.error && i.content).map((i) => ({ role: i.role, content: i.content }))
    setItems((list) => [...list, { role: 'user', content }, { role: 'assistant', content: '', pending: true }])
    setInput('')
    activeRun.current = 'pending'
    try {
      const runId = await api.chat([...history, { role: 'user', content }])
      if (activeRun.current === 'pending') activeRun.current = runId
    } catch (err) {
      activeRun.current = null
      updateLast((it) => ({ ...it, pending: false, error: cleanError(err) }))
    }
  }

  const stop = () => {
    const id = activeRun.current
    if (id && id !== 'pending') void api.cancelChat(id)
  }

  return (
    <aside aria-label="Assistant" className="glass fade flex w-[340px] shrink-0 flex-col overflow-hidden" style={{ ['--d' as string]: '180ms' }}>
      <header className="flex items-start justify-between px-4 pt-4 pb-3">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight">Assistant</h2>
          <p className="mt-0.5 text-xs text-muted">{settings.data ? `Ollama, ${settings.data.chatModel}` : 'Ollama'}</p>
        </div>
        <button onClick={onClose} className="press rounded-[8px] p-1 text-muted hover:bg-hover hover:text-ink" aria-label="Close assistant">
          <XIcon size={15} />
        </button>
      </header>

      <div ref={scrollRef} className="flex flex-1 flex-col gap-4 overflow-x-hidden overflow-y-auto px-4 pb-4">
        {items.length === 0 && (
          <p className="enter max-w-[34ch] text-[13px] leading-relaxed text-muted">
            Ask about your mail. The model on your Ollama PC can search, read and tag emails through MailSort's MCP tools.
          </p>
        )}
        {items.map((it, i) =>
          it.role === 'user' ? (
            <div key={i} className="enter selectable max-w-[86%] self-end rounded-[14px] rounded-br-[6px] bg-primary px-3.5 py-2 text-[13px] leading-relaxed whitespace-pre-wrap text-on-primary">
              {it.content}
            </div>
          ) : (
            <div key={i} className="enter flex min-w-0 flex-col gap-2">
              {it.tools?.map((t, j) => (
                <div key={j} className="flex items-center gap-2 text-xs text-muted">
                  {t.status === 'running' ? (
                    <ArrowsClockwiseIcon size={13} className="spin" />
                  ) : t.status === 'ok' ? (
                    <CheckIcon size={13} />
                  ) : (
                    <WarningCircleIcon size={13} className="text-danger" />
                  )}
                  <span className="tabular-nums">
                    {TOOL_LABEL[t.name] ?? t.name}
                    {t.total ? ` ${t.progress ?? 0} of ${t.total}` : ''}
                  </span>
                </div>
              ))}
              {it.content ? (
                <AssistantMessage content={it.content} />
              ) : (
                it.pending &&
                !it.tools?.length && (
                  <div className="flex gap-1.5 py-1" aria-label="Thinking">
                    <span className="skeleton h-2 w-10" />
                    <span className="skeleton h-2 w-16" />
                  </div>
                )
              )}
              {it.error && (
                <div className="selectable flex gap-2 rounded-[10px] bg-field px-3 py-2 text-[13px] leading-relaxed text-danger">
                  <WarningCircleIcon size={15} className="mt-0.5 shrink-0" />
                  {it.error}
                </div>
              )}
            </div>
          )
        )}
      </div>

      <div className="flex flex-col gap-2.5 px-3 pb-3">
        <div className="flex flex-wrap gap-1.5 px-1">
          {QUICK.map((q) => (
            <button
              key={q.label}
              disabled={busy}
              onClick={() => void send(q.prompt)}
              className="press rounded-[8px] bg-field px-2.5 py-1 text-xs text-ink-soft hover:bg-selected hover:text-ink disabled:opacity-50"
            >
              {q.label}
            </button>
          ))}
        </div>
        <div className="flex items-end gap-2 rounded-[12px] bg-field p-1.5 focus-within:bg-selected">
          <label className="sr-only" htmlFor="chat-input">
            Message the assistant
          </label>
          <textarea
            id="chat-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send(input)
              }
            }}
            rows={2}
            placeholder="Ask, or say “tag the emails”"
            className="flex-1 resize-none bg-transparent px-2 py-1 text-[13px] leading-relaxed outline-none placeholder:text-muted"
          />
          {busy ? (
            <button onClick={stop} className="press grid h-8 w-8 place-items-center rounded-[10px] bg-primary text-on-primary" aria-label="Stop">
              <StopIcon size={14} weight="fill" />
            </button>
          ) : (
            <button
              onClick={() => void send(input)}
              disabled={!input.trim()}
              className="press grid h-8 w-8 place-items-center rounded-[10px] bg-primary text-on-primary disabled:opacity-40"
              aria-label="Send"
            >
              <PaperPlaneRightIcon size={15} weight="fill" />
            </button>
          )}
        </div>
      </div>
    </aside>
  )
}
