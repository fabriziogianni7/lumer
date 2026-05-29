import { useCallback, useEffect, useRef, useState } from 'react'
import type { CaptureSource } from '../env'
import {
  acquireCamera,
  acquireDesktopVideo,
  attachSystemAudio,
  acquireMicrophone,
  humanizeMediaError,
  resolveCaptureSource,
  type CaptureWarnings
} from '../lib/media-capture'
import {
  CAM_RADIUS,
  CAM_SIZE,
  CANVAS_H,
  CANVAS_W,
  clampCamPosition,
  defaultCamPosition
} from '../constants/canvas'

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.lineTo(x + w - radius, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius)
  ctx.lineTo(x + w, y + h - radius)
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h)
  ctx.lineTo(x + radius, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius)
  ctx.lineTo(x, y + radius)
  ctx.quadraticCurveTo(x, y, x + radius, y)
  ctx.closePath()
}

type StartPreviewResult = { ok: true; warnings: CaptureWarnings } | { ok: false }

export function useCompositor(
  selectedSource: CaptureSource | null,
  includeMic: boolean,
  includeSystemAudio: boolean,
  refreshSources: () => Promise<CaptureSource[]>
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const screenVideoRef = useRef<HTMLVideoElement | null>(null)
  const camVideoRef = useRef<HTMLVideoElement | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const rafRef = useRef<number>(0)
  const screenStreamRef = useRef<MediaStream | null>(null)
  const camStreamRef = useRef<MediaStream | null>(null)
  const micStreamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const camPosRef = useRef(defaultCamPosition())

  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<CaptureWarnings>([])
  const [camPos, setCamPosState] = useState(defaultCamPosition)
  const [hasCamera, setHasCamera] = useState(true)

  const setCamPos = useCallback((next: { x: number; y: number }) => {
    const clamped = clampCamPosition(next.x, next.y)
    camPosRef.current = clamped
    setCamPosState(clamped)
  }, [])

  const stopStreams = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    screenStreamRef.current?.getTracks().forEach((t) => t.stop())
    camStreamRef.current?.getTracks().forEach((t) => t.stop())
    micStreamRef.current?.getTracks().forEach((t) => t.stop())
    screenStreamRef.current = null
    camStreamRef.current = null
    micStreamRef.current = null
    void audioContextRef.current?.close()
    audioContextRef.current = null
    setPreviewStream(null)
    setWarnings([])
    setHasCamera(true)
    const start = defaultCamPosition()
    camPosRef.current = start
    setCamPosState(start)
  }, [])

  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current
    const screenV = screenVideoRef.current
    const camV = camVideoRef.current
    if (!canvas || !screenV) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.fillStyle = '#0f0f12'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    if (screenV.readyState >= 2) {
      const sw = screenV.videoWidth
      const sh = screenV.videoHeight
      if (sw && sh) {
        const scale = Math.min(canvas.width / sw, canvas.height / sh)
        const dw = sw * scale
        const dh = sh * scale
        const dx = (canvas.width - dw) / 2
        const dy = (canvas.height - dh) / 2
        ctx.drawImage(screenV, dx, dy, dw, dh)
      }
    }

    if (camV && camV.readyState >= 2 && camV.videoWidth) {
      const { x, y } = camPosRef.current
      const vw = camV.videoWidth
      const vh = camV.videoHeight
      const side = Math.min(vw, vh)
      const sx = (vw - side) / 2
      const sy = (vh - side) / 2

      ctx.save()
      drawRoundedRect(ctx, x, y, CAM_SIZE, CAM_SIZE, CAM_RADIUS)
      ctx.clip()
      ctx.drawImage(camV, sx, sy, side, side, x, y, CAM_SIZE, CAM_SIZE)
      ctx.restore()

      ctx.strokeStyle = 'rgba(255,255,255,0.9)'
      ctx.lineWidth = 3
      drawRoundedRect(ctx, x, y, CAM_SIZE, CAM_SIZE, CAM_RADIUS)
      ctx.stroke()
    }

    rafRef.current = requestAnimationFrame(drawFrame)
  }, [])

  const startPreview = useCallback(async (): Promise<StartPreviewResult> => {
    setError(null)
    setWarnings([])
    stopStreams()

    if (!selectedSource) {
      setError('Select a screen or window first.')
      return { ok: false }
    }

    const captureWarnings: CaptureWarnings = []

    try {
      const source = await resolveCaptureSource(selectedSource, refreshSources)
      const screenStream = await acquireDesktopVideo(source.id)
      screenStreamRef.current = screenStream

      await attachSystemAudio(screenStream, source, includeSystemAudio, captureWarnings)

      const camStream = await acquireCamera()
      if (!camStream) {
        captureWarnings.push('No camera found — recording screen only (you can still record).')
        setHasCamera(false)
      } else {
        camStreamRef.current = camStream
      }

      let micStream: MediaStream | null = null
      if (includeMic) {
        micStream = await acquireMicrophone()
        if (!micStream) {
          captureWarnings.push('No microphone found — continuing without mic audio.')
        } else {
          micStreamRef.current = micStream
        }
      }

      const screenV = document.createElement('video')
      screenV.srcObject = screenStream
      screenV.muted = true
      screenV.playsInline = true
      await screenV.play()
      screenVideoRef.current = screenV

      if (camStream) {
        const camV = document.createElement('video')
        camV.srcObject = camStream
        camV.muted = true
        camV.playsInline = true
        await camV.play()
        camVideoRef.current = camV
      } else {
        camVideoRef.current = null
      }

      const canvas = canvasRef.current ?? document.createElement('canvas')
      canvas.width = CANVAS_W
      canvas.height = CANVAS_H
      canvasRef.current = canvas

      cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(drawFrame)

      const canvasStream = canvas.captureStream(30)
      const audioTracks: MediaStreamTrack[] = []
      screenStream.getAudioTracks().forEach((t) => audioTracks.push(t))
      micStream?.getAudioTracks().forEach((t) => audioTracks.push(t))
      if (audioTracks.length === 1) {
        canvasStream.addTrack(audioTracks[0])
      } else if (audioTracks.length > 1) {
        const ctx = new AudioContext()
        audioContextRef.current = ctx
        const dest = ctx.createMediaStreamDestination()
        for (const track of audioTracks) {
          ctx.createMediaStreamSource(new MediaStream([track])).connect(dest)
        }
        dest.stream.getAudioTracks().forEach((t) => canvasStream.addTrack(t))
      }

      setWarnings(captureWarnings)
      setPreviewStream(canvasStream)
      return { ok: true, warnings: captureWarnings }
    } catch (e) {
      setError(humanizeMediaError(e))
      stopStreams()
      return { ok: false }
    }
  }, [selectedSource, includeMic, includeSystemAudio, drawFrame, stopStreams, refreshSources])

  const startRecording = useCallback(() => {
    if (!previewStream) return null
    chunksRef.current = []
    const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
      ? 'video/webm;codecs=vp9,opus'
      : 'video/webm'
    const recorder = new MediaRecorder(previewStream, { mimeType: mime, videoBitsPerSecond: 6_000_000 })
    recorder.ondataavailable = (ev) => {
      if (ev.data.size) chunksRef.current.push(ev.data)
    }
    recorder.start(1000)
    recorderRef.current = recorder
    setIsRecording(true)
    return recorder
  }, [previewStream])

  const stopRecording = useCallback((): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const recorder = recorderRef.current
      if (!recorder || recorder.state === 'inactive') {
        reject(new Error('Not recording'))
        return
      }
      recorder.onstop = () => {
        setIsRecording(false)
        resolve(new Blob(chunksRef.current, { type: recorder.mimeType }))
      }
      recorder.stop()
    })
  }, [])

  useEffect(() => () => stopStreams(), [stopStreams])

  return {
    canvasRef,
    previewStream,
    isRecording,
    error,
    warnings,
    hasCamera,
    camPos,
    setCamPos,
    startPreview,
    stopStreams,
    startRecording,
    stopRecording
  }
}
