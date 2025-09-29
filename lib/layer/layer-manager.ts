import { ZoomPan2D } from '../core/zoom-pan-2d.ts'
import { SpaceType } from '../types'
import { LayerBase } from './layer.base.ts'
import { BitmapLayer, ICreateImageLayerOption } from './layer.bitmap.ts'
import { CanvasLayer, ICreateCanvasLayerOption } from './layer.canvas.ts'

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
  LayerManager
}
