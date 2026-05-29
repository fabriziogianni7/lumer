import { contextBridge, ipcRenderer } from 'electron'

export type CaptureSource = {
  id: string
  name: string
  type: 'screen' | 'window'
  thumbnail: string
}

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

contextBridge.exposeInMainWorld('loomAgent', {
  getCaptureSources: (): Promise<CaptureSource[]> => ipcRenderer.invoke('get-capture-sources'),
  saveRecording: (buffer: ArrayBuffer, suggestedName: string) =>
    ipcRenderer.invoke('save-recording', buffer, suggestedName),
  getMediaDuration: (filePath: string) => ipcRenderer.invoke('get-media-duration', filePath),
  toMediaUrl: (filePath: string) => ipcRenderer.invoke('to-media-url', filePath),
  getMediaPreview: (filePath: string) =>
    ipcRenderer.invoke('get-media-preview', filePath) as Promise<
      | { mode: 'blob'; mime: string; buffer: ArrayBuffer }
      | { mode: 'url'; url: string }
    >,
  processVideo: (inputPath: string, options: ProcessOptions) =>
    ipcRenderer.invoke('process-video', inputPath, options),
  getOpenAiKeyStatus: () => ipcRenderer.invoke('get-openai-key-status'),
  getWhisperStatus: () => ipcRenderer.invoke('get-whisper-status'),
  exportSubtitleFile: (sourcePath: string, format: 'srt' | 'vtt') =>
    ipcRenderer.invoke('export-subtitle-file', sourcePath, format),
  revealInFolder: (filePath: string) => ipcRenderer.invoke('reveal-in-folder', filePath),
  onProcessProgress: (cb: (payload: { message: string; percent?: number }) => void) => {
    const listener = (_: unknown, payload: { message: string; percent?: number }) =>
      cb(payload)
    ipcRenderer.on('process-progress', listener)
    return () => ipcRenderer.removeListener('process-progress', listener)
  }
})
