import type { ZoomPan2D } from '../core/zoom-pan-2d.ts'
import { AnchorType, SpaceType } from '../types'
import { LayerBase } from './layer.base.ts'

interface ICreateCanvasLayerOption {
  name?: string
  width: number
  height: number

  /**
   * The space of the layer, either 'world' or 'screen'.
   *
   * @default 'world'
   */
  space?: SpaceType
  x?: number
  y?: number
  scale?: number
  rotation?: number
  anchor?: AnchorType
  redraw?: (context: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => void
}

/**
 * CanvasLayer is used to create a layer with an offscreen canvas in either world or screen space.
 * You can draw anything you want on the offscreen canvas, and it will be rendered as a layer.
 */
class CanvasLayer extends LayerBase {
  private readonly _redraw?: (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => void

  readonly canvas: HTMLCanvasElement
  readonly context: CanvasRenderingContext2D
  x: number = 0
  y: number = 0
  scale: number = 1
  rotation: number = 0
  anchor: AnchorType = 'topLeft'

  // Drawing.
  // =================
  private _drawing = false
  private _lastX: number = 0
  private _lastY: number = 0

  beginStroke (wx: number, wy: number) {
    const { lx, ly } = this.toLocalPoint(wx, wy)
    this._lastX = lx
    this._lastY = ly
    this._drawing = true
  }

  stroke (
    wx: number, wy: number,
    color: string, size: number,
    pressure: number = 1,
    mode: 'brush' | 'eraser' = 'brush'
  ) {
    if (!this._drawing) {
      return
    }

    const { lx, ly } = this.toLocalPoint(wx, wy)

    this.context.beginPath()
    this.context.moveTo(this._lastX, this._lastY)
    this.context.lineTo(lx, ly)

    if (mode === 'eraser') {
      this.context.globalCompositeOperation = 'destination-out'
      this.context.strokeStyle = 'rgba(0, 0, 0, 1)'
    } else {
      this.context.globalCompositeOperation = 'source-over'
      this.context.strokeStyle = color
    }

    this.context.strokeStyle = color
    this.context.lineWidth = size * pressure
    this.context.lineCap = 'round'
    this.context.lineJoin = 'round'
    this.context.stroke()
    this.context.closePath()

    this._lastX = lx
    this._lastY = ly
  }

  endStroke () {
    this._drawing = false
  }

  /**
   * Request a redraw of the offscreen canvas.
   * This will call the redraw function you provided in the constructor.
   */
  requestRedraw () {
    this._redraw?.(this.context, this.canvas)
  }

  /**
   * Draw an image onto the offscreen canvas.
   */
  drawImage (
    image: HTMLImageElement | HTMLCanvasElement | ImageBitmap,
    dx: number, dy: number, dw?: number, dh?: number
  ) {
    this.context.drawImage(image, dx, dy, dw ?? image.width, dh ?? image.height)
  }

  /**
   * Hit test the layer.
   * Returns true if the point (wx, wy) in world space is within the layer bounds.
   */
  hitTest (wx: number, wy: number): boolean {
    const { lx, ly } = this.toLocalPoint(wx, wy)
    return lx >= 0 && lx <= this.canvas.width &&
      ly >= 0 && ly <= this.canvas.height
  }

  /**
   * Convert a point from world space to local layer space.
   *
   * @param wx
   * @param wy
   */
  toLocalPoint (wx: number, wy: number): { lx: number, ly: number } {
    // world → 相对图层原点
    const dx = wx - this.x
    const dy = wy - this.y

    // world → 旋转逆变换
    const cos = Math.cos(-this.rotation)
    const sin = Math.sin(-this.rotation)
    const rx = dx * cos - dy * sin
    const ry = dx * sin + dy * cos

    // world → local (缩放修正)
    const lx = rx / this.scale
    const ly = ry / this.scale

    // anchor 偏移
    const ax = this.anchor === 'center' ? this.canvas.width / 2 : 0
    const ay = this.anchor === 'center' ? this.canvas.height / 2 : 0

    return {
      lx: lx + ax,
      ly: ly + ay
    }
  }

  /**
   * Render the layer onto the given ZoomPan2D context.
   */
  render (view: ZoomPan2D) {
    if (!this.visible) {
      return
    }

    const ctx = view.context
    ctx.save()
    ctx.globalAlpha = this.opacity
    ctx.globalCompositeOperation = this.blend
    ctx.translate(this.x, this.y)
    ctx.rotate(this.rotation)

    const w = this.canvas.width * this.scale
    const h = this.canvas.height * this.scale
    const dx = this.anchor === 'center' ? -w / 2 : 0
    const dy = this.anchor === 'center' ? -h / 2 : 0
    ctx.drawImage(this.canvas, dx, dy, w, h)
    ctx.restore()
  }

  destroy () {
    // TODO: Nothing to do?
  }

  constructor (options: ICreateCanvasLayerOption) {
    super(
      options.name || '',
      'canvas',
      options.space ?? 'world'
    )
    this.canvas = document.createElement('canvas')
    this.canvas.width = options.width
    this.canvas.height = options.height

    const context = this.canvas.getContext('2d')
    if (!context) {
      throw new Error('Offscreen 2D context unavailable')
    }
    this.context = context

    this.x = options.x || 0
    this.y = options.y || 0
    this.scale = options.scale ?? 1
    this.rotation = options.rotation || 0
    if (options.anchor) {
      this.anchor = options.anchor
    }

    this._redraw = options.redraw
    if (this._redraw) {
      this._redraw(this.context, this.canvas)
    }
  }
}

export {
  CanvasLayer
}

export type {
  ICreateCanvasLayerOption
}
