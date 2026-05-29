import type { ProcessResult } from '../env'

type Props = {
  result: ProcessResult
  rawPath: string | null
  onReveal: (path: string) => void
  onExportSrt?: () => void
  onExportVtt?: () => void
}

export function ExportSuccess({ result, rawPath, onReveal, onExportSrt, onExportVtt }: Props) {
  const mainOutput = result.captionedVideoPath ?? result.editedVideoPath

  const outputs: { label: string; path: string }[] = [
    { label: 'Edited video', path: result.editedVideoPath }
  ]
  if (result.captionedVideoPath) {
    outputs.push({ label: 'Video with burned-in subtitles', path: result.captionedVideoPath })
  }
  if (result.srtPath) outputs.push({ label: 'Subtitles (SRT)', path: result.srtPath })
  if (result.vttPath) outputs.push({ label: 'Subtitles (VTT)', path: result.vttPath })

  const hasWarnings =
    result.transcriptionSource === 'none' ||
    (result.transcriptionSource === 'local' && !result.srtPath)

  return (
    <div className="export-success">
      <div className="export-success-banner" role="status">
        <span className="export-success-icon" aria-hidden>
          ✓
        </span>
        <div>
          <p className="export-success-title">Export successful</p>
          <p className="export-success-sub">Your processed files were saved to disk.</p>
        </div>
      </div>

      <ul className="export-success-list">
        {outputs.map((item) => (
          <li key={item.path}>
            <span className="export-success-check" aria-hidden>
              ✓
            </span>
            <div>
              <span className="export-success-label">{item.label}</span>
              <span className="export-success-path">{item.path}</span>
            </div>
          </li>
        ))}
      </ul>

      {rawPath && (
        <p className="muted export-raw-note">
          Original recording: <span className="export-success-path">{rawPath}</span>
        </p>
      )}

      {hasWarnings && (
        <div className="export-success-warn">
          {result.transcriptionSource === 'none' && <p>Transcription was skipped (no subtitle files).</p>}
          {result.transcriptionSource === 'local' && !result.srtPath && (
            <p>
              {result.transcriptionError ??
                'Subtitles were not created — install Whisper or use OpenAI API.'}
            </p>
          )}
        </div>
      )}

      <div className="actions">
        <button type="button" className="btn primary" onClick={() => onReveal(mainOutput)}>
          Show in Finder
        </button>
        {result.srtPath && onExportSrt && (
          <button type="button" className="btn secondary" onClick={onExportSrt}>
            Copy SRT elsewhere…
          </button>
        )}
        {result.vttPath && onExportVtt && (
          <button type="button" className="btn secondary" onClick={onExportVtt}>
            Copy VTT elsewhere…
          </button>
        )}
      </div>
    </div>
  )
}
