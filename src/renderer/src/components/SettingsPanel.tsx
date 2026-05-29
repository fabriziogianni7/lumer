import { useEffect, useState } from 'react'
import { loadOpenAiKey, saveOpenAiKey } from '../lib/settings'

export function SettingsPanel() {
  const [key, setKey] = useState('')
  const [envKey, setEnvKey] = useState(false)
  const [saved, setSaved] = useState(false)
  const [whisper, setWhisper] = useState<{ installed: boolean; hint: string; python: string | null } | null>(
    null
  )

  const refresh = () => {
    setKey(loadOpenAiKey())
    void window.loomAgent.getOpenAiKeyStatus().then((s) => setEnvKey(s.hasEnvKey))
    void window.loomAgent.getWhisperStatus().then(setWhisper)
  }

  useEffect(() => {
    refresh()
  }, [])

  const save = () => {
    saveOpenAiKey(key)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <fieldset className="process-fieldset settings-panel">
      <legend>Settings</legend>

      <p className="muted settings-help">
        <strong>Local Whisper</strong> — install once in Terminal:{' '}
        <code>python3 -m pip install openai-whisper</code>
      </p>
      {whisper && (
        <p className={whisper.installed ? 'success settings-env' : 'warn'}>
          {whisper.installed
            ? `Whisper ready (${whisper.python ?? 'python3'})`
            : whisper.hint}
        </p>
      )}
      <button type="button" className="btn secondary small" onClick={refresh}>
        Check Whisper
      </button>

      <p className="muted settings-help" style={{ marginTop: '1rem' }}>
        <strong>OpenAI API</strong> — optional cloud subtitles (Settings or <code>.env</code>).
      </p>
      <label>
        OpenAI API key
        <input
          type="password"
          placeholder="sk-…"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          autoComplete="off"
        />
      </label>
      {envKey && <p className="success settings-env">OPENAI_API_KEY detected from .env</p>}
      <button type="button" className="btn secondary small" onClick={save}>
        {saved ? 'Saved' : 'Save key'}
      </button>
    </fieldset>
  )
}
