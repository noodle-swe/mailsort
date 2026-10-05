import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChatCircleTextIcon, ColumnsIcon, GearSixIcon, ImageIcon, KeyboardIcon, ListIcon, MagnifyingGlassIcon, RowsIcon, SidebarSimpleIcon, WarningCircleIcon, XIcon } from '@phosphor-icons/react'
import type { Tag } from '../../core/tags'
import type { Provider, TaggingProgress } from '../../core/types'
import { api, useAppEvents } from './lib/api'
import { cleanError } from './lib/format'
import { cleanFilters, loadFilters, saveFilters, viewKey, type Filters } from './lib/filters'
import { useShortcuts } from './lib/useShortcuts'
import { cycleBackdrop } from './lib/appearance'
import { setSideCollapsed, usePanes } from './lib/panes'
import { withTransition } from './lib/motion'
import Sidebar from './components/Sidebar'
import MessageList from './components/MessageList'
import ReadingPane from './components/ReadingPane'
import ChatPanel from './components/ChatPanel'
import SettingsSheet from './components/SettingsSheet'
import ShortcutsSheet from './components/ShortcutsSheet'
import ResizeHandle from './components/ResizeHandle'
import Welcome from './components/Welcome'

export interface View {
  accountId?: string
  tag?: Tag | 'Untagged'
}

function IconButton({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`glass-side press no-drag grid h-8 w-8 place-items-center rounded-[10px] text-ink ${active ? 'opacity-100' : 'opacity-80 hover:opacity-100'}`}
    >
      {children}
    </button>
  )
}

export type Layout = 'columns' | 'split' | 'list'

/** Second key after "g": jump to a tag. */
const GO_TO: Record<string, Tag> = { a: 'Applied', r: 'Rejected', m: 'Meeting', q: 'Questions', n: 'Needs Attention', j: 'Junk', o: 'Other' }

const LAYOUTS: { id: Layout; label: string; icon: React.ReactNode }[] = [
  { id: 'columns', label: 'Columns: list beside the email', icon: <ColumnsIcon /> },
  { id: 'split', label: 'Split: list above the email', icon: <RowsIcon /> },
  { id: 'list', label: 'List: one pane at a time', icon: <ListIcon /> }
]

function loadLayout(): Layout {
  try {
    const saved = localStorage.getItem('layout')
    if (saved === 'columns' || saved === 'split' || saved === 'list') return saved
  } catch {
    // storage unavailable: fall back to the default
  }
  return 'columns'
}

function LayoutSwitch({ layout, onChange }: { layout: Layout; onChange: (l: Layout) => void }) {
  return (
    <div role="radiogroup" aria-label="Layout" className="glass-side no-drag flex h-8 items-center gap-0.5 rounded-[10px] p-0.5">
      {LAYOUTS.map((l) => (
        <button
          key={l.id}
          role="radio"
          aria-checked={layout === l.id}
          title={l.label}
          aria-label={l.label}
          onClick={() => onChange(l.id)}
          className={`press grid h-7 w-7 place-items-center rounded-[8px] ${layout === l.id ? 'bg-primary text-on-primary' : 'text-ink-soft hover:text-ink'}`}
        >
          {l.icon}
        </button>
      ))}
    </div>
  )
}

interface TopBarProps {
  onSearch: (s: string) => void
  chatOpen: boolean
  onToggleChat: () => void
  onOpenSettings: () => void
  layout: Layout
  onLayout: (l: Layout) => void
  onHelp: () => void
  searchRef: React.RefObject<HTMLInputElement | null>
  sideCollapsed: boolean
  onToggleSide: () => void
}

