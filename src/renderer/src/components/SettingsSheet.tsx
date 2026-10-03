import { useEffect, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckIcon, GoogleLogoIcon, MicrosoftOutlookLogoIcon, WarningCircleIcon, XIcon } from '@phosphor-icons/react'
import type { OllamaHealth } from '../../../core/ollama'
import type { Settings } from '../../../core/settings'
import { api } from '../lib/api'
import { ago, bytes, cleanError } from '../lib/format'

const inputCls = 'h-9 w-full rounded-[10px] bg-field px-3 text-[13px] outline-none placeholder:text-muted focus:bg-selected'
const buttonCls = 'press h-9 shrink-0 rounded-[10px] bg-field px-3.5 text-[13px] font-medium hover:bg-selected disabled:opacity-50'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h3 className="text-[14px] font-semibold tracking-tight">{title}</h3>
      {children}
    </section>
  )
}

function Field({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-ink-soft">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs leading-relaxed text-muted">{hint}</p>}
    </div>
  )
}

function Toggle({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 text-[13px] leading-snug">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
      <span
        aria-hidden
        className="relative mt-px h-5 w-9 shrink-0 rounded-full bg-selected transition-colors duration-200 peer-checked:bg-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 after:absolute after:top-0.5 after:left-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white peer-checked:after:bg-on-primary after:shadow-sm after:transition-transform after:duration-200 peer-checked:after:translate-x-4"
      />
      <span>{children}</span>
    </label>
  )
}

