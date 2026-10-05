import { CheckIcon } from '@phosphor-icons/react'
import { BACKDROPS } from '../lib/backdrops'
import { setAppearance, useAppearance, type Density, type Frost } from '../lib/appearance'
import { Field, Section } from './settings-ui'

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { id: T; name: string }[]; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-0.5 rounded-[10px] bg-field p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={`press h-8 flex-1 rounded-[8px] px-3 text-[13px] font-medium ${value === o.id ? 'bg-primary text-on-primary' : 'text-ink-soft hover:text-ink'}`}
        >
          {o.name}
        </button>
      ))}
    </div>
  )
}

const DENSITY: { id: Density; name: string }[] = [
  { id: 'comfortable', name: 'Comfortable' },
  { id: 'compact', name: 'Compact' }
]
const FROST: { id: Frost; name: string }[] = [
  { id: 'clear', name: 'Clear' },
  { id: 'frosted', name: 'Frosted' },
  { id: 'solid', name: 'Solid' }
]

/** Background photo, panel transparency and list density. These apply at once and stay on this PC. */
export default function AppearanceSection({ onResetLayout }: { onResetLayout: () => void }) {
  const a = useAppearance()
  return (
    <Section title="Appearance">
      <Field label="Background" hint="Photos from Unsplash. The overview and the frosted panels use the one you pick.">
        <div role="radiogroup" aria-label="Background" className="grid grid-cols-4 gap-2">
          {BACKDROPS.map((b) => {
            const on = a.backdrop === b.id
            return (
              <button
                key={b.id}
                role="radio"
                aria-checked={on}
                onClick={() => setAppearance({ backdrop: b.id })}
                title={`${b.name}, photo by ${b.credit}`}
                className="press group flex flex-col gap-1 text-left"
              >
                <span className={`relative block aspect-[16/10] overflow-hidden rounded-[10px] bg-field ring-offset-2 ring-offset-transparent transition-shadow duration-300 ${on ? 'shadow-[0_0_0_2px_var(--primary)]' : 'group-hover:shadow-[0_0_0_1.5px_var(--muted)]'}`}>
                  <img src={b.photo} alt={b.alt} loading="lazy" draggable={false} className="h-full w-full object-cover transition-transform duration-500 ease-[var(--ease-soft)] group-hover:scale-105" />
                  {on && (
                    <span className="pop-in absolute top-1 right-1 grid h-5 w-5 place-items-center rounded-full bg-primary text-on-primary">
                      <CheckIcon size={11} weight="bold" />
                    </span>
                  )}
                </span>
                <span className={`truncate text-xs ${on ? 'font-medium text-ink' : 'text-muted'}`}>{b.name}</span>
              </button>
            )
          })}
        </div>
      </Field>
      <Field label="Panels">
        <Segmented label="Panel style" value={a.frost} options={FROST} onChange={(frost) => setAppearance({ frost })} />
      </Field>
      <Field label="Email list">
        <Segmented label="List density" value={a.density} options={DENSITY} onChange={(density) => setAppearance({ density })} />
      </Field>
      <div>
        <button onClick={onResetLayout} className="press h-9 rounded-[10px] bg-field px-3.5 text-[13px] font-medium hover:bg-selected">
          Reset panel sizes
        </button>
      </div>
    </Section>
  )
}
