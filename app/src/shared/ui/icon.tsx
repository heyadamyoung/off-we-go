import { memo } from 'react'

const PATHS: Record<string, string> = {
  pin:'M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z|M14.5 9.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z',
  plane:'M3 12l18-8-6 18-3-7z',
  bed:'M3 18V8M3 13h18v5M21 18v-5a3 3 0 0 0-3-3H11v3|M9 10a2 2 0 1 1-4 0 2 2 0 0 1 4 0z',
  boat:'M3 17h18l-2 4H5zM5 17V9l7-5 7 5v8',
  museum:'M3 21h18M5 21V10M9 21V10M15 21V10M19 21V10M12 3l9 5H3z',
  food:'M6 3v7a3 3 0 0 0 6 0V3M9 3v18M17 3c-2 2-2 6-2 9h3v9',
  walk:'M9 21l3-7 2 2v5M7 13l3-4 3 1 3 3M15 21l-2-6|M14.6 4a1.6 1.6 0 1 1-3.2 0 1.6 1.6 0 0 1 3.2 0z',
  check:'M5 12l4 4L19 7',
  clock:'M12 8v4l3 2|M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0z',
  plus:'M12 5v14M5 12h14', minus:'M5 12h14',
  chev:'M9 6l6 6-6 6', chevl:'M15 6l-6 6 6 6', chevd:'M6 9l6 6 6-6',
  x:'M6 6l12 12M18 6L6 18',
  share:'M12 3v12M7 8l5-5 5 5M5 14v6h14v-6',
  heart:'M12 20s-7-4.6-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.4-7 10-7 10z',
  loc:'M12 2v4M12 18v4M2 12h4M18 12h4|M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  search:'M20 20l-4-4|M17.5 11a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0z',
  map:'M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z|M9 4v14M15 6v14',
  list:'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  grid:'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  users:'M2 20c0-4 3-6 7-6s7 2 7 6M17 5a3 3 0 0 1 0 6M18 20c0-3-1-4.5-2.5-5.5|M12 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  camera:'M4 8h3l2-3h6l2 3h3v11H4z|M15.5 13a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0z',
  send:'M4 5h16v11H9l-5 4z',
  moon:'M21 13A8 8 0 1 1 11 3a6.5 6.5 0 0 0 10 10z',
  sun:'M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4|M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z',
  expand:'M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6',
  copy:'M9 9h11v11H9zM5 15V4h11',
  upload:'M12 19V7M7 12l5-5 5 5M5 20h14',
  edit:'M4 20h4l10-10-4-4L4 16z|M13.5 6.5l4 4',
  star:'M12 3.2l2.6 5.6 6 .8-4.4 4.3 1.1 6.1-5.3-3-5.3 3 1.1-6.1L3.4 9.6l6-.8z',
  download:'M12 4v12M7 11l5 5 5-5M5 20h14',
  logout:'M10 5H5v14h5M14 8l4 4-4 4M18 12H9',
}
// Icons re-render on every map frame; split the path data once, not 50x per frame.
const SEGS: Record<string, string[]> = {}
for (const k in PATHS) SEGS[k] = PATHS[k].split('|')

export interface IconProps {
  n: string
  s?: number
  c?: string
  w?: number
}

const Icon = memo(function Icon({ n, s = 16, c = 'currentColor', w = 1.8 }: IconProps) {
  const d = SEGS[n] || SEGS.pin
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={w}
         strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}>
      {d.map((p, i) => <path key={i} d={p} />)}
    </svg>
  )
})

export default Icon


