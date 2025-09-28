const createPatternImage = (width: number, height: number, src: string): Promise<HTMLCanvasElement> => {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height

    const ctx = canvas.getContext('2d')!

    const img = new Image()
    img.onload = () => {
      const pattern = ctx.createPattern(img, 'repeat')
      if (pattern) {
        ctx.fillStyle = pattern
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        resolve(canvas)
      } else {
        reject(new Error('Failed to create pattern'))
      }
    }
    img.onerror = (err) => {
      console.error(err)
      reject(err)
    }
    img.src = src
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
