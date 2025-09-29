/*
 * In this example, we gonna make a simple painter.
 *
 * HotKeys:
 * B: Brush
 * E: Eraser
 * H: Pan
 * Alt: Color picker
 * Hold Space to move canvas while using Brush or Eraser.
 * Just like Photoshop.
 */

import { computed, createApp, defineComponent, nextTick, onBeforeUnmount, onMounted, ref, withModifiers } from 'vue'
import { BitmapLayer, CanvasLayer, ContentLayerManager, PanClampMode, ZoomPan2D } from '../../lib'
import { TopScreenLayerManager } from '../../lib/layer/layer-manager.top-screen.ts'
import colorpickerCursorImg from './assets/cursor-color-picker.png'
import dragCursorImg from './assets/cursor-darg.png'
import transparentLayerImg from './assets/transparent-layer.png'
import style from './index.module.styl'

import { BrushCursor } from './modules/brush-cursor.ts'
import { createPatternImage, loadImage } from './utils.ts'

// Document size, just like what in Photoshop.
const DOCUMENT_WIDTH = 1200
const DOCUMENT_HEIGHT = 2000

const MIN_BRUSH_SIZE = 0
const MAX_BRUSH_SIZE = 400

type ToolType = 'pan' | 'brush' | 'eraser' | 'zoom'

