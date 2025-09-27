// LayerKit.ts
// Layer system for ZoomPan2D: world-space layers + screen-space overlay layers.
// Features: image layers, offscreen-canvas layers, z-order, visibility, opacity, blend, hitTest.

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

  constructor (type: string, space: 'world' | 'screen' = 'world') {
    this.id = `layer_${type}_${++__LAYER_SEQ}`
    this.type = type
    this.space = space
  }
}

/* ---------------------------------------
 * Image layer
 * ------------------------------------- */
 interface IImageLayer {
  src: string | File | Blob
  x?: number
  y?: number
  scale?: number
  rotation?: number // radians
  anchor?: 'topLeft' | 'center'
  crossOrigin?: '' | 'anonymous' | 'use-credentials'
}

/**
 * Image is used to load and display an image in world space.
 */
class ImageLayer extends LayerBase {
  static async create (options: IImageLayer): Promise<ImageLayer> {
    const layer = new ImageLayer(options)
    const img = new Image()
    if (typeof options.src === 'string') {
      if (options.crossOrigin !== undefined) {
        img.crossOrigin = options.crossOrigin
      }
      img.src = options.src
    } else {
      const url = URL.createObjectURL(options.src)
      img.src = url
      layer.#urlToRevoke = url
    }

    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('Image load failed'))
    })

    layer.el = img
    layer.natW = img.naturalWidth
    layer.natH = img.naturalHeight

    return layer
  }

  el!: HTMLImageElement
  x = 0
  y = 0
  scale = 1
  rotation = 0
  anchor: 'topLeft' | 'center' = 'center'
  natW = 0
  natH = 0
  #urlToRevoke: string | null = null

  render (view: ZoomPan2D): void {
    if (!this.visible || !this.el) {
      return
    }

    const context = view.context
    context.save()
    context.globalAlpha = this.opacity
    context.globalCompositeOperation = this.blend
    context.translate(this.x, this.y)
    context.rotate(this.rotation)
    const w = this.natW * this.scale
    const h = this.natH * this.scale
    if (this.anchor === 'center') {
      context.drawImage(this.el, -w / 2, -h / 2, w, h)
    } else {
      context.drawImage(this.el, 0, 0, w, h)
    }
    context.restore()
  }

  hitTest (x: number, y: number): boolean {
    // world-space point (x,y)
    // inverse transform of rotation/translation/scale, then bbox hit test
    const dx = x - this.x
    const dy = y - this.y
    const cos = Math.cos(-this.rotation)
    const sin = Math.sin(-this.rotation)
    const rx = dx * cos - dy * sin
    const ry = dx * sin + dy * cos
    const w = this.natW * this.scale
    const h = this.natH * this.scale
    const lx = this.anchor === 'center' ? -w / 2 : 0
    const ly = this.anchor === 'center' ? -h / 2 : 0
    return rx >= lx && rx <= lx + w && ry >= ly && ry <= ly + h
  }

  destroy () {
    if (this.#urlToRevoke) {
      URL.revokeObjectURL(this.#urlToRevoke)
      this.#urlToRevoke = null
    }
  }

  constructor (init: IImageLayer) {
    super('image', 'world')
    this.x = init.x ?? 0
    this.y = init.y ?? 0
    this.scale = init.scale ?? 1
    this.rotation = init.rotation ?? 0
    if (init.anchor) {
      this.anchor = init.anchor
    }
    // lazy init in async loader
  }
}

/* ---------------------------------------
 * Canvas layer (offscreen)
 * ------------------------------------- */
 interface ICanvasLayer {
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
  canvas: HTMLCanvasElement
  context: CanvasRenderingContext2D
  x: number = 0
  y: number = 0
  scale: number = 1
  rotation: number = 0
  anchor: 'topLeft' | 'center' = 'topLeft'

  private _redraw?: (context: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => void

  requestRedraw () {
    if (this._redraw) {
      this._redraw(this.context, this.canvas)
    }
  }

  render (vie: ZoomPan2D) {
    if (!this.visible) {
      return
    }

    const context = vie.context
    context.save()
    context.globalAlpha = this.opacity
    context.globalCompositeOperation = this.blend
    context.translate(this.x, this.y)
    context.rotate(this.rotation)
    const w = this.canvas.width * this.scale
    const h = this.canvas.height * this.scale
    const dx = this.anchor === 'center' ? -w / 2 : 0
    const dy = this.anchor === 'center' ? -h / 2 : 0
    context.drawImage(this.canvas, dx, dy, w, h)
    context.restore()
  }

  getInfo (): LayerInfo {
    const base = super.getInfo()
    return { ...base }
  }

  constructor (options: ICanvasLayer) {
    super('canvas', options.space ?? 'world')
    this.canvas = document.createElement('canvas')
    this.canvas.width = options.width
    this.canvas.height = options.height

    const context = this.canvas.getContext('2d')
    if (!context) {
      throw new Error('Offscreen 2D context unavailable')
    }

    this.context = context
    this.x = options.x ?? 0
    this.y = options.y ?? 0
    this.scale = options.scale ?? 1
    this.rotation = options.rotation ?? 0
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

  async createImageLayer (init: IImageLayer): Promise<ImageLayer> {
    const layer = await ImageLayer.create(init)
    this.addLayer(layer)
    return layer
  }

  createCanvasLayer (init: ICanvasLayer): CanvasLayer {
    const layer = new CanvasLayer(init)
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
    if (!space) return [...this._worldLayers, ...this._screenLayers].sort((a, b) => a.zIndex - b.zIndex)
    return (space === 'world' ? this._worldLayers : this._screenLayers).slice().sort((a, b) => a.zIndex - b.zIndex)
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
  ImageLayer,
  CanvasLayer,
  LayerManager
}

export type {
  ILayer,
  LayerInfo,
  LayerId,
  BlendMode,
  IImageLayer,
  ICanvasLayer
}
