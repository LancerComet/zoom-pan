import type { CanvasLayer } from '../layer/layer.canvas'
import { BaseCommand } from './base-command'
import type { ICommand, IStrokeData } from './type'

interface StrokeCommandOptions {
  snapshot?: ImageData | null
  alreadyApplied?: boolean
}

interface BoundingBox {
  x: number
  y: number
  width: number
  height: number
}

class StrokeCommand extends BaseCommand {
  private readonly layer: CanvasLayer
  private strokeData: IStrokeData
  private previousImageData: ImageData | null = null
  private boundingBox: { x: number, y: number, width: number, height: number } | null = null
  private isExecuted = false

  private calculateBoundingBox (): BoundingBox | null {
    const { points, size } = this.strokeData
    if (points.length === 0) return null

    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity

    for (const point of points) {
      const pressure = point.pressure ?? 1
      const radius = (size * pressure) / 2
      minX = Math.min(minX, point.x - radius)
      minY = Math.min(minY, point.y - radius)
      maxX = Math.max(maxX, point.x + radius)
      maxY = Math.max(maxY, point.y + radius)
    }

    const padding = 2
    const { canvas } = this.layer
    const x = Math.max(0, Math.floor(minX - padding))
    const y = Math.max(0, Math.floor(minY - padding))
    const right = Math.min(canvas.width, Math.ceil(maxX + padding))
    const bottom = Math.min(canvas.height, Math.ceil(maxY + padding))

    const width = right - x
    const height = bottom - y

    if (width <= 0 || height <= 0) {
      return null
    }

    return { x, y, width, height }
  }

  private fitSnapshotToBoundingBox (): void {
    if (!this.previousImageData || !this.boundingBox) {
      return
    }

    const { width, height } = this.boundingBox
    if (this.previousImageData.width === width && this.previousImageData.height === height) {
      return
    }

    const source = this.previousImageData
    const cropped = new ImageData(width, height)
    const srcData = source.data
    const dstData = cropped.data
    const sourceWidth = source.width
    const rowStride = width * 4
    const { x, y } = this.boundingBox

    for (let row = 0; row < height; row++) {
      const srcOffset = ((y + row) * sourceWidth + x) * 4
      const dstOffset = row * rowStride
      dstData.set(srcData.subarray(srcOffset, srcOffset + rowStride), dstOffset)
    }

    this.previousImageData = cropped
  }

  private captureCurrentState (): ImageData | null {
    try {
      const { context, canvas } = this.layer
      if (!this.boundingBox) {
        this.boundingBox = this.calculateBoundingBox()
      }
      if (this.boundingBox) {
        const { x, y, width, height } = this.boundingBox
        return context.getImageData(x, y, width, height)
      }
      return context.getImageData(0, 0, canvas.width, canvas.height)
    } catch {
      return null
    }
  }

  private restorePreviousState (): void {
    const { context, canvas } = this.layer
    if (this.previousImageData && this.boundingBox) {
      context.putImageData(this.previousImageData, this.boundingBox.x, this.boundingBox.y)
    } else if (this.previousImageData) {
      context.putImageData(this.previousImageData, 0, 0)
    } else {
      context.clearRect(0, 0, canvas.width, canvas.height)
    }
    context.globalCompositeOperation = 'source-over'
  }

  private performStroke (): void {
    const context = this.layer.context
    const { points, color, size, mode } = this.strokeData

    if (points.length === 0) return

    context.save()
    if (mode === 'eraser') {
      context.globalCompositeOperation = 'destination-out'
      context.strokeStyle = 'rgba(0, 0, 0, 1)'
      context.fillStyle = 'rgba(0, 0, 0, 1)'
    } else {
      context.globalCompositeOperation = 'source-over'
      context.strokeStyle = color
      context.fillStyle = color
    }
    context.lineCap = 'round'
    context.lineJoin = 'round'

    if (points.length === 1) {
      const point = points[0]
      const radius = (size * (point.pressure ?? 1)) / 2
      context.beginPath()
      context.arc(point.x, point.y, radius, 0, Math.PI * 2)
      context.fill()
      context.restore()
      context.globalCompositeOperation = 'source-over'
      return
    }

    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1]
      const current = points[i]
      const pressure = current.pressure ?? 1
      const lineWidth = Math.max(size * pressure, 0.001)

      context.lineWidth = lineWidth
      context.beginPath()
      context.moveTo(prev.x, prev.y)
      context.lineTo(current.x, current.y)
      context.stroke()
    }

    context.restore()
    context.globalCompositeOperation = 'source-over'
  }

  /**
   * 执行命令：重新绘制笔画
   * 用于重做操作
   */
  execute (): void {
    if (this.isExecuted) {
      return
    }

    if (!this.previousImageData) {
      this.previousImageData = this.captureCurrentState()
      if (this.previousImageData && this.boundingBox) {
        this.fitSnapshotToBoundingBox()
      }
    }

    this.performStroke()
    this.isExecuted = true
  }

  undo (): void {
    if (!this.isExecuted) {
      return
    }

    this.restorePreviousState()
    this.isExecuted = false
  }

  canMerge (other: ICommand): boolean {
    return !!other && false
  }

  merge (other: ICommand): ICommand {
    if (other) {
      // merging is intentionally disabled for stroke commands
    }
    return this
  }

  constructor (
    layer: CanvasLayer,
    strokeData: IStrokeData,
    options: StrokeCommandOptions = {}
  ) {
    super('stroke')
    this.layer = layer
    this.strokeData = {
      ...strokeData,
      points: strokeData.points.slice()
    }
    this.previousImageData = options.snapshot ?? null
    this.isExecuted = options.alreadyApplied ?? false
    this.boundingBox = this.calculateBoundingBox()

    if (this.previousImageData && this.boundingBox) {
      this.fitSnapshotToBoundingBox()
    }
  }
}

export {
  StrokeCommand
}

export type {
  StrokeCommandOptions
}
