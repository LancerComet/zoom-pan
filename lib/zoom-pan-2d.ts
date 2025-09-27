// ZoomPan2D.ts
// A lightweight, smooth zoom & pan controller for HTMLCanvasElement (2D context).
// - Log-space zoom easing, continuous RAF
// - Anchor zoom (mouse position)
// - Pan drag with inertia (EMA + friction)
// - Smooth reset (zoom->1, pan->(0,0))
// - High-DPI (devicePixelRatio) support
//
// Usage:
//   const zp = new ZoomPan2D(canvas, (ctx, api) => {
//     // draw in WORLD coordinates (api already sets ctx transform)
//     ctx.fillStyle = '#08f'
//     ctx.fillRect(0, 0, 200, 120)
//   })
//   // optional: handle Ctrl+0 outside and call zp.resetSmooth()

export type RenderFn = (ctx: CanvasRenderingContext2D, api: ZoomPan2D) => void

export interface ZoomPanOptions {
  minZoom?: number // default 0.5
  maxZoom?: number // default 10
  wheelSensitivity?: number // default 0.0015  (pixel -> log step multiplier)
  approachKZoom?: number // default 0.022    (1/ms)
  approachKPan?: number // default 0.022    (1/ms) used for smooth reset pan
  friction?: number // default 0.92     (per frame)
  stopSpeed?: number // default 20/1000  (px/ms)
  emaAlpha?: number // default 0.25
  idleNoInertiaMs?: number // default 120
  autoResize?: boolean // default true (observes parent size)
  background?: string | null // clear color; default '#fff'
}

export class ZoomPan2D {
  private _canvas: HTMLCanvasElement
  private _context: CanvasRenderingContext2D
  private _render: RenderFn
  private _options: Required<ZoomPanOptions>

  private _dpr = Math.max(1, window.devicePixelRatio || 1)

  // Resize observer
  private _resizeObserver?: ResizeObserver

  private _isResetting = false

  // RAF
  private _raf = 0
  private _lastFrameTs = performance.now()

  // Zoom state (log-space)
  private _currentLogZ = Math.log(1)
  private _targetLogZ = Math.log(1)
  private LOG_MIN: number
  private LOG_MAX: number

  // Pan state (in CSS px world coords)
  private _tx = 0
  private _ty = 0

  // Wheel anchor (CSS px in canvas client coords)
  private _anchorX = 0
  private _anchorY = 0

  // Drag / inertia
  private _dragging = false
  private _vx = 0 // px/ms
  private _vy = 0
  private _lastMoveTs = 0

  // Listeners
  private onWheelBound = (e: PointerEvent) => {
    this._onWheel(e)
  }

  private onDownBound = (e: PointerEvent) => {
    this._onDown(e)
  }

  private onMoveBound = (e: PointerEvent) => {
    this._onMove(e)
  }

  private onUpBound = () => {
    this._onUp()
  }

  // ---------- Internals ----------
  private _loop () {
    const now = performance.now()
    const dt = Math.max(1, now - this._lastFrameTs)
    this._lastFrameTs = now

    const { approachKZoom, approachKPan, friction, stopSpeed, background } = this._options

    // --- A) 计算本帧缩放（log 空间指数趋近） ---
    const zPrev = Math.exp(this._currentLogZ) // 记录上一帧 z
    const az = 1 - Math.exp(-approachKZoom * dt)
    this._currentLogZ += (this._targetLogZ - this._currentLogZ) * az
    const zNow = Math.exp(this._currentLogZ)

    // --- B) 若 z 发生变化，对锚点做增量补偿（平滑进行） ---
    if (zNow !== zPrev) {
      const ax = this._anchorX
      const ay = this._anchorY
      const ratio = zNow / zPrev
      this._tx = ax - (ax - this._tx) * ratio
      this._ty = ay - (ay - this._ty) * ratio
    }

    // --- C) 平移：拖拽中已直接更新；不拖拽时应用惯性 + 可选回零（你原有逻辑） ---
    if (!this._dragging) {
      const dx = this._vx * dt
      const dy = this._vy * dt
      this._tx += dx
      this._ty += dy
      this._vx *= friction
      this._vy *= friction
      if (Math.hypot(this._vx, this._vy) < stopSpeed) {
        this._vx = 0; this._vy = 0
      }
    }

    // --- D) 一帧只写一次矩阵并渲染 ---
    this._context.setTransform(1, 0, 0, 1, 0, 0)
    if (background) {
      this._context.fillStyle = background
      this._context.fillRect(0, 0, this._canvas.width, this._canvas.height)
    } else {
      this._context.clearRect(0, 0, this._canvas.width, this._canvas.height)
    }
    this._context.setTransform(this._dpr * zNow, 0, 0, this._dpr * zNow, this._dpr * this._tx, this._dpr * this._ty)
    this._render(this._context, this)

    this._raf = requestAnimationFrame(() => this._loop())
  }

