import { useCallback, useRef } from 'react'
import { CAM_SIZE, CANVAS_H, CANVAS_W, clampCamPosition } from '../constants/canvas'

type Props = {
  camPos: { x: number; y: number }
  onCamPosChange: (pos: { x: number; y: number }) => void
  visible: boolean
  children: React.ReactNode
}

export function PreviewFrame({ camPos, onCamPosChange, visible, children }: Props) {
  const frameRef = useRef<HTMLDivElement>(null)
  const dragOffsetRef = useRef<{ dx: number; dy: number } | null>(null)

  const canvasToFrame = useCallback((canvasX: number, canvasY: number) => {
    const frame = frameRef.current
    if (!frame) return { left: 0, top: 0, scaleX: 1 }
    const scaleX = frame.clientWidth / CANVAS_W
    const scaleY = frame.clientHeight / CANVAS_H
    return { left: canvasX * scaleX, top: canvasY * scaleY, scaleX, scaleY }
  }, [])

  const onPointerDown = (e: React.PointerEvent) => {
    if (!visible) return
    e.preventDefault()
    e.stopPropagation()
    const frame = frameRef.current
    if (!frame) return
    const rect = frame.getBoundingClientRect()
    const scaleX = CANVAS_W / rect.width
    const scaleY = CANVAS_H / rect.height
    const pointerCanvasX = (e.clientX - rect.left) * scaleX
    const pointerCanvasY = (e.clientY - rect.top) * scaleY
    dragOffsetRef.current = {
      dx: pointerCanvasX - camPos.x,
      dy: pointerCanvasY - camPos.y
    }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragOffsetRef.current) return
    const frame = frameRef.current
    if (!frame) return
    const rect = frame.getBoundingClientRect()
    const scaleX = CANVAS_W / rect.width
    const scaleY = CANVAS_H / rect.height
    const pointerCanvasX = (e.clientX - rect.left) * scaleX
    const pointerCanvasY = (e.clientY - rect.top) * scaleY
    onCamPosChange(
      clampCamPosition(
        pointerCanvasX - dragOffsetRef.current.dx,
        pointerCanvasY - dragOffsetRef.current.dy
      )
    )
  }

  const onPointerUp = (e: React.PointerEvent) => {
    dragOffsetRef.current = null
    try {
      ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
    } catch {
      /* already released */
    }
  }

  const { left, top, scaleX = 1 } = canvasToFrame(camPos.x, camPos.y)
  const size = CAM_SIZE * scaleX

  return (
    <div className="preview-frame" ref={frameRef}>
      {children}
      {visible && (
        <>
          <div
            className="cam-drag-handle"
            style={{ left, top, width: size, height: size }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            title="Drag to move camera"
          />
          <p className="cam-drag-hint">Drag the square to move your camera</p>
        </>
      )}
    </div>
  )
}
