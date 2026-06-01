/** Shared encode / capture quality knobs (1080p screen + cam). */

/** VP9/WebM bitrate from MediaRecorder before FFmpeg export. */
export const RECORDER_VIDEO_BITS_PER_SECOND = 14_000_000

/** Apple VideoToolbox — screen content needs higher bitrate than camera. */
export const VTB_BITRATE = '16M'
export const VTB_MAXRATE = '20M'
export const VTB_BUFSIZE = '24M'

/** libx264 — lower CRF = higher quality; 18 is visually strong for 1080p. */
export const X264_CRF = 18
export const X264_PRESET = 'fast'

export const AAC_BITRATE = '256k'

/** Lanczos scaling when re-encoding (sharper than default bilinear). */
export const SCALE_VF = 'scale=trunc(iw/2)*2:trunc(ih/2)*2:flags=lanczos'
