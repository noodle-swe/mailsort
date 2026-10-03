import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowsClockwiseIcon,
  EnvelopeSimpleIcon,
  GoogleLogoIcon,
  MicrosoftOutlookLogoIcon,
  PlusIcon,
  SparkleIcon,
  TrayIcon,
  WarningCircleIcon
} from '@phosphor-icons/react'
import { TAGS } from '../../../core/tags'
import type { Account, Provider, TaggingProgress } from '../../../core/types'
import { api } from '../lib/api'
import { ago } from '../lib/format'
import type { View } from '../App'
import { TagSwatch } from './TagChip'

interface Props {
  view: View
  onView: (v: View) => void
  accounts: Account[]
  syncing: Record<string, boolean>
  progress: TaggingProgress | null
  configured?: Record<Provider, boolean>
  onAddAccount: (p: Provider) => void
}

function NavRow({
  active,
  onClick,
  icon,
  children,
  count,
  title,
  trailing
}: {
  active: boolean
  onClick: () => void
  icon: ReactNode
  children: ReactNode
  count?: number
  title?: string
  trailing?: ReactNode
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`press flex h-8 w-full items-center gap-2.5 rounded-[10px] px-2.5 text-left text-[13px] ${active ? 'bg-selected font-medium text-ink' : 'text-ink-soft hover:bg-hover hover:text-ink'}`}
    >
      <span className="grid w-4 shrink-0 place-items-center">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {trailing}
      {!!count && <span className="text-xs text-muted tabular-nums">{count}</span>}
    </button>
  )
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="mb-1 px-2.5 text-xs font-medium text-muted">{children}</div>
}

export default function Sidebar(p: Props) {
  const counts = useQuery({ queryKey: ['counts', p.view.accountId ?? null], queryFn: () => api.tagCounts(p.view.accountId) })
  const unread = useQuery({ queryKey: ['unread'], queryFn: api.unreadCounts })
  const totalUnread = Object.values(unread.data ?? {}).reduce((a, b) => a + b, 0)
  const isAll = !p.view.accountId && !p.view.tag
  const untagged = counts.data?.Untagged ?? 0
  const pct = p.progress ? p.progress.done / Math.max(1, p.progress.total) : 0

  return (
    <aside className="glass-side fade flex w-[232px] shrink-0 flex-col gap-5 overflow-y-auto px-2 pt-3.5 pb-2.5">
      <div className="flex items-center gap-2 px-2.5">
        <span className="grid h-7 w-7 place-items-center rounded-[8px] bg-primary text-on-primary">
          <EnvelopeSimpleIcon size={16} weight="bold" />
        </span>
        <span className="text-[15px] font-semibold tracking-tight">MailSort</span>
      </div>

      <nav aria-label="Mailboxes" className="flex flex-col gap-0.5">
        <NavRow active={isAll} onClick={() => p.onView({})} icon={<TrayIcon />} count={totalUnread}>
          All inboxes
        </NavRow>
        {p.accounts.map((a) => (
          <NavRow
            key={a.id}
            active={p.view.accountId === a.id && !p.view.tag}
            onClick={() => p.onView({ accountId: a.id })}
            icon={a.provider === 'gmail' ? <GoogleLogoIcon /> : <MicrosoftOutlookLogoIcon />}
            count={unread.data?.[a.id]}
            title={`${a.email}\nLast sync: ${ago(a.lastSyncAt)}${a.lastError ? `\nProblem: ${a.lastError}` : ''}`}
            trailing={
              p.syncing[a.id] ? (
                <ArrowsClockwiseIcon size={13} className="spin text-muted" aria-label="Syncing" />
              ) : a.lastError ? (
                <WarningCircleIcon size={15} className="text-danger" aria-label="Sync problem" />
              ) : null
            }
          >
            {a.email}
          </NavRow>
        ))}
      </nav>

      <nav aria-label="Tags" className="flex flex-col gap-0.5">
        <SectionLabel>Tags</SectionLabel>
        {[...TAGS, 'Untagged' as const].map((t) => (
          <NavRow
            key={t}
            active={p.view.tag === t}
            onClick={() => p.onView({ accountId: p.view.accountId, tag: t })}
            icon={<TagSwatch tag={t} />}
            count={counts.data?.[t]}
          >
            {t}
          </NavRow>
        ))}
      </nav>

      <div className="mt-auto flex flex-col gap-3">
        <div className="px-0.5">
          <button
            onClick={() => void api.runTagging({}).catch(() => undefined)}
            disabled={!!p.progress}
            className="press flex h-9 w-full items-center justify-center gap-2 rounded-[10px] bg-primary px-3 text-[13px] font-medium text-on-primary hover:opacity-90 disabled:opacity-80"
          >
            <SparkleIcon size={15} weight="fill" />
            {p.progress ? `Tagging ${p.progress.done} of ${p.progress.total}` : 'Tag new emails'}
          </button>
          <div className="mt-1.5 h-[3px] overflow-hidden rounded-full" aria-hidden>
            {p.progress && (
              <div
                className="h-full origin-left rounded-full bg-primary transition-transform duration-300"
                style={{ transform: `scaleX(${pct})` }}
              />
            )}
          </div>
          {!p.progress && untagged > 0 && (
            <div className="-mt-0.5 text-center text-[11px] text-muted">{untagged} waiting to be tagged</div>
          )}
        </div>

        <div className="flex flex-col gap-0.5">
          <NavRow
            active={false}
            onClick={() => p.onAddAccount('gmail')}
            icon={<PlusIcon size={14} />}
            title={p.configured?.gmail === false ? 'Gmail is not set up yet (docs/SETUP.md)' : undefined}
          >
            Add Gmail account
          </NavRow>
          <NavRow
            active={false}
            onClick={() => p.onAddAccount('outlook')}
            icon={<PlusIcon size={14} />}
            title={p.configured?.outlook === false ? 'Outlook is not set up yet (docs/SETUP.md)' : undefined}
          >
            Add Outlook account
          </NavRow>
        </div>
      </div>
    </aside>
  )
}
