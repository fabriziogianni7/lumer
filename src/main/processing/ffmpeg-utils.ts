import { spawn } from 'child_process'
import { rename, unlink } from 'fs/promises'
import ffmpegPath from 'ffmpeg-static'

export function getFfmpeg(): string {
  if (!ffmpegPath) throw new Error('ffmpeg-static binary not found')
  return ffmpegPath
}

export function runFfmpeg(args: string[]): Promise<{ stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(getFfmpeg(), args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    proc.on('error', reject)
    proc.stderr.on('data', (d) => {
      stderr += d.toString()
    })
    proc.on('close', (code) => {
      if (code === 0) resolve({ stderr })
      else reject(new Error(`ffmpeg failed (${code}): ${stderr.slice(-2500)}`))
    })
  })
}

export function runCommand(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PATH: process.env.PATH ?? '' }
    })
    let stdout = ''
    let stderr = ''
    proc.on('error', reject)
    proc.stdout.on('data', (d) => {
      stdout += d.toString()
    })
    proc.stderr.on('data', (d) => {
      stderr += d.toString()
    })
    proc.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr })
      else reject(new Error(`${cmd} failed (${code}): ${stderr.slice(-2500)}`))
    })
  })
}

export async function ffprobeStderr(inputPath: string): Promise<string> {
  try {
    const { stderr } = await runFfmpeg(['-hide_banner', '-i', inputPath, '-f', 'null', '-'])
    return stderr
  } catch (e) {
    if (e instanceof Error && 'message' in e) {
      const match = /ffmpeg failed \(\d+\): ([\s\S]*)$/.exec(e.message)
      if (match) return match[1]
    }
    throw e
  }
}

export async function probeDuration(inputPath: string): Promise<number> {
  const stderr = await ffprobeStderr(inputPath)
  const durMatch = /Duration: (\d+):(\d+):([\d.]+)/.exec(stderr)
  if (!durMatch) return 0
  return (
    parseInt(durMatch[1], 10) * 3600 +
    parseInt(durMatch[2], 10) * 60 +
    parseFloat(durMatch[3])
  )
}

export async function inputHasAudio(inputPath: string): Promise<boolean> {
  const stderr = await ffprobeStderr(inputPath)
  return /\n  Stream #\d+:\d+.*Audio:/.test(stderr)
}

/** H.264 + AAC MP4 tuned for QuickTime / macOS Preview. */
const QT_VIDEO = [
  '-c:v',
  'libx264',
  '-profile:v',
  'main',
  '-level',
  '4.0',
  '-pix_fmt',
  'yuv420p',
  '-preset',
  'fast',
  '-crf',
  '20',
  '-r',
  '30',
  '-fps_mode',
  'cfr',
  '-tag:v',
  'avc1'
]

const QT_SCALE_VF = 'scale=trunc(iw/2)*2:trunc(ih/2)*2'

const QT_AUDIO = ['-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2']

const QT_MUX = ['-movflags', '+faststart', '-f', 'mp4']

function buildQuickTimeArgs(hasAudio: boolean, outputPath: string): string[] {
  if (hasAudio) {
    return [
      '-map',
      '0:v:0',
      '-map',
      '0:a:0?',
      '-vf',
      QT_SCALE_VF,
      ...QT_VIDEO,
      ...QT_AUDIO,
      ...QT_MUX,
      outputPath
    ]
  }
  return [
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    '-shortest',
    '-vf',
    QT_SCALE_VF,
    ...QT_VIDEO,
    ...QT_AUDIO,
    ...QT_MUX,
    outputPath
  ]
}

export async function encodeQuickTimeMp4(inputPath: string, outputPath: string): Promise<void> {
  const hasAudio = await inputHasAudio(inputPath)
  const tmpOut = `${outputPath}.part`
  const base = ['-y', '-hide_banner', '-loglevel', 'error', '-i', inputPath]
  if (hasAudio) {
    await runFfmpeg([...base, ...buildQuickTimeArgs(true, tmpOut)])
  } else {
    await runFfmpeg([
      ...base,
      '-f',
      'lavfi',
      '-i',
      'anullsrc=channel_layout=stereo:sample_rate=48000',
      ...buildQuickTimeArgs(false, tmpOut)
    ])
  }
  await rename(tmpOut, outputPath)
}

