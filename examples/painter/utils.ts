const createPatternImage = (width: number, height: number, src: string): Promise<HTMLCanvasElement> => {
  return new Promise((resolve, reject) => {
    const canvas = document.querySelector('canvas')!
    canvas.width = width
    canvas.height = height

    const ctx = canvas.getContext('2d')!

    const img = new Image()
    img.src = src
    img.onload = () => {
      const pattern = ctx.createPattern(img, 'repeat')
      if (pattern) {
        ctx.fillStyle = pattern
        ctx.fillRect(0, 0, canvas.width, canvas.height)
      }
      resolve(canvas)
    }
    img.onerror = (err) => {
      reject(err)
    }
  })
}

const loadImage = (src: string) => {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.src = src
    img.onload = () => {
      resolve(img)
    }
    img.onerror = (err) => {
      reject(err)
    }
  })
}

export {
  createPatternImage,
  loadImage
}
