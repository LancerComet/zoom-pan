import { clamp } from '../utils'

type RenderFn = (view: ZoomPan2D) => void

type PanClampMode = 'margin' | 'minVisible'

interface ZoomPanOptions {
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
  drawDocBorder?: boolean // draw 1px border around document
  minVisiblePx?: number // The min visible edge of the document in px when clamping pan. Default 30.
  panClampMode?: PanClampMode // Set how to restrict the pan behavior. Only takes effect in document mode. Default 'minVisible'
}

class ZoomPan2D {
  readonly canvas: HTMLCanvasElement
  readonly context: CanvasRenderingContext2D

  readonly contentCanvas: HTMLCanvasElement
  readonly contentContext: CanvasRenderingContext2D

  readonly topScreenCanvas: HTMLCanvasElement
  readonly topScreenContext: CanvasRenderingContext2D

  private readonly _render: RenderFn
  private readonly _options: Required<ZoomPanOptions>
  private readonly _resizeObserver?: ResizeObserver

  private _isResetting = false

  private _raf = 0
  private _lastFrameTs = performance.now()

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

  private _onDownBound = (e: PointerEvent) => {
    this._onPointerDown(e)
  }

  private _onMoveBound = (e: PointerEvent) => {
    this._onPointerMove(e)
  }

  private _onUpBound = () => {
    this._onPointerUp()
  }

  // --------- Zoom ----------
  private _currentLogZ = Math.log(1)
  private _targetLogZ = Math.log(1)
  private LOG_MIN: number
  private LOG_MAX: number

  get zoom () {
    return Math.exp(this._currentLogZ)
  }

  get minZoom () {
    return this._options.minZoom
  }

  get maxZoom () {
    return this._options.maxZoom
  }

  /**
   * 将目标缩放（log 空间）钳制到范围内
   */
  private _clampLog (logZ: number) {
    return clamp(logZ, this.LOG_MIN, this.LOG_MAX)
  }

  /**
   * 设置“以屏幕点 (ax, ay) 为锚”的目标缩放（传入的是 log(zoom)），平滑过渡
   */
  private _setTargetLogZoomAtScreen (anchorX: number, anchorY: number, targetLogZ: number) {
    if (!Number.isFinite(targetLogZ)) {
      return
    }
    this._anchorX = anchorX
    this._anchorY = anchorY
    this._targetLogZ = this._clampLog(targetLogZ)
  }

  /**
   * 在屏幕点 (ax, ay) 处，缩放至绝对倍数，平滑过渡
   */
  zoomToAtScreen (anchorX: number, anchorY: number, zoom: number) {
    this._setTargetLogZoomAtScreen(anchorX, anchorY, Math.log(zoom))
  }

  /**
   * 在屏幕点 (ax, ay) 处，立即缩放到绝对倍数，无动画
   */
  zoomToAtScreenRaw (anchorX: number, anchorY: number, zoom: number) {
    // 1) 线性空间钳制 + 清洗
    if (!Number.isFinite(zoom)) {
      return
    }
    const minZ = Math.max(1e-8, this._options.minZoom) // minZoom 必须 > 0
    const maxZ = this._options.maxZoom
    const zTarget = clamp(zoom, minZ, maxZ)

    // 2) 前后缩放
    const zPrev = Math.exp(this._currentLogZ)
    const zNow = zTarget

    if (!Number.isFinite(zPrev) || zPrev <= 0) {
      return
    }

    if (Math.abs(zNow - zPrev) < 1e-12) {
      // 没变化，直接退出
      return
    }

    // 3) 立即更新 log（避免 -Infinity/NaN）
    const clampedLogZ = Math.log(zTarget)
    this._currentLogZ = clampedLogZ
    this._targetLogZ = clampedLogZ

    // 4) 锚点补偿（使用 CSS px；tx/ty 就是 CSS px，不用乘 DPR）
    const ratio = zNow / zPrev
    this._tx = anchorX - (anchorX - this._tx) * ratio
    this._ty = anchorY - (anchorY - this._ty) * ratio

    // 5) 在“文档模式”下，缩放后要立刻约束平移，避免越界后再抖
    this._clampPanForDocMode(zNow)
  }

