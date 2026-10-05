import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, posix, win32 } from 'node:path'

export interface LocalEnv {
  platform: NodeJS.Platform
  env: Record<string, string | undefined>
  exists: (path: string) => boolean
}

const real = (): LocalEnv => ({ platform: process.platform, env: process.env, exists: existsSync })

/** Where the Ollama program usually lives, then every folder on PATH. */
export function candidatePaths({ platform, env }: Pick<LocalEnv, 'platform' | 'env'>): string[] {
  const path = platform === 'win32' ? win32 : posix
  const exe = platform === 'win32' ? 'ollama.exe' : 'ollama'
  const known: string[] = []
  if (platform === 'win32') {
    if (env.LOCALAPPDATA) known.push(path.join(env.LOCALAPPDATA, 'Programs', 'Ollama', exe))
    if (env.ProgramFiles) known.push(path.join(env.ProgramFiles, 'Ollama', exe))
  } else if (platform === 'darwin') {
    known.push('/Applications/Ollama.app/Contents/Resources/ollama', '/opt/homebrew/bin/ollama', '/usr/local/bin/ollama')
  } else {
    known.push('/usr/local/bin/ollama', '/usr/bin/ollama')
  }
  const onPath = (env.PATH ?? env.Path ?? '')
    .split(platform === 'win32' ? ';' : delimiter)
    .filter(Boolean)
    .map((dir) => path.join(dir, exe))
  return [...new Set([...known, ...onPath])]
}

/** The Ollama program on this PC, or null when it is not installed. */
export function findOllamaBinary(e: LocalEnv = real()): string | null {
  return candidatePaths(e).find((p) => e.exists(p)) ?? null
}

/** Starts the Ollama server in the background, the way \`ollama serve\` would. It keeps running after MailSort closes. */
export function startOllamaProcess(binary: string): void {
  const child = spawn(binary, ['serve'], { detached: true, stdio: 'ignore', windowsHide: true })
  child.on('error', () => undefined) // a blocked or missing program is reported by the follow-up health check
  child.unref()
}
