/* Today's weather, drifting over the globe on the home page.

   The cloud map is one equirectangular frame stitched from the geostationary
   weather satellites and republished every three hours. Two things have to
   happen to it before it can go over the planet. It has to be stretched into
   Web Mercator, because laid down unchanged the cloud sitting over Iceland
   would appear somewhere north of Scotland. And it has to be redrawn at a
   rolling offset, because weather that never moves reads as a smear on the
   lens rather than as a planet with weather on it. */

const FRAME = 'https://clouds.matteason.co.uk/images/2048x1024/clouds-alpha.png'

/** The latitude Web Mercator stops at, and so the edge of what this can cover. */
export const MERCATOR_EDGE = 85.051129

export const CLOUD_BOUNDS: [number, number][] = [
  [-180, MERCATOR_EDGE], [180, MERCATOR_EDGE], [180, -MERCATOR_EDGE], [-180, -MERCATOR_EDGE],
]

/* Half an hour. The frame itself moves every three, and the CDN holds it for
   two, so most of these cost a cache hit rather than a download. */
export const CLOUD_REFRESH = 1_800_000

/** Degrees of longitude the weather rolls east per second. Real systems manage
    about a fiftieth of this; across a whole planet, real is indistinguishable
    from stopped. */
export const CLOUD_DRIFT = 1.1

/* The texture goes to the GPU on every frame it moves, so its width is a bill
   paid sixty times a second. Cloud has no hard edges to lose, and half of this
   stretched across a globe a thousand pixels wide still outruns the softness
   already in the source frame. */
const SIZE = 1024

/** The latitude a given fraction of the way down a Web Mercator square. */
export function mercatorLatitude(fraction: number): number {
  const y = Math.PI * (1 - 2 * fraction)
  return (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * (180 / Math.PI)
}

/** The row of an equirectangular frame a latitude falls on, as a fraction. */
export const equirectangularRow = (latitude: number) => (90 - latitude) / 180

export interface Weather {
  /** the live texture — the map re-reads this every frame */
  canvas: HTMLCanvasElement
  /** redraw it with the weather rolled this many degrees east */
  roll(degrees: number): void
  /** fetch a newer frame; false if there was not one to be had */
  refresh(): Promise<boolean>
}

function reproject(frame: HTMLImageElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const paint = canvas.getContext('2d')!
  paint.imageSmoothingEnabled = true
  paint.imageSmoothingQuality = 'high'
  /* One destination row at a time. Stretching in coarser bands leaves the
     boundaries between them visible as rings across the ocean, because each
     band samples one slice of the source and jumps to the next. */
  for (let row = 0; row < SIZE; row++) {
    const top = equirectangularRow(mercatorLatitude(row / SIZE)) * frame.height
    const bottom = equirectangularRow(mercatorLatitude((row + 1) / SIZE)) * frame.height
    paint.drawImage(frame, 0, top, frame.width, Math.max(bottom - top, 0.01),
                    0, row, SIZE, 1)
  }
  return canvas
}

const fetchFrame = () => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image()
  // Without this the canvas is tainted and WebGL refuses to upload it.
  image.crossOrigin = 'anonymous'
  image.onload = () => resolve(image)
  image.onerror = () => reject(new Error('no cloud frame'))
  image.src = FRAME
})

/** The weather, ready to roll — or null when it cannot be had, which is not an
    error worth showing: the planet is the page, the clouds are the day. */
export async function loadWeather(): Promise<Weather | null> {
  let master: HTMLCanvasElement
  try {
    master = reproject(await fetchFrame())
  } catch {
    return null
  }

  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const paint = canvas.getContext('2d')!

  /* Twice, a world apart: as the weather rolls off the right-hand edge the
     second copy is already coming in on the left, so the seam never arrives. */
  const roll = (degrees: number) => {
    const shift = (((degrees % 360) + 360) % 360) / 360 * SIZE
    paint.clearRect(0, 0, SIZE, SIZE)
    paint.drawImage(master, shift, 0)
    paint.drawImage(master, shift - SIZE, 0)
  }
  roll(0)

  const refresh = async () => {
    try {
      master = reproject(await fetchFrame())
      return true
    } catch {
      return false
    }
  }

  return { canvas, roll, refresh }
}