export async function transcodeWebmToMp4(webmPath: string, mp4Path: string): Promise<void> {
  await encodeQuickTimeMp4(webmPath, mp4Path)
}

/** Trim and re-encode (stream copy breaks QuickTime for MP4). */
export async function trimToQuickTimeMp4(
  inputPath: string,
  startSec: number,
  endSec: number,
  outputPath: string
): Promise<void> {
  const hasAudio = await inputHasAudio(inputPath)
  const tmpOut = `${outputPath}.part`
  const input = [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-ss',
    startSec.toFixed(3),
    '-to',
    endSec.toFixed(3),
    '-i',
    inputPath
  ]
  if (hasAudio) {
    await runFfmpeg([...input, ...buildQuickTimeArgs(true, tmpOut)])
  } else {
    await runFfmpeg([
      ...input,
      '-f',
      'lavfi',
      '-i',
      'anullsrc=channel_layout=stereo:sample_rate=48000',
      ...buildQuickTimeArgs(false, tmpOut)
    ])
  }
  await rename(tmpOut, outputPath)
}

export async function concatToQuickTimeMp4(listPath: string, outputPath: string): Promise<void> {
  const tmpOut = `${outputPath}.part`
  await runFfmpeg([
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    listPath,
    '-map',
    '0:v:0',
    '-map',
    '0:a:0?',
    '-vf',
    QT_SCALE_VF,
    ...QT_VIDEO,
    ...QT_AUDIO,
    ...QT_MUX,
    tmpOut
  ])
  await rename(tmpOut, outputPath)
}

export function escapeSubtitlesPath(filePath: string): string {
  return filePath.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'")
}

export async function replaceWithQuickTimeMp4(inputPath: string): Promise<void> {
  const tmp = `${inputPath}.qt-fix.mp4`
  await encodeQuickTimeMp4(inputPath, tmp)
  await unlink(inputPath).catch(() => undefined)
  await rename(tmp, inputPath)
}

function buildAtempoFilter(speed: number): string {
  const filters: string[] = []
  let s = speed
  while (s > 2.0001) {
    filters.push('atempo=2.0')
    s /= 2
  }
  while (s < 0.4999) {
    filters.push('atempo=0.5')
    s *= 2
  }
  filters.push(`atempo=${Math.max(0.5, Math.min(2, s)).toFixed(4)}`)
  return filters.join(',')
}

/** speed &gt; 1 = faster, &lt; 1 = slower */
export async function applyVideoSpeed(
  inputPath: string,
  outputPath: string,
  speed: number
): Promise<void> {
  if (Math.abs(speed - 1) < 0.02) {
    await encodeQuickTimeMp4(inputPath, outputPath)
    return
  }
  const hasAudio = await inputHasAudio(inputPath)
  const tmpOut = `${outputPath}.part`
  const videoFilter = `setpts=PTS/${speed},scale=trunc(iw/2)*2:trunc(ih/2)*2`
  const base = ['-y', '-hide_banner', '-loglevel', 'error', '-i', inputPath]

  if (hasAudio) {
    await runFfmpeg([
      ...base,
      '-vf',
      videoFilter,
      '-af',
      buildAtempoFilter(speed),
      ...QT_VIDEO,
      ...QT_AUDIO,
      ...QT_MUX,
      tmpOut
    ])
  } else {
    await runFfmpeg([
      ...base,
      '-f',
      'lavfi',
      '-i',
      'anullsrc=channel_layout=stereo:sample_rate=48000',
      '-vf',
      videoFilter,
      '-map',
      '0:v:0',
      '-map',
      '1:a:0',
      '-shortest',
      ...QT_VIDEO,
      ...QT_AUDIO,
      ...QT_MUX,
      tmpOut
    ])
  }
  await rename(tmpOut, outputPath)
}
