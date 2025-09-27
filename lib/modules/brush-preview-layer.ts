import type { ZoomPan2D } from '../zoom-pan-2d'
import { LayerBase } from './layer-kit'

class BrushPreviewLayer extends LayerBase {
  // 存屏幕坐标（来自 pointermove）
  screenX = 0
  screenY = 0
  // 世界半径（真实落笔半径，单位=世界坐标单位）
  radiusWorld = 20
  // 颜色/样式
  strokeStyle = '#00d8ff'
  fillStyle: string | null = null
  dashed = false

  constructor () {
    super('brush-preview', 'world')
    this.visible = true
    this.opacity = 1
  }

  render (ctx: CanvasRenderingContext2D, view: ZoomPan2D): void {
    if (!this.visible) return

    // 1) 把屏幕坐标转换成世界坐标（关键！）
    const { x: wx, y: wy } = view.toWorld(this.screenX, this.screenY)
    const { zoom } = view.getTransform()

    // 2) 画世界半径的圆（半径不随缩放变，屏幕上看会放大/缩小）
    ctx.save()
    ctx.globalAlpha = this.opacity
    ctx.globalCompositeOperation = this.blend

    // 画“始终 1px 屏幕粗细”的边框：lineWidth = 屏幕像素 / zoom
    ctx.lineWidth = 1 / zoom
    ctx.strokeStyle = this.strokeStyle
    if (this.dashed) ctx.setLineDash([4 / zoom, 4 / zoom])

    ctx.beginPath()
    ctx.arc(wx, wy, this.radiusWorld, 0, Math.PI * 2)
    if (this.fillStyle) {
      ctx.fillStyle = this.fillStyle
      ctx.fill()
    }
    ctx.stroke()
    ctx.restore()
  }
}

export {
  BrushPreviewLayer
}