  private _getLineHeightPx () {
    const lh = getComputedStyle(this._canvas).lineHeight
    if (!lh || lh === 'normal') return 16 // 兜底
    const n = parseFloat(lh)
    return Number.isFinite(n) ? n : 16
  }

  private _normalizeWheelDelta (e: WheelEvent) {
    const canvas = this._canvas
    let dy = e.deltaY

    // normalize delta
    // WheelEvent.deltaMode 有三种：
    // 0：像素（Chrome/大多数设备常见）
    // 1：行（Firefox、某些鼠标驱动）
    // 2：页（很少见）
    // 代码把行/页粗略换算成像素.
    if (e.deltaMode === 1) {
      dy *= this._getLineHeightPx() // 用真实行高
    } else if (e.deltaMode === 2) {
      const h = canvas.clientHeight || window.innerHeight
      dy *= (h || 800) // 用容器高度近似一页
    }

    return dy
  }

  private _onWheel (e: WheelEvent) {
    e.preventDefault()
    e.stopPropagation()

    const dy = this._normalizeWheelDelta(e)

    const rect = this._canvas.getBoundingClientRect()
    this._anchorX = e.clientX - rect.left
    this._anchorY = e.clientY - rect.top

    let step = -dy * this._options.wheelSensitivity
    if (e.ctrlKey || e.metaKey) step *= 1.6
    else if (e.shiftKey) step *= 0.6

    this._targetLogZ = Math.min(this.LOG_MAX, Math.max(this.LOG_MIN, this._targetLogZ + step))
  }

  private _onDown (e: PointerEvent) {
    if (e.button !== 0) {
      return
    }

    this._dragging = true
    this._vx = 0; this._vy = 0
    this._lastMoveTs = performance.now()
  }

  private _onMove (e: PointerEvent) {
    if (!this._dragging) {
      return
    }

    const now = performance.now()
    const dt = Math.max(1, now - (this._lastMoveTs || now - 16))
    this._lastMoveTs = now

    const dx = e.movementX
    const dy = e.movementY

    // apply pan immediately (CSS px)
    this._tx += dx
    this._ty += dy

    // velocity EMA (px/ms)
    const a = this._options.emaAlpha
    const instVx = dx / dt
    const instVy = dy / dt
    this._vx = (1 - a) * this._vx + a * instVx
    this._vy = (1 - a) * this._vy + a * instVy
  }

  private _onUp () {
    if (!this._dragging) {
      return
    }

    this._dragging = false

    const now = performance.now()
    const idle = this._lastMoveTs ? now - this._lastMoveTs : Infinity

    if (idle >= this._options.idleNoInertiaMs) {
      // clear residual velocity to avoid a "kick"
      this._vx = 0; this._vy = 0
    } else {
      // decay once by idle time (convert friction-per-16ms to friction-per-idle)
      const per = Math.pow(this._options.friction, idle / 16)
      this._vx *= per
      this._vy *= per
    }

    if (Math.hypot(this._vx, this._vy) < this._options.stopSpeed) {
      this._vx = 0; this._vy = 0
    }
  }

  // ---------- Public API ----------

  /** Smoothly reset to zoom=1, pan=(0,0) */
  resetSmooth () {
    this._isResetting = true
    this._targetLogZ = 0
    // 可选：停止当前惯性，避免干扰
    this._vx = 0
    this._vy = 0
  }

