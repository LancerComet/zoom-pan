import { ViewManager, LayerBase } from '../../../lib'

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
  radius: number = 20

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

  hitTest (): boolean {
    return false
  }

  render (context: CanvasRenderingContext2D, view: ViewManager) {
    if (!this.visible) {
      return
    }

    // 1) 把屏幕坐标转换成世界坐标（关键！）
    const { wx, wy } = view.toWorld(this.screenX, this.screenY)
    const { zoom } = view.getTransform()

    // 2) 画世界半径的圆（半径不随缩放变，屏幕上看会放大/缩小）
    context.save()
    context.globalAlpha = this.opacity
    context.globalCompositeOperation = this.blend

    // 画“始终 1px 屏幕粗细”的边框：lineWidth = 屏幕像素 / zoom
    context.lineWidth = 1 / zoom
    context.strokeStyle = this.strokeStyle
    if (this.dashed) {
      context.setLineDash([4 / zoom, 4 / zoom])
    }

    context.beginPath()
    context.arc(wx, wy, this.radius / 2, 0, Math.PI * 2)

    if (this.fillStyle) {
      context.fillStyle = this.fillStyle
      context.fill()
    }
    context.stroke()
    context.restore()
  }

  destroy () {
    // ...
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
