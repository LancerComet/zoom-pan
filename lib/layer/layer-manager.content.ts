import { ViewManager } from '../core/view-manager.ts'
import { LayerManagerBase } from './layer-manager.base.ts'

/**
 * Content Layer Manager is used to store content bitmaps.
 */
class ContentLayerManager extends LayerManagerBase {
  /**
   * Render all layers in target view.
   */
  renderAllLayersIn (view: ViewManager) {
    const context = view.contentContext
    this._renderAllLayersIn(view, context)
  }
}

export {
  ContentLayerManager
}
