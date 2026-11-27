import { useEffect, useRef, useState } from 'react'
import type { CaptureSourceItem } from '@wb/contracts'
import { Button, Dialog } from '@wb/ui-kit'
import { Camera, Check, Copy, Crop, Download, RefreshCw, Video, X } from 'lucide-react'
import { formatIpcError } from '../utils/format-error.js'

export interface CaptureDialogProps {
  open: boolean
  recording: boolean
  recordingSeconds: number
  onClose: () => void
  onCaptureFullPage: () => Promise<void>
  onStartRegionCapture: () => Promise<void>
  onStartRecording: (sourceId: string, includeMic: boolean) => Promise<void>
  onStopRecording: () => Promise<void>
}

export function formatRecDuration(seconds: number): string {
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
  const ss = String(seconds % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

export function CaptureDialog({
  open,
  recording,
  recordingSeconds,
  onClose,
  onCaptureFullPage,
  onStartRegionCapture,
  onStartRecording,
  onStopRecording,
}: CaptureDialogProps) {
  const [sources, setSources] = useState<CaptureSourceItem[]>([])
  const [selectedSourceId, setSelectedSourceId] = useState('')
  const [includeMic, setIncludeMic] = useState(false)
  const [loadingSources, setLoadingSources] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadSources = async (): Promise<void> => {
    setLoadingSources(true)
    setError(null)
    try {
      const list = await window.browserApi.listCaptureSources()
      setSources(list)
      const preferred =
        list.find((s) => s.kind === 'window' && /mulspace/i.test(s.name)) ??
        list.find((s) => s.kind === 'screen') ??
        list[0]
      if (preferred) {
        setSelectedSourceId(preferred.id)
      }
    } catch (err) {
      setError(formatIpcError(err))
    } finally {
      setLoadingSources(false)
    }
  }

  useEffect(() => {
    if (open && !recording) {
      void loadSources()
    }
  }, [open, recording])

  return (
    <Dialog
      open={open}
      title="截图与录屏工具"
      onClose={onClose}
      footer={
        <Button variant="text" onClick={onClose}>
          关闭
        </Button>
      }
    >
      {error ? <div className="wb-multab-error">{error}</div> : null}

      <div className="wb-dialog-card">
        <div className="wb-dialog-card__head">
          <div>
            <div className="wb-dialog-card__title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Camera size={14} />
              <span>网页截图</span>
            </div>
            <div className="wb-dialog-card__sub">支持当前网页整页截图或鼠标框选区域截图</div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <Button
              variant="filled"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  await onCaptureFullPage()
                } catch (err) {
                  setError(formatIpcError(err))
                } finally {
                  setBusy(false)
                }
              }}
            >
              <Camera size={13} />
              整页截图并复制
            </Button>
            <Button
              variant="tonal"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  await onStartRegionCapture()
                } catch (err) {
                  setError(formatIpcError(err))
                } finally {
                  setBusy(false)
                }
              }}
            >
              <Crop size={13} />
              框选区域截图
            </Button>
          </div>
        </div>
      </div>

      <div className="wb-dialog-card">
        <div className="wb-dialog-card__head">
          <div>
            <div className="wb-dialog-card__title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Video size={14} />
              <span>屏幕 / 窗口录屏（WebM）</span>
            </div>
            <div className="wb-dialog-card__sub">
              {recording
                ? `正在录制（已录制 ${formatRecDuration(recordingSeconds)}），停止后将弹出保存位置`
                : '选择要录制的屏幕或应用窗口'}
            </div>
          </div>
          {recording ? (
            <Button
              variant="danger"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  await onStopRecording()
                  onClose()
                } catch (err) {
                  setError(formatIpcError(err))
                } finally {
                  setBusy(false)
                }
              }}
            >
              停止并保存录屏
            </Button>
          ) : (
            <Button variant="text" disabled={loadingSources} onClick={() => void loadSources()}>
              <RefreshCw size={13} />
              刷新源
            </Button>
          )}
        </div>

        {!recording ? (
          <>
            <div className="wb-capture-grid">
              {sources.map((src) => {
                const selected = src.id === selectedSourceId
                return (
                  <button
                    key={src.id}
                    type="button"
                    className={`wb-capture-source ${selected ? 'wb-capture-source--selected' : ''}`}
                    onClick={() => setSelectedSourceId(src.id)}
                  >
                    <img src={src.thumbnailDataUrl} alt="" />
                    <span>{src.name}</span>
                  </button>
                )
              })}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <label className="wb-check-row">
                <input
                  type="checkbox"
                  checked={includeMic}
                  onChange={(e) => setIncludeMic(e.target.checked)}
                />
                <span>同时录制麦克风声音</span>
              </label>

              <Button
                variant="filled"
                disabled={busy || !selectedSourceId}
                onClick={async () => {
                  setBusy(true)
                  setError(null)
                  try {
                    await onStartRecording(selectedSourceId, includeMic)
                    onClose()
                  } catch (err) {
                    setError(formatIpcError(err))
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                <Video size={13} />
                开始录屏
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </Dialog>
  )
}

interface CropRect {
  x: number
  y: number
  w: number
  h: number
}

export interface CaptureCropOverlayProps {
  imageDataUrl: string | null
  onClose: () => void
  onCopyDataUrl: (dataUrl: string) => Promise<void>
  onSaveDataUrl: (dataUrl: string) => Promise<void>
}

export function CaptureCropOverlay({
  imageDataUrl,
  onClose,
  onCopyDataUrl,
  onSaveDataUrl,
}: CaptureCropOverlayProps) {
  const imgRef = useRef<HTMLImageElement | null>(null)
  const [selection, setSelection] = useState<CropRect | null>(null)
  const [dragging, setDragging] = useState(false)
  const startPointRef = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (!imageDataUrl) return
    setSelection(null)
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [imageDataUrl, onClose])

  if (!imageDataUrl) return null

  const exportCroppedDataUrl = (): string | null => {
    const img = imgRef.current
    if (!img || !selection || selection.w < 4 || selection.h < 4) return null
    const rect = img.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    const scaleX = img.naturalWidth / rect.width
    const scaleY = img.naturalHeight / rect.height
    const sx = Math.max(0, Math.round((selection.x - rect.left) * scaleX))
    const sy = Math.max(0, Math.round((selection.y - rect.top) * scaleY))
    const sw = Math.max(1, Math.min(img.naturalWidth - sx, Math.round(selection.w * scaleX)))
    const sh = Math.max(1, Math.min(img.naturalHeight - sy, Math.round(selection.h * scaleY)))
    const canvas = document.createElement('canvas')
    canvas.width = sw
    canvas.height = sh
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh)
    return canvas.toDataURL('image/png')
  }

  return (
    <div
      className="wb-crop-overlay"
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest('.wb-crop-toolbar')) return
        if (e.button !== 0) return
        startPointRef.current = { x: e.clientX, y: e.clientY }
        setSelection({ x: e.clientX, y: e.clientY, w: 0, h: 0 })
        setDragging(true)
      }}
      onPointerMove={(e) => {
        if (!dragging || !startPointRef.current) return
        const x = Math.min(startPointRef.current.x, e.clientX)
        const y = Math.min(startPointRef.current.y, e.clientY)
        const w = Math.abs(e.clientX - startPointRef.current.x)
        const h = Math.abs(e.clientY - startPointRef.current.y)
        setSelection({ x, y, w, h })
      }}
      onPointerUp={() => setDragging(false)}
    >
      <img ref={imgRef} src={imageDataUrl} alt="" className="wb-crop-image" draggable={false} />
      <div className="wb-crop-hint">按住鼠标左键拖动框选区域 · 按 Esc 退出</div>

      {selection && selection.w > 2 && selection.h > 2 ? (
        <div
          className="wb-crop-box"
          style={{ left: selection.x, top: selection.y, width: selection.w, height: selection.h }}
        >
          <span className="wb-crop-dims">
            {Math.round(selection.w)} × {Math.round(selection.h)}
          </span>
        </div>
      ) : null}

      <div className="wb-crop-toolbar">
        {selection && selection.w > 8 && selection.h > 8 ? (
          <>
            <button
              type="button"
              className="wb-crop-btn wb-crop-btn--primary"
              onClick={() => {
                const cropped = exportCroppedDataUrl()
                if (cropped) void onCopyDataUrl(cropped).then(onClose)
              }}
            >
              <Check size={14} />
              复制选区
            </button>
            <button
              type="button"
              className="wb-crop-btn"
              onClick={() => {
                const cropped = exportCroppedDataUrl()
                if (cropped) void onSaveDataUrl(cropped).then(onClose)
              }}
            >
              <Download size={14} />
              保存 PNG
            </button>
          </>
        ) : (
          <button
            type="button"
            className="wb-crop-btn wb-crop-btn--primary"
            onClick={() => void onCopyDataUrl(imageDataUrl).then(onClose)}
          >
            <Copy size={14} />
            复制整页截图
          </button>
        )}
        <button type="button" className="wb-crop-btn" onClick={onClose}>
          <X size={14} />
          取消
        </button>
      </div>
    </div>
  )
}
