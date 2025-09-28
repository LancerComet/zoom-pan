// LayerKit.ts
// Layer system for ZoomPan2D: world-space layers + screen-space overlay layers.
// Features: image layers, offscreen-canvas layers, z-order, visibility, opacity, blend, hitTest.

import { loadImage } from '../utils'
import type { ZoomPan2D } from '../zoom-pan-2d'

 type LayerId = string
 type BlendMode = GlobalCompositeOperation

 interface LayerInfo {
  id: LayerId
  type: string
  visible: boolean
  opacity: number
  blend: BlendMode
  zIndex: number
  space: 'world' | 'screen'
}

 interface ILayer {
  name: string
  readonly id: LayerId
  readonly type: string
  space: 'world' | 'screen'
  visible: boolean
  opacity: number
  blend: BlendMode
  zIndex: number

  /** draw: ctx 已经在正确坐标系（world: 由 ZoomPan2D 设置; screen: 已 reset 到单位矩阵） */
  render (view: ZoomPan2D): void

  /** 可选的命中测试（世界或屏幕坐标，取决于 space） */
  hitTest? (x: number, y: number, view: ZoomPan2D): boolean

  /** 返回可序列化信息（不含大对象） */
  getInfo (): LayerInfo

  /** 资源释放（如 revokeObjectURL） */
  destroy? (): void
}

/* ---------------------------------------
 * Base layer
 * ------------------------------------- */
let __LAYER_SEQ = 0

abstract class LayerBase implements ILayer {
  id: LayerId
  type: string
  name: string
  space: 'world' | 'screen' = 'world'
  visible = true
  opacity = 1
  blend: BlendMode = 'source-over'
  zIndex = 0

  getInfo (): LayerInfo {
    return {
      id: this.id,
      type: this.type,
      visible: this.visible,
      opacity: this.opacity,
      blend: this.blend,
      zIndex: this.zIndex,
      space: this.space
    }
  }

  abstract render (view: ZoomPan2D): void

  abstract destroy (): void

  constructor (name: string, type: string, space: 'world' | 'screen' = 'world') {
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
  space?: 'world' | 'screen'
  x?: number
  y?: number
  scale?: number
  rotation?: number
  anchor?: 'topLeft' | 'center'

  /** 当需要重绘离屏时调用，传入离屏 ctx（单位矩阵，屏幕像素） */
  redraw?: (context: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => void
}

/**
 * CanvasLayer is used to create a layer with an offscreen canvas in either world or screen space.
 * You can draw anything you want on the offscreen canvas, and it will be rendered as a layer.
 */
class CanvasLayer extends LayerBase {
  private _redraw?: (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => void

  canvas: HTMLCanvasElement
  context: CanvasRenderingContext2D
  x = 0
  y = 0
  scale = 1
  rotation = 0
  anchor: 'topLeft' | 'center' = 'topLeft'

  /** 触发重绘离屏内容 */
  requestRedraw () {
    this._redraw?.(this.context, this.canvas)
  }

  /** 通用命中：把世界/屏幕点逆变换到本地，再做 AABB 命中 */
  hitTest (x: number, y: number): boolean {
    const dx = x - this.x
    const dy = y - this.y
    const cos = Math.cos(-this.rotation)
    const sin = Math.sin(-this.rotation)
    const rx = dx * cos - dy * sin
    const ry = dx * sin + dy * cos

    const w = this.canvas.width * this.scale
    const h = this.canvas.height * this.scale

    const lx = this.anchor === 'center' ? -w / 2 : 0
    const ly = this.anchor === 'center' ? -h / 2 : 0

    return rx >= lx && rx <= lx + w && ry >= ly && ry <= ly + h
  }

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
    super(options.name || '', 'canvas', options.space ?? 'world')
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
      anchor?: 'topLeft' | 'center'
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
    space?: 'world' | 'screen'
    x?: number
    y?: number
    scale?: number; rotation?: number
    anchor?: 'topLeft' | 'center'
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
  anchor?: 'topLeft' | 'center'
  space?: 'world' | 'screen'
  crossOrigin?: '' | 'anonymous' | 'use-credentials'
}

/* ---------------------------------------
 * Layer Manager
 * ------------------------------------- */
class LayerManager {
  private _worldLayers: ILayer[] = []
  private _screenLayers: ILayer[] = []

  private _sortStack (stack: ILayer[]) {
    stack.sort((a, b) => a.zIndex - b.zIndex)
  }

  addLayer (layer: ILayer): LayerId {
    const stack = layer.space === 'world'
      ? this._worldLayers
      : this._screenLayers

    stack.push(layer)
    this._sortStack(stack)
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

  removeLayer (id: LayerId) {
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

  getLayer (id: LayerId): ILayer | undefined {
    return this._worldLayers.find(l => l.id === id) || this._screenLayers.find(l => l.id === id)
  }

  getAllLayers (space?: 'world' | 'screen'): ILayer[] {
    if (!space) {
      return [...this._worldLayers, ...this._screenLayers].sort((a, b) => a.zIndex - b.zIndex)
    }
    return (
      space === 'world' ? this._worldLayers : this._screenLayers
    ).slice().sort((a, b) => a.zIndex - b.zIndex)
  }

  setLayerZIndex (id: LayerId, z: number) {
    const l = this.getLayer(id); if (!l) return
    l.zIndex = z
    const stack = l.space === 'world' ? this._worldLayers : this._screenLayers
    this._sortStack(stack)
  }

  bringLayerToFront (id: LayerId) {
    const l = this.getLayer(id); if (!l) return
    l.zIndex = Math.max(...this.getAllLayers(l.space).map(x => x.zIndex), 0) + 1
    this._sortStack(l.space === 'world' ? this._worldLayers : this._screenLayers)
  }

  sendLayerToBack (id: LayerId) {
    const l = this.getLayer(id); if (!l) return
    l.zIndex = Math.min(...this.getAllLayers(l.space).map(x => x.zIndex), 0) - 1
    this._sortStack(l.space === 'world' ? this._worldLayers : this._screenLayers)
  }

  /**
   * 渲染所有图层（先 world 再 screen）
   * ctx 已由 ZoomPan2D 清空并设置为世界矩阵
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

  /** 命中测试（可选）：space 指定测试坐标是 world 还是 screen */
  hitTest (x: number, y: number, space: 'world'|'screen' = 'world'): ILayer | undefined {
    const stack = this.getAllLayers(space)
    for (let i = stack.length - 1; i >= 0; i--) { // top-first
      const l = stack[i]
      if (l.hitTest && l.hitTest(x, y, null as unknown as ZoomPan2D)) return l
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
  ILayer,
  LayerInfo,
  LayerId,
  BlendMode,
  ICreateImageLayerOption,
  ICreateCanvasLayerOption
}
