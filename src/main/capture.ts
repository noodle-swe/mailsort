import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Dev tooling: renders a few app states off-screen and saves PNGs (used for README screenshots).
 * Enabled with MAILSORT_CAPTURE=<dir>; pair it with MAILSORT_DATA_DIR pointing at a seeded demo folder.
 */
export async function captureScreens(win: BrowserWindow, outDir: string, prefix = ''): Promise<string[]> {
  mkdirSync(outDir, { recursive: true })
  const wc = win.webContents
  if (wc.isLoading()) await new Promise<void>((resolve) => wc.once('did-finish-load', () => resolve()))
  const saved: string[] = []
  const shot = async (name: string) => {
    const file = join(outDir, `${prefix}${name}.png`)
    writeFileSync(file, (await wc.capturePage()).toPNG())
    saved.push(file)
  }
  const click = (selector: string) => wc.executeJavaScript(`document.querySelector(${JSON.stringify(selector)})?.click()`)

  const clickText = (scope: string, text: string) =>
    wc.executeJavaScript(
      `[...document.querySelectorAll(${JSON.stringify(scope)})].find((b) => b.textContent.trim().startsWith(${JSON.stringify(text)}))?.click()`
    )

  await sleep(2500)
  await shot('overview')

  // A tag view with a filter on, two emails ticked for a bulk action, and the shortcuts sheet.
  await clickText('nav[aria-label="Tags"] button', 'Applied')
  await sleep(800)
  await clickText('[role="group"][aria-label="Filters"] button', 'Unread')
  await sleep(600)
  await shot('filters')
  await wc.executeJavaScript(`document.querySelectorAll('[role="checkbox"]').forEach((b, i) => i < 2 && b.click())`)
  await sleep(600)
  await shot('bulk')
  await click('button[aria-label^="Keyboard shortcuts"]')
  await sleep(600)
  await shot('shortcuts')
  await click('button[aria-label="Close shortcuts"]')
  await clickText('nav[aria-label="Mailboxes"] button', 'All inboxes')
  await sleep(800)

  await click('[data-row]')
  await sleep(3000) // the sandboxed email frame paints after the pane
  await shot('reading')
  await click('button[aria-label="Settings"]')
  await sleep(1200)
  await shot('settings')
  return saved
}
