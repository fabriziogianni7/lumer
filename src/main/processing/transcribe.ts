import { join, basename, extname } from 'path'
import { readFile, writeFile, rename } from 'fs/promises'
import { existsSync } from 'fs'
import { runFfmpeg, runCommand, getBurnInVideoArgs } from './ffmpeg-utils'
import { findWhisperRunner, getWhisperInstallHint } from './whisper-resolve'
import { SCALE_VF } from './encode-quality'

function formatSrtTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const ms = Math.round((seconds % 1) * 1000)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`
}

async function buildSrtFromWhisperJson(jsonPath: string): Promise<string> {
  const raw = await readFile(jsonPath, 'utf8')
  const data = JSON.parse(raw) as {
    segments?: { start: number; end: number; text: string }[]
  }
  return (data.segments ?? [])
    .map((seg, i) => {
      const text = seg.text.trim()
      if (!text) return ''
      return `${i + 1}\n${formatSrtTime(seg.start)} --> ${formatSrtTime(seg.end)}\n${text}\n`
    })
    .filter(Boolean)
    .join('\n')
}

export async function transcribeLocalWhisper(
  videoPath: string,
  workDir: string,
  model: string
): Promise<{ srtPath: string | null; available: boolean; error?: string }> {
  const runner = await findWhisperRunner()
  if (!runner) {
    return {
      srtPath: null,
      available: false,
      error: await getWhisperInstallHint()
    }
  }

  const args = [
    ...runner.prefix,
    videoPath,
    '--model',
    model,
    '--output_format',
    'srt',
    '--output_dir',
    workDir
  ]

  try {
    await runCommand(runner.executable, args)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return {
      srtPath: null,
      available: true,
      error: msg.includes('ENOENT')
        ? await getWhisperInstallHint()
        : msg.slice(0, 500)
    }
  }

  const stem = basename(videoPath, extname(videoPath))
  const srtCandidate = join(workDir, `${stem}.srt`)
  if (existsSync(srtCandidate)) return { srtPath: srtCandidate, available: true }

  const jsonCandidate = join(workDir, `${stem}.json`)
  if (existsSync(jsonCandidate)) {
    const srt = await buildSrtFromWhisperJson(jsonCandidate)
    const out = join(workDir, `${stem}.srt`)
    await writeFile(out, srt)
    return { srtPath: out, available: true }
  }
  return { srtPath: null, available: true, error: 'Whisper finished but no subtitle file was produced.' }
}

async function extractAudioWav(videoPath: string, wavPath: string): Promise<void> {
  await runFfmpeg(['-y', '-i', videoPath, '-vn', '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1', wavPath])
}

export async function transcribeOpenAI(
  videoPath: string,
  workDir: string,
  apiKey: string
): Promise<string> {
  const wavPath = join(workDir, 'transcribe.wav')
  await extractAudioWav(videoPath, wavPath)
  const audioBytes = await readFile(wavPath)
  const blob = new Blob([audioBytes], { type: 'audio/wav' })
  const form = new FormData()
  form.append('file', blob, 'audio.wav')
  form.append('model', 'whisper-1')
  form.append('response_format', 'srt')

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`OpenAI transcription failed (${res.status}): ${body.slice(0, 500)}`)
  }
  const srt = await res.text()
  const out = join(workDir, 'openai.srt')
  await writeFile(out, srt)
  return out
}

export async function burnSubtitles(
  inputVideo: string,
  srtPath: string,
  outputVideo: string
): Promise<void> {
  const escaped = srtPath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "'\\''")
  const vf = `subtitles='${escaped}':force_style='FontName=Helvetica,FontSize=22,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=1,MarginV=40',${SCALE_VF}`
  const tmpOut = `${outputVideo}.part`
  const video = await getBurnInVideoArgs()
  await runFfmpeg([
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    inputVideo,
    '-map',
    '0:v:0',
    '-map',
    '0:a:0?',
    '-vf',
    vf,
    ...video,
    '-af',
    'aresample=48000:async=1:first_pts=0',
    '-c:a',
    'aac',
    '-b:a',
    '256k',
    '-ar',
    '48000',
    '-ac',
    '2',
    '-movflags',
    '+faststart',
    '-f',
    'mp4',
    tmpOut
  ])
  await rename(tmpOut, outputVideo)
}
