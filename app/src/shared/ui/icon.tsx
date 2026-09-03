import { memo } from 'react'

/* One stroke set, drawn on a 16 grid at 1.5 weight. Everything is a path so a
   single <svg> shape works at 12px in a chip and 56px in a hero tile. */
const PATHS: Record<string, string> = {
  map: 'M2 4.5 6 3l4 1.5L14 3v8.5L10 13l-4-1.5L2 13V4.5Z|M6 3v8.5M10 4.5V13',
  list: 'M5.5 4h8M5.5 8h8M5.5 12h8|c2.5 4 .9|c2.5 8 .9|c2.5 12 .9',
  grid: 'M2 2h5v5H2zM9 2h5v5H9zM2 9h5v5H2zM9 9h5v5H9z',
  star: 'm8 2 1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.8l-3.8 2 .7-4.3-3.1-3 4.3-.6L8 2Z',
  people:
    'M1.5 13.5c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4M11 3.5a2.2 2.2 0 0 1 0 4.4M12.5 9.7c1.5.5 2.5 1.8 2.5 3.8|o6 5.5 2.5',
  pencil:
    'M3 13l.6-3L10.8 2.8a1.4 1.4 0 0 1 2 0l.4.4a1.4 1.4 0 0 1 0 2L6 12.4 3 13Z|M9.5 4.2l2.3 2.3',
  pin: 'M8 14.5S3 9.6 3 6.2a5 5 0 0 1 10 0c0 3.4-5 8.3-5 8.3Z|o8 6.2 1.6',
  pinplus: 'M8 14.5S3 9.6 3 6.2a5 5 0 0 1 10 0c0 3.4-5 8.3-5 8.3Z|M8 4.3v3.8M6.1 6.2h3.8',
  camera:
    'M2 5.5A1.5 1.5 0 0 1 3.5 4h1.6l1-1.5h3.8l1 1.5h1.6A1.5 1.5 0 0 1 14 5.5v6A1.5 1.5 0 0 1 12.5 13h-9A1.5 1.5 0 0 1 2 11.5v-6Z|o8 8.5 2.4',
  sun: 'M8 1.5v1.8M8 12.7v1.8M1.5 8h1.8M12.7 8h1.8M3.4 3.4l1.3 1.3M11.3 11.3l1.3 1.3M3.4 12.6l1.3-1.3M11.3 4.7l1.3-1.3|o8 8 3',
  moon: 'M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7Z',
  plane: 'M2 9.5 14 5l-1 3.5L9 10l-1.5 3.5-1.3-2.6L3.5 10 2 9.5Z',
  train: 'M3 1.5h10v10.5H3zM3 7h10M5.5 14.5 6.5 12M10.5 14.5 9.5 12|c5.75 9.75 .9|c10.25 9.75 .9',
  bed: 'M2 12V5.5M2 10h12v2M2 10V8.5A1.5 1.5 0 0 1 3.5 7h4A1.5 1.5 0 0 1 9 8.5V10m0 0h5v-1a2 2 0 0 0-2-2H9',
  music: 'M6 12.5V4l7-1.5V11|o4 12.5 2|o11 11 2',
  bike: 'M3.5 11 6 5.5h3.5l3 5.5M6 5.5 9.5 11M8 3.5h2|o3.5 11 2.5|o12.5 11 2.5',
  walk: 'M7 14.5 8 10l-1.5-1.5L7 5l2.5-1 2 2.5 2 .5M6.5 8.5 4.5 10.5M9.5 9.5l1.5 2 1 3|o9 2.5 1.2',
  car: 'M2 9.5 3.3 5.8A1.5 1.5 0 0 1 4.7 4.8h6.6a1.5 1.5 0 0 1 1.4 1L14 9.5v3H2v-3ZM2 9.5h12|o5 12.5 1.3|o11 12.5 1.3',
  boat: 'M2 11h12l-1.5 3h-9zM3.5 11V6L8 3l4.5 3v5',
  museum: 'M2 14h12M3.5 14V6.5M6.5 14V6.5M9.5 14V6.5M12.5 14V6.5M8 2l6 3.5H2z',
  food: 'M4 2v4.5a2 2 0 0 0 4 0V2M6 2v12M11.5 2c-1.3 1.3-1.3 4-1.3 6h2V14',
  note: 'M4 2h6l3 3v9H4V2Z|M10 2v3h3M6.5 8h4M6.5 10.5h4',
  trips: 'M2 3.5h12v9H2z|M2 6.5h12M5 3.5v-2M11 3.5v-2',
  arrival: 'M2 12.5h12|M3 8.5 13 6l-.7-2.4-2.7.6L6.2 2 4.9 2.4l2 2.6-2.7.7-1.6-1.1L1.5 5l1.5 3.5Z',
  check: 'm3 8.5 3.2 3L13 4.5',
  x: 'M4 4l8 8M12 4l-8 8',
  search: 'm10.5 10.5 3.5 3.5|o7 7 4.5',
  plus: 'M8 3v10M3 8h10',
  minus: 'M3 8h10',
  share: 'M8 10V2m0 0L5 5m3-3 3 3M3 9v3.5A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5V9',
  upload: 'M8 11V3m0 0L5 6m3-3 3 3M3 13h10',
  download: 'M8 3v8m0 0 3-3m-3 3-3-3M3 13h10',
  heart: 'M8 13.5S2 9.8 2 5.9A3 3 0 0 1 8 4.6a3 3 0 0 1 6 1.3c0 3.9-6 7.6-6 7.6Z',
  comment:
    'M2.5 3.5A1.5 1.5 0 0 1 4 2h8a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 12 11H7l-3.5 3v-3H4a1.5 1.5 0 0 1-1.5-1.5v-6Z',
  send: 'M14 2 7 9M14 2l-4.5 12L7 9 2 6.5 14 2Z',
  locate: 'M8 1v2.5M8 12.5V15M1 8h2.5M12.5 8H15|o8 8 4.5|c8 8 1.2',
  chevron: 'm6 3 5 5-5 5',
  chevronLeft: 'm10 3-5 5 5 5',
  chevronDown: 'm3 6 5 5 5-5',
  logout: 'M6 2H3.5A1.5 1.5 0 0 0 2 3.5v9A1.5 1.5 0 0 0 3.5 14H6M10 11l3-3-3-3M13 8H6',
  cog: 'M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4|o8 8 2.2',
  expand: 'M2 2h4M2 2v4M14 2h-4M14 2v4M2 14h4M2 14v-4M14 14h-4M14 14v-4',
  move: 'M8 2v12M2 8h12M6.2 3.8 8 2l1.8 1.8M6.2 12.2 8 14l1.8-1.8M3.8 6.2 2 8l1.8 1.8M12.2 6.2 14 8l-1.8 1.8',
  trash: 'M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5',
  clock: 'M8 4.5V8l2.5 1.5|o8 8 6',
  copy: 'M6 6h7v7H6zM3 10V3h7',
  more: 'c3.2 8 1.2|c8 8 1.2|c12.8 8 1.2',
  spark: 'M8 1.5 9.7 6.3 14.5 8 9.7 9.7 8 14.5 6.3 9.7 1.5 8 6.3 6.3 8 1.5Z|c13 3 .9',
}

