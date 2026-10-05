import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowUpRightIcon, CaretDownIcon, CheckIcon, DownloadSimpleIcon, PlayIcon, WarningCircleIcon, XIcon } from '@phosphor-icons/react'
import { isValidModelName, type OllamaHealth, type OllamaModel, type PullProgress } from '../../../core/ollama'
import { RECOMMENDED_MODELS, supportsTools } from '../../../core/ollama-models'
import type { Settings } from '../../../core/settings'
import { api, useAppEvents } from '../lib/api'
import { bytes, cleanError } from '../lib/format'
import { buttonCls, Field, inputCls, Section } from './settings-ui'

const DOWNLOAD_URL = 'https://ollama.com/download'

type SetSetting = <K extends keyof Settings>(key: K, value: Settings[K]) => void

const isPulled = (models: OllamaModel[], name: string) => models.some((m) => m.name === name || m.name === `${name}:latest` || m.name.replace(/:latest$/, '') === name)
const percent = (p?: PullProgress) => (p?.total ? Math.min(100, Math.round(((p.completed ?? 0) / p.total) * 100)) : null)
const downloading = (p?: PullProgress) => !!p && !p.done

function Note({ tone = 'info', icon, children }: { tone?: 'info' | 'warn'; icon?: ReactNode; children: ReactNode }) {
  return (
    <div className={`selectable flex items-start gap-2 rounded-[10px] bg-field px-3 py-2.5 text-[13px] leading-relaxed ${tone === 'warn' ? 'text-danger' : ''}`}>
      {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
      <div className="flex min-w-0 flex-1 flex-col gap-2">{children}</div>
    </div>
  )
}

function ProgressBar({ pct, label }: { pct: number | null; label: string }) {
  return pct === null ? (
    <div className="skeleton h-1 w-24" role="progressbar" aria-label={label} />
  ) : (
    <div role="progressbar" aria-label={label} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} className="h-1 w-24 overflow-hidden rounded-full bg-selected">
      <div className="h-full origin-left rounded-full bg-primary transition-transform duration-300" style={{ transform: `scaleX(${pct / 100})` }} />
    </div>
  )
}

