import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeftIcon, ArrowUpRightIcon, CaretDownIcon, EnvelopeSimpleIcon, EnvelopeSimpleOpenIcon, ImageIcon, SparkleIcon } from '@phosphor-icons/react'
import { dateRange, DATE_PRESET_LABEL } from '../../../core/dates'
import { ACTION_TAGS, TAGS, TAG_INFO, type Tag } from '../../../core/tags'
import type { TaggingProgress } from '../../../core/types'
import { api } from '../lib/api'
import { escapeHtml, fullDate, greeting } from '../lib/format'
import type { Filters } from '../lib/filters'
import type { View } from '../App'
import backdrop from '../assets/backdrop.webp'
import Avatar from './Avatar'
import { TagSwatch } from './TagChip'

/**
 * Wraps an email body for a sandboxed srcdoc iframe: no scripts, links open in the system
 * browser (target=_blank → main process), and remote images stay blocked unless allowed.
 */
function buildSrcDoc(body: { content: string; isHtml: boolean }, allowImages: boolean): string {
  const csp = ["default-src 'none'", "style-src 'unsafe-inline'", `img-src data: cid:${allowImages ? ' https: http:' : ''}`, 'font-src data:'].join('; ')
  const head = `<meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank">
<style>body{font:14px/1.6 'Segoe UI',system-ui,sans-serif;margin:20px 24px;color:#1d2420;background:#fbfcfa;overflow-wrap:anywhere}
img{max-width:100%;height:auto}pre{white-space:pre-wrap;font:inherit;margin:0}a{color:#2f5f8f}</style>`
  return body.isHtml ? head + body.content : `${head}<pre>${escapeHtml(body.content)}</pre>`
}

type OpenView = (v: View, filters?: Filters) => void

const DIGEST_TAGS: Tag[] = ['Applied', 'Rejected', 'Meeting', 'Questions', 'Needs Attention']
const DIGEST_HEADING: Partial<Record<Tag, string>> = { 'Needs Attention': 'Attention' }
type Period = 'week' | 'lastWeek'