/* Aliases keep older call sites reading naturally without a second drawing. */
const ALIAS: Record<string, string> = {
  users: 'people',
  edit: 'pencil',
  loc: 'locate',
  chev: 'chevron',
  chevl: 'chevronLeft',
  chevd: 'chevronDown',
  hotel: 'bed',
  flight: 'plane',
  drive: 'car',
  event: 'music',
  photo: 'camera',
  checkout: 'bed',
}

/* Icons re-render on every map frame; split the path data once, not 50x per
   frame. A leading `o`/`c` marks a circle (stroked / filled) so round shapes do
   not have to be spelled out as arcs. */
type Shape = { d: string } | { cx: number; cy: number; r: number; fill: boolean }
const SHAPES: Record<string, Shape[]> = {}
for (const key in PATHS) {
  SHAPES[key] = PATHS[key].split('|').map(part => {
    const circle = /^([oc])([\d.-]+) ([\d.-]+) ([\d.-]+)$/.exec(part)
    return circle
      ? { cx: +circle[2], cy: +circle[3], r: +circle[4], fill: circle[1] === 'c' }
      : { d: part }
  })
}

export interface IconProps {
  n: string
  s?: number
  c?: string
  w?: number
  className?: string
}

const Icon = memo(function Icon({ n, s = 16, c = 'currentColor', w = 1.5, className }: IconProps) {
  const shapes = SHAPES[ALIAS[n] || n] || SHAPES.pin
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 16 16"
      fill="none"
      stroke={c}
      strokeWidth={w}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ flex: 'none' }}
      aria-hidden="true">
      {shapes.map((shape, index) =>
        'd' in shape ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: the shape lists are frozen module constants; index is their identity
          <path key={index} d={shape.d} />
        ) : (
          <circle
            // biome-ignore lint/suspicious/noArrayIndexKey: the shape lists are frozen module constants; index is their identity
            key={index}
            cx={shape.cx}
            cy={shape.cy}
            r={shape.r}
            fill={shape.fill ? c : 'none'}
            stroke={shape.fill ? 'none' : undefined}
          />
        ),
      )}
    </svg>
  )
})

export default Icon
