import { ZoomPan2D } from '../core/zoom-pan-2d.ts'
import { LayerManagerBase } from './layer-manager.base.ts'

/**
 * Top Screen Layer Manager is used to store top screen overlays.
 * If you have something like UI elements, just put it here.
 */
class TopScreenLayerManager extends LayerManagerBase {
  /**
   * Render all layers in target view.
   */
  renderAllLayersIn (view: ZoomPan2D) {
    const context = view.topScreenContext
    this._renderAllLayersIn(view, context)
  }
}

export {
  TopScreenLayerManager
}
