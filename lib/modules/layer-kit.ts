import { loadImage } from '../utils'
import type { ZoomPan2D } from '../zoom-pan-2d'

type BlendMode = GlobalCompositeOperation
type AnchorType = 'topLeft' | 'center'
type SpaceType = 'world' | 'screen'

/* ---------------------------------------
 * Base layer
 * ------------------------------------- */
let __LAYER_SEQ = 0

abstract class LayerBase {
  readonly id: string
  type: string
  name: string
  space: SpaceType = 'world'
  visible: boolean = true
  opacity: number = 1
  blend: BlendMode = 'source-over'

  abstract render (view: ZoomPan2D): void
  abstract destroy (): void
  abstract hitTest (x: number, y: number, view?: ZoomPan2D): boolean

  protected constructor (name: string, type: string, space: SpaceType = 'world') {
    this.name = name
    this.id = `layer_${type}_${++__LAYER_SEQ}`
    this.type = type
    this.space = space
  }
}

/* ---------------------------------------
 * Canvas layer (offscreen)
 * ------------------------------------- */
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

/* ---------------------------------------
 * Bitmap Layer
 * ------------------------------------- */
/**
 * Image is used to load and display an image in world space.
 */
class BitmapLayer extends CanvasLayer {
  #urlToRevoke: string | null = null

  /** 从图片源创建位图层（会把像素绘入离屏） */
  static async fromImage (
    options: Omit<ICreateImageLayerOption, 'scale'|'rotation'|'anchor'> & {
      scale?: number
      rotation?: number
      anchor?: AnchorType
    }
  ): Promise<BitmapLayer> {
    const img = await loadImage(options.src, options.crossOrigin)
    const distWidth = options.width ?? img.naturalWidth
    const distHeight = options.height ?? img.naturalHeight
    const layer = new BitmapLayer({
      name: options.name,
      space: options.space ?? 'world',
      x: options.x ?? 0,
      y: options.y ?? 0,
      scale: options.scale ?? 1,
      rotation: options.rotation ?? 0,
      anchor: options.anchor ?? 'topLeft',
      width: distWidth,
      height: distHeight
    })

    layer.context.clearRect(0, 0, layer.canvas.width, layer.canvas.height)
    layer.context.drawImage(img, 0, 0, distWidth, distHeight)

    // 记下可撤销的 URL
    if (typeof options.src !== 'string') {
      layer.#urlToRevoke = (img.src.startsWith('blob:') ? img.src : null)
    }

    return layer
  }

