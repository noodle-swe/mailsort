import type { ReactNode } from 'react'

export const inputCls = 'h-9 w-full rounded-[10px] bg-field px-3 text-[13px] outline-none placeholder:text-muted focus:bg-selected'
export const buttonCls = 'press h-9 shrink-0 rounded-[10px] bg-field px-3.5 text-[13px] font-medium hover:bg-selected disabled:opacity-50'

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h3 className="text-[14px] font-semibold tracking-tight">{title}</h3>
      {children}
    </section>
  )
}

export function Field({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor?: string; children: ReactNode }) {
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
