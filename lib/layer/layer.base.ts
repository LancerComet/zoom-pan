import type { ViewManager } from '../core/view-manager.ts'
import { BlendMode, SpaceType } from '../types'

let __LAYER_SEQ = 0

abstract class LayerBase {
  readonly id: string
  type: string
  name: string
  space: SpaceType = 'world'
  visible: boolean = true
  opacity: number = 1
  blend: BlendMode = 'source-over'

  abstract render (context: CanvasRenderingContext2D, view: ViewManager): void
  abstract destroy (): void
  abstract hitTest (x: number, y: number, view?: ViewManager): boolean

  protected constructor (name: string, type: string, space: SpaceType = 'world') {
    this.name = name
    this.id = `layer_${type}_${++__LAYER_SEQ}`
    this.type = type
    this.space = space
  }
}

export {
  LayerBase
}
