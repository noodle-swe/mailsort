import { GoogleLogoIcon, MicrosoftOutlookLogoIcon } from '@phosphor-icons/react'
import type { Provider } from '../../../core/types'
import { useAppearance } from '../lib/appearance'
import { backdropById } from '../lib/backdrops'

/** First-run screen: shown until an account is connected. */
export default function Welcome({ configured, onAdd }: { configured?: Record<Provider, boolean>; onAdd: (p: Provider) => void }) {
  const photo = backdropById(useAppearance().backdrop)
  const missing = configured ? (['gmail', 'outlook'] as const).filter((p) => !configured[p]) : []
  return (
    <main className="glass fade flex min-w-0 flex-1 p-2.5">
      <div className="relative flex flex-1 items-end overflow-hidden rounded-[12px]">
        <img src={photo.photo} alt={photo.alt} className="kenburns absolute inset-0 h-full w-full object-cover" draggable={false} />
        <div className="absolute inset-0 bg-gradient-to-tr from-black/70 via-black/25 to-transparent" />
        <div className="enter relative max-w-xl p-10 text-white">
          <h1 className="text-[34px] leading-[1.1] font-semibold tracking-tight">Connect your inbox</h1>
          <p className="mt-3 max-w-[44ch] text-[15px] leading-relaxed text-white/85">
            Add as many Gmail and Outlook accounts as you need. One inbox, sorted by your own Ollama model.
          </p>
          <div className="mt-7 flex gap-2.5">
            <button
              onClick={() => onAdd('gmail')}
              disabled={configured && !configured.gmail}
              className="press flex h-10 items-center gap-2 rounded-[10px] bg-[#f3f6f2] px-4 text-[14px] font-medium text-[#17201b] hover:bg-white disabled:opacity-50"
            >
              <GoogleLogoIcon size={17} weight="bold" />
              Add Gmail
            </button>
            <button
              onClick={() => onAdd('outlook')}
              disabled={configured && !configured.outlook}
              className="press flex h-10 items-center gap-2 rounded-[10px] bg-white/15 px-4 text-[14px] font-medium text-white ring-1 ring-white/30 hover:bg-white/25 disabled:opacity-50"
            >
              <MicrosoftOutlookLogoIcon size={17} />
              Add Outlook
            </button>
          </div>
          {missing.length > 0 && (
            <p className="mt-5 max-w-[52ch] text-[13px] leading-relaxed text-white/75">
              {missing.map((p) => (p === 'gmail' ? 'Gmail' : 'Outlook')).join(' and ')} {missing.length > 1 ? 'are' : 'is'} not set up yet. Add the
              app IDs to .env as described in docs/SETUP.md, then restart MailSort.
            </p>
          )}
        </div>
      </div>
    </main>
  )
}
