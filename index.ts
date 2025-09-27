/*
 * In this exmaple, we gonna show how to create a simple painter.
 */

import { ZoomPan2D, BrushCursor, LayerManager } from './lib'

// We assume the painting document is 2480x3507 (A4 paper).
const DOCUMENT_WIDTH = 2480
const DOCUMENT_HEIGHT = 3507

const canvas = document.querySelector('canvas')!
const layerManager = new LayerManager()

// View initialization.
// =================
const view = new ZoomPan2D(
  canvas,
  view => {
    layerManager.renderAllLayersIn(view)
  },
  {
    minZoom: 0.2,
    background: null,
    drawDocBorder: true
  }
)

// Set initial document size and screen margins.
view.setDocumentRect(0, 0, DOCUMENT_WIDTH, DOCUMENT_HEIGHT)
view.setScreenMargins({
  left: 50,
  right: 50,
  top: 50,
  bottom: 50
})

// Fit the whole document to view.
view.zoomToFit('contain')

// Create layers.
// =================
// The layer that is used as the background of the document.
await layerManager.createCanvasLayer({
  name: 'Background',
  width: DOCUMENT_WIDTH,
  height: DOCUMENT_HEIGHT,
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

// Insert an image layer.
await layerManager.createImageLayer({
  src: '/image.png',
  x: 50,
  y: 50,
  scale: 1,
  anchor: 'topLeft'
})

// A cursor layer that always follows the mouse position.
// It is drawn in screen space, so it size is fixed and not affected by zoom.
const cursorLayer = layerManager.createCanvasLayer({
  width: 32,
  height: 32,
  space: 'screen',
  x: 0,
  y: 0,
  anchor: 'center',
  redraw (context, canvas) {
    context.clearRect(0, 0, canvas.width, canvas.height)

    // Let's make a crosshair cursor.
    context.strokeStyle = '#00d8ff'
    context.lineWidth = 2
    context.beginPath()
    context.moveTo(0, 16)
    context.lineTo(32, 16)
    context.moveTo(16, 0)
    context.lineTo(16, 32)
    context.stroke()
  }
})

// A brush cursor layer that shows the brush size in world space.
// It is drawn in world space, so its size is affected by zoom.
const brushCursor = new BrushCursor()
brushCursor.radiusWorld = 12 // Brush radius in world unit.
layerManager.addLayer(brushCursor)

canvas.addEventListener('pointermove', event => {
  const rect = canvas.getBoundingClientRect()
  const cx = event.clientX - rect.left
  const cy = event.clientY - rect.top

  cursorLayer.x = cx
  cursorLayer.y = cy
  cursorLayer.requestRedraw()

  // Assign screen position to the brush cursor.
  // It will be converted to world position in the BrushCursor.render() method.
  brushCursor.screenX = cx
  brushCursor.screenY = cy
})

// Press Ctrl + 0 to reset the view.
window.addEventListener('keyup', event => {
  if ((event.ctrlKey || event.metaKey) && (event.key === '0' || event.code === 'Digit0')) {
    event.preventDefault()
    view.resetSmooth()
  }
})
