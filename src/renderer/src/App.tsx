import { useCallback, useEffect, useState } from 'react'
import type { ProcessOptions, ProcessResult } from './env'
import { useCompositor } from './hooks/useCompositor'
import { ReviewPanel } from './components/ReviewPanel'
import { PreviewFrame } from './components/PreviewFrame'
import { SettingsPanel } from './components/SettingsPanel'
import { ExportSuccess } from './components/ExportSuccess'

type Phase = 'setup' | 'preview' | 'review' | 'processing' | 'done'

export default function App() {
  const [sources, setSources] = useState<Awaited<ReturnType<typeof window.loomAgent.getCaptureSources>>>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [includeMic, setIncludeMic] = useState(true)
  const [includeSystemAudio, setIncludeSystemAudio] = useState(false)
  const [phase, setPhase] = useState<Phase>('setup')
  const [savedPath, setSavedPath] = useState<string | null>(null)
  const [processLog, setProcessLog] = useState('Ready.')
  const [processPercent, setProcessPercent] = useState<number | null>(null)
  const [result, setResult] = useState<ProcessResult | null>(null)
  const [exportNotice, setExportNotice] = useState<string | null>(null)
  const [processError, setProcessError] = useState<string | null>(null)
  const [reviewEntry, setReviewEntry] = useState<'record' | 'import'>('record')

  const selected = sources.find((s) => s.id === selectedId) ?? null

  const loadSources = useCallback(async () => {
    const list = await window.loomAgent.getCaptureSources()
    setSources(list)
    if (!selectedId && list.length) {
      const screen = list.find((s) => s.type === 'screen')
      setSelectedId(screen?.id ?? list[0].id)
    }
    return list
  }, [selectedId])

  const {
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
  } = useCompositor(selected, includeMic, includeSystemAudio, loadSources)

  useEffect(() => {
    void loadSources()
  }, [loadSources])

  useEffect(() => {
    return window.loomAgent.onProcessProgress(({ message, percent }) => {
      setProcessLog(message)
      if (percent != null) setProcessPercent(percent)
    })
  }, [])

  const handleStartPreview = async () => {
    const result = await startPreview()
    if (result.ok) setPhase('preview')
  }

  const handleRecordToggle = async () => {
    if (!isRecording) {
      startRecording()
      return
    }
    try {
      const blob = await stopRecording()
      const buffer = await blob.arrayBuffer()
      const name = `recording-${new Date().toISOString().replace(/[:.]/g, '-')}.mp4`
      const save = await window.loomAgent.saveRecording(buffer, name)
      if (save.canceled) return
      setSavedPath(save.filePath)
      setExportNotice(save.filePath)
      setReviewEntry('record')
      setPhase('review')
    } catch (e) {
      setProcessLog(e instanceof Error ? e.message : String(e))
    }
  }

  const handleOpenExistingVideo = async () => {
    const picked = await window.loomAgent.pickVideoFile()
    if (picked.canceled) return
    stopStreams()
    setSavedPath(picked.filePath)
    setReviewEntry('import')
    setExportNotice(null)
    setProcessError(null)
    setResult(null)
    setPhase('review')
  }

  const handleReviewBack = () => {
    if (reviewEntry === 'import') {
      setSavedPath(null)
      setPhase('setup')
      return
    }
    setPhase('preview')
  }

  const runProcess = async (options: ProcessOptions) => {
    if (!savedPath) return
    setPhase('processing')
    setProcessPercent(0)
    setProcessLog('Starting…')
    setResult(null)
    setExportNotice(null)
    setProcessError(null)
    try {
      const out = await window.loomAgent.processVideo(savedPath, options)
      setResult(out)
      setProcessLog('Export completed successfully.')
      setProcessPercent(100)
      setProcessError(null)
      setPhase('done')
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setProcessLog(message)
      setProcessError(message)
      setPhase('review')
    }
  }

  const reset = () => {
    stopStreams()
    setSavedPath(null)
    setResult(null)
    setPhase('setup')
    setProcessLog('Ready.')
    setProcessPercent(null)
    setExportNotice(null)
    setProcessError(null)
    setReviewEntry('record')
  }

  const screens = sources.filter((s) => s.type === 'screen')
  const windows = sources.filter((s) => s.type === 'window')

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>Loom Agent</h1>
          <p className="subtitle">Screen or window + face cam → trim → silence cut → subtitles</p>
        </div>
        {phase !== 'setup' && (
          <button type="button" className="btn ghost" onClick={reset}>
            New recording
          </button>
        )}
      </header>

      <main className="layout">
        {(phase === 'setup' || phase === 'preview') && (
          <section className="panel sources">
            <h2>Capture source</h2>
            <button type="button" className="btn secondary small" onClick={loadSources}>
              Refresh list
            </button>

            <div className="source-group">
              <h3>Displays</h3>
              <div className="source-grid">
                {screens.map((s) => (
                  <SourceCard key={s.id} source={s} selected={selectedId === s.id} onSelect={setSelectedId} />
                ))}
              </div>
            </div>

            <div className="source-group">
              <h3>Windows</h3>
              <div className="source-grid">
                {windows.map((s) => (
                  <SourceCard key={s.id} source={s} selected={selectedId === s.id} onSelect={setSelectedId} />
                ))}
              </div>
            </div>

            <label className="checkbox">
              <input
                type="checkbox"
                checked={includeSystemAudio}
                onChange={(e) => setIncludeSystemAudio(e.target.checked)}
                disabled={phase === 'preview' || isRecording}
              />
              Include system audio (full display recommended on macOS)
            </label>

            <label className="checkbox">
              <input
                type="checkbox"
                checked={includeMic}
                onChange={(e) => setIncludeMic(e.target.checked)}
                disabled={phase === 'preview' || isRecording}
              />
              Include microphone
            </label>

            {phase === 'setup' && (
              <div className="setup-actions">
                <button type="button" className="btn primary" disabled={!selected} onClick={handleStartPreview}>
                  Start preview
                </button>
                <button type="button" className="btn secondary" onClick={() => void handleOpenExistingVideo()}>
                  Open existing video…
                </button>
              </div>
            )}

            <SettingsPanel />

            {error && <p className="error">{error}</p>}
            {warnings.map((w) => (
              <p key={w} className="warn">
                {w}
              </p>
            ))}
          </section>
        )}

        <section className={`panel preview ${phase === 'review' ? 'full' : ''}`}>
          {phase === 'review' && savedPath ? (
            <>
              {exportNotice && (
                <div className="export-success-banner export-success-banner--compact" role="status">
                  <span className="export-success-icon" aria-hidden>
                    ✓
                  </span>
                  <div>
                    <p className="export-success-title">Recording saved</p>
                    <p className="export-success-sub">{exportNotice}</p>
                  </div>
                </div>
              )}
              <ReviewPanel
                filePath={savedPath}
                onBack={handleReviewBack}
                onProcess={runProcess}
                processError={processError}
                imported={reviewEntry === 'import'}
              />
            </>
          ) : (
            <>
              <h2>Preview</h2>
              <PreviewFrame
                camPos={camPos}
                onCamPosChange={setCamPos}
                visible={Boolean(previewStream && hasCamera)}
              >
                <canvas ref={canvasRef} className="preview-canvas" width={1920} height={1080} />
                {!previewStream && phase !== 'processing' && phase !== 'done' && (
                  <div className="preview-placeholder">Select a source and start preview</div>
                )}
              </PreviewFrame>

              {phase === 'preview' && (
                <div className="record-bar">
                  <button
                    type="button"
                    className={`btn ${isRecording ? 'danger' : 'primary'}`}
                    onClick={handleRecordToggle}
                  >
                    {isRecording ? 'Stop recording' : 'Start recording'}
                  </button>
                  {isRecording && <span className="rec-dot">Recording</span>}
                </div>
              )}
            </>
          )}

          {(phase === 'processing' || phase === 'done') && (
            <div className={`process-box ${phase === 'done' && result ? 'process-box--success' : ''}`}>
              <h3>{phase === 'processing' ? 'Processing' : result ? 'Export complete' : 'Finished'}</h3>
              {phase === 'processing' && (
            <>
              <p>{processLog}</p>
              <p className="muted process-hint">
                Long clips + silence cut + local Whisper can take several minutes. The progress line above
                shows the current step.
              </p>
            </>
          )}
              {processPercent != null && phase === 'processing' && (
                <div className="progress">
                  <div className="progress-fill" style={{ width: `${processPercent}%` }} />
                </div>
              )}
              {phase === 'done' && result && (
                <ExportSuccess
                  result={result}
                  rawPath={savedPath}
                  onReveal={(path) => window.loomAgent.revealInFolder(path)}
                  onExportSrt={
                    result.srtPath
                      ? () => void window.loomAgent.exportSubtitleFile(result.srtPath!, 'srt')
                      : undefined
                  }
                  onExportVtt={
                    result.vttPath
                      ? () => void window.loomAgent.exportSubtitleFile(result.vttPath!, 'vtt')
                      : undefined
                  }
                />
              )}
              {phase === 'done' && !result && <p className="error">{processLog}</p>}
            </div>
          )}
        </section>
      </main>
    </div>
  )
}

function SourceCard({
  source,
  selected,
  onSelect
}: {
  source: { id: string; name: string; thumbnail: string }
  selected: boolean
  onSelect: (id: string) => void
}) {
  return (
    <button
      type="button"
      className={`source-card ${selected ? 'selected' : ''}`}
      onClick={() => onSelect(source.id)}
    >
      <img src={source.thumbnail} alt="" />
      <span>{source.name}</span>
    </button>
  )
}
