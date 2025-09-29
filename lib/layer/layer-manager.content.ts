import { ZoomPan2D } from '../core/zoom-pan-2d.ts'
import { LayerManagerBase } from './layer-manager.base.ts'

/**
 * Content Layer Manager is used to store content bitmaps.
 */
class ContentLayerManager extends LayerManagerBase {
  /**
   * Render all layers in target view.
   */
  renderAllLayersIn (view: ZoomPan2D) {
    const context = view.contentContext
    this._renderAllLayersIn(view, context)
  }
}

export {
  ContentLayerManager
}
