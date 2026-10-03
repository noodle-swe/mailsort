import { convert } from 'html-to-text'

/** Cleaned body text kept per message (enough for search and classification). */
export const BODY_TEXT_LIMIT = 4000
/** Characters of body text the LLM sees. */
export const LLM_TEXT_LIMIT = 1200

const HTML_OPTIONS = {
  wordwrap: false as const,
  preserveNewlines: false,
  selectors: [
    { selector: 'a', options: { ignoreHref: true } },
    { selector: 'img', format: 'skip' },
    { selector: 'style', format: 'skip' },
    { selector: 'script', format: 'skip' },
    { selector: 'head', format: 'skip' },
    { selector: 'table', format: 'block' },
    { selector: 'tr', format: 'block' },
    { selector: 'td', format: 'inline' },
    { selector: 'th', format: 'inline' }
  ],
  limits: { maxInputLength: 400_000 }
}

export function htmlToText(html: string): string {
  try {
    return convert(html, HTML_OPTIONS)
  } catch {
    return html.replace(/<[^>]+>/g, ' ')
  }
}

const URL_RE = /\bhttps?:\/\/[^\s<>"')\]]+/gi
const HREF_RE = /href\s*=\s*["']?(https?:\/\/[^"'\s>]+)/gi

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
}

/** Hostnames linked from the body (text URLs and HTML hrefs), deduplicated, at most 30. */
export function extractLinkDomains(text: string | null, html?: string | null): string[] {
  const hosts = new Set<string>()
  for (const m of (text ?? '').matchAll(URL_RE)) {
    const h = hostOf(m[0])
    if (h) hosts.add(h)
  }
  for (const m of (html ?? '').matchAll(HREF_RE)) {
    const h = hostOf(m[1])
    if (h) hosts.add(h)
  }
  return [...hosts].slice(0, 30)
}

/** Lines that start the quoted part of a reply/forward; everything after is dropped. */
const QUOTE_START = [
  /^On .{4,200}wrote:\s*$/,
  /^-{2,}\s*(Original Message|Forwarded message)\s*-{2,}/i,
  /^_{10,}\s*$/,
  /^From:\s.+$/, // Outlook-style reply header block
  /^Le .{4,200}a écrit\s*:\s*$/,
  /^Am .{4,200}schrieb .{0,100}:\s*$/,
  /^El .{4,200}escribió:\s*$/
]

/**
 * Normalizes a body for storage and classification: strips quoted replies, "--" signatures and
 * long tracking URLs (replaced by [link:domain]), collapses whitespace and truncates.
 */
export function cleanBody(text: string, limit = BODY_TEXT_LIMIT): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const kept: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd()
    const trimmed = line.trim()
    if (trimmed.startsWith('>')) continue
    const hasContent = kept.some((l) => l.trim())
    // A "From:" line only starts a quote once the message itself has a few lines.
    const minLines = trimmed.startsWith('From:') ? 3 : 1
    if (hasContent && kept.length >= minLines && QUOTE_START.some((re) => re.test(trimmed))) break
    if (trimmed === '--') break // signature delimiter
    kept.push(line)
  }
  return kept
    .join('\n')
    .replace(URL_RE, (url) => {
      const h = hostOf(url)
      return h ? `[link:${h}]` : ''
    })
    .replace(/[ \t ​-‍﻿͏]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, limit)
}

/** Parses `"Jane Doe" <jane@x.com>` into name and address. */
export function parseAddress(value: string | null | undefined): { name: string | null; addr: string | null } {
  if (!value) return { name: null, addr: null }
  const m = value.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/)
  if (m) return { name: m[1].trim() || null, addr: m[2].trim().toLowerCase() }
  const addr = value.match(/[^\s<>"]+@[^\s<>"]+/)?.[0]?.toLowerCase() ?? null
  return { name: addr ? null : value.trim(), addr }
}

/** Compact, model-friendly rendering of an email. */
export function formatForModel(e: { fromName: string | null; fromAddr: string | null; subject: string | null; body: string | null }): string {
  const from = [e.fromName, e.fromAddr ? `<${e.fromAddr}>` : null].filter(Boolean).join(' ')
  const body = (e.body ?? '').slice(0, LLM_TEXT_LIMIT)
  return `From: ${from || 'unknown'}\nSubject: ${e.subject ?? '(no subject)'}\n\n${body}`
}
