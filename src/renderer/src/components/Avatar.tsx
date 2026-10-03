function initials(name: string | null, addr: string | null): string {
  const source = (name || addr?.split('@')[0] || '?').replace(/[^\p{L}\p{N}\s.]/gu, ' ').trim()
  const parts = source.split(/[\s.]+/).filter(Boolean)
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] ?? '?').slice(0, 2)
  return letters.toUpperCase()
}

/** Sender monogram in a rounded square. */
export default function Avatar({ name, addr, size = 32 }: { name: string | null; addr: string | null; size?: number }) {
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-[9px] bg-field font-medium text-ink-soft"
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {initials(name, addr)}
    </span>
  )
}
