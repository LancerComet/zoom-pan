import type { ZoomPan2D } from '../zoom-pan-2d'
import { LayerBase } from './layer-kit'

class BrushCursor extends LayerBase {
  /**
   * The screen position x of the brush cursor in pixel.
   * Update it to move the brush cursor.
   *
   * @default 0
   */
  screenX: number = 0

  /**
   * The screen position y of the brush cursor in pixel.
   * Update it to move the brush cursor.
   *
   * @default 0
   */
  screenY: number = 0

  /**
   * The brush size in world unit.
   * Update it to change the brush size.
   *
   * @default 20
   */
  radiusWorld: number = 20

  /**
   * Stroke color of the brush circle.
   *
   * @default '#000000'
   */
  strokeStyle: string = '#000000'

  /**
   * Fill color of the brush circle.
   *
   * @default null
   */
  fillStyle: string | null = null

  /**
   * If the brush circle is dashed.
   *
   * @default false
   */
  dashed: boolean = false

  render (view: ZoomPan2D) {
    if (!this.visible) {
      return
    }

    const ctx = view.context

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
    if (this.dashed) {
      ctx.setLineDash([4 / zoom, 4 / zoom])
    }

    ctx.beginPath()
    ctx.arc(wx, wy, this.radiusWorld, 0, Math.PI * 2)
    if (this.fillStyle) {
      ctx.fillStyle = this.fillStyle
      ctx.fill()
    }
    ctx.stroke()
    ctx.restore()
  }

  constructor () {
    super('brush-preview', 'world')
    this.visible = true
    this.opacity = 1
  }
}

export {
  BrushCursor
}
