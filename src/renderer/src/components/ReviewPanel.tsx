import { useEffect, useMemo, useRef, useState } from 'react'
import type { ProcessOptions } from '../env'
import { loadOpenAiKey } from '../lib/settings'
import { TrimTimeline } from './TrimTimeline'

type Props = {
  filePath: string
  onProcess: (options: ProcessOptions) => void
  onBack: () => void
  processError?: string | null
}

const defaultProcess = (): Omit<ProcessOptions, 'trimStartSec' | 'trimEndSec'> => ({
  cutSilence: true,
  silenceThresholdDb: -35,
  minSilenceSec: 0.6,
  paddingSec: 0.12,
  transcription: 'local',
  whisperModel: 'base',
  openaiApiKey: loadOpenAiKey(),
  burnInSubtitles: false,
  videoSpeed: 1,
  subtitleExport: 'both'
})

const SPEED_PRESETS = [
  { label: '0.75×', value: 0.75 },
  { label: '1×', value: 1 },
  { label: '1.25×', value: 1.25 },
  { label: '1.5×', value: 1.5 },
  { label: '2×', value: 2 }
]

export function ReviewPanel({ filePath, onProcess, onBack, processError }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [duration, setDuration] = useState(0)
  const [trimStart, setTrimStart] = useState(0)
  const [trimEnd, setTrimEnd] = useState(0)
  const [videoUrl, setVideoUrl] = useState('')
  const [videoError, setVideoError] = useState<string | null>(null)
  const [processOpts, setProcessOpts] = useState(defaultProcess)
  const [envKey, setEnvKey] = useState(false)
  const [loadingPreview, setLoadingPreview] = useState(true)

  useEffect(() => {
    void window.loomAgent.getOpenAiKeyStatus().then((s) => setEnvKey(s.hasEnvKey))
  }, [])

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null
    setLoadingPreview(true)
    setVideoError(null)
    setVideoUrl('')

    ;(async () => {
      try {
        const d = await window.loomAgent.getMediaDuration(filePath)
        if (cancelled) return
        setDuration(d)
        setTrimStart(0)
        setTrimEnd(d)

        const preview = await window.loomAgent.getMediaPreview(filePath)
        if (cancelled) return
        if (preview.mode === 'blob') {
          objectUrl = URL.createObjectURL(new Blob([preview.buffer], { type: preview.mime }))
          setVideoUrl(objectUrl)
        } else {
          setVideoUrl(preview.url)
        }
      } catch (e) {
        if (!cancelled) {
          setVideoError(
            e instanceof Error
              ? `${e.message}. You can still process the file, or open it in Finder / QuickTime.`
              : 'Preview failed. Processing still works.'
          )
        }
      } finally {
        if (!cancelled) setLoadingPreview(false)
      }
    })()

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [filePath])

  const trimValid = trimEnd - trimStart >= 0.2

  const previewLabel = useMemo(() => {
    if (!duration) return loadingPreview ? 'Loading…' : 'No duration'
    return `Keeping ${formatTime(trimStart)} → ${formatTime(trimEnd)} (${(trimEnd - trimStart).toFixed(1)}s of ${duration.toFixed(1)}s)`
  }, [duration, trimStart, trimEnd, loadingPreview])

  return (
    <div className="review">
      {processError && (
        <p className="error" role="alert">
          Processing failed: {processError}
        </p>
      )}

      <div className="review-header">
        <h3>Review, cut &amp; trim</h3>
        <p className="muted">{previewLabel}</p>
      </div>

      <div className="review-video-wrap">
        {videoUrl ? (
          <video
            ref={videoRef}
            key={videoUrl}
            className="review-video"
            src={videoUrl}
            controls
            preload="auto"
            playsInline
            onLoadedData={() => setVideoError(null)}
            onError={(e) => {
              const el = e.currentTarget
              const code = el.error?.code
              const detail =
                code === MediaError.MEDIA_ERR_NETWORK
                  ? 'Could not load the file (network / path).'
                  : code === MediaError.MEDIA_ERR_DECODE
                    ? 'This file could not be decoded in the in-app player.'
                    : code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
                      ? 'This format is not supported in the in-app player.'
                      : 'Preview failed.'
              setVideoError(
                `${detail} Use Open in Finder / QuickTime below — trim settings still apply when you process.`
              )
            }}
          />
        ) : (
          <div className="preview-placeholder">
            {loadingPreview ? 'Loading preview…' : 'Preview unavailable'}
          </div>
        )}
      </div>

      {videoError && <p className="warn">{videoError}</p>}

      <TrimTimeline
        duration={duration}
        trimStart={trimStart}
        trimEnd={trimEnd}
        onTrimStartChange={setTrimStart}
        onTrimEndChange={setTrimEnd}
        videoRef={videoRef}
      />

      <fieldset className="process-fieldset">
        <legend>Export</legend>

        <label>
          Playback speed (export)
          <div className="speed-presets">
            {SPEED_PRESETS.map((p) => (
              <button
                key={p.value}
                type="button"
                className={`speed-btn ${processOpts.videoSpeed === p.value ? 'active' : ''}`}
                onClick={() => setProcessOpts((o) => ({ ...o, videoSpeed: p.value }))}
              >
                {p.label}
              </button>
            ))}
          </div>
        </label>

        <label>
          Subtitle files
          <select
            value={processOpts.subtitleExport}
            onChange={(e) =>
              setProcessOpts((p) => ({
                ...p,
                subtitleExport: e.target.value as ProcessOptions['subtitleExport']
              }))
            }
            disabled={processOpts.transcription === 'none'}
          >
            <option value="both">SRT + VTT (next to video)</option>
            <option value="srt">SRT only</option>
            <option value="vtt">VTT only (+ SRT for processing)</option>
          </select>
        </label>
      </fieldset>

      <fieldset className="process-fieldset">
        <legend>AI processing</legend>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={processOpts.cutSilence}
            onChange={(e) => setProcessOpts((p) => ({ ...p, cutSilence: e.target.checked }))}
          />
          Also remove silent sections (after trim)
        </label>

        {processOpts.cutSilence && (
          <div className="field-grid">
            <label>
              Silence threshold (dB)
              <input
                type="number"
                value={processOpts.silenceThresholdDb}
                onChange={(e) =>
                  setProcessOpts((p) => ({ ...p, silenceThresholdDb: Number(e.target.value) }))
                }
              />
            </label>
            <label>
              Min silence (sec)
              <input
                type="number"
                step={0.1}
                value={processOpts.minSilenceSec}
                onChange={(e) =>
                  setProcessOpts((p) => ({ ...p, minSilenceSec: Number(e.target.value) }))
                }
              />
            </label>
            <label>
              Padding (sec)
              <input
                type="number"
                step={0.05}
                value={processOpts.paddingSec}
                onChange={(e) =>
                  setProcessOpts((p) => ({ ...p, paddingSec: Number(e.target.value) }))
                }
              />
            </label>
          </div>
        )}

        <label>
          Transcription
          <select
            value={processOpts.transcription}
            onChange={(e) =>
              setProcessOpts((p) => ({
                ...p,
                transcription: e.target.value as ProcessOptions['transcription']
              }))
            }
          >
            <option value="local">Local Whisper (pip install openai-whisper)</option>
            <option value="openai">OpenAI API (whisper-1)</option>
            <option value="none">None</option>
          </select>
        </label>

        {processOpts.transcription === 'local' && (
          <label>
            Whisper model
            <select
              value={processOpts.whisperModel}
              onChange={(e) => setProcessOpts((p) => ({ ...p, whisperModel: e.target.value }))}
            >
              <option value="tiny">tiny</option>
              <option value="base">base</option>
              <option value="small">small</option>
              <option value="medium">medium</option>
            </select>
          </label>
        )}

        {processOpts.transcription === 'openai' && (
          <>
            <label>
              OpenAI API key (optional if saved in Settings / .env)
              <input
                type="password"
                placeholder="sk-…"
                value={processOpts.openaiApiKey}
                onChange={(e) => setProcessOpts((p) => ({ ...p, openaiApiKey: e.target.value }))}
                autoComplete="off"
              />
            </label>
            {envKey && !processOpts.openaiApiKey && (
              <p className="muted">Will use OPENAI_API_KEY from .env</p>
            )}
          </>
        )}

        <label className="checkbox">
          <input
            type="checkbox"
            checked={processOpts.burnInSubtitles}
            disabled={processOpts.transcription === 'none'}
            onChange={(e) => setProcessOpts((p) => ({ ...p, burnInSubtitles: e.target.checked }))}
          />
          Burn subtitles into video (exports MP4)
        </label>
      </fieldset>

      <div className="record-bar">
        <button type="button" className="btn ghost" onClick={onBack}>
          Back
        </button>
        <button
          type="button"
          className="btn secondary"
          disabled={!duration}
          onClick={() => void window.loomAgent.revealInFolder(filePath)}
        >
          Open in Finder
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={!trimValid || !duration}
          onClick={() =>
            onProcess({
              ...processOpts,
              openaiApiKey: processOpts.openaiApiKey || loadOpenAiKey(),
              trimStartSec: trimStart,
              trimEndSec: trimEnd
            })
          }
        >
          Process video
        </button>
      </div>
    </div>
  )
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}
