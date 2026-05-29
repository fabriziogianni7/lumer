import { protocol } from 'electron'
import { createReadStream, existsSync, statSync } from 'fs'
import { extname } from 'path'
import { Readable } from 'stream'
import { loomFileUrlToPath } from './loom-file-url'

function contentTypeForPath(filePath: string): string {
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

function loomFileResponse(request: Request, filePath: string): Response {
  const stat = statSync(filePath)
  const size = stat.size
  const contentType = contentTypeForPath(filePath)
  const commonHeaders: Record<string, string> = {
    'Accept-Ranges': 'bytes',
    'Content-Type': contentType
  }

  if (request.method === 'HEAD') {
    return new Response(null, {
      status: 200,
      headers: { ...commonHeaders, 'Content-Length': String(size) }
    })
  }

  const range = request.headers.get('Range')
  if (range) {
    const match = /^bytes=(\d+)-(\d*)$/i.exec(range.trim())
    if (!match) {
      return new Response(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${size}` }
      })
    }

    const start = Number.parseInt(match[1], 10)
    let end = match[2] ? Number.parseInt(match[2], 10) : size - 1
    end = Math.min(end, size - 1)

    if (Number.isNaN(start) || Number.isNaN(end) || start >= size || start > end) {
      return new Response(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${size}` }
      })
    }

    const chunkLength = end - start + 1
    const nodeStream = createReadStream(filePath, { start, end })
    const body = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>

    return new Response(body, {
      status: 206,
      headers: {
        ...commonHeaders,
        'Content-Length': String(chunkLength),
        'Content-Range': `bytes ${start}-${end}/${size}`
      }
    })
  }

  const nodeStream = createReadStream(filePath)
  const body = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>

  return new Response(body, {
    status: 200,
    headers: { ...commonHeaders, 'Content-Length': String(size) }
  })
}

export function registerMediaProtocol(): void {
  protocol.handle('loom-file', (request) => {
    let filePath: string
    try {
      filePath = loomFileUrlToPath(request.url)
    } catch {
      return new Response('Bad request', { status: 400 })
    }

    if (!existsSync(filePath)) {
      return new Response('Not found', { status: 404 })
    }

    try {
      return loomFileResponse(request, filePath)
    } catch {
      return new Response('Failed to read file', { status: 500 })
    }
  })
}
