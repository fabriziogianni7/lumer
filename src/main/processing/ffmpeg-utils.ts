import { spawn } from 'child_process'
import { rename } from 'fs/promises'
import ffmpegPath from 'ffmpeg-static'
import {
  AAC_BITRATE,
  SCALE_VF,
  VTB_BITRATE,
  VTB_BUFSIZE,
  VTB_MAXRATE,
  X264_CRF,
  X264_PRESET
} from './encode-quality'

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

const audioProbeCache = new Map<string, boolean>()

export async function inputHasAudio(inputPath: string): Promise<boolean> {
  const cached = audioProbeCache.get(inputPath)
  if (cached !== undefined) return cached
  const stderr = await ffprobeStderr(inputPath)
  const has = /\n  Stream #\d+:\d+.*Audio:/.test(stderr)
  audioProbeCache.set(inputPath, has)
  return has
}

export function clearMediaProbeCache(): void {
  audioProbeCache.clear()
}

let macVideoToolbox: boolean | null = null

async function useMacVideoToolbox(): Promise<boolean> {
  if (process.platform !== 'darwin') return false
  if (macVideoToolbox !== null) return macVideoToolbox
  try {
    await runFfmpeg([
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=black:s=64x64:d=0.04',
      '-pix_fmt',
      'yuv420p',
      '-c:v',
      'h264_videotoolbox',
      '-f',
      'null',
      '-'
    ])
    macVideoToolbox = true
  } catch {
    macVideoToolbox = false
  }
  return macVideoToolbox
}

export async function getVideoEncoderLabel(): Promise<string> {
  return (await useMacVideoToolbox()) ? 'Apple VideoToolbox (hardware)' : 'libx264 (software)'
}

/** Keep source frame timing — forcing 30fps CFR often desyncs mic/canvas WebM exports. */
async function videoEncodeArgs(): Promise<string[]> {
  if (await useMacVideoToolbox()) {
    return [
      '-c:v',
      'h264_videotoolbox',
      '-b:v',
      VTB_BITRATE,
      '-maxrate',
      VTB_MAXRATE,
      '-bufsize',
      VTB_BUFSIZE,
      '-profile:v',
      'high',
      '-pix_fmt',
      'yuv420p',
      '-tag:v',
      'avc1',
      '-fps_mode',
      'passthrough'
    ]
  }
  return [
    '-c:v',
    'libx264',
    '-profile:v',
    'high',
    '-level',
    '4.2',
    '-pix_fmt',
    'yuv420p',
    '-preset',
    X264_PRESET,
    '-crf',
    String(X264_CRF),
    '-tune',
    'animation',
    '-fps_mode',
    'passthrough',
    '-tag:v',
    'avc1'
  ]
}

const QT_SCALE_VF = SCALE_VF

const QT_AUDIO = ['-c:a', 'aac', '-b:a', AAC_BITRATE, '-ar', '48000', '-ac', '2']

const QT_MUX = ['-movflags', '+faststart', '-f', 'mp4']

const AUDIO_SYNC = 'aresample=48000:async=1:first_pts=0'

