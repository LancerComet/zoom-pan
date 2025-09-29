import vueJsx from '@vitejs/plugin-vue-jsx'
import { defineConfig } from 'vite'

export default function () {
  return defineConfig({
    plugins: [
      vueJsx({})
    ],

    css: {
      modules: {
        localsConvention: 'camelCaseOnly'
      }
    }
  })
}