function ModelSelect({
  id,
  value,
  models,
  onChange,
  emptyLabel,
  forChat
}: {
  id: string
  value: string
  models: OllamaModel[]
  onChange: (v: string) => void
  emptyLabel?: string
  forChat?: boolean
}) {
  const missing = !!value && !isPulled(models, value)
  return (
    <div className="relative">
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={`${inputCls} cursor-pointer appearance-none pr-9`}>
        {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
        {missing && <option value={value}>{value} (not pulled)</option>}
        {models.map((m) => (
          <option key={m.name} value={m.name}>
            {m.name} · {bytes(m.size)}
            {forChat && supportsTools(m.name) === false ? ' · no tool calling' : ''}
          </option>
        ))}
      </select>
      <CaretDownIcon size={13} className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted" />
    </div>
  )
}

/** Shown under a model dropdown whose current choice is not on the server. */
function NotPulled({ model, pull, onPull }: { model: string; pull?: PullProgress; onPull: (m: string) => void }) {
  if (downloading(pull)) return <p className="text-xs text-muted tabular-nums">Downloading {model} {percent(pull) ?? ''}{percent(pull) !== null && '%'}</p>
  return (
    <p className="text-xs text-danger">
      {model} is not on the server yet.{' '}
      <button onClick={() => onPull(model)} className="press font-medium underline underline-offset-2">
        Pull it now
      </button>
    </p>
  )
}

export default function OllamaSection({ form, set }: { form: Settings; set: SetSetting }) {
  const [health, setHealth] = useState<OllamaHealth | null>(null)
  const [checking, setChecking] = useState(false)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const [pulls, setPulls] = useState<Record<string, PullProgress>>({})
  const [custom, setCustom] = useState('')
  const [customError, setCustomError] = useState<string | null>(null)

  const url = useRef(form.ollamaUrl)
  url.current = form.ollamaUrl

  const check = useCallback(async () => {
    setChecking(true)
    try {
      setHealth(await api.checkOllama(url.current))
    } finally {
      setChecking(false)
    }
  }, [])

  // Check when Settings opens, and pick up downloads that were already running.
  useEffect(() => {
    void check()
    void api.pullStatus().then((list) => setPulls(Object.fromEntries(list.map((p) => [p.model, p]))))
  }, [check])

  useAppEvents((e) => {
    if (e.type !== 'ollama-pull') return
    setPulls((prev) => ({ ...prev, [e.model]: e }))
    if (e.done) void check()
  })

  const start = async () => {
    setStarting(true)
    setStartError(null)
    try {
      setHealth(await api.startOllama(url.current))
    } catch (err) {
      setStartError(cleanError(err))
      void check()
    } finally {
      setStarting(false)
    }
  }

  const pull = async (name: string) => {
    const model = name.trim()
    setCustomError(null)
    setPulls((prev) => ({ ...prev, [model]: { model, status: 'Starting' } }))
    try {
      await api.pullModel(model, url.current)
    } catch (err) {
      setPulls((prev) => ({ ...prev, [model]: { model, status: 'Failed', done: true, error: cleanError(err) } }))
      setCustomError(cleanError(err))
    }
  }

  const models = health?.models ?? []
  const reachable = !!health?.reachable

  return (
    <Section title="Ollama">
      <Field label="Server address" htmlFor="ollama-url" hint="The PC with the graphics card, for example http://192.168.1.50:11434. Use http://127.0.0.1:11434 for this PC.">
        <div className="flex gap-2">
          <input id="ollama-url" className={inputCls} value={form.ollamaUrl} onChange={(e) => set('ollamaUrl', e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void check()} />
          <button onClick={() => void check()} disabled={checking} className={buttonCls}>
            {checking ? 'Checking' : 'Check'}
          </button>
        </div>
      </Field>

      {!health ? (
        <div className="skeleton h-10 w-full" aria-busy aria-label="Checking Ollama" />
      ) : reachable ? (
        <Note icon={<CheckIcon size={15} />}>
          <span>
            Ollama {health.version} is running{health.local ? ' on this PC' : ''}. {models.length} {models.length === 1 ? 'model' : 'models'} pulled.
          </span>
        </Note>
      ) : health.local && health.installed ? (
        <Note tone="warn" icon={<WarningCircleIcon size={15} />}>
          <span>Ollama is installed on this PC but not running.</span>
          <div>
            <button onClick={() => void start()} disabled={starting} className={`${buttonCls} inline-flex h-8 items-center gap-1.5`}>
              <PlayIcon size={13} weight="fill" />
              {starting ? 'Starting' : 'Start Ollama'}
            </button>
          </div>
          {startError && <span className="text-xs">{startError}</span>}
        </Note>
      ) : health.local ? (
        <Note tone="warn" icon={<WarningCircleIcon size={15} />}>
          <span>Ollama is not installed on this PC.</span>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => void api.openExternal(DOWNLOAD_URL)} className={`${buttonCls} inline-flex h-8 items-center gap-1.5`}>
              Download Ollama
              <ArrowUpRightIcon size={13} />
            </button>
            <span className="text-xs text-muted">
              or run <code className="rounded-[5px] bg-selected px-1 py-px">winget install Ollama.Ollama</code>
            </span>
          </div>
          <span className="text-xs text-muted">After installing, press Check.</span>
        </Note>
      ) : (
        <Note tone="warn" icon={<WarningCircleIcon size={15} />}>
          <span>{health.error ?? `Can't reach Ollama at ${health.url}.`}</span>
        </Note>
      )}

      <Field label="Chat model" htmlFor="chat-model" hint="Answers your questions in the Assistant. It needs tool calling.">
        <ModelSelect id="chat-model" value={form.chatModel} models={models} onChange={(v) => set('chatModel', v)} forChat />
        {reachable && form.chatModel && !isPulled(models, form.chatModel) && <NotPulled model={form.chatModel} pull={pulls[form.chatModel]} onPull={(m) => void pull(m)} />}
      </Field>

      <Field label="Tagging model" htmlFor="tag-model" hint="Sorts your mail. Leave it on the chat model so the graphics card never swaps models; pick a smaller one if tagging is slow.">
        <ModelSelect id="tag-model" value={form.classifierModel} models={models} onChange={(v) => set('classifierModel', v)} emptyLabel="Same as chat model" />
        {reachable && form.classifierModel && !isPulled(models, form.classifierModel) && (
          <NotPulled model={form.classifierModel} pull={pulls[form.classifierModel]} onPull={(m) => void pull(m)} />
        )}
      </Field>

      <div className="flex flex-col gap-2">
        <div className="text-[13px] font-medium text-ink-soft">Get a model</div>
        <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-[12px] bg-field">
          {RECOMMENDED_MODELS.map((m) => {
            const p = pulls[m.name]
            const installed = isPulled(models, m.name)
            return (
              <li key={m.name} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0">
                  <div className="text-[13px] font-medium">
                    {m.name} <span className="font-normal text-muted tabular-nums">{m.size}</span>
                  </div>
                  <div className="text-xs leading-snug text-muted">{p?.error && p.done ? <span className="text-danger">{p.error}</span> : m.note}</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {downloading(p) ? (
                    <>
                      <div className="flex flex-col items-end gap-1">
                        <ProgressBar pct={percent(p)} label={`Downloading ${m.name}`} />
                        <span className="text-[11px] text-muted tabular-nums">
                          {p!.status}
                          {percent(p) !== null && ` ${percent(p)}%`}
                        </span>
                      </div>
                      <button onClick={() => void api.cancelPull(m.name)} className="press grid h-7 w-7 place-items-center rounded-[8px] text-muted hover:bg-hover hover:text-ink" aria-label={`Cancel ${m.name}`} title="Cancel">
                        <XIcon size={13} />
                      </button>
                    </>
                  ) : installed ? (
                    <span className="flex items-center gap-1 text-xs text-muted">
                      <CheckIcon size={13} />
                      Pulled
                    </span>
                  ) : (
                    <button onClick={() => void pull(m.name)} disabled={!reachable} title={reachable ? undefined : 'Start Ollama first'} className="press flex h-7 items-center gap-1.5 rounded-[8px] bg-selected px-2.5 text-xs font-medium hover:opacity-80 disabled:opacity-50">
                      <DownloadSimpleIcon size={13} />
                      {p?.error && p.done ? 'Retry' : 'Pull'}
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
        <div className="flex gap-2">
          <input
            className={inputCls}
            aria-label="Another model to pull"
            placeholder="Another model, for example llama3.1:8b"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && reachable && isValidModelName(custom.trim())) {
                void pull(custom)
                setCustom('')
              }
            }}
          />
          <button
            onClick={() => {
              void pull(custom)
              setCustom('')
            }}
            disabled={!reachable || !isValidModelName(custom.trim())}
            className={buttonCls}
          >
            Pull
          </button>
        </div>
        {customError && <p className="text-xs text-danger">{customError}</p>}
        <p className="text-xs leading-relaxed text-muted">
          Models download onto the Ollama PC and can take several minutes. Browse more at{' '}
          <button onClick={() => void api.openExternal('https://ollama.com/library')} className="press underline underline-offset-2">
            ollama.com/library
          </button>
          .
        </p>
      </div>

      <Field
        label="Parallel requests"
        htmlFor="parallel"
        hint="0 is Auto: MailSort measures the speed and picks. A fixed number should match OLLAMA_NUM_PARALLEL on the Ollama PC."
      >
        <input id="parallel" className={`${inputCls} w-24`} type="number" min={0} max={16} value={form.llmConcurrency} onChange={(e) => set('llmConcurrency', Number(e.target.value))} />
      </Field>
    </Section>
  )
}
