import { describe, expect, it } from 'vitest'
import { applyRules, domainRuleAllowed, RULE_ACCEPT } from '../src/core/classify/rules'
import { parseVerdict } from '../src/core/classify/llm'
import { FIXTURES } from './helpers'

describe('applyRules on the labeled fixtures', () => {
  it('is never confidently wrong (precision of accepted rule verdicts is 100%)', () => {
    const wrong = FIXTURES.map((f) => ({ f, v: applyRules(f) }))
      .filter(({ v }) => v && v.confidence >= RULE_ACCEPT)
      .filter(({ f, v }) => v!.tag !== f.expected)
      .map(({ f, v }) => `${f.subject}: expected ${f.expected}, rules said ${v!.tag} (${v!.reason})`)
    expect(wrong).toEqual([])
  })

  it('settles a good share of emails without the model', () => {
    const settled = FIXTURES.filter((f) => (applyRules(f)?.confidence ?? 0) >= RULE_ACCEPT).length
    expect(settled / FIXTURES.length).toBeGreaterThan(0.5)
  })
})

describe('applyRules cases', () => {
  const base = {
    fromName: null,
    fromAddr: 'x@company.com',
    subject: '',
    text: '',
    linkDomains: [] as string[],
    hasCalendarInvite: false,
    listUnsubscribe: false,
    providerLabels: [] as string[]
  }

  it('prefers Rejected over Applied wording', () => {
    const v = applyRules({ ...base, subject: 'Your application', text: 'Thank you for applying. We regret to inform you that we will not be moving forward.' })
    expect(v?.tag).toBe('Rejected')
  })

  it('treats "verify your email to continue your application" as Needs Attention, not Junk', () => {
    const v = applyRules({ ...base, subject: 'Verify your email to continue your application', text: 'Click to verify your email.' })
    expect(v?.tag).toBe('Needs Attention')
  })

  it('calls a verification code junk with confidence, even from a job site', () => {
    const v = applyRules({ ...base, subject: 'Your verification code', text: 'Use code 4417 to sign in to your candidate portal.' })
    expect(v?.tag).toBe('Junk')
    expect(v!.confidence).toBeGreaterThanOrEqual(RULE_ACCEPT)
  })

  it('keeps a code sent mid-application out of Needs Attention', () => {
    const security = applyRules({
      ...base,
      fromAddr: 'no-reply@us.greenhouse-mail.io',
      subject: 'Security code for your application to Acme',
      text: 'Copy and paste this code into the application form: aB3dE9xZ. Enter it to complete your application.'
    })
    expect(security).toMatchObject({ tag: 'Junk' })
    expect(security!.confidence).toBeGreaterThanOrEqual(RULE_ACCEPT)

    const workday = applyRules({
      ...base,
      fromAddr: 'workday@myworkday.com',
      subject: 'Your one-time passcode',
      text: 'Use this one-time code 558201 to continue your application. It expires in 10 minutes.'
    })
    expect(workday?.tag).toBe('Junk')
  })

  it('still flags an incomplete application that has no code', () => {
    const v = applyRules({ ...base, subject: 'Action needed', text: 'Your application is incomplete. Please upload your resume to complete your application.' })
    expect(v?.tag).toBe('Needs Attention')
  })

  it('only looks for a code near the top, so a footer warning does not hide a real email', () => {
    const footer = `${'We would like to talk about the role. '.repeat(30)}Never share your verification code with anyone.`
    const v = applyRules({ ...base, subject: 'Next steps for your application', text: `Please complete your application form. ${footer}` })
    expect(v?.tag).toBe('Needs Attention')
  })

  it('does not treat a webinar newsletter with a Zoom link as a meeting', () => {
    const v = applyRules({ ...base, subject: 'Join our webinar', text: 'Meet our speakers', linkDomains: ['zoom.us'], listUnsubscribe: true })
    expect(v?.tag).toBe('Junk')
  })

  it('leaves recruiter outreach with an unsubscribe footer to the model', () => {
    const v = applyRules({ ...base, subject: 'Senior analyst role at Contoso', text: 'Would you be open to a chat about this position?', listUnsubscribe: true })
    expect(v === null || v.confidence < RULE_ACCEPT).toBe(true)
  })
})

describe('domainRuleAllowed', () => {
  it('blocks ATS and free-mail senders', () => {
    expect(domainRuleAllowed('no-reply@greenhouse.io')).toBe(false)
    expect(domainRuleAllowed('friend@gmail.com')).toBe(false)
    expect(domainRuleAllowed('news@uniqlo.com')).toBe(true)
  })
})

describe('parseVerdict', () => {
  it('parses valid JSON', () => {
    expect(parseVerdict('{"reason":"r","tag":"Meeting","confidence":0.8}')).toEqual({ tag: 'Meeting', confidence: 0.8, reason: 'r' })
  })
  it('maps low confidence to Other', () => {
    expect(parseVerdict('{"reason":"r","tag":"Meeting","confidence":0.3}').tag).toBe('Other')
  })
  it('accepts lowercase tags and recovers from non-JSON output', () => {
    expect(parseVerdict('{"reason":"r","tag":"needs attention","confidence":0.9}').tag).toBe('Needs Attention')
    expect(parseVerdict('I think this is Rejected').tag).toBe('Rejected')
    expect(parseVerdict('nonsense').tag).toBe('Other')
  })
})