  /**
   * 在世界坐标点 (wx, wy) 处，缩放到目标倍数.
   */
  zoomToAtWorld (wx: number, wy: number, zoom: number) {
    const { x, y } = this.toScreen(wx, wy)
    this.zoomToAtScreen(x, y, zoom)
  }

  /**
   * 在屏幕点 (ax, ay) 处，以乘法因子进行缩放（>1 放大，<1 缩小），平滑过渡
   */
  zoomByFactorAtScreen (anchorX: number, anchorY: number, factor: number) {
    if (factor <= 0 || !Number.isFinite(factor)) {
      return
    }

    const stepLog = Math.log(factor)
    this._setTargetLogZoomAtScreen(anchorX, anchorY, this._targetLogZ + stepLog)
  }

  /**
   * 在世界坐标 (wx, wy) 处，缩放（先换算到屏幕坐标再复用）.
   */
  zoomByFactorAtWorld (wx: number, wy: number, factor: number) {
    const { x, y } = this.toScreen(wx, wy)
    this.zoomByFactorAtScreen(x, y, factor)
  }

  zoomInAtCenter () {
    const rect = this.canvas.getBoundingClientRect()
    const cx = rect.width / 2
    const cy = rect.height / 2
    const zoomFactor = 1.2
    this.zoomByFactorAtScreen(cx, cy, zoomFactor)
  }

  zoomOutAtCenter () {
    const rect = this.canvas.getBoundingClientRect()
    const cx = rect.width / 2
    const cy = rect.height / 2
    const zoomFactor = 1 / 1.2
    this.zoomByFactorAtScreen(cx, cy, zoomFactor)
  }

  // ---- Interaction toggles ----
  private _panEnabled = true
  private _zoomEnabled = true
  private _panClampMode: PanClampMode = 'minVisible'

  // ---------- Document space ----------
  // 文档矩形（世界坐标），默认无边界（禁用）
  private _docEnabled = false
  private _docX = 0
  private _docY = 0
  private _docW = 0
  private _docH = 0

  // 允许的屏幕留白（CSS 像素）
  private _marginL = 0
  private _marginR = 0
  private _marginT = 0
  private _marginB = 0

  // ---------- Internals ----------
  private _activePointerId: number | null = null

  private _ensureOffscreenSizeLike (target: HTMLCanvasElement, src: HTMLCanvasElement) {
    if (target.width !== src.width || target.height !== src.height) {
      target.width = src.width
      target.height = src.height
    }
  }

  private _loop () {
    const now = performance.now()
    const dt = Math.max(1, now - this._lastFrameTs)
    this._lastFrameTs = now

    const { approachKZoom, friction, stopSpeed } = this._options

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
      if (this._panEnabled) {
        const dx = this._vx * dt
        const dy = this._vy * dt
        this._tx += dx
        this._ty += dy
        this._vx *= friction
        this._vy *= friction
        if (Math.hypot(this._vx, this._vy) < stopSpeed) {
          this._vx = 0; this._vy = 0
        }
      } else {
        // 平移被禁用，确保没有残留速度
        this._vx = 0; this._vy = 0
      }
    }

    // explicit smooth reset of pan towards (0,0) ONLY when resetting (not based on zoom≈1)
    if (this._isResetting) {
      const ap = 1 - Math.exp(-this._options.approachKPan * dt) // ← 改这个
      this._tx += (0 - this._tx) * ap
      this._ty += (0 - this._ty) * ap
      const doneZ = Math.abs(this._currentLogZ) < 1e-3 && Math.abs(this._targetLogZ) < 1e-6
      const doneP = Math.abs(this._tx) < 0.5 && Math.abs(this._ty) < 0.5
      if (doneZ && doneP) {
        this._currentLogZ = 0
        this._targetLogZ = 0
        this._tx = 0
        this._ty = 0
        this._isResetting = false
      }
    }

    // document pan clamp (after zoom/pan changes)
    this._clampPanForDocMode(zNow)

    // --- D) 一帧只写一次矩阵并渲染 ---
    const contentCanvas = this.contentCanvas
    const contentContext = this.contentContext

