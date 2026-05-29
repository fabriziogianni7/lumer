/** Build a fetch-safe loom-file URL for an absolute filesystem path. */
export function filePathToLoomFileUrl(filePath: string): string {
  const segments = filePath.split('/').map((segment) => encodeURIComponent(segment))
  // Absolute paths start with '' before first '/Users/...'
  if (filePath.startsWith('/')) {
    return `loom-file://${segments.join('/')}`
  }
  return `loom-file:///${segments.join('/')}`
}

export function loomFileUrlToPath(requestUrl: string): string {
  const url = new URL(requestUrl)
  if (url.protocol !== 'loom-file:') {
    throw new Error(`Invalid media URL: ${requestUrl}`)
  }
  const path = decodeURIComponent(url.pathname)
  return path
}
