import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

let cachedOpenAiKey: string | null = null

function parseEnvFile(path: string): void {
  if (!existsSync(path)) return
  const text = readFileSync(path, 'utf8')
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (key === 'OPENAI_API_KEY' && value && !process.env.OPENAI_API_KEY) {
      process.env.OPENAI_API_KEY = value
    }
    if (key === 'WHISPER_PYTHON' && value && !process.env.WHISPER_PYTHON) {
      process.env.WHISPER_PYTHON = value
    }
  }
}

export function loadProjectEnv(): void {
  const candidates = [
    join(process.cwd(), '.env'),
    join(app.getAppPath(), '.env'),
    join(app.getPath('userData'), '.env')
  ]
  for (const p of candidates) parseEnvFile(p)
}

export function getOpenAiKeyFromEnv(): string {
  if (cachedOpenAiKey != null) return cachedOpenAiKey
  loadProjectEnv()
  cachedOpenAiKey = process.env.OPENAI_API_KEY?.trim() ?? ''
  return cachedOpenAiKey
}