    const topScreenCanvas = this.topScreenCanvas
    const topScreenContext = this.topScreenContext

    const finalCanvas = this.canvas
    const finalContext = this.context

    this._ensureOffscreenSizeLike(contentCanvas, finalCanvas)
    this._ensureOffscreenSizeLike(topScreenCanvas, finalCanvas)

    contentContext.setTransform(1, 0, 0, 1, 0, 0)
    topScreenContext.setTransform(1, 0, 0, 1, 0, 0)

    // treat null / undefined / '' / 'transparent' as transparent
    const bg = this._options.background
    const isOpaqueBg = typeof bg === 'string' && bg.trim() !== '' && bg.toLowerCase() !== 'transparent'

    if (isOpaqueBg) {
      contentContext.fillStyle = bg!
      contentContext.fillRect(0, 0, contentCanvas.width, contentCanvas.height)
    } else {
      contentContext.clearRect(0, 0, contentCanvas.width, contentCanvas.height)
    }
    topScreenContext.clearRect(0, 0, topScreenCanvas.width, topScreenCanvas.height)

    contentContext.setTransform(this._dpr * zNow, 0, 0, this._dpr * zNow, this._dpr * this._tx, this._dpr * this._ty)

    if (this._docEnabled) {
      // optional background around doc could be drawn here if you like
      // world clipping to document
      contentContext.save()
      contentContext.beginPath()
      contentContext.rect(this._docX, this._docY, this._docW, this._docH)
      contentContext.clip()

      // user world rendering
      this._render(this)

      contentContext.restore()

      // 1px screen border around the document
      if (this._options.drawDocBorder) {
        const { zoom } = this.getTransform()
        contentContext.save()
        contentContext.lineWidth = 1 / zoom
        contentContext.strokeStyle = '#cfcfcf'
        contentContext.strokeRect(this._docX, this._docY, this._docW, this._docH)
        contentContext.restore()
      }
    } else {
      // no document rect: render directly
      this._render(this)
    }

    finalContext.clearRect(0, 0, finalCanvas.width, finalCanvas.height)
    finalContext.drawImage(contentCanvas, 0, 0)
    finalContext.drawImage(topScreenCanvas, 0, 0)

