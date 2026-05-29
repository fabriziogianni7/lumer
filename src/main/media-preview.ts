import { readFile, stat } from 'fs/promises'
import { extname } from 'path'
import { filePathToLoomFileUrl } from './loom-file-url'

/** In-app `<video>` is unreliable with custom schemes; blob preview is preferred under this size. */
const MAX_BLOB_PREVIEW_BYTES = 250 * 1024 * 1024

function mimeForPath(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case '.mp4':
    case '.m4v':
      return 'video/mp4'
    case '.webm':
      return 'video/webm'
    case '.mov':
      return 'video/quicktime'
    default:
      return 'application/octet-stream'
  }
}

export type MediaPreviewPayload =
  | { mode: 'blob'; mime: string; buffer: ArrayBuffer }
  | { mode: 'url'; url: string }

export async function loadMediaPreview(filePath: string): Promise<MediaPreviewPayload> {
  const { size } = await stat(filePath)
  const mime = mimeForPath(filePath)

  if (size <= MAX_BLOB_PREVIEW_BYTES) {
    const buf = await readFile(filePath)
    return {
      mode: 'blob',
      mime,
      buffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    }
  }

  return { mode: 'url', url: filePathToLoomFileUrl(filePath) }
}
