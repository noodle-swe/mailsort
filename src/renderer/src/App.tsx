import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChatCircleTextIcon, GearSixIcon, MagnifyingGlassIcon, WarningCircleIcon, XIcon } from '@phosphor-icons/react'
import type { Tag } from '../../core/tags'
import type { Provider, TaggingProgress } from '../../core/types'
import { api, useAppEvents } from './lib/api'
import { cleanError } from './lib/format'
import Sidebar from './components/Sidebar'
import MessageList from './components/MessageList'
import ReadingPane from './components/ReadingPane'
import ChatPanel from './components/ChatPanel'
import SettingsSheet from './components/SettingsSheet'
import Welcome from './components/Welcome'

export interface View {
  accountId?: string
  tag?: Tag | 'Untagged'
  unreadOnly?: boolean
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

function TopBar({ onSearch, chatOpen, onToggleChat, onOpenSettings }: { onSearch: (s: string) => void; chatOpen: boolean; onToggleChat: () => void; onOpenSettings: () => void }) {
  const [draft, setDraft] = useState('')
  // Debounce typing so each keystroke doesn't hit SQLite.
  useEffect(() => {
    const t = setTimeout(() => onSearch(draft.trim()), 180)
    return () => clearTimeout(t)
  }, [draft, onSearch])

  return (
    <header
      className="drag flex h-12 shrink-0 items-center gap-2 pl-[252px]"
      // Leave room for the native window controls (Window Controls Overlay).
      style={{ paddingRight: 'calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, calc(100vw - 150px)) + 10px)' }}
    >
      <label className="glass-side no-drag flex h-8 w-[min(460px,42vw)] items-center gap-2 rounded-[10px] px-3 text-muted focus-within:text-ink">
        <MagnifyingGlassIcon size={15} />
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Search mail"
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
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [syncing, setSyncing] = useState<Record<string, boolean>>({})
  const [progress, setProgress] = useState<TaggingProgress | null>(null)
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null)

  const accounts = useQuery({ queryKey: ['accounts'], queryFn: api.listAccounts })
  const status = useQuery({ queryKey: ['status'], queryFn: api.status })

  const refreshMail = () => {
    void qc.invalidateQueries({ queryKey: ['messages'] })
    void qc.invalidateQueries({ queryKey: ['counts'] })
    void qc.invalidateQueries({ queryKey: ['unread'] })
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

  const changeView = (v: View) => {
    setView(v)
    setSelectedId(null)
  }

  const hasAccounts = (accounts.data?.length ?? 0) > 0

  return (
    <div className="relative flex h-full flex-col">
      <TopBar onSearch={setSearch} chatOpen={chatOpen} onToggleChat={() => setChatOpen((o) => !o)} onOpenSettings={() => setSettingsOpen(true)} />

      <div className="flex min-h-0 flex-1 gap-2.5 px-2.5 pb-2.5">
        <Sidebar
          view={view}
          onView={changeView}
          accounts={accounts.data ?? []}
          syncing={syncing}
          progress={progress}
          configured={status.data?.configured}
          onAddAccount={addAccount}
        />

        {hasAccounts || accounts.isLoading ? (
          <>
            <MessageList view={view} onView={changeView} accounts={accounts.data ?? []} search={search} selectedId={selectedId} onSelect={setSelectedId} />
            <ReadingPane id={selectedId} onView={changeView} progress={progress} />
          </>
        ) : (
          <Welcome configured={status.data?.configured} onAdd={addAccount} />
        )}

        {chatOpen && <ChatPanel onClose={() => setChatOpen(false)} />}
      </div>

      {settingsOpen && <SettingsSheet onClose={() => setSettingsOpen(false)} />}

      {notice && (
        <div role="status" className="glass-solid enter fixed bottom-5 left-1/2 z-30 flex max-w-xl -translate-x-1/2 items-start gap-3 px-4 py-3">
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