  /** Instantly reset (no animation) */
  resetInstant () {
    this._currentLogZ = 0
    this._targetLogZ = 0
    this._tx = 0
    this._ty = 0
  }

  /** Convert screen (canvas client) -> world */
  toWorld (x: number, y: number) {
    const z = Math.exp(this._currentLogZ)
    // account for DPR: our transform multiplies by (dpr*z) and translates by (dpr*tx, dpr*ty)
    // screen client px → canvas CSS px is 1:1; we stored tx/ty in CSS px
    const wx = (x - this._tx) / z
    const wy = (y - this._ty) / z
    return { x: wx, y: wy }
  }

  /** Convert world -> screen (canvas client) */
  toScreen (wx: number, wy: number) {
    const z = Math.exp(this._currentLogZ)
    return { x: wx * z + this._tx, y: wy * z + this._ty }
  }

  /** Get current transform */
  getTransform () {
    const zoom = Math.exp(this._currentLogZ)
    return { zoom, tx: this._tx, ty: this._ty }
  }

  /** Set zoom range */
  setZoomRange (minZoom: number, maxZoom: number) {
    this._options.minZoom = minZoom
    this._options.maxZoom = maxZoom
    this.LOG_MIN = Math.log(minZoom)
    this.LOG_MAX = Math.log(maxZoom)
    this._targetLogZ = Math.min(this.LOG_MAX, Math.max(this.LOG_MIN, this._targetLogZ))
  }

  /** Set wheel sensitivity (pixel->log step multiplier) */
  setWheelSensitivity (s: number) {
    this._options.wheelSensitivity = s
  }

  /** Resize canvas to match parent size and DPR */
  resizeToParent () {
    const parent = this._canvas.parentElement || this._canvas
    const rect = parent.getBoundingClientRect()
    this._dpr = Math.max(1, window.devicePixelRatio || 1)

    const w = Math.max(1, Math.round(rect.width))
    const h = Math.max(1, Math.round(rect.height))

    this._canvas.width = Math.round(w * this._dpr)
    this._canvas.height = Math.round(h * this._dpr)
    this._canvas.style.width = `${w}px`
    this._canvas.style.height = `${h}px`
  }

  /** Destroy and cleanup */
  destroy () {
    cancelAnimationFrame(this._raf)
    this._canvas.removeEventListener('wheel', this.onWheelBound)
    this._canvas.removeEventListener('mousedown', this.onDownBound)
    window.removeEventListener('mousemove', this.onMoveBound)
    window.removeEventListener('mouseup', this.onUpBound)
    if (this._resizeObserver) {
      this._resizeObserver.disconnect()
    }
  }

  constructor (canvas: HTMLCanvasElement, render: RenderFn, options?: ZoomPanOptions) {
    this._canvas = canvas
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2D context not available')
    this._context = ctx
    this._render = render

    // defaults
    this._options = {
      minZoom: 0.5,
      maxZoom: 10,
      wheelSensitivity: 0.0015,
      approachKZoom: 0.022,
      approachKPan: 0.022,
      friction: 0.92,
      stopSpeed: 20 / 1000,
      emaAlpha: 0.25,
      idleNoInertiaMs: 120,
      autoResize: true,
      background: '#fff',
      ...options
    }

    this.LOG_MIN = Math.log(this._options.minZoom)
    this.LOG_MAX = Math.log(this._options.maxZoom)

    // events
    this._canvas.addEventListener('wheel', this.onWheelBound, { passive: false })
    this._canvas.addEventListener('pointerdown', this.onDownBound)
    window.addEventListener('pointermove', this.onMoveBound)
    window.addEventListener('pointerup', this.onUpBound)

    // resize
    if (this._options.autoResize) {
      this._resizeObserver = new ResizeObserver(() => this.resizeToParent())
      this._resizeObserver.observe(this._canvas.parentElement || this._canvas)
    }
    this.resizeToParent()

    // start loop
    this._lastFrameTs = performance.now()
    this._raf = requestAnimationFrame(() => this._loop())
  }
}
