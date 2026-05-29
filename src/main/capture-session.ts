import { session, desktopCapturer } from 'electron'

/** Enables macOS system audio loopback when renderer uses getDisplayMedia. */
export function configureCaptureSession(): void {
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(true)
  })

  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer.getSources({ types: ['window', 'screen'] }).then((sources) => {
      if (!sources.length) {
        callback({})
        return
      }
      callback({
        video: sources[0],
        audio: process.platform === 'darwin' ? 'loopback' : undefined
      })
    })
  })
}