    this._raf = requestAnimationFrame(() => this._loop())
  }

  private _getLineHeightPx () {
    const lh = getComputedStyle(this.canvas).lineHeight
    if (!lh || lh === 'normal') return 16 // 兜底
    const n = parseFloat(lh)
    return Number.isFinite(n) ? n : 16
  }

  private _onPointerDown (e: PointerEvent) {
    if (e.button !== 0 || !this._panEnabled) {
      return
    }

    this._dragging = true
    this._vx = 0; this._vy = 0
    this._lastMoveTs = performance.now()
    this._activePointerId = e.pointerId
    try {
      this.canvas.setPointerCapture(e.pointerId)
    } catch {
    }
  }

  private _onPointerMove (e: PointerEvent) {
    if (!this._dragging || !this._panEnabled) {
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

  private _onPointerUp () {
    if (!this._dragging) {
      return
    }

    this._dragging = false

    const now = performance.now()
    const idle = this._lastMoveTs ? now - this._lastMoveTs : Infinity

    if (this._activePointerId != null) {
      try {
        this.canvas.releasePointerCapture(this._activePointerId)
      } catch {
      }
      this._activePointerId = null
    }

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

  // --------- Wheel ----------
  private _normalizeWheelDelta (e: WheelEvent) {
    const canvas = this.canvas
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
    if (!this._zoomEnabled) {
      return
    }

    e.preventDefault()
    e.stopPropagation()

    const dy = this._normalizeWheelDelta(e)

    const rect = this.canvas.getBoundingClientRect()
    const ax = e.clientX - rect.left
    const ay = e.clientY - rect.top

    // 将“像素增量 → log 空间步进”
    let stepLog = -dy * this._options.wheelSensitivity
    if (e.ctrlKey || e.metaKey) {
      stepLog *= 1.6
    } else if (e.shiftKey) {
      stepLog *= 0.6
    }

    this._setTargetLogZoomAtScreen(ax, ay, this._targetLogZ + stepLog)
  }

  private _onWheelBound = (e: WheelEvent) => {
    this._onWheel(e)
  }

  // -------- Dpr --------
  private _dpr = Math.max(1, window.devicePixelRatio || 1)

  get dpr () {
    return this._dpr
  }

  applyWorldTransform (ctx: CanvasRenderingContext2D) {
    const z = Math.exp(this._currentLogZ)
    ctx.setTransform(this._dpr * z, 0, 0, this._dpr * z, this._dpr * this._tx, this._dpr * this._ty)
  }

  applyScreenTransform (ctx: CanvasRenderingContext2D) {
    ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0) // 只有 DPR，没有 world 变换
  }

  // --------- Color ----------
  getPixelColorAtScreen (sx: number, sy: number) {
    // 映射到画布内部像素坐标（注意 DPR）
    const x = Math.floor(sx * this._dpr)
    const y = Math.floor(sy * this._dpr)

    // 边界保护
    if (x < 0 || y < 0 || x >= this.canvas.width || y >= this.canvas.height) {
      return { r: 0, g: 0, b: 0, a: 0, rgba: 'rgba(0,0,0,0)', hex: '#000000' }
    }

    // getImageData 不受当前 transform 影响，直接是像素空间
    const context = this.contentContext // Get color from content context.
    const data = context.getImageData(x, y, 1, 1).data
    const r = data[0]
    const g = data[1]
    const b = data[2]
    const a = data[3] / 255

    const to2 = (n: number) => n.toString(16).padStart(2, '0')
    const hex = `#${to2(r)}${to2(g)}${to2(b)}`

    return {
      r,
      g,
      b,
      a,
      rgba: `rgba(${r},${g},${b},${a.toFixed(3)})`,
      hex
    }
  }

  getPixelColorAtWorld (wx: number, wy: number) {
    const { x: sx, y: sy } = this.toScreen(wx, wy)
    return this.getPixelColorAtScreen(sx, sy)
  }

  // ---------- Pan & Zoom ----------
  private _clampPanForDocMode (z: number) {
    if (!this._docEnabled) {
      return
    }

    // 画布的 CSS 像素尺寸
    const W = this.canvas.width / this._dpr
    const H = this.canvas.height / this._dpr

    // 文档在“世界坐标”的边
    const docLw = this._docX
    const docTw = this._docY
    const docRw = this._docX + this._docW
    const docBw = this._docY + this._docH

    if (this._panClampMode === 'margin') {
      // 约束条件：文档的屏幕映射需落在留白内
      // 左边缘：z*docL + tx <= marginL
      // 右边缘：z*docR + tx >= W - marginR
      // 上边缘：z*docT + ty <= marginT
      // 下边缘：z*docB + ty >= H - marginB

      const txMax = this._marginL - z * docLw
      const txMin = (W - this._marginR) - z * docRw
      const tyMax = this._marginT - z * docTw
      const tyMin = (H - this._marginB) - z * docBw

      // 文档比视口小的方向要“居中”
      // 如果 z*docW <= availW，则锁定 tx 为居中值（不让它左右晃），同理 y。
      const availW = Math.max(1, W - (this._marginL + this._marginR))
      const availH = Math.max(1, H - (this._marginT + this._marginB))

      if (z * this._docW <= availW) {
        this._tx = this._marginL + (availW - z * this._docW) / 2 - z * this._docX
      } else {
        // clamp
        this._tx = Math.min(txMax, Math.max(txMin, this._tx))
      }

      if (z * this._docH <= availH) {
        this._ty = this._marginT + (availH - z * this._docH) / 2 - z * this._docY
      } else {
        this._ty = Math.min(tyMax, Math.max(tyMin, this._ty))
      }
    } else if (this._panClampMode === 'minVisible') {
      // 文档映射到屏幕后的尺寸（不含平移）
      const docScreenW = z * this._docW
      const docScreenH = z * this._docH

      // 至少保留的可见边长（防止文档太小导致约束无解）
      const minVisX = Math.min(this._options.minVisiblePx!, docScreenW)
      const minVisY = Math.min(this._options.minVisiblePx!, docScreenH)

      // 屏幕坐标下的文档边缘：sx = z*docL + tx,  ex = z*docR + tx
      // 约束：至少留 minVisX 可见
      // => 左边缘不能超过 (W - minVisX)： z*docL + tx <= W - minVisX  → tx <= (W - minVisX) - z*docL
      //    右边缘不能小于 minVisX      ： z*docR + tx >= minVisX      → tx >= minVisX - z*docR
      const txMax = (W - minVisX) - z * docLw
      const txMin = (minVisX) - z * docRw

      // 同理 Y
      const tyMax = (H - minVisY) - z * docTw
      const tyMin = (minVisY) - z * docBw

      // clamp
      // 若文档特别小，可能 txMin > txMax，此时把 tx 限到中点即可（等价于“尽力满足”）
      this._tx = (txMin <= txMax)
        ? Math.min(txMax, Math.max(txMin, this._tx))
        : (txMin + txMax) / 2

      this._ty = (tyMin <= tyMax)
        ? Math.min(tyMax, Math.max(tyMin, this._ty))
        : (tyMin + tyMax) / 2
    }
  }

  setPanClampMode (mode: PanClampMode) {
    this._panClampMode = mode
  }

  isPanEnabled () {
    return this._panEnabled
  }

  isZoomEnabled () {
    return this._zoomEnabled
  }

  setPanEnabled (enabled: boolean) {
    if (this._panEnabled === enabled) {
      return
    }

    this._panEnabled = enabled

    // 立刻终止正在进行的拖拽与惯性
    if (!enabled) {
      this._dragging = false
      this._vx = 0
      this._vy = 0
    }
  }

  setZoomEnabled (enabled: boolean) {
    this._zoomEnabled = enabled
  }

  // ---------- Public API ----------
  setDocumentRect (x: number, y: number, w: number, h: number) {
    this._docEnabled = true
    this._docX = x
    this._docY = y
    this._docW = w
    this._docH = h
  }

  clearDocumentRect () {
    this._docEnabled = false
  }

  setDocumentMargins (px: { left?: number; right?: number; top?: number; bottom?: number }) {
    this._marginL = px.left ?? this._marginL
    this._marginR = px.right ?? this._marginR
    this._marginT = px.top ?? this._marginT
    this._marginB = px.bottom ?? this._marginB
  }

  zoomDocumentToFit (mode: 'contain'|'cover'|'fitWidth'|'fitHeight' = 'contain') {
    if (!this._docEnabled) {
      return
    }

    const W = this.canvas.width / this._dpr
    const H = this.canvas.height / this._dpr
    const availW = Math.max(1, W - (this._marginL + this._marginR))
    const availH = Math.max(1, H - (this._marginT + this._marginB))

    let z: number
    const rw = availW / this._docW
    const rh = availH / this._docH
    if (mode === 'contain') {
      z = Math.min(rw, rh)
    } else if (mode === 'cover') {
      z = Math.max(rw, rh)
    } else if (mode === 'fitWidth') {
      z = rw
    } else {
      z = rh
    }

    const zMin = Math.exp(this.LOG_MIN)
    const zMax = Math.exp(this.LOG_MAX)
    z = Math.min(zMax, Math.max(zMin, z))

    // 目标缩放（log 空间）
    this._targetLogZ = Math.log(z)
    this._currentLogZ = Math.log(z) // 保持你的“立即跳到位”的语义

    // 居中放置：保证文档在留白内居中
    // s = z*w + t ；让 doc 左上角映射到 margin 内，且居中
    const sx = this._marginL + (availW - z * this._docW) / 2
    const sy = this._marginT + (availH - z * this._docH) / 2
    this._tx = sx - z * this._docX
    this._ty = sy - z * this._docY
  }

  isPointInDocument (wx: number, wy: number) {
    if (!this._docEnabled) {
      return true
    }

    return wx >= this._docX && wx <= this._docX + this._docW &&
      wy >= this._docY && wy <= this._docY + this._docH
  }

  /**
   * Smoothly reset to zoom=1, pan=(0,0).
   */
  resetSmooth () {
    this._isResetting = true
    this._targetLogZ = 0

    // 停止当前惯性，避免干扰
    this._vx = 0
    this._vy = 0
  }

  /**
   * Instantly reset (no animation)
   */
  resetInstant () {
    this._currentLogZ = 0
    this._targetLogZ = 0
    this._tx = 0
    this._ty = 0
  }

  /**
   * Convert screen (canvas client) -> world
   */
  toWorld (x: number, y: number) {
    const z = Math.exp(this._currentLogZ)
    // account for DPR: our transform multiplies by (dpr*z) and translates by (dpr*tx, dpr*ty)
    // screen client px → canvas CSS px is 1:1; we stored tx/ty in CSS px
    const wx = (x - this._tx) / z
    const wy = (y - this._ty) / z
    return {
      wx,
      wy
    }
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
    const parent = this.canvas.parentElement || this.canvas
    const rect = parent.getBoundingClientRect()
    this._dpr = Math.max(1, window.devicePixelRatio || 1)

    const w = Math.max(1, Math.round(rect.width))
    const h = Math.max(1, Math.round(rect.height))

    this.canvas.width = Math.round(w * this._dpr)
    this.canvas.height = Math.round(h * this._dpr)
    this.canvas.style.width = `${w}px`
    this.canvas.style.height = `${h}px`

    this._ensureOffscreenSizeLike(this.contentCanvas, this.canvas)
    this._ensureOffscreenSizeLike(this.topScreenCanvas, this.canvas)
  }

  /** Destroy and cleanup */
  destroy () {
    cancelAnimationFrame(this._raf)
    this.canvas.removeEventListener('wheel', this._onWheelBound)
    this.canvas.removeEventListener('pointerdown', this._onDownBound)
    window.removeEventListener('pointermove', this._onMoveBound)
    window.removeEventListener('pointerup', this._onUpBound)
    if (this._resizeObserver) {
      this._resizeObserver.disconnect()
    }
  }

  constructor (
    canvas: HTMLCanvasElement,
    render: RenderFn,
    options?: ZoomPanOptions
  ) {
    const context = canvas.getContext('2d', {
      willReadFrequently: true,
      alpha: true
    })
    if (!context) {
      throw new Error('2D context not available')
    }

    this.canvas = canvas
    this.context = context
    this._render = render

    this.contentCanvas = document.createElement('canvas')
    this.contentCanvas.width = canvas.width
    this.contentCanvas.height = canvas.height
    this.contentContext = this.contentCanvas.getContext('2d', {
      willReadFrequently: true,
      alpha: true
    })!

    this.topScreenCanvas = document.createElement('canvas')
    this.topScreenCanvas.width = canvas.width
    this.topScreenCanvas.height = canvas.height
    this.topScreenContext = this.topScreenCanvas.getContext('2d', {
      willReadFrequently: true,
      alpha: true
    })!

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
      drawDocBorder: false,
      minVisiblePx: 30,
      panClampMode: 'minVisible',
      ...options
    }

    if (this._options.minVisiblePx > canvas.width) {
      this._options.minVisiblePx = Math.max(canvas.width - 5, 0)
    }

    this.LOG_MIN = Math.log(this._options.minZoom)
    this.LOG_MAX = Math.log(this._options.maxZoom)

    // events
    this.canvas.addEventListener('wheel', this._onWheelBound, { passive: false })
    this.canvas.addEventListener('pointerdown', this._onDownBound)
    window.addEventListener('pointermove', this._onMoveBound)
    window.addEventListener('pointerup', this._onUpBound)

    // resize
    if (this._options.autoResize) {
      this._resizeObserver = new ResizeObserver(() => this.resizeToParent())
      this._resizeObserver.observe(this.canvas.parentElement || this.canvas)
    }
    this.resizeToParent()

    // start loop
    this._lastFrameTs = performance.now()
    this._raf = requestAnimationFrame(() => this._loop())
  }
}

export {
  ZoomPan2D
}

export type {
  PanClampMode,
  ZoomPanOptions
}
