import { app, BrowserWindow, ipcMain, desktopCapturer, dialog, shell, protocol } from 'electron'
import { join } from 'path'
import { writeFile, mkdir, unlink, copyFile } from 'fs/promises'
import { existsSync } from 'fs'
import { tmpdir } from 'os'
import { processRecording, type ProcessOptions } from './processing/pipeline'
import { probeDuration, transcodeWebmToMp4 } from './processing/ffmpeg-utils'
import { registerMediaProtocol } from './media-protocol'
import { configureCaptureSession } from './capture-session'
import { getOpenAiKeyFromEnv, loadProjectEnv } from './env-config'
import { getWhisperInstallHint, findWhisperRunner } from './processing/whisper-resolve'
import { pythonPathsForMac } from './processing/whisper-resolve'
import { filePathToLoomFileUrl } from './loom-file-url'
import { loadMediaPreview } from './media-preview'

let mainWindow: BrowserWindow | null = null

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'loom-file',
    privileges: {
      standard: true,
      secure: true,
      bypassCSP: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true
    }
  }
])

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 960,
    minHeight: 680,
    title: 'Loom Agent',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function augmentPathForMac(): void {
  if (process.platform !== 'darwin') return
  const extra = [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    ...pythonPathsForMac()
  ]
  const parts = new Set((process.env.PATH ?? '').split(':').filter(Boolean))
  for (const p of extra) parts.add(p)
  process.env.PATH = [...parts].join(':')
}

app.whenReady().then(() => {
  augmentPathForMac()
  loadProjectEnv()
  configureCaptureSession()
  registerMediaProtocol()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.handle('get-capture-sources', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['window', 'screen'],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: true
  })
  return sources.map((s) => ({
    id: s.id,
    name: s.name,
    type: s.id.startsWith('screen:') ? 'screen' : 'window',
    thumbnail: s.thumbnail.toDataURL()
  }))
})

ipcMain.handle('save-recording', async (_event, buffer: ArrayBuffer, suggestedName: string) => {
  const recordingsDir = join(app.getPath('videos'), 'Loom Agent')
  if (!existsSync(recordingsDir)) {
    await mkdir(recordingsDir, { recursive: true })
  }
  const defaultPath = join(recordingsDir, suggestedName.replace(/\.webm$/i, '.mp4'))
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Save recording',
    defaultPath,
    filters: [{ name: 'MP4 video', extensions: ['mp4'] }]
  })
  if (canceled || !filePath) return { canceled: true as const }
  const mp4Path = filePath.toLowerCase().endsWith('.mp4') ? filePath : `${filePath}.mp4`
  const tmpWebm = join(tmpdir(), `loom-agent-${Date.now()}.webm`)
  await writeFile(tmpWebm, Buffer.from(buffer))
  try {
    await transcodeWebmToMp4(tmpWebm, mp4Path)
  } finally {
    await unlink(tmpWebm).catch(() => undefined)
  }
  return { canceled: false as const, filePath: mp4Path }
})

ipcMain.handle('get-media-duration', async (_event, filePath: string) => {
  return probeDuration(filePath)
})

ipcMain.handle('to-media-url', (_event, filePath: string) => {
  return filePathToLoomFileUrl(filePath)
})

ipcMain.handle('get-media-preview', async (_event, filePath: string) => {
  return loadMediaPreview(filePath)
})

ipcMain.handle('process-video', async (_event, inputPath: string, options: ProcessOptions) => {
  const sendProgress = (message: string, percent?: number) => {
    mainWindow?.webContents.send('process-progress', { message, percent })
  }
  const merged: ProcessOptions = {
    ...options,
    openaiApiKey: options.openaiApiKey.trim() || getOpenAiKeyFromEnv()
  }
  try {
    return await processRecording(inputPath, merged, sendProgress)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    throw new Error(message)
  }
})

ipcMain.handle('get-openai-key-status', () => ({
  hasEnvKey: Boolean(getOpenAiKeyFromEnv())
}))

ipcMain.handle('get-whisper-status', async () => {
  const runner = await findWhisperRunner()
  return {
    installed: Boolean(runner),
    hint: await getWhisperInstallHint(),
    python: runner?.executable ?? null
  }
})

ipcMain.handle(
  'export-subtitle-file',
  async (_event, sourcePath: string, format: 'srt' | 'vtt') => {
    const ext = format === 'vtt' ? 'vtt' : 'srt'
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: `Export ${ext.toUpperCase()} subtitles`,
      defaultPath: sourcePath,
      filters: [{ name: `${ext.toUpperCase()} subtitles`, extensions: [ext] }]
    })
    if (canceled || !filePath) return { canceled: true as const }
    await copyFile(sourcePath, filePath)
    return { canceled: false as const, filePath }
  }
)

ipcMain.handle('reveal-in-folder', async (_event, filePath: string) => {
  shell.showItemInFolder(filePath)
})
