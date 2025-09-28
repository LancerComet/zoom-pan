/*
 * In this example, we gonna show how to create a simple painter.
 */
import { computed, createApp, defineComponent, onBeforeUnmount, onMounted, ref, withModifiers } from 'vue'
import { ZoomPan2D, BrushCursor, LayerManager, BitmapLayer, LayerBase, CanvasLayer } from '../../lib'
import dragCursorImg from './assets/cursor-darg.png'
import transparentLayerImg from './assets/transparent-layer.png'
import style from './index.module.styl'
import { createPatternImage, loadImage } from './utils.ts'

// Document size, just like what in Photoshop.
const DOCUMENT_WIDTH = 1200
const DOCUMENT_HEIGHT = 2000

const MIN_BRUSH_SIZE = 0
const MAX_BRUSH_SIZE = 200

const brushColor = '#000'

type ToolType = 'move' | 'pen' | 'eraser'

const App = defineComponent({
  name: 'App',

  setup () {
    const canvasRef = ref<HTMLCanvasElement | null>(null)

    const layerListRef = ref<LayerBase[]>([])
    const selectedLayerIdRef = ref<string>('')
    const toolRef = ref<ToolType>('move')
    const brushSizeRef = ref(40)
    const eraserSizeRef = ref(20)

    let isInTempMoveMode = false

    let startStockLayer: CanvasLayer | null = null

    // The ZoomPan2D instance that manages the view (canvas).
    let view: ZoomPan2D | null = null

    // LayerManager is used to manage all layers and render them in the view.
    const layerManager = new LayerManager()

    // This cursor layer acts as a drag cursor in the stage.
    // When people use the pen / eraser tool while holding the space key, it appears.
    // It is drawn in screen space, so its size is fixed and not affected by zoom.
    let dragCursorLayer: BitmapLayer | null = null

    // A brush cursor layer that shows the brush cursor in the stage.
    // It is drawn in world space, so its size is affected by zoom.
    let brushCursor: BrushCursor | null = null

    const currentBrushSize = computed(() => {
      if (toolRef.value === 'eraser') {
        return eraserSizeRef.value
      }
      return brushSizeRef.value
    })

    const shouldHideBrowserCursor = computed(() => {
      return toolRef.value !== 'move'
    })

    const addLayer = (layer: LayerBase) => {
      layerListRef.value.push(layer)
    }

    const selectLayer = (layerId: string) => {
      selectedLayerIdRef.value = layerId
    }

    const removeLayer = (layerId: string) => {
      const index = layerListRef.value.findIndex(item => item.id === layerId)
      if (index > -1) {
        layerListRef.value.splice(index, 1)
      }
      layerManager.removeLayer(layerId)
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
      addLayer(backgroundLayer)

      // Insert an image layer.
      const avatarImg = await loadImage('/image.png')
      const avatarLayer = layerManager.createCanvasLayer({
        name: 'My Avatar',
        width: DOCUMENT_WIDTH,
        height: DOCUMENT_HEIGHT,
        scale: 1
      })
      addLayer(avatarLayer)
      avatarLayer.drawImage(avatarImg, 50, 50)
      selectedLayerIdRef.value = avatarLayer.id

      // The drag cursor is drawn in screen space, so it size is fixed and not affected by zoom.
      dragCursorLayer = await layerManager.createImageLayer({
        width: 32,
        height: 32,
        src: dragCursorImg,
        space: 'screen',
        anchor: 'center'
      })
      dragCursorLayer.visible = false

      // Create a brush cursor layer.
      // The brush cursor is drawn in world space, so its size is affected by zoom.
      brushCursor = new BrushCursor()
      brushCursor.radius = brushSizeRef.value / 2
      brushCursor.visible = false
      layerManager.addLayer(brushCursor)
    }

    const onPointerDown = (event: PointerEvent) => {
      if (view && !isInTempMoveMode) {
        const { wx, wy } = view.toWorld(event.offsetX, event.offsetY)
        const currentLayer = layerManager.getLayer(selectedLayerIdRef.value)
        if (currentLayer instanceof CanvasLayer && currentLayer.hitTest(wx, wy)) {
          startStockLayer = currentLayer
          const brushSize = brushSizeRef.value
          currentLayer.beginStroke(wx, wy, brushColor, brushSize, event.pressure)
        }
      }
    }

    const onPointerMove = (event: PointerEvent) => {
      const canvas = canvasRef.value

      if (canvas && dragCursorLayer && brushCursor) {
        const rect = canvas.getBoundingClientRect()
        const cx = event.clientX - rect.left
        const cy = event.clientY - rect.top

        dragCursorLayer.x = cx
        dragCursorLayer.y = cy
        dragCursorLayer.requestRedraw()

        // Assign screen position to the brush cursor.
        // It will be converted to world position in the BrushCursor.render() method.
        brushCursor.screenX = cx
        brushCursor.screenY = cy
      }

      if (view && !isInTempMoveMode) {
        const { wx, wy } = view.toWorld(event.offsetX, event.offsetY)
        if (
          toolRef.value === 'pen' &&
          event.buttons === 1 &&
          startStockLayer &&
          startStockLayer.hitTest(wx, wy)
        ) {
          const brushSize = brushSizeRef.value
          startStockLayer.stroke(wx, wy, brushColor, brushSize, event.pressure)
        }
      }
    }

    const onPointerUp = (event: PointerEvent) => {
      if (view) {
        const { wx, wy } = view.toWorld(event.offsetX, event.offsetY)
        if (
          toolRef.value === 'pen' &&
          startStockLayer &&
          startStockLayer.hitTest(wx, wy)
        ) {
          startStockLayer.endStroke()
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
      if (dragCursorLayer) {
        dragCursorLayer.visible = true
      }
      if (brushCursor) {
        brushCursor.visible = false
      }
      view?.setPanEnabled(true)
      isInTempMoveMode = true
    }

    const leaveTempMoveMode = () => {
      if (dragCursorLayer) {
        dragCursorLayer.visible = false
      }
      if (brushCursor) {
        brushCursor.visible = true
      }
      view?.setPanEnabled(false)
      isInTempMoveMode = false
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
      const isSpace = event.code === 'Space' || event.key === ' '
      const currentTool = toolRef.value
      const enterMoveMode = isSpace && (currentTool === 'pen' || currentTool === 'eraser')
      if (enterMoveMode) {
        enterTempMoveMode()
        return
      }

      const isA = event.key === 'a' || event.code === 'KeyA'
      if (isA) {
        const brushSize = currentBrushSize.value + 10
        setBrushSize(brushSize)
        return
      }

      const isS = event.key === 's' || event.code === 'KeyS'
      if (isS) {
        const brushSize = currentBrushSize.value - 10
        setBrushSize(brushSize)
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

      const isSpace = event.code === 'Space' || event.key === ' '
      const currentTool = toolRef.value
      const leaveMoveMode = isSpace && (currentTool === 'pen' || currentTool === 'eraser')
      if (leaveMoveMode) {
        leaveTempMoveMode()
        return
      }

      const isB = event.key === 'b' || event.code === 'KeyB'
      if (isB) {
        selectPenTool()
        return
      }

      const isV = event.key === 'v' || event.code === 'KeyV'
      if (isV) {
        selectMoveTool()
      }

      const isE = event.key === 'e' || event.code === 'KeyE'
      if (isE) {
        selectEraserTool()
      }
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

            <div class={style.previewImg}></div>

            <div class={style.layerInfo}>
              <span>{ item.name }</span>
            </div>
          </div>
        ))
      }</div>
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
          <div class={style.sideBarHeader}>Layers</div>
          <LayerList />
        </div>
      </div>
    )
  }
})

createApp(App).mount('#app')
