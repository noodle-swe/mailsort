import { useEffect, useMemo, useRef } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  CaretDownIcon,
  CheckIcon,
  EnvelopeSimpleIcon,
  EnvelopeSimpleOpenIcon,
  GoogleLogoIcon,
  MicrosoftOutlookLogoIcon,
  PaperclipIcon,
  TrayIcon
} from '@phosphor-icons/react'
import { TAGS, type Tag } from '../../../core/tags'
import type { Account, MessageSummary } from '../../../core/types'
import { api } from '../lib/api'
import { activeCount, describeFilters, filtersToQuery, type Filters } from '../lib/filters'
import { shortDate } from '../lib/format'
import { ROW_HEIGHT, useAppearance } from '../lib/appearance'
import type { View } from '../App'
import Avatar from './Avatar'
import BulkBar from './BulkBar'
import FilterBar from './FilterBar'
import TagChip from './TagChip'

interface Props {
  view: View
  filters: Filters
  onFilters: (f: Filters) => void
  accounts: Account[]
  search: string
  selectedId: string | null
  onSelect: (id: string) => void
  /** Emails ticked for a bulk action. */
  checked: Set<string>
  onChecked: (next: Set<string>) => void
  /** Ids in list order, for keyboard navigation and "select all". */
  onRows: (ids: string[]) => void
  onSetRead: (ids: string[], read: boolean) => void
  onSetTag: (ids: string[], tag: Tag) => void
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

/** Quick actions on the row under the pointer: read state and tag. Sibling of the row button, so no nested buttons. */
function RowActions({ m, onSetRead, onSetTag }: { m: MessageSummary; onSetRead: Props['onSetRead']; onSetTag: Props['onSetTag'] }) {
  return (
    <div
      className="absolute top-1.5 right-2 hidden items-center gap-0.5 rounded-[9px] p-0.5 shadow-sm group-focus-within:flex group-hover:flex"
      style={{ background: 'var(--glass-solid)' }}
    >
      <button
        onClick={() => onSetRead([m.id], !m.isRead)}
        title={m.isRead ? 'Mark as unread (u)' : 'Mark as read (u)'}
        aria-label={m.isRead ? 'Mark as unread' : 'Mark as read'}
        className="press grid h-6 w-6 place-items-center rounded-[7px] text-ink-soft hover:bg-hover hover:text-ink"
      >
        {m.isRead ? <EnvelopeSimpleIcon size={14} /> : <EnvelopeSimpleOpenIcon size={14} />}
      </button>
      <label className="relative">
        <span className="sr-only">Set tag</span>
        <select
          value=""
          onChange={(e) => e.target.value && onSetTag([m.id], e.target.value as Tag)}
          title="Set tag (1 to 7)"
          className="press h-6 cursor-pointer appearance-none rounded-[7px] pr-5 pl-2 text-[11px] font-medium text-ink-soft hover:bg-hover hover:text-ink"
        >
          <option value="" disabled>
            Tag
          </option>
          {TAGS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <CaretDownIcon size={10} className="pointer-events-none absolute top-1/2 right-1.5 -translate-y-1/2 text-muted" />
      </label>
    </div>
  )
}

export default function MessageList({
  view,
  filters,
  onFilters,
  accounts,
  search,
  selectedId,
  onSelect,
  checked,
  onChecked,
  onRows,
  onSetRead,
  onSetTag,
  className = 'w-(--w-list) shrink-0'
}: Props) {
  const { density } = useAppearance()
  const compact = density === 'compact'
  const rowH = ROW_HEIGHT[density]
  const query = useInfiniteQuery({
    queryKey: ['messages', view, filters, search],
    queryFn: ({ pageParam }) =>
      api.listMessages({ accountId: view.accountId, tag: view.tag, ...filtersToQuery(filters), query: search || undefined, cursor: pageParam, limit: 50 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: (prev) => prev
  })
  const rows = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data])

  useEffect(() => onRows(rows.map((r) => r.id)), [rows, onRows])

  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: rows.length + (query.hasNextPage ? 1 : 0),
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowH,
    overscan: 10
  })
  // A new density changes every row's height.
  useEffect(() => virtualizer.measure(), [rowH, virtualizer])
  const items = virtualizer.getVirtualItems()

