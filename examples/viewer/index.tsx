import { createApp, defineComponent, onBeforeUnmount, onMounted, ref } from 'vue'
import { LayerManager, ZoomPan2D } from '../../lib'
import style from './index.module.styl'

const App = defineComponent({
  name: 'App',

  setup () {
    const canvasRef = ref<HTMLCanvasElement | null>(null)

    // The ZoomPan2D instance that manages the view (canvas).
    let view: ZoomPan2D | null = null

    // LayerManager is used to manage all layers and render them in the view.
    const layerManager = new LayerManager()

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
          background: '#ffffff',
          drawDocBorder: true
        }
      )
    }

    const initPresetLayers = async () => {
      await layerManager.createImageLayer({
        src: '/image.png',
        x: 20,
        y: 20
      })

      const image2 = await layerManager.createImageLayer({
        src: '/anime.png',
        x: 800,
        y: 500,
        width: 500,
        height: 925,
        anchor: 'center'
      })

      const move = () => {
        image2.rotation += 0.001
        requestAnimationFrame(move)
      }
      move()
    }

    onMounted(async () => {
      initView()
      await initPresetLayers()
    })

    onBeforeUnmount(() => {
      layerManager.destroy()
      view?.destroy()
      view = null
    })

    return () => (
      <div class={style.app}>
        <div class={style.canvasContainer}>
          <canvas ref={canvasRef} />
        </div>
      </div>
    )
  }
})

createApp(App).mount('#app')
