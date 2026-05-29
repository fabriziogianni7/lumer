import type { CaptureSource } from '../env'

export type CaptureWarnings = string[]

function isNotFoundError(e: unknown): boolean {
  if (!(e instanceof DOMException)) return false
  return e.name === 'NotFoundError' || e.name === 'DevicesNotFoundError'
}

function desktopVideoConstraints(sourceId: string): MediaStreamConstraints {
  return {
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: sourceId,
        maxWidth: 1920,
        maxHeight: 1080
      }
    } as MediaTrackConstraints
  }
}

function desktopAudioConstraints(sourceId: string): MediaStreamConstraints {
  return {
    audio: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: sourceId
      }
    } as MediaTrackConstraints,
    video: false
  }
}

export async function resolveCaptureSource(
  selected: CaptureSource,
  refreshSources: () => Promise<CaptureSource[]>
): Promise<CaptureSource> {
  const list = await refreshSources()
  const exact = list.find((s) => s.id === selected.id)
  if (exact) return exact
  const byName = list.find((s) => s.name === selected.name && s.type === selected.type)
  if (byName) return byName
  throw new Error(
    'That screen or window is no longer available. Click "Refresh list", pick the source again, then start preview.'
  )
}

export async function acquireDesktopVideo(sourceId: string): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia(desktopVideoConstraints(sourceId))
}

export async function acquireDesktopAudio(sourceId: string): Promise<MediaStream | null> {
  try {
    return await navigator.mediaDevices.getUserMedia(desktopAudioConstraints(sourceId))
  } catch (e) {
    if (isNotFoundError(e)) return null
    throw e
  }
}

export async function acquireCamera(): Promise<MediaStream | null> {
  const attempts: MediaStreamConstraints[] = [
    { video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: false },
    { video: true, audio: false }
  ]
  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints)
    } catch (e) {
      if (!isNotFoundError(e)) throw e
    }
  }
  return null
}

export async function acquireMicrophone(): Promise<MediaStream | null> {
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
  } catch (e) {
    if (isNotFoundError(e)) return null
    throw e
  }
}

export async function attachSystemAudio(
  screenStream: MediaStream,
  source: CaptureSource,
  includeSystemAudio: boolean,
  warnings: CaptureWarnings
): Promise<void> {
  if (!includeSystemAudio) return
  if (source.type === 'window') {
    warnings.push(
      'System audio usually does not work for single windows on macOS. Select a display or turn off system audio.'
    )
    return
  }
  const audioStream = await acquireDesktopAudio(source.id)
  if (!audioStream || !audioStream.getAudioTracks().length) {
    warnings.push(
      'System audio could not be captured. Try a full display, check Screen Recording permission, or disable system audio.'
    )
    return
  }
  audioStream.getAudioTracks().forEach((track) => screenStream.addTrack(track))
}

export function humanizeMediaError(e: unknown): string {
  if (e instanceof DOMException) {
    if (e.name === 'NotFoundError' || e.name === 'DevicesNotFoundError') {
      return 'A requested device was not found (camera, mic, or capture source). Refresh the source list, check permissions, or disable camera / mic / system audio.'
    }
    if (e.name === 'NotAllowedError') {
      return 'Permission denied. Allow Camera, Microphone, and Screen Recording for Loom Agent in System Settings, then restart the app.'
    }
    if (e.name === 'NotReadableError') {
      return 'Device is busy or unavailable. Close other apps using the camera or mic and try again.'
    }
    return e.message
  }
  if (e instanceof Error) return e.message
  return String(e)
}
