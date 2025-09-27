import { ZoomPan2D } from './zoom-pan-2d'

const canvas = document.querySelector('canvas')!
const zp = new ZoomPan2D(canvas, (ctx, api) => {
  // 在“世界坐标”里画（api 已设置好 ctx 变换）
  ctx.fillStyle = '#222'
  ctx.fillRect(-400, -300, 800, 600) // 背板
  ctx.fillStyle = '#0bf'
  ctx.fillRect(0, 0, 200, 120)

  // 画个锚点十字
  const { x, y } = api.toWorld(200, 150) // 把屏幕点(200,150)转成世界坐标
  ctx.strokeStyle = '#fff'
  ctx.lineWidth = 1 / api.getTransform().zoom
  ctx.beginPath()
  ctx.moveTo(x - 10, y); ctx.lineTo(x + 10, y)
  ctx.moveTo(x, y - 10); ctx.lineTo(x, y + 10)
  ctx.stroke()
})

// 可选：绑定 Ctrl/⌘ + 0 平滑复位
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && (e.key === '0' || e.code === 'Digit0')) {
    e.preventDefault()
    zp.resetSmooth()
  }
})
