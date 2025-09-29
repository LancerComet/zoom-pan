import { AnchorType, SpaceType } from '../types'
import { loadImage } from '../utils'
import { CanvasLayer } from './layer.canvas.ts'

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

export {
  BitmapLayer
}

export type {
  ICreateImageLayerOption
}
