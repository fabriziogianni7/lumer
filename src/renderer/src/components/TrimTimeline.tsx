import { useEffect, useState } from 'react'

type Props = {
  duration: number
  trimStart: number
  trimEnd: number
  onTrimStartChange: (v: number) => void
  onTrimEndChange: (v: number) => void
  videoRef: React.RefObject<HTMLVideoElement | null>
}

export function TrimTimeline({
  duration,
  trimStart,
  trimEnd,
  onTrimStartChange,
  onTrimEndChange,
  videoRef
}: Props) {
  const [playSelectionActive, setPlaySelectionActive] = useState(false)

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const onTime = () => {
      if (!playSelectionActive) return
      if (v.currentTime >= trimEnd - 0.05) {
        v.pause()
        setPlaySelectionActive(false)
      }
    }
    v.addEventListener('timeupdate', onTime)
    return () => v.removeEventListener('timeupdate', onTime)
  }, [videoRef, trimEnd, playSelectionActive])

  const setInFromPlayhead = () => {
    const v = videoRef.current
    if (!v) return
    onTrimStartChange(Math.min(v.currentTime, trimEnd - 0.2))
  }

  const setOutFromPlayhead = () => {
    const v = videoRef.current
    if (!v) return
    onTrimEndChange(Math.max(v.currentTime, trimStart + 0.2))
  }

  const playSelection = () => {
    const v = videoRef.current
    if (!v) return
    setPlaySelectionActive(true)
    v.currentTime = trimStart
    void v.play()
  }

  const startPct = duration > 0 ? (trimStart / duration) * 100 : 0
  const endPct = duration > 0 ? (trimEnd / duration) * 100 : 100

  return (
    <fieldset className="process-fieldset trim-fieldset">
      <legend>Cut &amp; trim</legend>
      <p className="muted settings-help">
        Keep only the highlighted range. Use the playhead + <strong>Set In / Out</strong>, or drag the
        sliders. Silence removal is optional below.
      </p>

      <div className="trim-track" aria-hidden>
        <div className="trim-track-bg" />
        <div
          className="trim-track-selection"
          style={{ left: `${startPct}%`, width: `${Math.max(0, endPct - startPct)}%` }}
        />
        <div className="trim-handle trim-handle-in" style={{ left: `${startPct}%` }} />
        <div className="trim-handle trim-handle-out" style={{ left: `${endPct}%` }} />
      </div>

      <div className="trim-sliders">
        <label>
          <span>In {formatTime(trimStart)}</span>
          <input
            type="range"
            min={0}
            max={Math.max(duration, 0.1)}
            step={0.05}
            value={trimStart}
            disabled={!duration}
            onChange={(e) => {
              const v = parseFloat(e.target.value)
              onTrimStartChange(Math.min(v, trimEnd - 0.2))
            }}
          />
        </label>
        <label>
          <span>Out {formatTime(trimEnd)}</span>
          <input
            type="range"
            min={0}
            max={Math.max(duration, 0.1)}
            step={0.05}
            value={trimEnd}
            disabled={!duration}
            onChange={(e) => {
              const v = parseFloat(e.target.value)
              onTrimEndChange(Math.max(v, trimStart + 0.2))
            }}
          />
        </label>
      </div>

      <div className="trim-actions">
        <button type="button" className="btn secondary small" disabled={!duration} onClick={setInFromPlayhead}>
          Set In at playhead
        </button>
        <button type="button" className="btn secondary small" disabled={!duration} onClick={setOutFromPlayhead}>
          Set Out at playhead
        </button>
        <button type="button" className="btn secondary small" disabled={!duration} onClick={playSelection}>
          Play selection
        </button>
        <button
          type="button"
          className="btn ghost small"
          disabled={!duration}
          onClick={() => {
            onTrimStartChange(0)
            onTrimEndChange(duration)
          }}
        >
          Full clip
        </button>
      </div>
    </fieldset>
  )
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  const ms = Math.floor((sec % 1) * 10)
  return `${m}:${String(s).padStart(2, '0')}.${ms}`
}
