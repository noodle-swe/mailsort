/**
 * Measures tagging accuracy and speed on the labeled fixtures against a real Ollama.
 *
 *   npm run eval -- --url http://192.168.1.50:11434 --model qwen2.5:7b [--llm-only] [--concurrency 4]
 *
 * --llm-only sends every email to the model (skips rules) to judge the model on its own.
 */
import { createOllamaClassifier } from '../src/core/classify/llm'
import { applyRules, RULE_ACCEPT, type Verdict } from '../src/core/classify/rules'
import { TAGS, type Tag } from '../src/core/tags'
import { FIXTURES } from '../test/helpers'

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const url = arg('url', process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434')
const model = arg('model', process.env.OLLAMA_MODEL ?? 'qwen2.5:7b')
const concurrency = Number(arg('concurrency', '4'))
const llmOnly = process.argv.includes('--llm-only')

interface Row {
  subject: string
  expected: Tag
  got: Tag
  source: 'rule' | 'llm'
  ms: number
  reason: string
}

async function main() {
  const classifier = createOllamaClassifier({ url, model })
  const rows: Row[] = []
  const queue = FIXTURES.map((f, i) => ({ f, i }))
  const started = Date.now()

  // Warm up: the first request loads the model into GPU memory and would skew timings.
  process.stdout.write(`Loading ${model} on ${url}… `)
  const t0 = Date.now()
  await classifier.classify(FIXTURES[0], [])
  console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s`)

  const worker = async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      const { f } = item
      const rule = llmOnly ? null : applyRules(f)
      let verdict: Verdict
      let source: Row['source'] = 'rule'
      const t = Date.now()
      if (rule && rule.confidence >= RULE_ACCEPT) verdict = rule
      else {
        verdict = await classifier.classify(f, [])
        source = 'llm'
      }
      rows.push({ subject: f.subject ?? '', expected: f.expected, got: verdict.tag, source, ms: Date.now() - t, reason: verdict.reason })
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
  const wall = Date.now() - started

  const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(0)}%` : '-')
  const correct = rows.filter((r) => r.got === r.expected)
  const llm = rows.filter((r) => r.source === 'llm')
  const ruleRows = rows.filter((r) => r.source === 'rule')
  const avgLlm = llm.length ? llm.reduce((a, r) => a + r.ms, 0) / llm.length : 0

  console.log(`\nModel ${model}${llmOnly ? ' (LLM only)' : ''}: ${correct.length}/${rows.length} correct (${pct(correct.length, rows.length)})`)
  console.log(`  rules: ${ruleRows.filter((r) => r.got === r.expected).length}/${ruleRows.length} correct (${pct(ruleRows.length, rows.length)} of emails, 0 ms)`)
  console.log(`  model: ${llm.filter((r) => r.got === r.expected).length}/${llm.length} correct, avg ${avgLlm.toFixed(0)} ms/email`)
  console.log(`  wall time ${(wall / 1000).toFixed(1)}s with concurrency ${concurrency}\n`)

  // Confusion matrix: rows = expected, columns = predicted.
  const short = (t: string) => t.replace('Needs Attention', 'NeedsAtt').slice(0, 8).padStart(8)
  console.log('expected \\ got  ' + TAGS.map(short).join(' '))
  for (const e of TAGS) {
    const cells = TAGS.map((g) => String(rows.filter((r) => r.expected === e && r.got === g).length || '.').padStart(8))
    console.log(short(e).padEnd(16) + cells.join(' '))
  }

  const wrong = rows.filter((r) => r.got !== r.expected)
  if (wrong.length) {
    console.log('\nMistakes:')
    for (const r of wrong) console.log(`  [${r.source}] "${r.subject}": expected ${r.expected}, got ${r.got} (${r.reason})`)
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