function buildAtempoChain(speed: number): string {
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

function buildAvFilterComplex(
  startSec: number | undefined,
  endSec: number | undefined,
  speed: number
): { filter: string; maps: string[] } {
  const hasTrim = startSec != null && endSec != null
  const hasSpeed = Math.abs(speed - 1) >= 0.02
  const start = hasTrim ? startSec.toFixed(3) : '0'
  const end = hasTrim ? endSec!.toFixed(3) : undefined

  const vChain: string[] = []
  if (hasTrim) vChain.push(`trim=start=${start}:end=${end}`)
  vChain.push('setpts=PTS-STARTPTS')
  if (hasSpeed) vChain.push(`setpts=PTS/${speed}`)
  vChain.push(QT_SCALE_VF)
  const v = `[0:v]${vChain.join(',')}[v]`

  const aChain: string[] = []
  if (hasTrim) aChain.push(`atrim=start=${start}:end=${end}`, 'asetpts=PTS-STARTPTS')
  else aChain.push('asetpts=PTS-STARTPTS')
  if (hasSpeed) aChain.push(buildAtempoChain(speed))
  aChain.push(AUDIO_SYNC)
  const a = `[0:a]${aChain.join(',')}[a]`

  return { filter: `${v};${a}`, maps: ['-map', '[v]', '-map', '[a]'] }
}

type SegmentEncodeOptions = {
  startSec?: number
  endSec?: number
  speed?: number
}

async function encodeSegmentToQuickTimeMp4(
  inputPath: string,
  outputPath: string,
  segment: SegmentEncodeOptions = {}
): Promise<void> {
  const speed = segment.speed ?? 1
  const hasAudio = await inputHasAudio(inputPath)
  const tmpOut = `${outputPath}.part`
  const video = await videoEncodeArgs()
  const hasTrim = segment.startSec != null && segment.endSec != null
  const hasSpeed = Math.abs(speed - 1) >= 0.02
  const useFilterSync = hasAudio && (hasTrim || hasSpeed)

  const baseIn = ['-y', '-hide_banner', '-loglevel', 'error', '-fflags', '+genpts', '-i', inputPath]

  if (useFilterSync) {
    const { filter, maps } = buildAvFilterComplex(segment.startSec, segment.endSec, speed)
    await runFfmpeg([...baseIn, '-filter_complex', filter, ...maps, ...video, ...QT_AUDIO, ...QT_MUX, tmpOut])
  } else if (hasAudio) {
    await runFfmpeg([
      ...baseIn,
      '-map',
      '0:v:0',
      '-map',
      '0:a:0?',
      '-vf',
      QT_SCALE_VF,
      '-af',
      AUDIO_SYNC,
      ...video,
      ...QT_AUDIO,
      ...QT_MUX,
      tmpOut
    ])
  } else {
    await runFfmpeg([
      ...baseIn,
      '-f',
      'lavfi',
      '-i',
      'anullsrc=channel_layout=stereo:sample_rate=48000',
      '-map',
      '0:v:0',
      '-map',
      '1:a:0',
      '-shortest',
      '-vf',
      QT_SCALE_VF,
      ...video,
      ...QT_AUDIO,
      ...QT_MUX,
      tmpOut
    ])
  }
  await rename(tmpOut, outputPath)
}

export async function encodeQuickTimeMp4(inputPath: string, outputPath: string): Promise<void> {
  await encodeSegmentToQuickTimeMp4(inputPath, outputPath)
}

export async function transcodeWebmToMp4(webmPath: string, mp4Path: string): Promise<void> {
  await encodeQuickTimeMp4(webmPath, mp4Path)
}

export async function trimToQuickTimeMp4(
  inputPath: string,
  startSec: number,
  endSec: number,
  outputPath: string
): Promise<void> {
  await encodeSegmentToQuickTimeMp4(inputPath, outputPath, { startSec, endSec })
}

export async function trimAndSpeedToQuickTimeMp4(
  inputPath: string,
  startSec: number,
  endSec: number,
  outputPath: string,
  speed: number
): Promise<void> {
  await encodeSegmentToQuickTimeMp4(inputPath, outputPath, { startSec, endSec, speed })
}

export async function concatToQuickTimeMp4(listPath: string, outputPath: string): Promise<void> {
  const tmpOut = `${outputPath}.part`
  try {
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
      '-c',
      'copy',
      '-movflags',
      '+faststart',
      tmpOut
    ])
    await rename(tmpOut, outputPath)
    return
  } catch {
    /* re-encode if stream copy concat fails */
  }

  const video = await videoEncodeArgs()
  await runFfmpeg([
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-fflags',
    '+genpts',
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
    '-af',
    AUDIO_SYNC,
    ...video,
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
  const { unlink } = await import('fs/promises')
  await unlink(inputPath).catch(() => undefined)
  await rename(tmp, inputPath)
}

export async function applyVideoSpeed(
  inputPath: string,
  outputPath: string,
  speed: number
): Promise<void> {
  await encodeSegmentToQuickTimeMp4(inputPath, outputPath, { speed })
}

export async function getBurnInVideoArgs(): Promise<string[]> {
  return videoEncodeArgs()
}