function TopBar({ onSearch, chatOpen, onToggleChat, onOpenSettings, layout, onLayout, onHelp, searchRef, sideCollapsed, onToggleSide }: TopBarProps) {
  const [draft, setDraft] = useState('')
  // Debounce typing so each keystroke doesn't hit SQLite.
  useEffect(() => {
    const t = setTimeout(() => onSearch(draft.trim()), 180)
    return () => clearTimeout(t)
  }, [draft, onSearch])

  return (
    <header
      className="drag relative flex h-12 shrink-0 items-center gap-2 transition-[padding] duration-[360ms] ease-[var(--ease-soft)]"
      // The search box starts after the sidebar; the right side leaves room for the native window controls (Window Controls Overlay).
      style={{
        paddingLeft: 'calc(var(--side) + 20px)',
        paddingRight: 'calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, calc(100vw - 150px)) + 10px)'
      }}
    >
      <div className="absolute top-2 left-2.5">
        <IconButton label={sideCollapsed ? 'Show sidebar' : 'Hide sidebar'} active={!sideCollapsed} onClick={onToggleSide}>
          <SidebarSimpleIcon weight={sideCollapsed ? 'regular' : 'fill'} />
        </IconButton>
      </div>
      <label className="glass-side no-drag flex h-8 w-[min(460px,42vw)] items-center gap-2 rounded-[10px] px-3 text-muted focus-within:text-ink">
        <MagnifyingGlassIcon size={15} />
        <input
          ref={searchRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && e.currentTarget.blur()}
          placeholder="Search mail (/)"
          aria-label="Search mail"
          className="w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-muted"
        />
        {draft && (
          <button onClick={() => setDraft('')} aria-label="Clear search" className="text-muted hover:text-ink">
            <XIcon size={13} />
          </button>
        )}
      </label>
      <div className="ml-auto flex gap-1.5">
        <LayoutSwitch layout={layout} onChange={onLayout} />
        <IconButton label="Next background" onClick={cycleBackdrop}>
          <ImageIcon />
        </IconButton>
        <IconButton label="Keyboard shortcuts (?)" onClick={onHelp}>
          <KeyboardIcon />
        </IconButton>
        <IconButton label={chatOpen ? 'Hide assistant' : 'Show assistant'} active={chatOpen} onClick={onToggleChat}>
          <ChatCircleTextIcon weight={chatOpen ? 'fill' : 'regular'} />
        </IconButton>
        <IconButton label="Settings" onClick={onOpenSettings}>
          <GearSixIcon />
        </IconButton>
      </div>
    </header>
  )
}

