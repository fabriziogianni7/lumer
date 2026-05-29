import { join, dirname, basename, extname } from 'path'
import { mkdir, writeFile, readFile, copyFile, rename } from 'fs/promises'
import { existsSync } from 'fs'
import {
  probeDuration,
  runFfmpeg,
  trimToQuickTimeMp4,
  concatToQuickTimeMp4,
  encodeQuickTimeMp4,
  applyVideoSpeed
} from './ffmpeg-utils'
import { burnSubtitles, transcribeLocalWhisper, transcribeOpenAI } from './transcribe'
import { writeSubtitleExports } from './subtitles-export'

export type ProcessOptions = {
  trimStartSec: number
  trimEndSec: number | null
  cutSilence: boolean
  silenceThresholdDb: number
  minSilenceSec: number
  paddingSec: number
  transcription: 'local' | 'openai' | 'none'
  whisperModel: string
  openaiApiKey: string
  burnInSubtitles: boolean
  videoSpeed: number
  subtitleExport: 'srt' | 'vtt' | 'both'
}

export type ProcessResult = {
  editedVideoPath: string
  srtPath: string | null
  vttPath: string | null
  captionedVideoPath: string | null
  segmentsKept: number
  whisperAvailable: boolean
  transcriptionSource: 'local' | 'openai' | 'none'
  transcriptionError: string | null
}

type SpeechSegment = { start: number; end: number }

const isMp4 = (ext: string) => ext.toLowerCase() === '.mp4'

async function detectSilences(
  inputPath: string,
  thresholdDb: number,
  minSilenceSec: number
): Promise<{ silences: { start: number; end: number }[]; duration: number }> {
  const duration = await probeDuration(inputPath)
  const { stderr } = await runFfmpeg([
    '-i',
    inputPath,
    '-af',
    `silencedetect=noise=${thresholdDb}dB:d=${minSilenceSec}`,
    '-f',
    'null',
    '-'
  ])
  const silences: { start: number; end: number }[] = []
  let currentStart: number | null = null
  for (const line of stderr.split('\n')) {
    const startMatch = /silence_start: ([\d.]+)/.exec(line)
    if (startMatch) currentStart = parseFloat(startMatch[1])
    const endMatch = /silence_end: ([\d.]+)/.exec(line)
    if (endMatch && currentStart != null) {
      silences.push({ start: currentStart, end: parseFloat(endMatch[1]) })
      currentStart = null
    }
  }
  return { silences, duration }
}

function silencesToSpeechSegments(
  silences: { start: number; end: number }[],
  duration: number,
  paddingSec: number
): SpeechSegment[] {
  if (duration <= 0) return []
  const sorted = [...silences].sort((a, b) => a.start - b.start)
  const speech: SpeechSegment[] = []
  let cursor = 0
  for (const s of sorted) {
    const speechEnd = s.start + paddingSec
    if (speechEnd - cursor >= 0.15) {
      speech.push({
        start: Math.max(0, cursor - paddingSec),
        end: Math.min(duration, speechEnd)
      })
    }
    cursor = Math.max(cursor, s.end - paddingSec)
  }
  if (duration - cursor >= 0.15) {
    speech.push({ start: Math.max(0, cursor - paddingSec), end: duration })
  }
  const merged: SpeechSegment[] = []
  for (const seg of speech) {
    const start = Math.max(0, seg.start)
    const end = Math.min(duration, seg.end)
    if (end - start < 0.15) continue
    const last = merged[merged.length - 1]
    if (last && start <= last.end + 0.05) last.end = Math.max(last.end, end)
    else merged.push({ start, end })
  }
  return merged
}

async function cutToSegments(
  inputPath: string,
  segments: SpeechSegment[],
  outputPath: string,
  workDir: string,
  ext: string
): Promise<void> {
  if (segments.length === 0) {
    if (isMp4(ext)) await encodeQuickTimeMp4(inputPath, outputPath)
    else await runFfmpeg(['-y', '-i', inputPath, '-c', 'copy', outputPath])
    return
  }

  const partPaths: string[] = []
  for (let i = 0; i < segments.length; i++) {
    const { start, end } = segments[i]
    const part = join(workDir, `part_${i}${ext}`)
    partPaths.push(part)
    if (isMp4(ext)) {
      await trimToQuickTimeMp4(inputPath, start, end, part)
    } else {
      await runFfmpeg([
        '-y',
        '-ss',
        start.toFixed(3),
        '-to',
        end.toFixed(3),
        '-i',
        inputPath,
        '-c',
        'copy',
        part
      ])
    }
  }
  const listPath = join(workDir, 'concat.txt')
  const listBody = partPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n')
  await writeFile(listPath, listBody)
  if (isMp4(ext)) {
    await concatToQuickTimeMp4(listPath, outputPath)
  } else {
    await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outputPath])
  }
}

async function trimVideo(
  inputPath: string,
  startSec: number,
  endSec: number,
  outputPath: string,
  ext: string
): Promise<void> {
  if (isMp4(ext)) {
    await trimToQuickTimeMp4(inputPath, startSec, endSec, outputPath)
    return
  }
  await runFfmpeg([
    '-y',
    '-ss',
    startSec.toFixed(3),
    '-to',
    endSec.toFixed(3),
    '-i',
    inputPath,
    '-c',
    'copy',
    outputPath
  ])
}

