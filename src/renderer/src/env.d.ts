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

declare global {
  interface Window {
    loomAgent: {
      getCaptureSources: () => Promise<CaptureSource[]>
      saveRecording: (
        buffer: ArrayBuffer,
        suggestedName: string
      ) => Promise<{ canceled: true } | { canceled: false; filePath: string }>
      pickVideoFile: () => Promise<
        { canceled: true } | { canceled: false; filePath: string }
      >
      getMediaDuration: (filePath: string) => Promise<number>
      toMediaUrl: (filePath: string) => Promise<string>
      getMediaPreview: (filePath: string) => Promise<
        | { mode: 'blob'; mime: string; buffer: ArrayBuffer }
        | { mode: 'url'; url: string }
      >
      processVideo: (inputPath: string, options: ProcessOptions) => Promise<ProcessResult>
      getOpenAiKeyStatus: () => Promise<{ hasEnvKey: boolean }>
      getWhisperStatus: () => Promise<{
        installed: boolean
        hint: string
        python: string | null
      }>
      exportSubtitleFile: (
        sourcePath: string,
        format: 'srt' | 'vtt'
      ) => Promise<{ canceled: true } | { canceled: false; filePath: string }>
      revealInFolder: (filePath: string) => Promise<void>
      onProcessProgress: (
        cb: (payload: { message: string; percent?: number }) => void
      ) => () => void
    }
  }
}

export {}
