import { writeFile } from 'fs/promises'

export function srtToVtt(srt: string): string {
  const blocks = srt.replace(/\r/g, '').trim().split(/\n\n+/)
  const parts = ['WEBVTT', '']
  for (const block of blocks) {
    const lines = block.split('\n').filter(Boolean)
    const timeIdx = lines.findIndex((l) => l.includes('-->'))
    if (timeIdx < 0) continue
    const timeLine = lines[timeIdx].replace(/,/g, '.')
    const text = lines.slice(timeIdx + 1).join('\n')
    if (!text.trim()) continue
    parts.push(timeLine, text, '')
  }
  return parts.join('\n')
}

export async function writeSubtitleExports(
  srtContent: string,
  srtPath: string,
  exportFormats: 'srt' | 'vtt' | 'both'
): Promise<{ srtPath: string; vttPath: string | null }> {
  await writeFile(srtPath, srtContent)
  if (exportFormats === 'srt') return { srtPath, vttPath: null }
  const vttPath = srtPath.replace(/\.srt$/i, '.vtt')
  await writeFile(vttPath, srtToVtt(srtContent))
  if (exportFormats === 'vtt') return { srtPath, vttPath }
  return { srtPath, vttPath }
}