  /** 替换图源（尺寸会重配） */
  async setSource (src: string | File | Blob, crossOrigin?: '' | 'anonymous' | 'use-credentials') {
    const img = await loadImage(src, crossOrigin)
    this.canvas.width = img.naturalWidth
    this.canvas.height = img.naturalHeight
    this.context.setTransform(1, 0, 0, 1, 0, 0)
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height)
    this.context.drawImage(img, 0, 0)
    if (this.#urlToRevoke) {
      try { URL.revokeObjectURL(this.#urlToRevoke) } catch {}
      this.#urlToRevoke = null
    }
    if (typeof src !== 'string') {
      this.#urlToRevoke = (img.src.startsWith('blob:') ? img.src : null)
    }
  }

  /** 在位图上作画（提供 ctx） */
  paint (fn: (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => void) {
    fn(this.context, this.canvas)
  }

  /** 读取/写回像素 */
  getImageData (sx = 0, sy = 0, sw = this.canvas.width, sh = this.canvas.height) {
    return this.context.getImageData(sx, sy, sw, sh)
  }

  putImageData (img: ImageData, dx = 0, dy = 0) {
    this.context.putImageData(img, dx, dy)
  }

  /** 导出（PNG dataURL 或 ImageBitmap） */
  toDataURL (type: string = 'image/png', quality?: number) {
    return this.canvas.toDataURL(type, quality)
  }

  toImageBitmap (opts?: ImageBitmapOptions) {
    return createImageBitmap(this.canvas, opts ?? {})
  }

  override destroy () {
    super.destroy?.()
    if (this.#urlToRevoke) {
      try { URL.revokeObjectURL(this.#urlToRevoke) } catch {}
      this.#urlToRevoke = null
    }
  }

  private constructor (options: {
    name?: string
    space?: SpaceType
    x?: number
    y?: number
    scale?: number; rotation?: number
    anchor?: AnchorType
    width: number
    height: number
  }) {
    super({
      name: options.name,
      space: options.space ?? 'world',
      x: options.x,
      y: options.y,
      scale: options.scale,
      rotation: options.rotation,
      anchor: options.anchor ?? 'topLeft',
      width: options.width,
      height: options.height
    })
    this.type = 'bitmap'
  }
}

/* ---------------------------------------
 * Image layer
 * ------------------------------------- */
interface ICreateImageLayerOption {
  src: string | File | Blob
  width?: number
  height?: number
  name?: string
  x?: number
  y?: number
  scale?: number
  rotation?: number // radians
  anchor?: AnchorType
  space?: SpaceType
  crossOrigin?: '' | 'anonymous' | 'use-credentials'
}

/* ---------------------------------------
 * Layer Manager
 * ------------------------------------- */
class LayerManager {
  private _worldLayers: LayerBase[] = []
  private _screenLayers: LayerBase[] = []

  addLayer (layer: LayerBase, insertAt?: number): string {
    const stack = layer.space === 'world'
      ? this._worldLayers
      : this._screenLayers

    if (typeof insertAt === 'number' && insertAt >= 0 && insertAt < stack.length) {
      stack.splice(insertAt, 0, layer)
      return layer.id
    }

    stack.push(layer)
    return layer.id
  }

  async createImageLayer (option: ICreateImageLayerOption): Promise<BitmapLayer> {
    const layer = await BitmapLayer.fromImage(option)
    this.addLayer(layer)
    return layer
  }

  createCanvasLayer (option: ICreateCanvasLayerOption): CanvasLayer {
    const layer = new CanvasLayer(option)
    this.addLayer(layer)
    return layer
  }

  removeLayer (id: string) {
    const idxW = this._worldLayers.findIndex(l => l.id === id)
    if (idxW >= 0) {
      this._worldLayers[idxW].destroy?.()
      this._worldLayers.splice(idxW, 1)
      return
    }
    const idxS = this._screenLayers.findIndex(l => l.id === id)
    if (idxS >= 0) {
      this._screenLayers[idxS].destroy?.()
      this._screenLayers.splice(idxS, 1)
    }
  }

  getLayer (id: string): LayerBase | undefined {
    return this._worldLayers.find(l => l.id === id) || this._screenLayers.find(l => l.id === id)
  }

  getAllLayers (space?: SpaceType): LayerBase[] {
    if (!space) {
      return [...this._worldLayers, ...this._screenLayers]
    }
    return (
      space === 'world' ? this._worldLayers : this._screenLayers
    ).slice()
  }

  /**
   * Render all layers in target view.
   */
  renderAllLayersIn (view: ZoomPan2D) {
    // world stack（ctx 已在 ZoomPan2D 中设置为世界矩阵）
    for (const l of this._worldLayers) {
      if (!l.visible || l.opacity <= 0) {
        continue
      }
      l.render(view)
    }

    // screen stack（切回单位矩阵）
    const context = view.context
    context.setTransform(1, 0, 0, 1, 0, 0)
    for (const l of this._screenLayers) {
      if (!l.visible || l.opacity <= 0) {
        continue
      }
      l.render(view)
    }
  }

  /**
   * Hit test all layers (top-first).
   *
   * @param x
   * @param y
   * @param space
   */
  hitTest (x: number, y: number, space: 'world'|'screen' = 'world'): LayerBase | undefined {
    const allLayers = this.getAllLayers(space)
    for (let i = allLayers.length - 1; i >= 0; i--) { // top-first
      const layer = allLayers[i]
      if (layer.hitTest && layer.hitTest(x, y)) {
        return layer
      }
    }
    return undefined
  }

  destroy () {
    for (const item of [...this._worldLayers, ...this._screenLayers]) {
      item.destroy?.()
    }
    this._worldLayers = []
    this._screenLayers = []
  }
}

export {
  LayerBase,
  CanvasLayer,
  BitmapLayer,
  LayerManager
}

export type {
  BlendMode,
  ICreateImageLayerOption,
  ICreateCanvasLayerOption
}
