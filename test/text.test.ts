import { describe, expect, it } from 'vitest'
import { cleanBody, extractLinkDomains, formatForModel, htmlToText, parseAddress } from '../src/core/text'

describe('cleanBody', () => {
  it('drops quoted replies after "On ... wrote:"', () => {
    const body = 'Thanks, see you Tuesday.\n\nOn Mon, Oct 6, 2026 at 9:00 AM Jane <jane@x.com> wrote:\n> Are you free Tuesday?\n> Jane'
    expect(cleanBody(body)).toBe('Thanks, see you Tuesday.')
  })

  it('drops ">" quoted lines and the "--" signature', () => {
    expect(cleanBody('Hello\n> old text\nBody line\n-- \nJane Doe\nRecruiter')).toBe('Hello\nBody line')
  })

  it('drops Outlook reply headers only after the message has content', () => {
    const body = 'Sounds good.\nI will send the documents.\nBest, Sam\nFrom: Jane <jane@x.com>\nSent: Monday\nSubject: Docs'
    expect(cleanBody(body)).toBe('Sounds good.\nI will send the documents.\nBest, Sam')
  })

  it('replaces long URLs with their domain', () => {
    expect(cleanBody('Book here: https://calendly.com/jane/30min?utm_source=x&id=123 thanks')).toBe(
      'Book here: [link:calendly.com] thanks'
    )
  })

  it('collapses whitespace and truncates', () => {
    expect(cleanBody('a   b\n\n\n\nc', 100)).toBe('a b\n\nc')
    expect(cleanBody('x'.repeat(50), 10)).toHaveLength(10)
  })
})

describe('extractLinkDomains', () => {
  it('finds hosts in text and hrefs, without www and duplicates', () => {
    const html = '<a href="https://www.zoom.us/j/123">Join</a><a href="https://zoom.us/x">x</a>'
    expect(extractLinkDomains('see https://meet.google.com/abc', html).sort()).toEqual(['meet.google.com', 'zoom.us'])
  })
})

describe('htmlToText', () => {
  it('keeps text, skips styles and images', () => {
    const text = htmlToText('<style>p{color:red}</style><p>Hello <b>Sam</b></p><img src="x.png"><p>Bye</p>')
    expect(text).toContain('Hello Sam')
    expect(text).toContain('Bye')
    expect(text).not.toContain('color')
  })
})

describe('parseAddress', () => {
  it('parses name and address', () => {
    expect(parseAddress('"Jane Doe" <Jane@X.com>')).toEqual({ name: 'Jane Doe', addr: 'jane@x.com' })
    expect(parseAddress('jane@x.com')).toEqual({ name: null, addr: 'jane@x.com' })
    expect(parseAddress(null)).toEqual({ name: null, addr: null })
  })
})

describe('formatForModel', () => {
  it('limits the body sent to the model', () => {
    const out = formatForModel({ fromName: 'A', fromAddr: 'a@x.com', subject: 'S', body: 'y'.repeat(5000) })
    expect(out.startsWith('From: A <a@x.com>\nSubject: S\n\n')).toBe(true)
    expect(out.length).toBeLessThan(1300)
  })
})