export default function SettingsSheet({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.getSettings })
  const status = useQuery({ queryKey: ['status'], queryFn: api.status })
  const storage = useQuery({ queryKey: ['storage'], queryFn: api.storageStats })
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: api.listAccounts })
  const [form, setForm] = useState<Settings | null>(null)
  const [health, setHealth] = useState<OllamaHealth | null>(null)
  const [testing, setTesting] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)

  useEffect(() => {
    if (settings.data && !form) setForm(settings.data)
  }, [settings.data, form])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setForm((f) => (f ? { ...f, [k]: v } : f))

  const test = async () => {
    if (!form) return
    setTesting(true)
    setHealth(await api.checkOllama(form.ollamaUrl))
    setTesting(false)
  }

  const save = useMutation({
    mutationFn: (patch: Settings) => api.updateSettings(patch),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['settings'] })
      void qc.invalidateQueries({ queryKey: ['status'] })
      onClose()
    }
  })
  const clear = useMutation({ mutationFn: api.clearCache, onSuccess: (s) => qc.setQueryData(['storage'], s) })
  const retag = useMutation({ mutationFn: () => api.runTagging({ retag: true }) })

  const removeAccount = async (id: string) => {
    await api.removeAccount(id)
    setConfirmRemove(null)
    void qc.invalidateQueries({ queryKey: ['accounts'] })
  }

  const modelNames = health?.models?.map((m) => m.name) ?? []
  const stdio = status.data?.stdioCommand
  const stdioJson = stdio ? JSON.stringify({ mcpServers: { mailsort: stdio } }, null, 2) : ''

  return (
    <div className="fixed inset-0 z-20 flex justify-end bg-black/25" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal aria-label="Settings" className="glass-solid enter m-2.5 flex w-[440px] flex-col overflow-hidden">
        <header className="flex items-center justify-between px-6 pt-5 pb-3">
          <h2 className="text-[17px] font-semibold tracking-tight">Settings</h2>
          <button onClick={onClose} className="press rounded-[8px] p-1 text-muted hover:bg-hover hover:text-ink" aria-label="Close settings">
            <XIcon size={16} />
          </button>
        </header>

        {!form ? (
          <div className="flex flex-col gap-3 px-6 pt-2">
            <div className="skeleton h-3 w-1/3" />
            <div className="skeleton h-9 w-full" />
            <div className="skeleton h-9 w-full" />
          </div>
        ) : (
          <div className="flex flex-col gap-9 overflow-y-auto px-6 pt-2 pb-6">
            <Section title="Ollama">
              <Field label="Server address" htmlFor="ollama-url" hint="The PC with the graphics card, for example http://192.168.1.50:11434">
                <div className="flex gap-2">
                  <input id="ollama-url" className={inputCls} value={form.ollamaUrl} onChange={(e) => set('ollamaUrl', e.target.value)} />
                  <button onClick={() => void test()} disabled={testing} className={buttonCls}>
                    {testing ? 'Testing' : 'Test'}
                  </button>
                </div>
              </Field>
              {health && (
                <p className={`selectable flex gap-2 rounded-[10px] bg-field px-3 py-2.5 text-[13px] leading-relaxed ${health.ok ? '' : 'text-danger'}`}>
                  {health.ok ? <CheckIcon size={15} className="mt-0.5 shrink-0" /> : <WarningCircleIcon size={15} className="mt-0.5 shrink-0" />}
                  <span>
                    {health.error
                      ? health.error
                      : `Connected to Ollama ${health.version}, ${health.models?.length ?? 0} models available.` +
                        (health.missing?.length ? ` Missing ${health.missing.join(', ')}. Run "ollama pull ${health.missing[0]}" on that PC.` : '')}
                  </span>
                </p>
              )}
              <datalist id="models">
                {modelNames.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
              <Field label="Chat model" htmlFor="chat-model" hint="Needs tool calling, such as qwen2.5:7b or llama3.1:8b.">
                <input id="chat-model" className={inputCls} list="models" value={form.chatModel} onChange={(e) => set('chatModel', e.target.value)} />
              </Field>
              <Field label="Tagging model" htmlFor="tag-model" hint="Leave empty to use the chat model, so the GPU never swaps models.">
                <input id="tag-model" className={inputCls} list="models" placeholder="Same as chat model" value={form.classifierModel} onChange={(e) => set('classifierModel', e.target.value)} />
              </Field>
              <Field
                label="Parallel requests"
                htmlFor="parallel"
                hint="0 is Auto: MailSort measures the speed and picks. A fixed number should match OLLAMA_NUM_PARALLEL on the Ollama PC."
              >
                <input id="parallel" className={`${inputCls} w-24`} type="number" min={0} max={16} value={form.llmConcurrency} onChange={(e) => set('llmConcurrency', Number(e.target.value))} />
              </Field>
            </Section>

            <Section title="Tagging">
              <Toggle checked={form.autoTag} onChange={(v) => set('autoTag', v)}>
                Tag new emails as soon as they arrive
              </Toggle>
              <Toggle checked={form.writeBack} onChange={(v) => set('writeBack', v)}>
                Save tags to Gmail labels and Outlook categories, such as AI/Meeting
              </Toggle>
              <div className="flex items-center gap-3">
                <button onClick={() => retag.mutate()} disabled={retag.isPending} className={buttonCls}>
                  {retag.isPending ? 'Re-tagging' : 'Re-tag all emails'}
                </button>
                <span className="text-xs text-muted">{retag.data ? `Re-tagged ${retag.data.tagged} emails.` : 'Tags you set yourself are kept.'}</span>
              </div>
            </Section>

            <Section title="Accounts">
              {(accounts.data ?? []).length === 0 && <p className="text-[13px] text-muted">No accounts yet.</p>}
              {(accounts.data ?? []).map((a) => (
                <div key={a.id} className="flex items-center gap-3 rounded-[12px] bg-field px-3 py-2.5 text-[13px]">
                  {a.provider === 'gmail' ? <GoogleLogoIcon className="shrink-0" /> : <MicrosoftOutlookLogoIcon className="shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{a.email}</div>
                    <div className={`truncate text-xs ${a.lastError ? 'text-danger' : 'text-muted'}`} title={a.lastError ?? undefined}>
                      {a.lastError ?? `Synced ${ago(a.lastSyncAt)}`}
                    </div>
                  </div>
                  {confirmRemove === a.id ? (
                    <>
                      <button onClick={() => void removeAccount(a.id)} className="press rounded-[8px] bg-danger px-2.5 py-1 text-xs font-medium text-white">
                        Remove
                      </button>
                      <button onClick={() => setConfirmRemove(null)} className="press rounded-[8px] px-2 py-1 text-xs text-muted hover:text-ink">
                        Keep
                      </button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => void api.syncNow(a.id)} className="press rounded-[8px] px-2 py-1 text-xs font-medium text-ink-soft hover:bg-hover hover:text-ink">
                        Sync
                      </button>
                      <button onClick={() => setConfirmRemove(a.id)} className="press rounded-[8px] px-2 py-1 text-xs font-medium text-ink-soft hover:bg-hover hover:text-danger">
                        Remove
                      </button>
                    </>
                  )}
                </div>
              ))}
              {confirmRemove && <p className="text-xs text-muted">Removing deletes this account's emails and tags from MailSort only. Nothing changes in the mailbox.</p>}
              <div className="grid grid-cols-2 gap-3">
                <Field label="First sync, days" htmlFor="sync-days">
                  <input id="sync-days" className={inputCls} type="number" min={1} value={form.syncDays} onChange={(e) => set('syncDays', Number(e.target.value))} />
                </Field>
                <Field label="Check every, seconds" htmlFor="sync-interval">
                  <input id="sync-interval" className={inputCls} type="number" min={15} value={form.syncIntervalSec} onChange={(e) => set('syncIntervalSec', Number(e.target.value))} />
                </Field>
              </div>
            </Section>

            <Section title="Storage">
              {storage.data && (
                <dl className="grid grid-cols-2 gap-2 text-[13px]">
                  {[
                    ['Database', bytes(storage.data.dbBytes + storage.data.walBytes)],
                    ['Emails', storage.data.messages.toLocaleString()],
                    ['Email text', bytes(storage.data.bodyTextBytes)],
                    ['Opened emails cache', `${bytes(storage.data.bodyCacheBytes)}`]
                  ].map(([k, v]) => (
                    <div key={k} className="rounded-[12px] bg-field px-3 py-2.5">
                      <dt className="text-xs text-muted">{k}</dt>
                      <dd className="mt-0.5 font-medium tabular-nums">{v}</dd>
                    </div>
                  ))}
                </dl>
              )}
              <div className="grid grid-cols-2 gap-3">
                <Field label="Cache limit, MB" htmlFor="cache-mb" hint="Oldest-opened emails go first.">
                  <input id="cache-mb" className={inputCls} type="number" min={10} value={form.bodyCacheMB} onChange={(e) => set('bodyCacheMB', Number(e.target.value))} />
                </Field>
                <Field label="Keep email text, days" htmlFor="retention" hint="0 keeps it forever.">
                  <input id="retention" className={inputCls} type="number" min={0} value={form.retentionDays} onChange={(e) => set('retentionDays', Number(e.target.value))} />
                </Field>
              </div>
              <div>
                <button onClick={() => clear.mutate()} disabled={clear.isPending} className={buttonCls}>
                  {clear.isPending ? 'Clearing' : 'Clear cache'}
                </button>
              </div>
            </Section>

            <Section title="MCP server">
              <p className="text-[13px] leading-relaxed text-muted">Other MCP clients can use MailSort's email tools. Paste this into the client's MCP config:</p>
              <pre className="selectable overflow-x-auto rounded-[12px] bg-field p-3 font-mono text-[11.5px] leading-relaxed">{stdioJson}</pre>
              <Toggle checked={form.mcpHttpEnabled} onChange={(v) => set('mcpHttpEnabled', v)}>
                Also serve over HTTP, on this PC only
              </Toggle>
              {form.mcpHttpEnabled && (
                <Field label="Port" htmlFor="mcp-port" hint={status.data?.mcpHttpUrl ? `Running at ${status.data.mcpHttpUrl}` : undefined}>
                  <input id="mcp-port" className={`${inputCls} w-28`} type="number" value={form.mcpHttpPort} onChange={(e) => set('mcpHttpPort', Number(e.target.value))} />
                </Field>
              )}
            </Section>
          </div>
        )}

        <footer className="flex items-center justify-end gap-2 px-6 py-4">
          {save.error && <span className="mr-auto text-[13px] text-danger">{cleanError(save.error)}</span>}
          <button onClick={onClose} className={buttonCls}>
            Cancel
          </button>
          <button
            onClick={() => form && save.mutate(form)}
            disabled={!form || save.isPending}
            className="press h-9 rounded-[10px] bg-primary px-4 text-[13px] font-medium text-on-primary hover:opacity-90 disabled:opacity-50"
          >
            Save
          </button>
        </footer>
      </div>
    </div>
  )
}
