const loadImage = async (src: string | File | Blob, crossOrigin?: '' | 'anonymous' | 'use-credentials'): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  const img = new Image()
  if (typeof src === 'string') {
    if (crossOrigin !== undefined) img.crossOrigin = crossOrigin
    img.src = src
  } else {
    img.src = URL.createObjectURL(src)
  }
  img.onload = () => resolve(img)
  img.onerror = () => reject(new Error('Image load failed'))
});

export {
  loadImage
}
