import { runCommand } from './ffmpeg-utils'

export type WhisperRunner = { executable: string; prefix: string[] }

const MAC_PYTHON_CANDIDATES = [
  process.env.WHISPER_PYTHON,
  'python3',
  '/opt/homebrew/bin/python3',
  '/usr/local/bin/python3',
  '/Library/Frameworks/Python.framework/Versions/3.13/bin/python3',
  '/Library/Frameworks/Python.framework/Versions/3.12/bin/python3',
  '/Library/Frameworks/Python.framework/Versions/3.11/bin/python3',
  '/Library/Frameworks/Python.framework/Versions/3.10/bin/python3'
].filter((p): p is string => Boolean(p))

export function pythonPathsForMac(): string[] {
  const bins = new Set<string>()
  for (const p of MAC_PYTHON_CANDIDATES) {
    if (p.includes('/')) bins.add(p.slice(0, p.lastIndexOf('/')))
    else bins.add('/usr/bin')
  }
  return [...bins]
}

async function pythonHasWhisper(pythonExe: string): Promise<boolean> {
  try {
    await runCommand(pythonExe, ['-m', 'whisper', '--help'])
    return true
  } catch {
    return false
  }
}

export async function findWhisperRunner(): Promise<WhisperRunner | null> {
  const tried = new Set<string>()
  for (const candidate of MAC_PYTHON_CANDIDATES) {
    if (tried.has(candidate)) continue
    tried.add(candidate)
    if (await pythonHasWhisper(candidate)) {
      return { executable: candidate, prefix: ['-m', 'whisper'] }
    }
  }
  try {
    await runCommand('whisper', ['--help'])
    return { executable: 'whisper', prefix: [] }
  } catch {
    return null
  }
}

export async function getWhisperInstallHint(): Promise<string> {
  const runner = await findWhisperRunner()
  if (runner) {
    return runner.executable === 'whisper'
      ? 'Local Whisper CLI is available.'
      : `Local Whisper OK (${runner.executable} -m whisper).`
  }
  const py = process.env.WHISPER_PYTHON ?? 'python3'
  return `Install: ${py} -m pip install openai-whisper — or use OpenAI API in Review / Settings.`
}