export default function App() {
  const qc = useQueryClient()
  const [view, setView] = useState<View>({})
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [chatOpen, setChatOpen] = useState(true)
  const [layout, setLayout] = useState<Layout>(loadLayout)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [syncing, setSyncing] = useState<Record<string, boolean>>({})
  const [progress, setProgress] = useState<TaggingProgress | null>(null)
  const [notice, setNotice] = useState<{ text: string; error?: boolean; autoHide?: boolean } | null>(null)
  const [filtersByView, setFiltersByView] = useState<Record<string, Filters>>(loadFilters)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [helpOpen, setHelpOpen] = useState(false)
  const { sideCollapsed } = usePanes()
  const searchRef = useRef<HTMLInputElement>(null)
  const rowIds = useRef<string[]>([])
  const filters = filtersByView[viewKey(view)] ?? {}

  useEffect(() => saveFilters(filtersByView), [filtersByView])
  useEffect(() => {
    if (!notice?.autoHide) return
    const t = setTimeout(() => setNotice(null), 3500)
    return () => clearTimeout(t)
  }, [notice])

  /** The list reports its loaded ids; ticks on rows that are no longer there (re-tagged away, filtered out) are dropped. */
  const onRows = useCallback((ids: string[]) => {
    rowIds.current = ids
    setChecked((prev) => {
      if (!prev.size) return prev
      const present = new Set(ids)
      const next = new Set([...prev].filter((id) => present.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [])
  const changeSearch = useCallback((s: string) => {
    setSearch(s)
    setChecked((prev) => (prev.size ? new Set() : prev))
  }, [])

  const accounts = useQuery({ queryKey: ['accounts'], queryFn: api.listAccounts })
  const status = useQuery({ queryKey: ['status'], queryFn: api.status })

  const refreshMail = () => {
    void qc.invalidateQueries({ queryKey: ['messages'] })
    void qc.invalidateQueries({ queryKey: ['counts'] })
    void qc.invalidateQueries({ queryKey: ['unread'] })
    void qc.invalidateQueries({ queryKey: ['digest'] })
  }

  useAppEvents((e) => {
    switch (e.type) {
      case 'messages-changed':
        refreshMail()
        break
      case 'tags-changed':
        refreshMail()
        void qc.invalidateQueries({ queryKey: ['message'] })
        break
      case 'accounts-changed':
        void qc.invalidateQueries({ queryKey: ['accounts'] })
        refreshMail()
        break
      case 'sync-status':
        setSyncing((s) => ({ ...s, [e.accountId]: e.syncing }))
        if (!e.syncing) void qc.invalidateQueries({ queryKey: ['accounts'] })
        break
      case 'tagging-progress':
        setProgress(e.progress.stage === 'done' ? null : e.progress)
        break
      case 'writeback':
        if (e.failed) setNotice({ text: `${e.failed} tag(s) could not be saved to your mailbox${e.error ? `: ${e.error}` : '.'}`, error: true })
        break
      case 'read-sync-failed':
        setNotice({ text: `Couldn't mark the email as read in your mailbox: ${e.error}`, error: true })
        break
    }
  })

  const addAccount = async (provider: Provider) => {
    setNotice({ text: `Finish signing in to ${provider === 'gmail' ? 'Google' : 'Microsoft'} in your browser.` })
    try {
      await api.addAccount(provider)
      setNotice(null)
    } catch (err) {
      setNotice({ text: cleanError(err), error: true })
    }
  }

  const setFiltersFor = (key: string, f: Filters) =>
    setFiltersByView((prev) => {
      const next = { ...prev }
      const clean = cleanFilters(f)
      if (Object.keys(clean).length) next[key] = clean
      else delete next[key]
      return next
    })

  /** Each tag and mailbox remembers its own filters; `f` replaces them (the weekly digest opens a view already filtered). */
  const changeView = (v: View, f?: Filters) => {
    if (f) setFiltersFor(viewKey(v), f)
    setView(v)
    setSelectedId(null)
    setChecked(new Set())
  }

  const applyRead = async (ids: string[], read: boolean) => {
    if (!ids.length) return
    try {
      await api.setRead(ids, read)
      refreshMail()
      void qc.invalidateQueries({ queryKey: ['message'] })
    } catch (err) {
      setNotice({ text: cleanError(err), error: true })
    }
  }

  const applyTag = async (ids: string[], tag: Tag) => {
    if (!ids.length) return
    try {
      const n = await api.setTag(ids, tag)
      setNotice({ text: `Tagged ${n} ${n === 1 ? 'email' : 'emails'} as ${tag}.`, autoHide: true })
    } catch (err) {
      setNotice({ text: cleanError(err), error: true })
    }
  }

  /** Keyboard shortcuts act on the ticked emails, else on the open one. */
  const targetIds = () => (checked.size ? [...checked] : selectedId ? [selectedId] : [])

  useShortcuts(
    {
      move: (delta) => {
        const ids = rowIds.current
        if (!ids.length) return
        const at = selectedId ? ids.indexOf(selectedId) : -1
        const next = ids[Math.min(ids.length - 1, Math.max(0, at + delta))]
        if (next) setSelectedId(next)
      },
      toggleCheck: () => {
        if (!selectedId) return
        setChecked((prev) => {
          const next = new Set(prev)
          if (!next.delete(selectedId)) next.add(selectedId)
          return next
        })
      },
      toggleRead: () => {
        const ids = targetIds()
        if (!ids.length) return
        void Promise.all(ids.map((id) => api.getMessage(id))).then((msgs) => applyRead(ids, msgs.some((m) => m && !m.isRead)))
      },
      setTag: (tag) => void applyTag(targetIds(), tag),
      focusSearch: () => searchRef.current?.focus(),
      goTo: (key) => {
        if (key === 'i') changeView({})
        else if (GO_TO[key]) changeView({ accountId: view.accountId, tag: GO_TO[key] })
        else return false
        return true
      },
      toggleChat: () => setChatOpen((o) => !o),
      escape: () => {
        if (checked.size) setChecked(new Set())
        else if (layout === 'list' && selectedId) setSelectedId(null)
      },
      help: () => setHelpOpen(true)
    },
    !settingsOpen && !helpOpen
  )

  const changeLayout = (l: Layout) => {
    withTransition(() => setLayout(l))
    try {
      localStorage.setItem('layout', l)
    } catch {
      // not persisted; the choice still applies for this session
    }
  }

  const hasAccounts = (accounts.data?.length ?? 0) > 0

  const list = (className: string) => (
    <MessageList
      view={view}
      filters={filters}
      onFilters={(f) => setFiltersFor(viewKey(view), f)}
      accounts={accounts.data ?? []}
      search={search}
      selectedId={selectedId}
      onSelect={setSelectedId}
      checked={checked}
      onChecked={setChecked}
      onRows={onRows}
      onSetRead={(ids, read) => void applyRead(ids, read)}
      onSetTag={(ids, tag) => void applyTag(ids, tag)}
      className={className}
    />
  )

  return (
    <div className="relative flex h-full flex-col">
      <TopBar
        onSearch={changeSearch}
        chatOpen={chatOpen}
        onToggleChat={() => setChatOpen((o) => !o)}
        onOpenSettings={() => setSettingsOpen(true)}
        layout={layout}
        onLayout={changeLayout}
        onHelp={() => setHelpOpen(true)}
        searchRef={searchRef}
        sideCollapsed={sideCollapsed}
        onToggleSide={() => setSideCollapsed(!sideCollapsed)}
      />

      <div className="flex min-h-0 flex-1 px-2.5 pb-2.5">
        <Sidebar
          view={view}
          onView={changeView}
          accounts={accounts.data ?? []}
          syncing={syncing}
          progress={progress}
          configured={status.data?.configured}
          onAddAccount={addAccount}
          collapsed={sideCollapsed}
        />
        {sideCollapsed ? <div className="w-2.5 shrink-0" /> : <ResizeHandle pane="side" label="Resize sidebar" grow={1} />}

        {hasAccounts || accounts.isLoading ? (
          layout === 'columns' ? (
            <>
              {list('w-(--w-list) shrink-0')}
              <ResizeHandle pane="list" label="Resize email list" grow={1} />
              <ReadingPane id={selectedId} onView={changeView} progress={progress} />
            </>
          ) : layout === 'split' ? (
            <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2.5">
              {list('h-[40%] min-h-[200px] w-full shrink-0')}
              <ReadingPane id={selectedId} onView={changeView} progress={progress} />
            </div>
          ) : selectedId ? (
            <ReadingPane id={selectedId} onView={changeView} progress={progress} onBack={() => setSelectedId(null)} />
          ) : (
            list('flex-1')
          )
        ) : (
          <Welcome configured={status.data?.configured} onAdd={addAccount} />
        )}

        {/* Always mounted, so the conversation survives hiding it; the width slides open and shut. */}
        <div
          inert={!chatOpen}
          aria-hidden={!chatOpen}
          className="flex shrink-0 overflow-hidden transition-[width,opacity] duration-[420ms] ease-[var(--ease-soft)] [view-transition-name:chat]"
          style={{ width: chatOpen ? 'calc(var(--w-chat) + 10px)' : 0, opacity: chatOpen ? 1 : 0 }}
        >
          <ResizeHandle pane="chat" label="Resize assistant" grow={-1} />
          <ChatPanel onClose={() => setChatOpen(false)} />
        </div>
      </div>

      {settingsOpen && <SettingsSheet onClose={() => setSettingsOpen(false)} />}
      {helpOpen && <ShortcutsSheet onClose={() => setHelpOpen(false)} />}

      {notice && (
        <div role="status" className={`glass-solid fixed bottom-5 left-1/2 z-30 flex max-w-xl items-start gap-3 px-4 py-3 ${notice.autoHide ? 'toast-auto' : 'enter -translate-x-1/2'}`}>
          {notice.error && <WarningCircleIcon className="mt-px shrink-0 text-danger" />}
          <span className="selectable flex-1 text-[13px] leading-relaxed">{notice.text}</span>
          <button className="press text-muted hover:text-ink" onClick={() => setNotice(null)} aria-label="Dismiss">
            <XIcon size={14} />
          </button>
        </div>
      )}
    </div>
  )
}
