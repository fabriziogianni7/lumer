const OPENAI_KEY = 'loom-agent.openaiApiKey'

export function loadOpenAiKey(): string {
  try {
    return localStorage.getItem(OPENAI_KEY) ?? ''
  } catch {
    return ''
  }
}

export function saveOpenAiKey(key: string): void {
  try {
    if (key.trim()) localStorage.setItem(OPENAI_KEY, key.trim())
    else localStorage.removeItem(OPENAI_KEY)
  } catch {
    /* ignore */
  }
}
