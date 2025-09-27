// LayerKit.ts
// Layer system for ZoomPan2D: world-space layers + screen-space overlay layers.
// Features: image layers, offscreen-canvas layers, z-order, visibility, opacity, blend, hitTest.

import type { ZoomPan2D } from '../zoom-pan-2d'

export type LayerId = string
export type BlendMode = GlobalCompositeOperation

export interface LayerInfo {
  id: LayerId
  type: string
  visible: boolean
  opacity: number
  blend: BlendMode
  zIndex: number
  space: 'world' | 'screen'
}

export interface ILayer {
  readonly id: LayerId
  readonly type: string
  space: 'world' | 'screen'
  visible: boolean
  opacity: number
  blend: BlendMode
  zIndex: number

  /** draw: ctx 已经在正确坐标系（world: 由 ZoomPan2D 设置; screen: 已 reset 到单位矩阵） */
  render(ctx: CanvasRenderingContext2D, view: ZoomPan2D): void

  /** 可选的命中测试（世界或屏幕坐标，取决于 space） */
  hitTest?(x: number, y: number, view: ZoomPan2D): boolean

  /** 返回可序列化信息（不含大对象） */
  getInfo(): LayerInfo

  /** 资源释放（如 revokeObjectURL） */
  destroy?(): void
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

  constructor (type: string, space: 'world' | 'screen' = 'world') {
    this.id = `layer_${type}_${++__LAYER_SEQ}`
    this.type = type
    this.space = space
  }

  abstract render(ctx: CanvasRenderingContext2D, view: ZoomPan2D): void

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
}

/* ---------------------------------------
 * Image layer
 * ------------------------------------- */
 interface ImageLayerInit {
  src: string | File | Blob
  x?: number
  y?: number
  scale?: number
  rotation?: number // radians
  anchor?: 'topLeft' | 'center'
  crossOrigin?: '' | 'anonymous' | 'use-credentials'
}

class ImageLayer extends LayerBase {
  el!: HTMLImageElement
  x = 0
  y = 0
  scale = 1
  rotation = 0
  anchor: 'topLeft' | 'center' = 'center'
  natW = 0
  natH = 0
  #urlToRevoke: string | null = null

  constructor (init: ImageLayerInit) {
    super('image', 'world')
    this.x = init.x ?? 0
    this.y = init.y ?? 0
    this.scale = init.scale ?? 1
    this.rotation = init.rotation ?? 0
    if (init.anchor) this.anchor = init.anchor
    // lazy init in async loader
  }

