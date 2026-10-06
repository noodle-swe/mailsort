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

  describe('invitations to book a call', () => {
    const invite = `Dear Sam,

Thank you for applying to the Applied AI Product Engineer (Remote Opportunity) at Acme. We would like to schedule a brief phone screen to discuss your background, experience, and the position.

Please use the scheduling link to select a time that works best for you.

https://acme.breezy.hr/pick-time/abc123

We look forward to speaking with you`

    it('calls a recruiter\'s "pick a time" email a Meeting, even though it starts by thanking you for applying', () => {
      // The booking page is on the applicant tracking system, not a known scheduling site.
      for (const linkDomains of [['acme.breezy.hr'], []]) {
        const v = applyRules({ ...base, fromAddr: 'recruiter@acme.com', subject: 'Phone screen invitation', text: invite, linkDomains })
        expect(v?.tag).toBe('Meeting')
        expect(v!.confidence).toBeGreaterThanOrEqual(RULE_ACCEPT)
      }
    })

    it('recognises other ways of inviting you to book', () => {
      const lead = 'Thank you for your application. '
      for (const line of [
        'We would like to invite you to an interview.',
        "I'd love to set up a call this week. Please pick a time that suits you.",
        'You are invited to a video interview, use the scheduling link below.',
        'Select a time that works for you and we will send the meeting details.'
      ]) {
        expect(applyRules({ ...base, subject: 'Next steps', text: lead + line })?.tag, line).toBe('Meeting')
      }
    })

    it('does not take a promise to schedule later for an invitation: that stays an application confirmation', () => {
      const v = applyRules({
        ...base,
        subject: 'Thank you for applying to Acme',
        text: "Thanks for applying to the Data Analyst role. If your experience matches our needs, we will contact you to schedule an interview. We'll be in touch."
      })
      expect(v?.tag).toBe('Applied')
    })

    it('does not take "if you are selected, you will receive an invitation" for an invitation', () => {
      // Wording from a real application confirmation: a promise about a later step.
      for (const text of [
        'Thank you for your application to Acme. If you are selected to move forward in the process, you will receive an invitation to a video screen (Google Meet) from our talent acquisition team.',
        'Thanks for applying. If your background is a good fit, you will receive a link to select a time for a call.',
        'Thanks for applying to Acme. We will send you a scheduling link if we would like to talk.'
      ]) {
        expect(applyRules({ ...base, subject: 'Thank you for your application to Acme', text })?.tag, text).toBe('Applied')
      }
    })

    it('still sees an invitation that says "if you are interested"', () => {
      const v = applyRules({ ...base, subject: 'Quick chat about the role', text: "If you're interested in this role, please pick a time that suits you." })
      expect(v?.tag).toBe('Meeting')
    })

    it('reads an "Interview invitation" subject as an invitation', () => {
      expect(applyRules({ ...base, subject: 'Interview invitation: Data Analyst at Acme', text: 'Hi Sam, details are in the attached document.' })?.tag).toBe('Meeting')
    })

    it('leaves bulk mail and non-job mail that offers to book a time alone', () => {
      const bulk = applyRules({ ...base, subject: 'Career coaching', text: 'Pick a time for a free session about your next role.', listUnsubscribe: true })
      expect(bulk?.tag).not.toBe('Meeting')
      const sales = applyRules({ ...base, subject: 'Book a demo', text: 'Pick a time that suits you to see our product.' })
      expect(sales?.tag).not.toBe('Meeting')
    })

    it('still lets a rejection win', () => {
      const v = applyRules({ ...base, subject: 'Your application', text: 'We regret to inform you that we will not be moving forward. Feel free to select a time to hear feedback.' })
      expect(v?.tag).toBe('Rejected')
    })
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