  // Keyboard moves (j/k, arrows) change selectedId from outside; keep the row in view.
  // Only when the selection changes, so a background refresh never yanks the list back.
  const scrolledTo = useRef<string | null>(null)
  useEffect(() => {
    if (!selectedId || scrolledTo.current === selectedId) return
    const idx = rows.findIndex((r) => r.id === selectedId)
    if (idx < 0) return
    scrolledTo.current = selectedId
    virtualizer.scrollToIndex(idx, { align: 'auto' })
  }, [selectedId, rows, virtualizer])

  // Infinite scroll: load the next page when the loader row comes into view.
  const lastIndex = items.at(-1)?.index ?? 0
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query
  useEffect(() => {
    if (lastIndex >= rows.length - 1 && hasNextPage && !isFetchingNextPage) void fetchNextPage()
  }, [lastIndex, rows.length, hasNextPage, isFetchingNextPage, fetchNextPage])

  // j and k are global shortcuts (see useShortcuts); the arrow keys work while the list has focus.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const idx = rows.findIndex((r) => r.id === selectedId)
    const next = e.key === 'ArrowDown' ? Math.min(rows.length - 1, idx + 1) : Math.max(0, idx - 1)
    if (rows[next]) onSelect(rows[next].id)
  }

  const anchor = useRef<string | null>(null)
  const toggleChecked = (id: string, range: boolean) => {
    const next = new Set(checked)
    const from = rows.findIndex((r) => r.id === anchor.current)
    const to = rows.findIndex((r) => r.id === id)
    if (range && from >= 0 && to >= 0) for (let i = Math.min(from, to); i <= Math.max(from, to); i++) next.add(rows[i].id)
    else if (next.has(id)) next.delete(id)
    else next.add(id)
    anchor.current = id
    onChecked(next)
  }

  const selectedIndex = rows.findIndex((r) => r.id === selectedId)
  const unreadShown = rows.filter((r) => !r.isRead).length
  // With several accounts in the unified view, each row says which mailbox it came from.
  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts])
  const showAccount = !view.accountId && accounts.length > 1
  const filtered = activeCount(filters) > 0
  const anyChecked = checked.size > 0
  const described = describeFilters(filters)

  return (
    <section aria-label="Emails" className={`glass fade flex min-h-0 min-w-0 flex-col overflow-hidden [view-transition-name:list] ${className}`} style={{ ['--d' as string]: '60ms' }}>
      <header className="flex items-end justify-between gap-3 px-4 pt-4 pb-3">
        <div className="min-w-0">
          <h1 className="truncate text-[17px] font-semibold tracking-tight">{search ? `Results for "${search}"` : viewTitle(view, accounts)}</h1>
          <p className="mt-0.5 truncate text-xs text-muted tabular-nums">
            {query.isLoading ? 'Loading' : `${rows.length}${query.hasNextPage ? '+' : ''} emails${unreadShown ? `, ${unreadShown} unread` : ''}${described ? ` · ${described}` : ''}`}
          </p>
        </div>
      </header>

      {anyChecked ? (
        <BulkBar
          count={checked.size}
          loaded={rows.length}
          onSelectAll={() => onChecked(new Set(rows.map((r) => r.id)))}
          onRead={(read) => onSetRead([...checked], read)}
          onTag={(tag) => onSetTag([...checked], tag)}
          onClear={() => onChecked(new Set())}
        />
      ) : (
        <FilterBar view={view} filters={filters} onChange={onFilters} />
      )}

      <div ref={scrollRef} tabIndex={0} onKeyDown={onKeyDown} className="relative flex-1 overflow-y-auto px-2 pb-2 outline-none">
        {query.isLoading && <SkeletonRows />}
        {!query.isLoading && rows.length === 0 && (
          <div className="enter flex flex-col items-center gap-2 px-8 pt-16 text-center text-muted">
            <TrayIcon size={28} weight="light" />
            <p className="text-[13px]">{search ? 'No emails match your search.' : filtered ? 'No emails match these filters.' : 'No emails here yet.'}</p>
            {filtered && (
              <button onClick={() => onFilters({})} className="press mt-1 h-7 rounded-[8px] bg-field px-2.5 text-xs font-medium text-ink-soft hover:bg-selected hover:text-ink">
                Clear filters
              </button>
            )}
          </div>
        )}
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 rounded-[10px] bg-selected transition-[transform,opacity] duration-[380ms] ease-[var(--ease-soft)]"
            style={{ height: 'calc(var(--row-h) - 4px)', transform: `translateY(${Math.max(0, selectedIndex) * rowH}px)`, opacity: selectedIndex >= 0 ? 1 : 0 }}
          />
          {items.map((vi) => {
            const m = rows[vi.index]
            const selected = m?.id === selectedId
            const isChecked = !!m && checked.has(m.id)
            return (
              <div key={m?.id ?? 'loader'} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: vi.size, transform: `translateY(${vi.start}px)` }}>
                {m ? (
                  <div
                    className={`group relative h-[calc(var(--row-h)-4px)] ${vi.index < 12 ? 'enter' : ''}`}
                    style={vi.index < 12 ? { ['--d' as string]: `${vi.index * 24}ms` } : undefined}
                  >
                    <button
                      data-row
                      onClick={(e) => {
                        if (e.shiftKey || e.ctrlKey || e.metaKey) toggleChecked(m.id, e.shiftKey)
                        else {
                          anchor.current = m.id
                          onSelect(m.id)
                        }
                      }}
                      aria-current={selected ? 'true' : undefined}
                      className={`press flex h-[calc(var(--row-h)-4px)] w-full gap-3 rounded-[10px] px-2.5 text-left ${compact ? 'items-center py-1.5' : 'py-2.5'} ${isChecked ? 'bg-selected' : selected ? '' : 'hover:bg-hover'}`}
                    >
                      <Avatar name={m.fromName} addr={m.fromAddr} size={compact ? 28 : 32} />
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
                        <div className={`items-center gap-1.5 text-xs text-muted ${compact ? 'hidden' : 'flex'}`}>
                          {showAccount && accountById.get(m.accountId) && <AccountMark account={accountById.get(m.accountId)!} />}
                          <span className="truncate">{m.snippet}</span>
                        </div>
                      </div>
                    </button>
                    <button
                      role="checkbox"
                      aria-checked={isChecked}
                      aria-label={`Select email from ${m.fromName || m.fromAddr || 'unknown sender'}`}
                      onClick={(e) => toggleChecked(m.id, e.shiftKey)}
                      className={`press absolute ${compact ? 'top-1.5' : 'top-2.5'} left-2.5 grid ${compact ? 'h-7 w-7' : 'h-8 w-8'} place-items-center rounded-[9px] focus-visible:opacity-100 ${isChecked || anyChecked ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                      style={{ background: 'color-mix(in srgb, var(--glass-solid) 92%, transparent)' }}
                    >
                      <span
                        className={`grid h-[18px] w-[18px] place-items-center rounded-[6px] transition-colors duration-200 ${isChecked ? 'bg-primary text-on-primary' : 'shadow-[inset_0_0_0_1.5px_var(--muted)]'}`}
                      >
                        {isChecked && <CheckIcon size={12} weight="bold" />}
                      </span>
                    </button>
                    <RowActions m={m} onSetRead={onSetRead} onSetTag={onSetTag} />
                  </div>
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