  static async create (init: ImageLayerInit): Promise<ImageLayer> {
    const layer = new ImageLayer(init)
    const img = new Image()
    if (typeof init.src === 'string') {
      if (init.crossOrigin !== undefined) img.crossOrigin = init.crossOrigin
      img.src = init.src
    } else {
      const url = URL.createObjectURL(init.src)
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

  render (ctx: CanvasRenderingContext2D): void {
    if (!this.visible || !this.el) return
    ctx.save()
    ctx.globalAlpha = this.opacity
    ctx.globalCompositeOperation = this.blend
    ctx.translate(this.x, this.y)
    ctx.rotate(this.rotation)
    const w = this.natW * this.scale
    const h = this.natH * this.scale
    if (this.anchor === 'center') {
      ctx.drawImage(this.el, -w / 2, -h / 2, w, h)
    } else {
      ctx.drawImage(this.el, 0, 0, w, h)
    }
    ctx.restore()
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
}

/* ---------------------------------------
 * Canvas layer (offscreen)
 * ------------------------------------- */
 interface CanvasLayerInit {
  width: number
  height: number
  space?: 'world' | 'screen'
  x?: number
  y?: number
  scale?: number
  rotation?: number
  anchor?: 'topLeft' | 'center'
  /** 当需要重绘离屏时调用，传入离屏 ctx（单位矩阵，屏幕像素） */
  redraw?: (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => void
}

class CanvasLayer extends LayerBase {
  off: HTMLCanvasElement
  offCtx: CanvasRenderingContext2D
  x = 0
  y = 0
  scale = 1
  rotation = 0
  anchor: 'topLeft' | 'center' = 'topLeft'
  redraw?: (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => void

  constructor (init: CanvasLayerInit) {
    super('canvas', init.space ?? 'world')
    this.off = document.createElement('canvas')
    this.off.width = init.width
    this.off.height = init.height
    const ctx = this.off.getContext('2d')
    if (!ctx) throw new Error('Offscreen 2D context unavailable')
    this.offCtx = ctx
    this.x = init.x ?? 0
    this.y = init.y ?? 0
    this.scale = init.scale ?? 1
    this.rotation = init.rotation ?? 0
    if (init.anchor) this.anchor = init.anchor
    this.redraw = init.redraw
    if (this.redraw) this.redraw(this.offCtx, this.off)
  }

  requestRedraw () {
    if (this.redraw) this.redraw(this.offCtx, this.off)
  }

  render (ctx: CanvasRenderingContext2D): void {
    if (!this.visible) return
    ctx.save()
    ctx.globalAlpha = this.opacity
    ctx.globalCompositeOperation = this.blend
    ctx.translate(this.x, this.y)
    ctx.rotate(this.rotation)
    const w = this.off.width * this.scale
    const h = this.off.height * this.scale
    const dx = this.anchor === 'center' ? -w / 2 : 0
    const dy = this.anchor === 'center' ? -h / 2 : 0
    ctx.drawImage(this.off, dx, dy, w, h)
    ctx.restore()
  }

  getInfo (): LayerInfo {
    const base = super.getInfo()
    return { ...base }
  }
}

/* ---------------------------------------
 * Layer Manager
 * ------------------------------------- */
class LayerManager {
  private worldLayers: ILayer[] = []
  private screenLayers: ILayer[] = []

  add (layer: ILayer): LayerId {
    const stack = layer.space === 'world' ? this.worldLayers : this.screenLayers
    stack.push(layer)
    this.sortStack(stack)
    return layer.id
  }

  async createImageLayer (init: ImageLayerInit): Promise<ImageLayer> {
    const layer = await ImageLayer.create(init)
    this.add(layer)
    return layer
  }

  createCanvasLayer (init: CanvasLayerInit): CanvasLayer {
    const layer = new CanvasLayer(init)
    this.add(layer)
    return layer
  }

  remove (id: LayerId) {
    const idxW = this.worldLayers.findIndex(l => l.id === id)
    if (idxW >= 0) {
      this.worldLayers[idxW].destroy?.()
      this.worldLayers.splice(idxW, 1)
      return
    }
    const idxS = this.screenLayers.findIndex(l => l.id === id)
    if (idxS >= 0) {
      this.screenLayers[idxS].destroy?.()
      this.screenLayers.splice(idxS, 1)
    }
  }

  get (id: LayerId): ILayer | undefined {
    return this.worldLayers.find(l => l.id === id) || this.screenLayers.find(l => l.id === id)
  }

  getAll (space?: 'world' | 'screen'): ILayer[] {
    if (!space) return [...this.worldLayers, ...this.screenLayers].sort((a, b) => a.zIndex - b.zIndex)
    return (space === 'world' ? this.worldLayers : this.screenLayers).slice().sort((a, b) => a.zIndex - b.zIndex)
  }

  setZIndex (id: LayerId, z: number) {
    const l = this.get(id); if (!l) return
    l.zIndex = z
    const stack = l.space === 'world' ? this.worldLayers : this.screenLayers
    this.sortStack(stack)
  }

  bringToFront (id: LayerId) {
    const l = this.get(id); if (!l) return
    l.zIndex = Math.max(...this.getAll(l.space).map(x => x.zIndex), 0) + 1
    this.sortStack(l.space === 'world' ? this.worldLayers : this.screenLayers)
  }

  sendToBack (id: LayerId) {
    const l = this.get(id); if (!l) return
    l.zIndex = Math.min(...this.getAll(l.space).map(x => x.zIndex), 0) - 1
    this.sortStack(l.space === 'world' ? this.worldLayers : this.screenLayers)
  }

  private sortStack (stack: ILayer[]) {
    stack.sort((a, b) => a.zIndex - b.zIndex)
  }

  /** 渲染：世界层在 ZoomPan2D 的世界变换下；屏幕层在单位矩阵下 */
  renderWith (view: ZoomPan2D, ctx: CanvasRenderingContext2D) {
    // world stack（ctx 已在 ZoomPan2D 中设置为世界矩阵）
    for (const l of this.worldLayers) {
      if (!l.visible || l.opacity <= 0) continue
      l.render(ctx, view)
    }
    // screen stack（切回单位矩阵）
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    for (const l of this.screenLayers) {
      if (!l.visible || l.opacity <= 0) continue
      l.render(ctx, view)
    }
  }

  /** 命中测试（可选）：space 指定测试坐标是 world 还是 screen */
  hitTest (x: number, y: number, space: 'world'|'screen' = 'world'): ILayer | undefined {
    const stack = this.getAll(space)
    for (let i = stack.length - 1; i >= 0; i--) { // top-first
      const l = stack[i]
      if (l.hitTest && l.hitTest(x, y, null as unknown as ZoomPan2D)) return l
    }
    return undefined
  }

  destroy () {
    for (const l of [...this.worldLayers, ...this.screenLayers]) l.destroy?.()
    this.worldLayers = []
    this.screenLayers = []
  }
}

export {
  LayerBase,
  ImageLayer,
  CanvasLayer,
  LayerManager
}

export type {
  ImageLayerInit,
  CanvasLayerInit
}
