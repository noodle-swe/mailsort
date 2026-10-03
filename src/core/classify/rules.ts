import type { Tag } from '../tags'

export interface ClassifyInput {
  fromName: string | null
  fromAddr: string | null
  subject: string | null
  /** Cleaned body text (falls back to the snippet). */
  text: string | null
  linkDomains: string[]
  hasCalendarInvite: boolean
  listUnsubscribe: boolean
  providerLabels: string[]
}

export interface Verdict {
  tag: Tag
  confidence: number
  reason: string
}

/** Rule verdicts at or above this confidence are final; below it the LLM decides. */
export const RULE_ACCEPT = 0.85

/** Applicant tracking systems: they send every kind of job email, so never treat them as newsletters. */
const ATS_DOMAINS = [
  'greenhouse.io', 'greenhouse-mail.io', 'lever.co', 'myworkday.com', 'myworkdayjobs.com', 'workday.com',
  'ashbyhq.com', 'smartrecruiters.com', 'icims.com', 'jobvite.com', 'workable.com', 'workablemail.com',
  'breezy.hr', 'bamboohr.com', 'recruitee.com', 'teamtailor.com', 'successfactors.com', 'taleo.net',
  'jazzhr.com', 'applytojob.com', 'rippling.com', 'pinpointhq.com', 'personio.com', 'personio.de',
  'join.com', 'wellfound.com', 'paylocity.com', 'ultipro.com', 'ukg.com', 'eightfold.ai', 'avature.net',
  'phenompeople.com', 'dover.com', 'hirebridge.com', 'oraclecloud.com', 'gem.com', 'trakstar.com'
]

const MEETING_DOMAINS = [
  'calendly.com', 'zoom.us', 'meet.google.com', 'teams.microsoft.com', 'teams.live.com', 'cal.com',
  'goodtime.io', 'webex.com', 'whereby.com', 'savvycal.com', 'chilipiper.com', 'meetings.hubspot.com',
  'modernloop.io', 'prelude.co', 'doodle.com', 'youcanbook.me', 'zcal.co', 'tidycal.com', 'coderpad.io',
  'outlook.office.com', 'outlook.office365.com'
]

/** Personal mailbox domains: one sender there says nothing about the rest of the domain. */
const FREE_MAIL_DOMAINS = ['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com', 'icloud.com', 'me.com', 'proton.me', 'protonmail.com', 'aol.com']

const JOB_RE = /\b(application|applied|applying|candida(te|cy)|position|role|interview|recruit(er|ers|ing|ment)|hiring|job|resume|cv|talent acquisition|opportunit(y|ies))\b/