const App = defineComponent({
  name: 'App',

  setup () {
    const canvasRef = ref<HTMLCanvasElement | null>(null)
    const brushColorRef = ref<string>('#000000')

    const layerListRef = ref<CanvasLayer[]>([])
    const selectedLayerIdRef = ref<string>('')
    const toolRef = ref<ToolType>('pan')
    const brushSizeRef = ref(100)
    const eraserSizeRef = ref(50)
    const panClampModeRef = ref<PanClampMode>('minVisible')

    const isInTempMoveModeRef = ref(false)
    const isInColorPickerModeRef = ref(false)

    // The layer that is currently being drawn (stroked) on.
    let currentStrokeLayer: CanvasLayer | null = null

    // The ZoomPan2D instance that manages the view (canvas).
    let view: ZoomPan2D | null = null

    // LayerManager is used to manage all layers and render them in the view.
    // - Content layer manager: Put your bitmap content to this manager.
    // - Top screen layer manager: Put your non bitmap content here, such as UI elements.
    const contentLayerManager = new ContentLayerManager()
    const topScreenLayerManager = new TopScreenLayerManager()

    // This cursor layer acts as a drag cursor in the stage.
    // When people use the pen / eraser tool while holding the space key, it appears.
    // It is drawn in screen space, so its size is fixed and not affected by zoom.
    let dragCursor: BitmapLayer | null = null

    // A brush cursor layer that shows the brush cursor in the stage.
    // It is drawn in world space, so its size is affected by zoom.
    let brushCursor: BrushCursor | null = null

    // The color picker cursor appears when user is picking a color.
    let colorPickerCursor: BitmapLayer | null = null

    let colorPreviewLayer: CanvasLayer | null = null

    const isPaintToolSelected = computed(() => {
      return toolRef.value === 'brush' || toolRef.value === 'eraser'
    })

    const currentBrushSize = computed(() => {
      if (toolRef.value === 'eraser') {
        return eraserSizeRef.value
      }
      return brushSizeRef.value
    })

    const shouldHideBrowserCursor = computed(() => {
      return isPaintToolSelected.value || isInColorPickerModeRef.value || isInTempMoveModeRef.value
    })

    const setDragCursorVisibility = (isVisible: boolean) => {
      if (dragCursor) {
        dragCursor.visible = isVisible
      }
    }

    const setBrushVisibility = (isVisible: boolean) => {
      if (brushCursor) {
        brushCursor.visible = isVisible
      }
    }

    const addToLayerList = (layer: CanvasLayer, insertAt?: number) => {
      if (insertAt !== undefined && insertAt > -1) {
        layerListRef.value.splice(insertAt, 0, layer)
      } else {
        layerListRef.value.push(layer)
      }
    }

    const createCanvasLayer = () => {
      const layer = new CanvasLayer({
        name: `Layer ${layerListRef.value.length + 1}`,
        width: DOCUMENT_WIDTH,
        height: DOCUMENT_HEIGHT
      })

      {
        const allLayer = contentLayerManager.getAllLayers()
        const insertAt = allLayer.findIndex(l => l.id === selectedLayerIdRef.value)
        contentLayerManager.addLayer(layer, insertAt + 1)
      }

      {
        const insertAt = layerListRef.value.findIndex(item => item.id === selectedLayerIdRef.value)
        addToLayerList(layer, insertAt + 1)
      }

      selectLayer(layer.id)
    }

    const removeLayer = (layerId: string) => {
      const index = layerListRef.value.findIndex(item => item.id === layerId)
      if (index > -1) {
        layerListRef.value.splice(index, 1)
      }
      contentLayerManager.removeLayer(layerId)
    }

    const selectLayer = (layerId: string) => {
      selectedLayerIdRef.value = layerId
    }

    const selectPanTool = () => {
      view?.setPanEnabled(true)
      setBrushVisibility(false)
      toolRef.value = 'pan'
    }

    const selectBrushTool = () => {
      view?.setPanEnabled(false)
      if (brushCursor) {
        brushCursor.radius = brushSizeRef.value / 2
      }
      setBrushVisibility(true)
      toolRef.value = 'brush'
    }

    const selectEraserTool = () => {
      view?.setPanEnabled(false)
      toolRef.value = 'eraser'
      if (brushCursor) {
        brushCursor.radius = eraserSizeRef.value / 2
      }
      setBrushVisibility(true)
    }

    const selectZoomTool = () => {
      toolRef.value = 'zoom'
      setBrushVisibility(false)
      view?.setPanEnabled(false)
    }

    const initView = () => {
      const canvas = canvasRef.value
      if (!canvas) {
        return
      }

      // View initialization.
      view = new ZoomPan2D(
        canvas,
        view => {
          contentLayerManager.renderAllLayersIn(view)
          topScreenLayerManager.renderAllLayersIn(view)
        },
        {
          minZoom: 0.2,
          background: null,
          drawDocBorder: true,
          panClampMode: panClampModeRef.value
        }
      )

      // Set initial document size and screen margins.
      view.setDocumentRect(0, 0, DOCUMENT_WIDTH, DOCUMENT_HEIGHT)
      view.setDocumentMargins({
        left: 50,
        right: 50,
        top: 50,
        bottom: 50
      })

      // Fit the whole document to view.
      view.zoomDocumentToFit('contain')
    }

    const initPresetLayers = async () => {
      // Create a layer that shows a checkerboard pattern to indicate transparency.
      const transparentImg = await createPatternImage(DOCUMENT_WIDTH, DOCUMENT_HEIGHT, transparentLayerImg)
      const l = contentLayerManager.createCanvasLayer({
        width: DOCUMENT_WIDTH,
        height: DOCUMENT_HEIGHT
      })
      l.drawImage(transparentImg, 0, 0)

      // The layer that is used as the background of the document.
      const backgroundLayer = contentLayerManager.createCanvasLayer({
        name: 'Background',
        width: DOCUMENT_WIDTH,
        height: DOCUMENT_HEIGHT,
        redraw (context, canvas) {
          context.fillStyle = '#ffffff'
          context.fillRect(0, 0, canvas.width, canvas.height)
        }
      })
      addToLayerList(backgroundLayer)

      // Insert an image layer.
      const lineArtImage = await loadImage('/anime.png')
      const lineArtLayer = contentLayerManager.createCanvasLayer({
        name: 'LineArt',
        width: DOCUMENT_WIDTH,
        height: DOCUMENT_HEIGHT
      })
      lineArtLayer.drawImage(
        lineArtImage,
        (DOCUMENT_WIDTH - lineArtImage.naturalWidth) / 2,
        (DOCUMENT_HEIGHT - lineArtImage.naturalHeight) / 2
      )
      addToLayerList(lineArtLayer)
      selectedLayerIdRef.value = lineArtLayer.id

      const paletteImg = await loadImage('/palette.png')
      const paletteLayer = contentLayerManager.createCanvasLayer({
        name: 'Palette',
        width: DOCUMENT_WIDTH,
        height: DOCUMENT_HEIGHT
      })
      paletteLayer.drawImage(paletteImg, 50, 50)
      addToLayerList(paletteLayer)

      // The drag cursor is drawn in screen space, so it size is fixed and not affected by zoom.
      dragCursor = await topScreenLayerManager.createImageLayer({
        width: 32,
        height: 32,
        src: dragCursorImg,
        space: 'screen',
        anchor: 'center'
      })
      dragCursor.visible = false

      // Create a brush cursor layer.
      // The brush cursor is drawn in world space, so its size is affected by zoom.
      brushCursor = new BrushCursor()
      brushCursor.radius = brushSizeRef.value / 2
      setBrushVisibility(false)
      topScreenLayerManager.addLayer(brushCursor)

      // Create a color picker cursor layer.
      colorPickerCursor = await BitmapLayer.fromImage({
        width: 64,
        height: 64,
        src: colorpickerCursorImg,
        space: 'screen',
        anchor: 'center'
      })
      colorPickerCursor.visible = false
      topScreenLayerManager.addLayer(colorPickerCursor)

      colorPreviewLayer = topScreenLayerManager.createCanvasLayer({
        width: 40,
        height: 25,
        space: 'screen',
        redraw: (context, canvas) => {
          context.fillStyle = brushColorRef.value
          context.fillRect(0, 0, canvas.width, canvas.height)

          context.strokeStyle = '#000000'
          context.strokeRect(0, 0, canvas.width, canvas.height)

          context.strokeStyle = '#ffffff'
          context.strokeRect(1, 1, canvas.width - 2, canvas.height - 2)
        }
      })
      colorPreviewLayer.visible = false
    }

    const setBrushColor = (color: string) => {
      brushColorRef.value = color
      colorPreviewLayer?.requestRedraw()
    }

    const zoomStartPoint = { x: 0, y: 0 }
    let zoomStartZoom = 0
    let isPointerDown = false

    const onPointerDown = (event: PointerEvent) => {
      if (!view) {
        return
      }

      isPointerDown = true

      const shouldHandleZoom = toolRef.value === 'zoom'
      if (shouldHandleZoom) {
        zoomStartPoint.x = event.offsetX
        zoomStartPoint.y = event.offsetY
        zoomStartZoom = view.zoom
        return
      }

      const shouldHandleDraw = !isInTempMoveModeRef.value && !isInColorPickerModeRef.value
      if (shouldHandleDraw) {
        const { wx, wy } = view!.toWorld(event.offsetX, event.offsetY)
        const currentLayer = contentLayerManager.getLayer(selectedLayerIdRef.value)
        if (
          currentLayer instanceof CanvasLayer &&
          currentLayer.visible &&
          currentLayer.hitTest(wx, wy)
        ) {
          currentStrokeLayer = currentLayer
          currentLayer.beginStroke(wx, wy)
        }
      }

      const shouldPickColor = isInColorPickerModeRef.value
      if (shouldPickColor && colorPreviewLayer) {
        const { wx, wy } = view.toWorld(event.offsetX, event.offsetY)
        setBrushColor(view.getPixelColorAtWorld(wx, wy).hex)
        colorPreviewLayer.visible = true
        colorPreviewLayer.requestRedraw()
      }
    }

    const onPointerMoveRaw = (e: PointerEvent) => {
      const isZoomTool = toolRef.value === 'zoom'
      if (isZoomTool) {
        return
      }

      const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e]
      for (const event of events) {
        const shouldHandleDraw = view && !isInTempMoveModeRef.value && !isInColorPickerModeRef.value
        if (shouldHandleDraw) {
          const { wx, wy } = view!.toWorld(event.offsetX, event.offsetY)
          const isBrush = toolRef.value === 'brush'
          const isEraser = toolRef.value === 'eraser'
          if (
            (isBrush || isEraser) &&
            event.buttons === 1 &&
            currentStrokeLayer &&
            currentStrokeLayer.visible &&
            currentStrokeLayer.hitTest(wx, wy)
          ) {
            const brushSize = currentBrushSize.value
            const pressure = event.pressure
            const brushColor = brushColorRef.value
            currentStrokeLayer.stroke(
              wx, wy, brushColor, brushSize, pressure,
              isEraser ? 'eraser' : 'brush'
            )
          }
        }
      }
    }

    const onPointerMove = (event: PointerEvent) => {
      const clientX = event.clientX
      const clientY = event.clientY

      const isZoomTool = toolRef.value === 'zoom'
      if (isZoomTool && isPointerDown && !isInTempMoveModeRef.value && !isInColorPickerModeRef.value) {
        const dx = event.offsetX - zoomStartPoint.x
        const targetZoom = zoomStartZoom + dx * 0.01
        view?.zoomToAtScreen(zoomStartPoint.x, zoomStartPoint.y, targetZoom)
        return
      }

      const canvas = canvasRef.value
      if (canvas) {
        const rect = canvas.getBoundingClientRect()
        const cx = clientX - rect.left
        const cy = clientY - rect.top

        if (dragCursor) {
          dragCursor.x = cx
          dragCursor.y = cy
        }

        if (colorPreviewLayer) {
          colorPreviewLayer.x = cx + 30
          colorPreviewLayer.y = cy - 40
        }

        // Assign screen position to the brush cursor.
        // It will be converted to world position in the BrushCursor.render() method.
        if (brushCursor) {
          brushCursor.screenX = cx
          brushCursor.screenY = cy
        }

        if (colorPickerCursor) {
          colorPickerCursor.x = cx
          colorPickerCursor.y = cy
        }
      }

      const isMouseDown = (event.buttons ?? 0) > 0
      const shouldPickColor = isInColorPickerModeRef.value && isMouseDown
      if (view && shouldPickColor) {
        const { wx, wy } = view.toWorld(event.offsetX, event.offsetY)
        setBrushColor(view.getPixelColorAtWorld(wx, wy).hex)
      }
    }

    const onPointerUp = (event: PointerEvent) => {
      isPointerDown = false

      if (view) {
        const { wx, wy } = view.toWorld(event.offsetX, event.offsetY)

        const shouldHandleDraw = toolRef.value === 'brush' &&
          !isInColorPickerModeRef.value &&
          currentStrokeLayer &&
          currentStrokeLayer.hitTest(wx, wy)

        if (shouldHandleDraw) {
          currentStrokeLayer!.endStroke()
          return
        }

        const shouldPickColor = isInColorPickerModeRef.value
        if (shouldPickColor) {
          setBrushColor(view.getPixelColorAtWorld(wx, wy).hex)
        }
      }

      if (colorPreviewLayer) {
        colorPreviewLayer.visible = false
      }
    }

    /**
     * When the user presses Space key while using the pen or eraser tool,
     * we temporarily enter the move tool mode.
     * When the Space key is released, we go back to the previous tool.
     * It behaves the same way as Photoshop.
     */
    const enterTempMoveMode = () => {
      if (dragCursor) {
        dragCursor.visible = true
      }
      setBrushVisibility(false)
      view?.setPanEnabled(true)
      isInTempMoveModeRef.value = true
    }

    const leaveTempMoveMode = () => {
      if (dragCursor) {
        dragCursor.visible = false
      }

      if (isPaintToolSelected.value) {
        setBrushVisibility(true)
        view?.setPanEnabled(false)
      }

      if (toolRef.value === 'zoom') {
        view?.setPanEnabled(false)
      }

      isInTempMoveModeRef.value = false
    }

    const enterColorPickerMode = () => {
      if (colorPickerCursor) {
        colorPickerCursor.visible = true
      }
      setBrushVisibility(false)
      view?.setPanEnabled(false)
      isInColorPickerModeRef.value = true
    }

    const leaveColorPickerMode = () => {
      if (colorPickerCursor) {
        colorPickerCursor.visible = false
      }
      if (colorPreviewLayer) {
        colorPreviewLayer.visible = false
      }
      if (isPaintToolSelected.value) {
        setBrushVisibility(true)
      }
      isInColorPickerModeRef.value = false
    }

    const setBrushSize = (size: number) => {
      size = Math.max(MIN_BRUSH_SIZE, Math.min(MAX_BRUSH_SIZE, size))

      if (toolRef.value === 'eraser') {
        eraserSizeRef.value = size
      } else {
        brushSizeRef.value = size
      }
      if (brushCursor) {
        brushCursor.radius = size / 2
      }
    }

    const onKeyDown = (event: KeyboardEvent) => {
      // Hold space to move the canvas while using the pen or eraser tool.
      const isSpace = event.code === 'Space' || event.key === ' '
      if (isSpace) {
        enterTempMoveMode()
        return
      }

      switch (event.key.toLowerCase()) {
        case 'a': {
          const brushSize = currentBrushSize.value + 10
          setBrushSize(brushSize)
          return
        }

        case 's': {
          const brushSize = currentBrushSize.value - 10
          setBrushSize(brushSize)
          return
        }
      }

      const isAltHold = event.altKey || event.metaKey
      if (isAltHold) {
        event.preventDefault()
        enterColorPickerMode()
      }
    }

    const onKeyUp = (event: KeyboardEvent) => {
      const isCtrlPressed = event.ctrlKey || event.metaKey
      if (isCtrlPressed) {
        // Press Ctrl + 0 to reset the view.
        const is0 = event.key === '0' || event.code === 'Digit0'
        if (is0) {
          event.preventDefault()
          view?.zoomDocumentToFit('contain')
          return
        }
      }

      // Release Space key to leave the temporary move tool mode.
      const isSpace = event.code === 'Space' || event.key === ' '
      if (isSpace) {
        leaveTempMoveMode()
        return
      }

      switch (event.key.toLowerCase()) {
        case 'b':
          selectBrushTool()
          return
        case 'h':
          selectPanTool()
          return
        case 'e':
          selectEraserTool()
          return
        case 'd':
          brushColorRef.value = '#000000'
          return
        case 'z':
          selectZoomTool()
          return
      }

      event.preventDefault()
      leaveColorPickerMode()
    }

    const onWindowBlur = () => {
      leaveColorPickerMode()
      if (isPaintToolSelected.value) {
        leaveTempMoveMode()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onWindowBlur)

    onMounted(async () => {
      initView()
      await initPresetLayers()
    })

    onBeforeUnmount(() => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onWindowBlur)
      layerListRef.value = []
      contentLayerManager.destroy()
      view?.destroy()
      view = null
    })

    // This is a hacky way to append the canvas of each layer into the layer list item.
    const createSrc = (id: string, canvas: HTMLCanvasElement) => {
      nextTick(() => {
        const div = document.getElementById(`preview_${id}`)
        if (div) {
          div.appendChild(canvas)
        }
      })
    }

    const LayerList = () => (
      <div class={style.layerList}>{
        layerListRef.value.slice().reverse().map(item => (
          <div
            key={item.id}
            class={[
              style.layerListItem,
              item.id === selectedLayerIdRef.value ? style.selected : ''
            ]}
            onClick={() => selectLayer(item.id)}
          >
            <div>
              <input
                v-model={item.visible}
                class={style.visibilityCheckbox}
                type='checkbox'
                onClick={withModifiers(() => {}, ['stop'])}
              />
            </div>

            <div
              id={'preview_' + item.id}
              class={style.previewImg}
            >{ createSrc(item.id, item.canvas) }</div>

            <div class={style.layerInfo}>
              <span>{ item.name }</span>
            </div>
          </div>
        ))
      }</div>
    )

    const ColorPicker = () => (
      <input type='color' v-model={brushColorRef.value} />
    )

    const ToolButtons = () => (
      <div>
        <button
          class={[
            style.toolbarButton,
            toolRef.value === 'pan' ? style.selected : ''
          ]}
          onClick={selectPanTool}
        >Pan (H)</button>
        <button
          class={[
            style.toolbarButton,
            toolRef.value === 'brush' ? style.selected : ''
          ]}
          onClick={selectBrushTool}
        >Brush (B)</button>
        <button
          class={[
            style.toolbarButton,
            toolRef.value === 'eraser' ? style.selected : ''
          ]}
          onClick={selectEraserTool}
        >Eraser (E)</button>
        <button
          class={[
            style.toolbarButton,
            toolRef.value === 'zoom' ? style.selected : ''
          ]}
          onClick={selectZoomTool}
        >Zoom (Z)</button>
      </div>
    )

    const BrushSizeSlider = () => (
      <div
        class={[
          style.brushSizeSlider,
          !isPaintToolSelected.value ? style.hide : ''
        ]}
      >
        <span>Brush size:</span>
        <input
          style='margin-left: 10px'
          value={currentBrushSize.value}
          onInput={e => {
            const rawValue = (e.target as HTMLInputElement).value
            const brushSize = parseInt(rawValue, 10)
            setBrushSize(brushSize)
          }}
          type='range' min={MIN_BRUSH_SIZE} max={MAX_BRUSH_SIZE}
        />
        <span>{currentBrushSize.value}</span>
      </div>
    )

    const CanvasContainer = () => (
      <div
        class={[
          style.canvasContainer,
          shouldHideBrowserCursor.value ? style.hideCursor : ''
        ]}
      >
        <canvas
          ref={canvasRef}
          onPointerdown={onPointerDown}
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-expect-error
          onPointerrawupdate={onPointerMoveRaw}
          onPointermove={onPointerMove}
          onPointerup={onPointerUp}
        />
      </div>
    )

    const PanModeSelector = () => (
      <label class={style.panModeSelector}>
        <span>Pan Mode:</span>
        <select
          value={panClampModeRef.value}
          onInput={event => {
            const value = (event.target as HTMLSelectElement).value as PanClampMode
            console.log(value)
            view?.setPanClampMode(value)
            panClampModeRef.value = value
          }}
        >
          <option value='margin'>Margin</option>
          <option value='minVisible'>MinVisible</option>
        </select>
      </label>
    )

    const Toolbar = () => (
      <div class={style.toolbar}>
        <PanModeSelector />
        <ColorPicker />
        <ToolButtons />
        <BrushSizeSlider />
      </div>
    )

    return () => (
      <div class={style.app}>
        <div class={style.mainStage}>
          <CanvasContainer />
          <Toolbar />
        </div>

        <div class={style.sideBar}>
          <div class={style.sideBarHeader}>
            <span>Layers</span>
            <div>
              <button onClick={createCanvasLayer}>Create Layer</button>
            </div>
          </div>
          <LayerList />
        </div>
      </div>
    )
  }
})

createApp(App).mount('#app')
