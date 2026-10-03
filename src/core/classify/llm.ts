import { OllamaClient, type OllamaMessage } from '../ollama'
import { concurrencyCeiling } from './autotune'
import { TAGS, TAG_PRECEDENCE, normalizeTag, tagDefinitionsText } from '../tags'
import { formatForModel } from '../text'
import type { Correction } from '../store'
import type { ClassifyInput, Verdict } from './rules'

/** Below this the model's answer becomes "Other". */
export const MIN_LLM_CONFIDENCE = 0.5

export interface LlmClassifier {
  readonly model: string
  classify(email: ClassifyInput, examples: Correction[], signal?: AbortSignal): Promise<Verdict>
  /** How many requests the host can usefully run at once, once the model is loaded. Omitted = use the default. */
  concurrencyCeiling?(signal?: AbortSignal): Promise<number>
}

// "reason" comes first so small models think briefly before choosing the tag.
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    reason: { type: 'string' },
    tag: { type: 'string', enum: [...TAGS] },
    confidence: { type: 'number' }
  },
  required: ['reason', 'tag', 'confidence']
}

// Kept byte-for-byte stable so Ollama can reuse the cached prompt prefix across emails.
const SYSTEM_PROMPT = `You sort a job seeker's incoming emails. Choose exactly one tag.

Tags:
${tagDefinitionsText()}

Guidance:
- If several tags fit, choose the one that comes first in: ${TAG_PRECEDENCE.join(', ')}.
- Meeting: the company wants to talk, proposes times, or sends an interview/meeting invite or scheduling link.
- Questions: the company asks the candidate something or requests information, documents or an assessment (not a meeting).
- Needs Attention: the candidate's application is incomplete or a required step to submit it is missing.
- Applied: a confirmation that the application was received, with nothing else asked.
- Junk: newsletters, marketing, job alerts and digests, social notifications, receipts, password resets, verification codes, API keys.
- Other: anything else, or you cannot tell.
Answer with JSON: {"reason": "<at most 12 words>", "tag": "<one tag>", "confidence": <0 to 1>}.`

const FEW_SHOT: { email: string; answer: { reason: string; tag: string; confidence: number } }[] = [
  {
    email: 'From: Acme Careers <no-reply@acme.com>\nSubject: We received your application\n\nHi Sam, thanks for applying to Data Analyst. Our team will review your application.',
    answer: { reason: 'confirms application received', tag: 'Applied', confidence: 0.95 }
  },
  {
    email: 'From: Jane at Globex <jane@globex.com>\nSubject: Next steps\n\nHi Sam, we would love to set up a 30 minute call. Please pick a time here: [link:calendly.com]',
    answer: { reason: 'recruiter asks to schedule a call', tag: 'Meeting', confidence: 0.95 }
  },
  {
    email: 'From: Initech HR <hr@initech.com>\nSubject: Quick question about your application\n\nCould you tell us your notice period and whether you need visa sponsorship?',
    answer: { reason: 'company asks candidate questions', tag: 'Questions', confidence: 0.9 }
  },
  {
    email: 'From: Umbrella Talent <talent@umbrella.com>\nSubject: Your application to Umbrella\n\nThank you for your interest. After careful consideration we will not be moving forward with your application.',
    answer: { reason: 'company declines the application', tag: 'Rejected', confidence: 0.97 }
  },
  {
    email: 'From: Hooli Jobs <jobs@hooli.com>\nSubject: Action needed\n\nYour application is incomplete. Please upload your resume to submit it.',
    answer: { reason: 'application missing a required step', tag: 'Needs Attention', confidence: 0.9 }
  },
  {
    email: 'From: Job Board <alerts@jobboard.com>\nSubject: 25 new jobs for you\n\nSenior Analyst at Foo, Data Scientist at Bar... Unsubscribe',
    answer: { reason: 'automated job alert digest', tag: 'Junk', confidence: 0.95 }
  },
  {
    email: 'From: Mom <mom@example.com>\nSubject: Dinner Sunday?\n\nAre you coming for dinner on Sunday?',
    answer: { reason: 'personal email unrelated to job applications', tag: 'Other', confidence: 0.9 }
  }
]

const FEW_SHOT_MESSAGES: OllamaMessage[] = FEW_SHOT.flatMap((ex) => [
  { role: 'user' as const, content: ex.email },
  { role: 'assistant' as const, content: JSON.stringify(ex.answer) }
])

function correctionMessages(examples: Correction[]): OllamaMessage[] {
  return examples.flatMap((c) => [
    {
      role: 'user' as const,
      content: formatForModel({ fromName: null, fromAddr: c.fromAddr, subject: c.subject, body: c.excerpt })
    },
    {
      role: 'assistant' as const,
      content: JSON.stringify({ reason: 'the user tagged this email themselves', tag: c.toTag, confidence: 1 })
    }
  ])
}

export function parseVerdict(content: string): Verdict {
  let raw: { tag?: unknown; confidence?: unknown; reason?: unknown } = {}
  try {
    raw = JSON.parse(content)
  } catch {
    const m = content.match(new RegExp(`(${TAGS.join('|')})`, 'i'))
    raw = { tag: m?.[1], confidence: 0.5, reason: 'unparsed model output' }
  }
  const tag = normalizeTag(raw.tag)
  const confidence = typeof raw.confidence === 'number' && Number.isFinite(raw.confidence) ? Math.min(1, Math.max(0, raw.confidence)) : 0.5
  const reason = typeof raw.reason === 'string' ? raw.reason.slice(0, 200) : ''
  if (!tag || confidence < MIN_LLM_CONFIDENCE) {
    return { tag: 'Other', confidence, reason: reason || 'model was unsure' }
  }
  return { tag, confidence, reason }
}

export function createOllamaClassifier(opts: { url: string; model: string }): LlmClassifier {
  const client = new OllamaClient(opts.url)
  return {
    model: opts.model,
    async classify(email, examples, signal) {
      const res = await client.chat(
        {
          model: opts.model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            ...FEW_SHOT_MESSAGES,
            ...correctionMessages(examples),
            {
              role: 'user',
              content: formatForModel({ fromName: email.fromName, fromAddr: email.fromAddr, subject: email.subject, body: email.text })
            }
          ],
          format: RESPONSE_SCHEMA,
          // Reasoning models (qwen3 and similar) would spend the whole num_predict budget thinking and return no answer.
          think: false,
          options: { temperature: 0, num_ctx: 3072, num_predict: 80 },
          keep_alive: '30m'
        },
        signal
      )
      return parseVerdict(res.message.content)
    },
    async concurrencyCeiling(signal) {
      const loaded = (await client.running(signal)).find((m) => m.name === opts.model || m.model === opts.model)
      return concurrencyCeiling(loaded)
    }
  }
}