const REJECT_STRONG_RE =
  /(regret to inform|decided (not )?to (move|proceed) forward with other|(move|moving|proceed|proceeding) forward with other candidates|not (to )?(be )?(move|moving|proceed|proceeding) forward with your (application|candidacy)|will not be (moving|proceeding) forward|won'?t be (moving|proceeding) forward|decided to pursue other candidates|position has (now )?been filled|not been selected|unable to offer you|will not be progressing|unsuccessful on this occasion|decided not to (move|proceed) forward|other applicants whose (experience|qualifications))/
const UNFORTUNATELY_RE = /\bunfortunately\b/

const APPLIED_RE =
  /(thanks?( you)? for (your )?(applying|application|interest in)|we('ve| have)? received your application|application (has been |was )?(received|submitted)|successfully (applied|submitted)|your application (to|for) .{0,80}(has been|was) (received|submitted)|we('ll| will) (carefully )?review your (application|resume|profile|background))/

const NEEDS_ATTENTION_RE =
  /(complete your application|finish (your|the) application|continue your application|application (is )?(incomplete|not (yet )?complete)|(haven'?t|have not|did not|didn'?t) (finish|complete)(d)? (your|the) application|missing (required )?(information|documents?)|complete the (assessment|questionnaire|application form))/

const OTP_RE =
  /(verification code|verify your (email|account|identity)|confirm your email( address)?|security code|one[- ]time (pass(word|code)|code)|\botp\b|your (login|sign[- ]in|access) code|password reset|reset your password|two[- ]factor|\b2fa\b|api key|access key|activation code|magic link|sign[- ]in link|new sign[- ]in|login attempt)/

const MEETING_WORDS_RE =
  /\b(interview|schedule|scheduling|availability|available times?|book a (time|slot)|pick a time|chat|call|meet|phone screen|screening|video call|time slot|invitation)\b/

const REQUEST_HINT_RE = /(please (send|provide|reply|answer|share|confirm|complete)|could you|can you|would you)/

const JOB_ALERT_RE =
  /(job alert|jobs? (for|matching) you|new jobs|recommended jobs|jobs you may|is hiring|people (also )?viewed|similar jobs|top jobs|job recommendations|weekly digest|newsletter)/

function matchesDomain(host: string, list: string[]): string | null {
  return list.find((d) => host === d || host.endsWith('.' + d)) ?? null
}

function senderDomain(addr: string | null): string | null {
  const at = addr?.lastIndexOf('@') ?? -1
  return at >= 0 ? addr!.slice(at + 1).toLowerCase() : null
}

export function isAtsSender(e: Pick<ClassifyInput, 'fromAddr' | 'linkDomains'>): boolean {
  const d = senderDomain(e.fromAddr)
  if (d && matchesDomain(d, ATS_DOMAINS)) return true
  return e.linkDomains.some((h) => matchesDomain(h, ATS_DOMAINS))
}

/** Whether a learned per-domain rule may apply to this sender (not for ATS or free-mail senders). */
export function domainRuleAllowed(fromAddr: string | null): boolean {
  const d = senderDomain(fromAddr)
  if (!d) return false
  return !matchesDomain(d, ATS_DOMAINS) && !matchesDomain(d, FREE_MAIL_DOMAINS)
}

/**
 * Deterministic tagging for the obvious cases. Checks run in tag precedence order
 * (Rejected > Meeting > Needs Attention > Applied > Junk), so the first hit wins.
 * Returns null when no rule applies.
 */
export function applyRules(e: ClassifyInput): Verdict | null {
  const subject = (e.subject ?? '').toLowerCase()
  const body = (e.text ?? '').toLowerCase()
  const all = `${subject}\n${body}`
  const head = `${subject}\n${body.slice(0, 600)}`
  const ats = isAtsSender(e)
  const jobRelated = ats || JOB_RE.test(all)

  if (REJECT_STRONG_RE.test(all)) {
    return { tag: 'Rejected', confidence: jobRelated ? 0.95 : 0.8, reason: 'rejection wording' }
  }

  if (e.hasCalendarInvite) {
    return { tag: 'Meeting', confidence: 0.92, reason: 'calendar invite attached' }
  }

  const meetingHost = e.linkDomains.map((h) => matchesDomain(h, MEETING_DOMAINS)).find(Boolean)
  if (meetingHost && MEETING_WORDS_RE.test(all) && !e.listUnsubscribe) {
    return { tag: 'Meeting', confidence: jobRelated ? 0.92 : 0.8, reason: `scheduling link (${meetingHost})` }
  }

  if (NEEDS_ATTENTION_RE.test(all) && jobRelated) {
    return { tag: 'Needs Attention', confidence: 0.88, reason: 'application not complete' }
  }

  if (OTP_RE.test(head)) {
    // "Verify your email to continue your application" is not junk; let the model look.
    return { tag: 'Junk', confidence: jobRelated ? 0.6 : 0.95, reason: 'verification / password / key email' }
  }

  if (APPLIED_RE.test(all) && !UNFORTUNATELY_RE.test(all)) {
    const asksSomething = REQUEST_HINT_RE.test(body)
    return { tag: 'Applied', confidence: asksSomething ? 0.7 : 0.9, reason: 'application received confirmation' }
  }

  if (e.listUnsubscribe && !ats && (!jobRelated || JOB_ALERT_RE.test(all))) {
    return { tag: 'Junk', confidence: 0.9, reason: 'newsletter / subscription' }
  }

  const promo = e.providerLabels.some((l) => l === 'CATEGORY_PROMOTIONS' || l === 'CATEGORY_SOCIAL')
  if (promo && !jobRelated) {
    return { tag: 'Junk', confidence: 0.88, reason: 'promotions / social category' }
  }

  return null
}
