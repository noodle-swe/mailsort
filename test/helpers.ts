import { Core } from '../src/core/core'
import type { LlmClassifier } from '../src/core/classify/llm'
import type { ClassifyInput } from '../src/core/classify/rules'
import type { Tag } from '../src/core/tags'
import type { IncomingMessage } from '../src/core/types'
import fixtures from './fixtures/emails.json'

export interface Fixture extends ClassifyInput {
  expected: Tag
}

export const FIXTURES = fixtures as Fixture[]

export const plainSecrets = {
  encrypt: (s: string) => Buffer.from(s, 'utf8'),
  decrypt: (b: Uint8Array) => Buffer.from(b).toString('utf8')
}

/** A classifier that answers from a lookup by subject, counting calls. */
export function fakeClassifier(answers: Map<string, Tag>, opts: { fail?: Error } = {}): LlmClassifier & { calls: number } {
  return {
    model: 'fake',
    calls: 0,
    async classify(email) {
      this.calls++
      if (opts.fail) throw opts.fail
      return { tag: answers.get(email.subject ?? '') ?? 'Other', confidence: 0.9, reason: 'fake' }
    }
  }
}

export function makeCore(classifier?: LlmClassifier): Core {
  return new Core({
    dbPath: ':memory:',
    secrets: plainSecrets,
    clientIds: {},
    openUrl: () => undefined,
    createClassifier: classifier ? () => classifier : undefined
  })
}

export function toIncoming(f: Fixture, i: number, receivedAt = Date.UTC(2026, 8, 1) + i * 60_000): IncomingMessage {
  return {
    providerId: `m${i}`,
    threadId: `t${i}`,
    fromName: f.fromName,
    fromAddr: f.fromAddr,
    toAddrs: 'sam@example.com',
    subject: f.subject,
    snippet: (f.text ?? '').slice(0, 120),
    bodyText: f.text,
    linkDomains: f.linkDomains,
    hasCalendarInvite: f.hasCalendarInvite,
    listUnsubscribe: f.listUnsubscribe,
    hasAttachments: false,
    providerLabels: f.providerLabels,
    receivedAt,
    isRead: i % 3 === 0,
    webLink: null
  }
}

/** Core with one Gmail account holding every fixture email. */
export function seededCore(classifier?: LlmClassifier): { core: Core; accountId: string } {
  const core = makeCore(classifier)
  const accountId = 'gmail-test'
  core.store.insertAccount({ id: accountId, provider: 'gmail', email: 'sam@example.com', name: 'Sam', tokenEnc: plainSecrets.encrypt('{}') })
  core.store.upsertMessages(accountId, FIXTURES.map((f, i) => toIncoming(f, i)))
  return { core, accountId }
}
