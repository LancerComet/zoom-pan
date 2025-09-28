/*
 * In this example, we gonna make a simple painter.
 *
 * HotKeys:
 * B: Brush
 * E: Eraser
 * V: Move
 * Alt: Color picker
 *
 * Hold Space to move canvas while using Brush or Eraser.
 * Just like Photoshop.
 */

import { computed, createApp, defineComponent, nextTick, onBeforeUnmount, onMounted, ref, withModifiers } from 'vue'
import { ZoomPan2D, BrushCursor, LayerManager, BitmapLayer, CanvasLayer } from '../../lib'
import colorpickerCursorImg from './assets/cursor-color-picker.png'
import dragCursorImg from './assets/cursor-darg.png'
import transparentLayerImg from './assets/transparent-layer.png'
import style from './index.module.styl'
import { createPatternImage, loadImage } from './utils.ts'

// Document size, just like what in Photoshop.
const DOCUMENT_WIDTH = 1200
const DOCUMENT_HEIGHT = 2000

const MIN_BRUSH_SIZE = 0
const MAX_BRUSH_SIZE = 400

type ToolType = 'move' | 'pen' | 'eraser'

const App = defineComponent({
  name: 'App',

  setup () {
    const canvasRef = ref<HTMLCanvasElement | null>(null)
    const brushColorRef = ref<string>('#000000')

    const layerListRef = ref<CanvasLayer[]>([])
    const selectedLayerIdRef = ref<string>('')
    const toolRef = ref<ToolType>('move')
    const brushSizeRef = ref(100)
    const eraserSizeRef = ref(50)

    let isInTempMoveMode = false
    const isInColorPickerModeRef = ref(false)

    // The layer that is currently being drawn (stroked) on.
    let currentStrokeLayer: CanvasLayer | null = null

    // The ZoomPan2D instance that manages the view (canvas).
    let view: ZoomPan2D | null = null

    // LayerManager is used to manage all layers and render them in the view.
    const layerManager = new LayerManager()

    // This cursor layer acts as a drag cursor in the stage.
    // When people use the pen / eraser tool while holding the space key, it appears.
    // It is drawn in screen space, so its size is fixed and not affected by zoom.
    let dragCursor: BitmapLayer | null = null

    // A brush cursor layer that shows the brush cursor in the stage.
    // It is drawn in world space, so its size is affected by zoom.
    let brushCursor: BrushCursor | null = null

    let colorPickerCursor: BitmapLayer | null = null

    const isPaintToolSelected = computed(() => {
      return toolRef.value === 'pen' || toolRef.value === 'eraser'
    })

    const currentBrushSize = computed(() => {
      if (toolRef.value === 'eraser') {
        return eraserSizeRef.value
      }
      return brushSizeRef.value
    })

    const shouldHideBrowserCursor = computed(() => {
      return isPaintToolSelected.value || isInColorPickerModeRef.value
    })

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
        const allLayer = layerManager.getAllLayers()
        const insertAt = allLayer.findIndex(l => l.id === selectedLayerIdRef.value)
        layerManager.addLayer(layer, insertAt + 1)
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
      layerManager.removeLayer(layerId)
    }

    const selectLayer = (layerId: string) => {
      selectedLayerIdRef.value = layerId
    }

    const selectMoveTool = () => {
      view?.setPanEnabled(true)
      toolRef.value = 'move'
      if (brushCursor) {
        brushCursor.visible = false
      }
    }

    const selectPenTool = () => {
      view?.setPanEnabled(false)
      toolRef.value = 'pen'
      if (brushCursor) {
        brushCursor.radius = brushSizeRef.value / 2
        brushCursor.visible = true
      }
    }

    const selectEraserTool = () => {
      view?.setPanEnabled(false)
      toolRef.value = 'eraser'
      if (brushCursor) {
        brushCursor.radius = eraserSizeRef.value / 2
        brushCursor.visible = true
      }
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
      const l = layerManager.createCanvasLayer({
        width: DOCUMENT_WIDTH,
        height: DOCUMENT_HEIGHT
      })
      l.drawImage(transparentImg, 0, 0)

      // The layer that is used as the background of the document.
      const backgroundLayer = layerManager.createCanvasLayer({
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
      const avatarImg = await loadImage('/image.png')
      const avatarLayer = layerManager.createCanvasLayer({
        name: 'My Avatar',
        width: DOCUMENT_WIDTH,
        height: DOCUMENT_HEIGHT,
        scale: 1
      })
      addToLayerList(avatarLayer)
      avatarLayer.drawImage(avatarImg, 50, 50)
      selectedLayerIdRef.value = avatarLayer.id

      // The drag cursor is drawn in screen space, so it size is fixed and not affected by zoom.
      dragCursor = await layerManager.createImageLayer({
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
      brushCursor.visible = false
      layerManager.addLayer(brushCursor)

      // Create a color picker cursor layer.
      colorPickerCursor = await layerManager.createImageLayer({
        width: 64,
        height: 64,
        src: colorpickerCursorImg,
        space: 'screen',
        anchor: 'center'
      })
      colorPickerCursor.visible = false
      layerManager.addLayer(colorPickerCursor)
    }

    const onPointerDown = (event: PointerEvent) => {
      const shouldHandleDraw = view && !isInTempMoveMode && !isInColorPickerModeRef.value
      if (shouldHandleDraw) {
        const { wx, wy } = view!.toWorld(event.offsetX, event.offsetY)
        const currentLayer = layerManager.getLayer(selectedLayerIdRef.value)
        if (
          currentLayer instanceof CanvasLayer &&
          currentLayer.visible &&
          currentLayer.hitTest(wx, wy)
        ) {
          currentStrokeLayer = currentLayer
          currentLayer.beginStroke(wx, wy)
        }
      }
    }

    const onPointerMove = (event: PointerEvent) => {
      const canvas = canvasRef.value

      if (canvas) {
        const rect = canvas.getBoundingClientRect()
        const cx = event.clientX - rect.left
        const cy = event.clientY - rect.top

        if (dragCursor) {
          dragCursor.x = cx
          dragCursor.y = cy
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

      if (view) {
        const shouldHandleDraw = !isInTempMoveMode && !isInColorPickerModeRef.value
        if (shouldHandleDraw) {
          const { wx, wy } = view!.toWorld(event.offsetX, event.offsetY)
          const isBrush = toolRef.value === 'pen'
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
          return
        }

        const isMouseDown = (event.buttons ?? 0) > 0
        const shouldPickColor = isInColorPickerModeRef.value && isMouseDown
        if (shouldPickColor) {
          const { wx, wy } = view.toWorld(event.offsetX, event.offsetY)
          brushColorRef.value = view.getPixelColorAtWorld(wx, wy).hex
        }
      }
    }

    const onPointerUp = (event: PointerEvent) => {
      if (view) {
        const { wx, wy } = view.toWorld(event.offsetX, event.offsetY)

        const shouldHandleDraw = toolRef.value === 'pen' &&
          !isInColorPickerModeRef.value &&
          currentStrokeLayer &&
          currentStrokeLayer.hitTest(wx, wy)

        if (shouldHandleDraw) {
          currentStrokeLayer!.endStroke()
          return
        }

        const shouldPickColor = isInColorPickerModeRef.value
        if (shouldPickColor) {
          brushColorRef.value = view.getPixelColorAtWorld(wx, wy).hex
        }
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
      if (brushCursor) {
        brushCursor.visible = false
      }
      view?.setPanEnabled(true)
      isInTempMoveMode = true
    }

    const leaveTempMoveMode = () => {
      if (dragCursor) {
        dragCursor.visible = false
      }
      if (brushCursor) {
        brushCursor.visible = true
      }
      view?.setPanEnabled(false)
      isInTempMoveMode = false
    }

    const enterColorPickerMode = () => {
      if (colorPickerCursor) {
        colorPickerCursor.visible = true
      }
      if (brushCursor) {
        brushCursor.visible = false
      }
      isInColorPickerModeRef.value = true
    }

    const leaveColorPickerMode = () => {
      if (colorPickerCursor) {
        colorPickerCursor.visible = false
      }

      if (brushCursor && isPaintToolSelected.value) {
        brushCursor.visible = true
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
      const currentTool = toolRef.value
      const enterMoveMode = isSpace && (currentTool === 'pen' || currentTool === 'eraser')
      if (enterMoveMode) {
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
      // Press Ctrl + 0 to reset the view.
      const isCtrl0 = (event.ctrlKey || event.metaKey) && (event.key === '0' || event.code === 'Digit0')
      if (isCtrl0) {
        event.preventDefault()
        view?.zoomDocumentToFit('contain')
        return
      }

      // Release Space key to leave the temporary move tool mode.
      const isSpace = event.code === 'Space' || event.key === ' '
      const currentTool = toolRef.value
      const leaveMoveMode = isSpace && (currentTool === 'pen' || currentTool === 'eraser')
      if (leaveMoveMode) {
        leaveTempMoveMode()
        return
      }

      switch (event.key.toLowerCase()) {
        case 'b':
          selectPenTool()
          return
        case 'v':
          selectMoveTool()
          return
        case 'e':
          selectEraserTool()
          return
        case 'd':
          brushColorRef.value = '#000000'
          return
      }

      event.preventDefault()
      leaveColorPickerMode()
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)

    onMounted(async () => {
      initView()
      await initPresetLayers()
    })

    onBeforeUnmount(() => {
      window.addEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      layerListRef.value = []
      layerManager.destroy()
      view?.destroy()
      view = null
    })

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
            toolRef.value === 'move' ? style.selected : ''
          ]}
          onClick={selectMoveTool}
        >Move</button>
        <button
          class={[
            style.toolbarButton,
            toolRef.value === 'pen' ? style.selected : ''
          ]}
          onClick={selectPenTool}
        >Pen</button>
        <button
          class={[
            style.toolbarButton,
            toolRef.value === 'eraser' ? style.selected : ''
          ]}
          onClick={selectEraserTool}
        >Eraser</button>
      </div>
    )

    const BrushSizeSlider = () => (
      <div
        class={[
          style.brushSizeSlider,
          toolRef.value === 'move' ? style.hide : ''
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
          onPointerrawupdate={onPointerMove}
          onPointerup={onPointerUp}
        />
      </div>
    )

    const Toolbar = () => (
      <div class={style.toolbar}>
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