/** Emails per inbox and tag for this week or last week. A number opens the list already filtered to it. */
function Digest({ onView }: { onView: OpenView }) {
  const [period, setPeriod] = useState<Period>('week')
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: api.listAccounts })
  const digest = useQuery({ queryKey: ['digest', period], queryFn: () => api.digest(dateRange(period)) })
  const inboxes = accounts.data ?? []
  const count = (accountId: string | null, tag: Tag) =>
    (digest.data ?? []).filter((r) => r.tag === tag && (accountId === null || r.accountId === accountId)).reduce((n, r) => n + r.count, 0)

  const cell = (accountId: string | null, tag: Tag) => {
    const n = count(accountId, tag)
    return (
      <td key={tag} className="px-0.5 py-0.5 text-right">
        <button
          disabled={!n}
          onClick={() => onView({ accountId: accountId ?? undefined, tag }, { date: period })}
          title={n ? `Show ${tag} from ${DATE_PRESET_LABEL[period].toLowerCase()}` : undefined}
          className={`press w-full rounded-[7px] px-2 py-1 text-right tabular-nums ${n ? 'font-medium hover:bg-hover' : 'text-muted/60'}`}
        >
          {n}
        </button>
      </td>
    )
  }

  return (
    <section className="enter px-3" style={{ ['--d' as string]: '140ms' }} aria-label="Weekly digest">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <h3 className="text-[13px] font-medium text-ink-soft">Digest</h3>
        <div role="radiogroup" aria-label="Period" className="flex gap-0.5 rounded-[8px] bg-field p-0.5">
          {(['week', 'lastWeek'] as const).map((p) => (
            <button
              key={p}
              role="radio"
              aria-checked={period === p}
              onClick={() => setPeriod(p)}
              className={`press h-6 rounded-[6px] px-2.5 text-xs font-medium ${period === p ? 'bg-primary text-on-primary' : 'text-ink-soft hover:text-ink'}`}
            >
              {DATE_PRESET_LABEL[p]}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto rounded-[12px] bg-field p-1.5">
        <table className="w-full min-w-[420px] text-[13px]">
          <thead>
            <tr className="text-xs text-muted">
              <th scope="col" className="px-2 pt-1 pb-1.5 text-left font-medium">
                Inbox
              </th>
              {DIGEST_TAGS.map((t) => (
                <th key={t} scope="col" className="px-2 pt-1 pb-1.5 text-right font-medium">
                  <span className="inline-flex items-center gap-1.5">
                    <TagSwatch tag={t} />
                    {DIGEST_HEADING[t] ?? t}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {inboxes.map((a) => (
              <tr key={a.id} className="border-t border-line">
                <th scope="row" className="max-w-[180px] truncate px-2 py-1 text-left font-normal" title={a.email}>
                  {a.email}
                </th>
                {DIGEST_TAGS.map((t) => cell(a.id, t))}
              </tr>
            ))}
            {inboxes.length > 1 && (
              <tr className="border-t border-line">
                <th scope="row" className="px-2 py-1 text-left font-medium">
                  All inboxes
                </th>
                {DIGEST_TAGS.map((t) => cell(null, t))}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Overview({ onView, progress }: { onView: OpenView; progress: TaggingProgress | null }) {
  const counts = useQuery({ queryKey: ['counts', null], queryFn: () => api.tagCounts() })
  const needAction = ACTION_TAGS.reduce((n, t) => n + (counts.data?.[t] ?? 0), 0)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto">
      <div className="relative h-[44%] min-h-[220px] shrink-0 overflow-hidden rounded-[12px]">
        <img src={backdrop} alt="Green highland ridge under low cloud, with a narrow road winding below" className="absolute inset-0 h-full w-full object-cover" draggable={false} />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/15 to-transparent" />
        <div className="enter absolute right-0 bottom-0 left-0 p-6 text-white">
          <p className="text-[13px] text-white/80">{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
          <h2 className="mt-1 text-[28px] leading-tight font-semibold tracking-tight">{greeting()}</h2>
          <p className="mt-1.5 max-w-[48ch] text-[14px] text-white/85 [text-wrap:pretty]">
            {progress
              ? `Tagging your mail now: ${progress.done} of ${progress.total} done.`
              : needAction
                ? `${needAction} ${needAction === 1 ? 'email needs' : 'emails need'} a reply or a decision.`
                : 'Nothing needs your attention right now.'}
          </p>
        </div>
      </div>

      <section className="enter px-3" style={{ ['--d' as string]: '80ms' }}>
        <h3 className="mb-2.5 text-[13px] font-medium text-ink-soft">Needs your attention</h3>
        <div className="grid grid-cols-3 gap-2">
          {ACTION_TAGS.map((t) => (
            <button
              key={t}
              onClick={() => onView({ tag: t })}
              className="press flex flex-col items-start gap-1.5 rounded-[12px] bg-field px-3.5 py-3 text-left hover:bg-selected"
            >
              {/* Count first so the numbers line up even when a label wraps. */}
              <span className="text-[26px] leading-none font-semibold tracking-tight tabular-nums">{counts.data?.[t] ?? 0}</span>
              <span className="mt-1 flex items-center gap-2 text-[13px] leading-tight font-medium">
                <TagSwatch tag={t} />
                {t}
              </span>
              <span className="text-xs leading-snug text-muted">{TAG_INFO[t].meaning}</span>
            </button>
          ))}
        </div>
      </section>

      <Digest onView={onView} />
    </div>
  )
}

function BodySkeleton() {
  return (
    <div className="flex flex-col gap-3 p-6" aria-busy aria-label="Loading email">
      {[90, 75, 82, 40, 0, 88, 70].map((w, i) => (w ? <div key={i} className="skeleton h-3" style={{ width: `${w}%` }} /> : <div key={i} className="h-2" />))}
    </div>
  )
}

export default function ReadingPane({ id, onView, progress, onBack }: { id: string | null; onView: OpenView; progress: TaggingProgress | null; onBack?: () => void }) {
  const qc = useQueryClient()
  const [allowImages, setAllowImages] = useState(false)
  useEffect(() => setAllowImages(false), [id])

  const message = useQuery({ queryKey: ['message', id], queryFn: () => api.getMessage(id!), enabled: !!id })
  const body = useQuery({ queryKey: ['body', id], queryFn: () => api.getBody(id!), enabled: !!id, gcTime: 60_000 })

  const markRead = useMutation({
    mutationFn: (msgId: string) => api.markRead(msgId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['messages'] })
      void qc.invalidateQueries({ queryKey: ['unread'] })
    }
  })
  const unreadId = message.data && !message.data.isRead ? message.data.id : null
  const { mutate: markReadNow } = markRead
  // Opening marks an email read once. Without this guard, "Mark unread" would be undone at once.
  const autoRead = useRef<string | null>(null)
  useEffect(() => {
    if (unreadId && autoRead.current !== unreadId) {
      autoRead.current = unreadId
      markReadNow(unreadId)
    }
  }, [unreadId, markReadNow])

  const setRead = useMutation({
    mutationFn: (read: boolean) => api.setRead([id!], read),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['message', id] })
      void qc.invalidateQueries({ queryKey: ['messages'] })
      void qc.invalidateQueries({ queryKey: ['unread'] })
    }
  })

  const setTag = useMutation({ mutationFn: (tag: Tag) => api.setTag([id!], tag) })

  const m = message.data
  const shown = useMemo(
    () => body.data ?? (body.isError && m ? { content: m.bodyText ?? m.snippet ?? '', isHtml: false } : null),
    [body.data, body.isError, m]
  )
  const srcDoc = useMemo(() => (shown ? buildSrcDoc(shown, allowImages) : ''), [shown, allowImages])
  const hasRemoteImages = !!shown?.isHtml && /<img[^>]+src=["']?https?:/i.test(shown.content)
  const provider = m?.accountId.startsWith('gmail') ? 'Gmail' : 'Outlook'

  return (
    <main className="glass fade flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-2.5" style={{ ['--d' as string]: '120ms' }}>
      {!id ? (
        <Overview onView={onView} progress={progress} />
      ) : !m ? (
        <BodySkeleton />
      ) : (
        <div key={m.id} className="enter flex min-h-0 flex-1 flex-col">
          <header className="flex flex-col gap-3 px-3.5 pt-3 pb-4">
            {/* Actions sit above the title so a long subject always gets the full pane width. */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              {onBack ? (
                <button onClick={onBack} className="press flex h-8 items-center gap-1.5 rounded-[10px] bg-field px-3 text-[13px] font-medium hover:bg-selected">
                  <ArrowLeftIcon size={13} />
                  Back to list
                </button>
              ) : (
                <span />
              )}
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  onClick={() => setRead.mutate(!m.isRead)}
                  disabled={setRead.isPending}
                  title={m.isRead ? 'Mark as unread (u)' : 'Mark as read (u)'}
                  className="press flex h-8 items-center gap-1.5 rounded-[10px] bg-field px-3 text-[13px] font-medium hover:bg-selected disabled:opacity-60"
                >
                  {m.isRead ? <EnvelopeSimpleIcon size={14} /> : <EnvelopeSimpleOpenIcon size={14} />}
                  {m.isRead ? 'Mark unread' : 'Mark read'}
                </button>
                <label className="relative">
                  <span className="sr-only">Tag</span>
                  {m.tag && (
                    <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2">
                      <TagSwatch tag={m.tag} />
                    </span>
                  )}
                  <select
                    value={m.tag ?? ''}
                    onChange={(e) => setTag.mutate(e.target.value as Tag)}
                    title="Change the tag. MailSort learns from your changes."
                    className={`press h-8 cursor-pointer appearance-none rounded-[10px] bg-field pr-7 text-[13px] font-medium hover:bg-selected ${m.tag ? 'pl-6' : 'pl-3'}`}
                  >
                    <option value="" disabled>
                      Set tag
                    </option>
                    {TAGS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  <CaretDownIcon size={12} className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-muted" />
                </label>
                {m.webLink && (
                  <button
                    onClick={() => api.openExternal(m.webLink!)}
                    className="press flex h-8 items-center gap-1.5 rounded-[10px] bg-field px-3 text-[13px] font-medium hover:bg-selected"
                  >
                    Open in {provider}
                    <ArrowUpRightIcon size={13} />
                  </button>
                )}
              </div>
            </div>
            <h2 className="selectable line-clamp-4 text-[19px] leading-snug font-semibold tracking-tight [overflow-wrap:anywhere] [text-wrap:balance]" title={m.subject ?? undefined}>
              {m.subject || '(no subject)'}
            </h2>
            <div className="flex items-center gap-3">
              <Avatar name={m.fromName} addr={m.fromAddr} size={36} />
              <div className="selectable min-w-0 flex-1">
                <div className="truncate text-[13.5px]">
                  <span className="font-medium">{m.fromName || m.fromAddr}</span>
                  {m.fromName && <span className="text-muted"> &lt;{m.fromAddr}&gt;</span>}
                </div>
                <div className="truncate text-xs text-muted">
                  To {m.toAddrs || 'me'}, {fullDate(m.receivedAt)}
                </div>
              </div>
            </div>
            {m.tagReason && m.tagSource !== 'user' && (
              <p className="flex items-center gap-1.5 text-xs text-muted">
                <SparkleIcon size={13} />
                {m.tagSource === 'llm' ? 'Tagged by the model' : 'Tagged by a rule'}: {m.tagReason}
              </p>
            )}
            {hasRemoteImages && !allowImages && (
              <div className="flex items-center gap-2 rounded-[10px] bg-field px-3 py-2 text-xs text-muted">
                <ImageIcon size={15} />
                Remote images are blocked for privacy and speed.
                <button onClick={() => setAllowImages(true)} className="press ml-auto font-medium text-ink hover:underline">
                  Load images
                </button>
              </div>
            )}
          </header>
          <div className="min-h-0 flex-1 overflow-hidden rounded-[12px] bg-[#fbfcfa]">
            {shown ? (
              <iframe key={`${id}-${allowImages}`} title="Email body" sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={srcDoc} className="h-full w-full" />
            ) : body.isLoading ? (
              <BodySkeleton />
            ) : (
              <p className="p-6 text-[13px] text-[#56635c]">This email has no content.</p>
            )}
          </div>
        </div>
      )}
    </main>
  )
}
