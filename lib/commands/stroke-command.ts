import type { CanvasLayer } from '../layer/layer.canvas'
import { BaseCommand } from './base-command'
import type { ICommand, IStrokeData } from './type'

interface StrokeCommandOptions {
  snapshot?: ImageData | null
  appliedFromLive?: boolean
}

/**
 * 笔画命令：记录一次完整的绘画操作
 */
class StrokeCommand extends BaseCommand {
  private readonly layer: CanvasLayer
  private strokeData: IStrokeData
  private previousImageData: ImageData | null
  private hasLiveApplied: boolean
  private isExecuted = false

  private captureCurrentState (): ImageData | null {
    try {
      const { canvas, context } = this.layer
      return context.getImageData(0, 0, canvas.width, canvas.height)
    } catch {
      return null
    }
  }

  private restorePreviousState (): void {
    const { context, canvas } = this.layer
    if (this.previousImageData) {
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

  execute (): void {
    if (this.isExecuted) return

    if (!this.previousImageData) {
      this.previousImageData = this.captureCurrentState()
    }

    if (this.hasLiveApplied) {
      this.hasLiveApplied = false
    } else {
      this.performStroke()
    }

    this.isExecuted = true
  }

  undo (): void {
    if (!this.isExecuted) return

    this.restorePreviousState()
    this.isExecuted = false
  }

  canMerge (other: ICommand): boolean {
    if (!(other instanceof StrokeCommand)) return false
    if (other.layer.id !== this.layer.id) return false

    const timeDiff = Math.abs(other.getTimestamp() - this.getTimestamp())
    if (timeDiff > 100) {
      return false
    }

    return (
      other.strokeData.color === this.strokeData.color &&
      other.strokeData.size === this.strokeData.size &&
      other.strokeData.mode === this.strokeData.mode
    )
  }

  merge (other: ICommand): ICommand {
    if (!(other instanceof StrokeCommand)) {
      return other
    }

    this.strokeData.points.push(...other.strokeData.points)
    this.timestamp = other.getTimestamp()
    return this
  }

  constructor (layer: CanvasLayer, strokeData: IStrokeData, options?: StrokeCommandOptions) {
    super('stroke')
    this.layer = layer
    this.strokeData = {
      ...strokeData,
      points: strokeData.points.slice()
    }
    this.previousImageData = options?.snapshot ?? null
    this.hasLiveApplied = options?.appliedFromLive ?? false
  }
}

export {
  StrokeCommand
}

export type {
  StrokeCommandOptions
}

