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
  /** Narrow icon rail instead of the full sidebar. */
  collapsed: boolean
}

function NavRow({
  active,
  onClick,
  icon,
  children,
  count,
  title,
  trailing,
  badge
}: {
  active: boolean
  onClick: () => void
  icon: ReactNode
  children: ReactNode
  count?: number
  title?: string
  trailing?: ReactNode
  /** In the collapsed rail, show a dot on the icon when there is something to read. */
  badge?: boolean
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      aria-label={typeof children === 'string' ? children : undefined}
      className={`press flex h-8 w-full items-center gap-2.5 rounded-[10px] px-2.5 text-left text-[13px] group-data-[compact=true]/side:justify-center group-data-[compact=true]/side:gap-0 ${active ? 'bg-selected font-medium text-ink' : 'text-ink-soft hover:bg-hover hover:text-ink'}`}
    >
      <span className="relative grid w-4 shrink-0 place-items-center">
        {icon}
        {badge && !!count && <span className="absolute -top-1 -right-1.5 hidden h-2 w-2 rounded-full bg-primary group-data-[compact=true]/side:block" aria-hidden />}
      </span>
      <span className="min-w-0 flex-1 truncate transition-opacity duration-200 group-data-[compact=true]/side:hidden">{children}</span>
      <span className="flex items-center gap-2 group-data-[compact=true]/side:hidden">
        {trailing}
        {!!count && <span className="text-xs text-muted tabular-nums">{count}</span>}
      </span>
    </button>
  )
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="mb-1 px-2.5 text-xs font-medium text-muted">{children}</div>
}

export default function Sidebar(p: Props) {
  const collapsed = p.collapsed
  const counts = useQuery({ queryKey: ['counts', p.view.accountId ?? null], queryFn: () => api.tagCounts(p.view.accountId) })
  const unread = useQuery({ queryKey: ['unread'], queryFn: api.unreadCounts })
  const totalUnread = Object.values(unread.data ?? {}).reduce((a, b) => a + b, 0)
  const isAll = !p.view.accountId && !p.view.tag
  const untagged = counts.data?.Untagged ?? 0
  const pct = p.progress ? p.progress.done / Math.max(1, p.progress.total) : 0

  return (
    <aside
      data-compact={collapsed}
      aria-label="Sidebar"
      className="glass-side fade group/side flex shrink-0 flex-col gap-5 overflow-x-hidden overflow-y-auto px-2 pt-3.5 pb-2.5 transition-[width] duration-[360ms] ease-[var(--ease-soft)] [view-transition-name:side]"
      style={{ width: 'var(--side)' }}
    >
      <div className="flex items-center gap-2 px-2.5 group-data-[compact=true]/side:justify-center group-data-[compact=true]/side:px-0">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[8px] bg-primary text-on-primary">
          <EnvelopeSimpleIcon size={16} weight="bold" />
        </span>
        <span className="text-[15px] font-semibold tracking-tight group-data-[compact=true]/side:hidden">MailSort</span>
      </div>

      <nav aria-label="Mailboxes" className="flex flex-col gap-0.5">
        <NavRow active={isAll} onClick={() => p.onView({})} icon={<TrayIcon />} count={totalUnread} badge>
          All inboxes
        </NavRow>
        {p.accounts.map((a) => (
          <NavRow
            key={a.id}
            active={p.view.accountId === a.id && !p.view.tag}
            onClick={() => p.onView({ accountId: a.id })}
            icon={a.provider === 'gmail' ? <GoogleLogoIcon /> : <MicrosoftOutlookLogoIcon />}
            count={unread.data?.[a.id]}
            badge
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
        <div className="group-data-[compact=true]/side:hidden">
          <SectionLabel>Tags</SectionLabel>
        </div>
        <div className="mx-2 hidden h-px bg-line group-data-[compact=true]/side:block" aria-hidden />
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
            className="press flex h-9 w-full items-center justify-center gap-2 rounded-[10px] bg-primary px-3 text-[13px] font-medium text-on-primary hover:opacity-90 disabled:opacity-80 group-data-[compact=true]/side:px-0"
            title={p.progress ? `Tagging ${p.progress.done} of ${p.progress.total}` : 'Tag new emails'}
            aria-label={p.progress ? `Tagging ${p.progress.done} of ${p.progress.total}` : 'Tag new emails'}
          >
            <SparkleIcon size={15} weight="fill" className="shrink-0" />
            <span className="truncate group-data-[compact=true]/side:hidden">{p.progress ? `Tagging ${p.progress.done} of ${p.progress.total}` : 'Tag new emails'}</span>
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
            <div className="-mt-0.5 text-center text-[11px] text-muted group-data-[compact=true]/side:hidden">{untagged} waiting to be tagged</div>
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
