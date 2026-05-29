export const CANVAS_W = 1920
export const CANVAS_H = 1080
export const CAM_SIZE = 220
export const CAM_RADIUS = 12
export const CAM_MARGIN = 24

export function defaultCamPosition(): { x: number; y: number } {
  return {
    x: CANVAS_W - CAM_SIZE - CAM_MARGIN,
    y: CANVAS_H - CAM_SIZE - CAM_MARGIN
  }
}

export function clampCamPosition(x: number, y: number): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(CANVAS_W - CAM_SIZE, x)),
    y: Math.max(0, Math.min(CANVAS_H - CAM_SIZE, y))
  }
}
