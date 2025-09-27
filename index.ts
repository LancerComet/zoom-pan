import { ZoomPan2D, BrushPreviewLayer, LayerManager } from './lib'

const canvas = document.querySelector('canvas')!
const layers = new LayerManager()

const documentWidth = 500
const documentHeight = 500

const view = new ZoomPan2D(canvas, (ctx, zoomPan) => {
  layers.renderWith(zoomPan, ctx) // 这里 ZoomPan2D 已经 setTransform 为世界坐标
}, {
  background: null,
  drawDocBorder: true
})

view.setDocumentRect(0, 0, documentWidth, documentHeight)
view.setScreenMargins({
  left: 50,
  right: 50,
  top: 50,
  bottom: 50
})

view.zoomToFit('contain') // 让整张文档自适应显示（contain）

// 文档区域背景图层.
await layers.createCanvasLayer({
  width: 1000,
  height: 2000,
  space: 'world',
  x: 0,
  y: 0,
  anchor: 'topLeft',
  redraw (ctx, off) {
    // 画一个淡黄色背景
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, off.width, off.height)
  }
})

// 1) 加一张图片图层
await layers.createImageLayer({
  src: '/image.png',
  x: 50,
  y: 50,
  scale: 1,
  anchor: 'topLeft'
})

// 2) 加一个屏幕坐标的“自定义指针/叠加 UI”图层（Offscreen Canvas）
const cursorLayer = layers.createCanvasLayer({
  width: 32,
  height: 32,
  space: 'screen',
  x: 0,
  y: 0,
  anchor: 'center',
  redraw (ctx, off) {
    // 画一个十字+方框。注意：这是屏幕像素坐标，和世界无关。
    ctx.clearRect(0, 0, off.width, off.height)
    ctx.strokeStyle = '#00d8ff'
    ctx.lineWidth = 2
    ctx.strokeRect(8, 8, off.width - 16, off.height - 16)
    ctx.beginPath()
    ctx.moveTo(off.width / 2, 6); ctx.lineTo(off.width / 2, off.height - 6)
    ctx.moveTo(6, off.height / 2); ctx.lineTo(off.width - 6, off.height / 2)
    ctx.stroke()
  }
})

// 世界层：笔刷覆盖预览（真正的“落笔”半径）
const brushLayer = new BrushPreviewLayer()
brushLayer.radiusWorld = 12 // 世界半径（比如 12 个世界单位）
layers.add(brushLayer)

canvas.addEventListener('pointermove', event => {
  const rect = canvas.getBoundingClientRect()
  const cx = event.clientX - rect.left
  const cy = event.clientY - rect.top

  cursorLayer.x = cx
  cursorLayer.y = cy
  cursorLayer.requestRedraw()

  // 只需要给 brushLayer 填“屏幕坐标”，它会在 render 里自己转世界坐标
  brushLayer.screenX = cx
  brushLayer.screenY = cy
})

// 可选：绑定 Ctrl/⌘ + 0 平滑复位
window.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && (event.key === '0' || event.code === 'Digit0')) {
    event.preventDefault()
    view.resetSmooth()
  }
})
