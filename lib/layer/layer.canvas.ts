import { HistoryManager } from '../commands/history-manager'
import { StrokeCommand } from '../commands/stroke-command'
import { IStrokePoint } from '../commands/type'
import { AnchorType, SpaceType } from '../types'
import { LayerBase } from './layer.base.ts'

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

interface ILayerResizeConfig {
  width: number
  height: number
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

  // Undo/Redo system
  // =================
  private _historyManager?: HistoryManager
  private _currentStrokePoints: IStrokePoint[] = []
  private _currentStrokeColor: string = '#000000'
  private _currentStrokeSize: number = 10
  private _currentStrokeMode: 'brush' | 'eraser' = 'brush'
  private _strokeStartSnapshot: ImageData | null = null

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

    if (this._historyManager) {
      try {
        this._strokeStartSnapshot = this.context.getImageData(
          0,
          0,
          this.canvas.width,
          this.canvas.height
        )
      } catch {
        this._strokeStartSnapshot = null
      }
    } else {
      this._strokeStartSnapshot = null
    }

    // 开始新笔画，清空之前的笔画点
    this._currentStrokePoints = [{
      x: lx,
      y: ly,
      pressure: 1 // 默认压力值，可以通过参数传入
    }]
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

    if (this._currentStrokePoints.length === 1) {
      this._currentStrokePoints[0].pressure = pressure
    }

    // 记录笔画点（用于撤销重做）
    this._currentStrokePoints.push({
      x: lx,
      y: ly,
      pressure
    })

    // 更新当前笔画属性
    this._currentStrokeColor = color
    this._currentStrokeSize = size
    this._currentStrokeMode = mode

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

    this.context.lineWidth = size * pressure
    this.context.lineCap = 'round'
    this.context.lineJoin = 'round'
    this.context.stroke()
    this.context.closePath()

    this._lastX = lx
    this._lastY = ly
  }

  endStroke () {
    if (!this._drawing) {
      return
    }

    this._drawing = false

    // 如果有历史管理器且有笔画点，创建命令并添加到历史记录
    // 注意：使用 addCommand 而不是 executeCommand，因为笔画已经在实时绘制阶段应用
    if (this._historyManager && this._currentStrokePoints.length > 0) {
      const command = new StrokeCommand(this, {
        points: this._currentStrokePoints.slice(),
        color: this._currentStrokeColor,
        size: this._currentStrokeSize,
        mode: this._currentStrokeMode
      }, {
        snapshot: this._strokeStartSnapshot ?? undefined,
        alreadyApplied: true
      })

      this._historyManager.addCommand(command)
    }

    // 清空笔画点缓存
    this._currentStrokePoints = []
    this._strokeStartSnapshot = null
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
  render (ctx: CanvasRenderingContext2D) {
    if (!this.visible) {
      return
    }

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

  /**
   * 设置历史管理器，用于撤销重做功能
   */
  setHistoryManager (historyManager: HistoryManager): void {
    this._historyManager = historyManager
  }

  /**
   * 获取历史管理器
   */
  getHistoryManager (): HistoryManager | undefined {
    return this._historyManager
  }

  /**
   * 撤销操作
   */
  undo (): boolean {
    if (this._historyManager?.canUndo()) {
      this._historyManager.undo()
      return true
    }
    return false
  }

  /**
   * 重做操作
   */
  redo (): boolean {
    if (this._historyManager?.canRedo()) {
      this._historyManager.redo()
      return true
    }
    return false
  }

  /**
   * 检查是否可以撤销
   */
  canUndo (): boolean {
    return this._historyManager?.canUndo() ?? false
  }

  /**
   * 检查是否可以重做
   */
  canRedo (): boolean {
    return this._historyManager?.canRedo() ?? false
  }

  destroy (): void {
    this._currentStrokePoints = []
    this._historyManager = undefined
    this._strokeStartSnapshot = null
  }

  cropTo (config: ILayerResizeConfig): void {
    const width = Math.max(1, Math.floor(config.width))
    const height = Math.max(1, Math.floor(config.height))
    if (width === this.canvas.width && height === this.canvas.height) {
      return
    }

    const snapshot = this._cloneCanvas()
    const copyWidth = Math.min(snapshot.width, width)
    const copyHeight = Math.min(snapshot.height, height)

    this._setCanvasSize(width, height)
    if (copyWidth > 0 && copyHeight > 0) {
      this.context.drawImage(snapshot, 0, 0, copyWidth, copyHeight, 0, 0, copyWidth, copyHeight)
    }
  }

  resizeTo (config: ILayerResizeConfig): void {
    const width = Math.max(1, Math.floor(config.width))
    const height = Math.max(1, Math.floor(config.height))
    if (width === this.canvas.width && height === this.canvas.height) {
      return
    }

    const snapshot = this._cloneCanvas()

    this._setCanvasSize(width, height)
    if (snapshot.width > 0 && snapshot.height > 0) {
      this.context.drawImage(snapshot, 0, 0, snapshot.width, snapshot.height, 0, 0, width, height)
    }
  }

  private _cloneCanvas (): HTMLCanvasElement {
    const offscreen = document.createElement('canvas')
    offscreen.width = this.canvas.width
    offscreen.height = this.canvas.height
    if (offscreen.width === 0 || offscreen.height === 0) {
      return offscreen
    }

    const ctx = offscreen.getContext('2d')
    if (!ctx) {
      throw new Error('Offscreen 2D context unavailable')
    }
    ctx.drawImage(this.canvas, 0, 0)
    return offscreen
  }

  private _setCanvasSize (width: number, height: number): void {
    this.canvas.width = width
    this.canvas.height = height
    this.context.setTransform(1, 0, 0, 1, 0, 0)
    this.context.clearRect(0, 0, width, height)
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

    const context = this.canvas.getContext('2d', {
      willReadFrequently: true
    })
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

export {
  CanvasLayer
}

export type {
  ICreateCanvasLayerOption,
  ILayerResizeConfig
}
