import { useEffect, useMemo, useRef } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import { GoogleLogoIcon, MicrosoftOutlookLogoIcon, PaperclipIcon, TrayIcon } from '@phosphor-icons/react'
import type { Account } from '../../../core/types'
import { api } from '../lib/api'
import { shortDate } from '../lib/format'
import type { View } from '../App'
import Avatar from './Avatar'
import TagChip from './TagChip'

const ROW_HEIGHT = 84

interface Props {
  view: View
  onView: (v: View) => void
  accounts: Account[]
  search: string
  selectedId: string | null
  onSelect: (id: string) => void
  /** Sizing from the layout; the default is the fixed-width column. */
  className?: string
}

function viewTitle(view: View, accounts: Account[]): string {
  const account = accounts.find((a) => a.id === view.accountId)
  if (view.tag) return account ? `${view.tag} in ${account.email}` : view.tag
  return account?.email ?? 'All inboxes'
}

/** Provider logo plus the mailbox name (part before @), e.g. "G sam.lee". */
function AccountMark({ account }: { account: Account }) {
  const Logo = account.provider === 'gmail' ? GoogleLogoIcon : MicrosoftOutlookLogoIcon
  return (
    <span title={account.email} className="flex max-w-[40%] shrink-0 items-center gap-1 rounded-[6px] bg-field px-1.5 py-px text-[11px] text-ink-soft">
      <Logo size={11} weight="bold" className="shrink-0" />
      <span className="truncate">{account.email.split('@')[0]}</span>
    </span>
  )
}

function SkeletonRows() {
  return (
    <div className="flex flex-col gap-1 px-2 pt-1" aria-busy aria-label="Loading emails">
      {Array.from({ length: 7 }, (_, i) => (
        <div key={i} className="flex gap-3 rounded-[10px] px-2.5 py-3">
          <div className="skeleton h-8 w-8 shrink-0 rounded-[9px]" />
          <div className="flex flex-1 flex-col gap-2 pt-0.5">
            <div className="skeleton h-3 w-2/5" />
            <div className="skeleton h-3 w-4/5" />
            <div className="skeleton h-2.5 w-3/5" />
          </div>
        </div>
      ))}
    </div>
  )
}

export default function MessageList({ view, onView, accounts, search, selectedId, onSelect, className = 'w-[372px] shrink-0' }: Props) {
  const query = useInfiniteQuery({
    queryKey: ['messages', view, search],
    queryFn: ({ pageParam }) => api.listMessages({ ...view, query: search || undefined, cursor: pageParam, limit: 50 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: (prev) => prev
  })
  const rows = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data])

  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: rows.length + (query.hasNextPage ? 1 : 0),
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10
  })
  const items = virtualizer.getVirtualItems()

  // Infinite scroll: load the next page when the loader row comes into view.
  const lastIndex = items.at(-1)?.index ?? 0
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query
  useEffect(() => {
    if (lastIndex >= rows.length - 1 && hasNextPage && !isFetchingNextPage) void fetchNextPage()
  }, [lastIndex, rows.length, hasNextPage, isFetchingNextPage, fetchNextPage])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!['ArrowDown', 'ArrowUp', 'j', 'k'].includes(e.key)) return
    e.preventDefault()
    const idx = rows.findIndex((r) => r.id === selectedId)
    const next = e.key === 'ArrowDown' || e.key === 'j' ? Math.min(rows.length - 1, idx + 1) : Math.max(0, idx - 1)
    if (rows[next]) {
      onSelect(rows[next].id)
      virtualizer.scrollToIndex(next, { align: 'auto' })
    }
  }

  const unreadShown = rows.filter((r) => !r.isRead).length
  // With several accounts in the unified view, each row says which mailbox it came from.
  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts])
  const showAccount = !view.accountId && accounts.length > 1

  return (
    <section aria-label="Emails" className={`glass fade flex min-h-0 min-w-0 flex-col overflow-hidden ${className}`} style={{ ['--d' as string]: '60ms' }}>
      <header className="flex items-end justify-between gap-3 px-4 pt-4 pb-3">
        <div className="min-w-0">
          <h1 className="truncate text-[17px] font-semibold tracking-tight">{search ? `Results for "${search}"` : viewTitle(view, accounts)}</h1>
          <p className="mt-0.5 text-xs text-muted tabular-nums">
            {query.isLoading ? 'Loading' : `${rows.length}${query.hasNextPage ? '+' : ''} emails${unreadShown ? `, ${unreadShown} unread` : ''}`}
          </p>
        </div>
        <button
          onClick={() => onView({ ...view, unreadOnly: !view.unreadOnly })}
          aria-pressed={!!view.unreadOnly}
          className={`press h-7 shrink-0 rounded-[8px] px-2.5 text-xs font-medium ${view.unreadOnly ? 'bg-primary text-on-primary' : 'bg-field text-ink-soft hover:text-ink'}`}
        >
          Unread
        </button>
      </header>

      <div ref={scrollRef} tabIndex={0} onKeyDown={onKeyDown} className="relative flex-1 overflow-y-auto px-2 pb-2 outline-none">
        {query.isLoading && <SkeletonRows />}
        {!query.isLoading && rows.length === 0 && (
          <div className="enter flex flex-col items-center gap-2 px-8 pt-16 text-center text-muted">
            <TrayIcon size={28} weight="light" />
            <p className="text-[13px]">{search ? 'No emails match your search.' : view.unreadOnly ? 'Nothing unread here.' : 'No emails here yet.'}</p>
          </div>
        )}
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {items.map((vi) => {
            const m = rows[vi.index]
            const selected = m?.id === selectedId
            return (
              <div key={m?.id ?? 'loader'} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: vi.size, transform: `translateY(${vi.start}px)` }}>
                {m ? (
                  <button
                    data-row
                    onClick={() => onSelect(m.id)}
                    aria-current={selected ? 'true' : undefined}
                    className={`press flex h-[80px] w-full gap-3 rounded-[10px] px-2.5 py-2.5 text-left ${selected ? 'bg-selected' : 'hover:bg-hover'}`}
                  >
                    <Avatar name={m.fromName} addr={m.fromAddr} />
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <div className="flex items-center gap-2">
                        <span className={`truncate text-[13px] ${m.isRead ? 'text-ink-soft' : 'font-semibold text-ink'}`}>{m.fromName || m.fromAddr || 'Unknown sender'}</span>
                        {!m.isRead && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
                        <span className="ml-auto shrink-0 text-[11.5px] text-muted tabular-nums">{shortDate(m.receivedAt)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`truncate text-[13px] ${m.isRead ? 'text-ink-soft' : 'font-medium text-ink'}`}>{m.subject || '(no subject)'}</span>
                        {m.hasAttachments && <PaperclipIcon size={13} className="shrink-0 text-muted" aria-label="Has attachments" />}
                        {m.tag && (
                          <span className="ml-auto">
                            <TagChip tag={m.tag} source={m.tagSource} small />
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-muted">
                        {showAccount && accountById.get(m.accountId) && <AccountMark account={accountById.get(m.accountId)!} />}
                        <span className="truncate">{m.snippet}</span>
                      </div>
                    </div>
                  </button>
                ) : (
                  <div className="flex justify-center p-3">
                    <div className="skeleton h-2.5 w-24" />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