export async function processRecording(
  inputPath: string,
  options: ProcessOptions,
  onProgress: (message: string, percent?: number) => void
): Promise<ProcessResult> {
  const dir = dirname(inputPath)
  const stem = basename(inputPath, extname(inputPath))
  const ext = extname(inputPath) || '.mp4'
  const workDir = join(dir, `.loom-agent-${stem}`)
  if (!existsSync(workDir)) await mkdir(workDir, { recursive: true })

  onProgress('Preparing clip…', 5)
  const fullDuration = await probeDuration(inputPath)
  const trimEnd = options.trimEndSec ?? fullDuration
  const trimStart = Math.max(0, Math.min(options.trimStartSec, fullDuration))
  const trimEndClamped = Math.max(trimStart + 0.1, Math.min(trimEnd, fullDuration))

  const trimmedPath = join(workDir, `trimmed${ext}`)
  const needsTrim = trimStart > 0.05 || trimEndClamped < fullDuration - 0.05
  const workingInput = needsTrim ? trimmedPath : inputPath
  if (needsTrim) {
    onProgress('Applying manual trim…', 12)
    await trimVideo(inputPath, trimStart, trimEndClamped, trimmedPath, ext)
  }

  let speech: SpeechSegment[] = [{ start: 0, end: await probeDuration(workingInput) }]
  if (options.cutSilence) {
    onProgress('Detecting silent sections…', 22)
    const { silences, duration } = await detectSilences(
      workingInput,
      options.silenceThresholdDb,
      options.minSilenceSec
    )
    speech =
      silences.length === 0 && duration > 0
        ? [{ start: 0, end: duration }]
        : silencesToSpeechSegments(silences, duration, options.paddingSec)
    onProgress(`Cutting ${speech.length} speech segment(s)…`, 40)
  } else {
    onProgress('Skipping silence removal…', 35)
  }

  const editedPath = join(dir, `${stem}-edited${ext}`)
  if (options.cutSilence) {
    await cutToSegments(workingInput, speech, editedPath, workDir, ext)
  } else if (needsTrim) {
    await copyFile(workingInput, editedPath)
  } else {
    await copyFile(inputPath, editedPath)
  }

  if (isMp4(ext) && !options.cutSilence && !needsTrim) {
    onProgress('Optimizing for QuickTime…', 48)
    const tmp = `${editedPath}.qt.part`
    await encodeQuickTimeMp4(editedPath, tmp)
    await rename(tmp, editedPath)
  }

  if (isMp4(ext) && Math.abs(options.videoSpeed - 1) >= 0.02) {
    onProgress(`Applying ${options.videoSpeed}× speed…`, 52)
    const speedOut = join(workDir, `speed${ext}`)
    await applyVideoSpeed(editedPath, speedOut, options.videoSpeed)
    await copyFile(speedOut, editedPath)
  }

  let finalSrt: string | null = null
  let finalVtt: string | null = null
  let transcriptionError: string | null = null
  let whisperAvailable = false
  let transcriptionSource: ProcessResult['transcriptionSource'] = 'none'

  if (options.transcription === 'local') {
    onProgress('Generating subtitles (local Whisper)…', 62)
    const { srtPath, available, error } = await transcribeLocalWhisper(
      editedPath,
      workDir,
      options.whisperModel
    )
    whisperAvailable = available
    transcriptionSource = 'local'
    if (error) transcriptionError = error
    if (srtPath) {
      finalSrt = join(dir, `${stem}-edited.srt`)
      const exported = await writeSubtitleExports(
        await readFile(srtPath, 'utf8'),
        finalSrt,
        options.subtitleExport
      )
      finalSrt = exported.srtPath
      finalVtt = exported.vttPath
    }
  } else if (options.transcription === 'openai') {
    if (!options.openaiApiKey.trim()) {
      throw new Error(
        'OpenAI API key is required. Add it in Settings, Review, or set OPENAI_API_KEY in .env'
      )
    }
    onProgress('Generating subtitles (OpenAI)…', 62)
    const srtPath = await transcribeOpenAI(editedPath, workDir, options.openaiApiKey.trim())
    whisperAvailable = true
    transcriptionSource = 'openai'
    finalSrt = join(dir, `${stem}-edited.srt`)
    const exported = await writeSubtitleExports(
      await readFile(srtPath, 'utf8'),
      finalSrt,
      options.subtitleExport
    )
    finalSrt = exported.srtPath
    finalVtt = exported.vttPath
  }

  let captionedVideoPath: string | null = null
  if (options.burnInSubtitles) {
    if (!finalSrt) {
      throw new Error('Burn-in subtitles requires transcription to be enabled.')
    }
    onProgress('Burning subtitles into video…', 82)
    captionedVideoPath = join(dir, `${stem}-edited-captioned.mp4`)
    await burnSubtitles(editedPath, finalSrt, captionedVideoPath)
  }

  onProgress('Done', 100)
  return {
    editedVideoPath: editedPath,
    srtPath: finalSrt,
    vttPath: finalVtt,
    captionedVideoPath,
    segmentsKept: speech.length,
    whisperAvailable,
    transcriptionSource,
    transcriptionError
  }
}
