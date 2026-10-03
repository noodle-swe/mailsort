/**
 * Fills a throwaway data directory with the labeled fixture emails so the UI can be tried
 * without connecting a real account:
 *
 *   npx tsx scripts/seed-demo.ts C:\temp\mailsort-demo
 *   set MAILSORT_DATA_DIR=C:\temp\mailsort-demo && npm start
 *
 * Only rule-based tags are applied; the rest stay untagged for "Tag new emails" to pick up.
 */
import { join } from 'node:path'
import { Core } from '../src/core/core'
import { OllamaError } from '../src/core/ollama'
import { FIXTURES, toIncoming } from '../test/helpers'

const dir = process.argv[2]
if (!dir) {
  console.error('usage: tsx scripts/seed-demo.ts <data-dir>')
  process.exit(1)
}

const core = new Core({
  dbPath: join(dir, 'mail.db'),
  secrets: { encrypt: (s) => Buffer.from(s), decrypt: (b) => Buffer.from(b).toString() },
  clientIds: {},
  openUrl: () => undefined,
  createClassifier: () => ({
    model: 'none',
    classify: async () => {
      throw new OllamaError('demo: model step skipped', 'unreachable')
    }
  })
})

// Several mailboxes, as in real use: two Gmail accounts and one Outlook account.
const accounts = [
  { id: 'gmail-demo1', provider: 'gmail' as const, email: 'samlee.jobs@gmail.com' },
  { id: 'gmail-demo2', provider: 'gmail' as const, email: 'sam.lee.personal@gmail.com' },
  { id: 'outlook-demo', provider: 'outlook' as const, email: 'sam.lee@outlook.com' }
]
for (const a of accounts) core.store.insertAccount({ ...a, name: 'Sam', tokenEnc: new Uint8Array() })
const now = Date.now()
FIXTURES.forEach((f, i) => {
  core.store.upsertMessages(accounts[i % accounts.length].id, [toIncoming(f, i, now - (FIXTURES.length - i) * 47 * 60_000)])
})
void core.runTagging().then((result) => {
  console.log(`Seeded ${FIXTURES.length} emails into ${dir}; ${result.byRules} tagged by rules, ${result.total - result.byRules} left untagged.`)
  core.close()
})
