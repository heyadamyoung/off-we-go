import { useEffect, useMemo, useState } from 'react'

const RAD = Math.PI / 180
const OBLIQUITY = RAD * 23.4397
const PERIHELION = RAD * 102.9372

// Sun altitude above the horizon, in degrees.
function sunAltitude(date, lat, lng) {
  const days = date.valueOf() / 86400000 - 0.5 + 2440588 - 2451545
  const M = RAD * (357.5291 + 0.98560028 * days)                       // mean anomaly
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M))
  const L = M + C + PERIHELION + Math.PI                               // ecliptic longitude
  const dec = Math.asin(Math.sin(OBLIQUITY) * Math.sin(L))             // declination
  const ra = Math.atan2(Math.sin(L) * Math.cos(OBLIQUITY), Math.cos(L))
  const H = RAD * (280.16 + 360.9856235 * days) - RAD * -lng - ra      // hour angle
  const phi = RAD * lat
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H))
  return alt / RAD
}

/* Altitude -> the wash laid over the basemap. Interpolated between stops so
   the colour creeps rather than steps; the whole ramp is traversed twice a day. */
const TINT = [
  { alt:  50, c: [255, 246, 230], a: 0.06, name: 'daylight' },   // never quite bare
  { alt:  20, c: [255, 238, 214], a: 0.09, name: 'daylight' },
  { alt:   8, c: [255, 206, 146], a: 0.16, name: 'afternoon' },
  { alt:   2, c: [255, 168,  86], a: 0.26, name: 'golden hour' },
  { alt:  -2, c: [255, 138,  72], a: 0.30, name: 'sunset' },
  // Below here the basemap is dark, and a bright wash over near-black only
  // muddies it to brown — so the colours deepen and the alphas drop right off.
  { alt:  -5, c: [190,  96, 110], a: 0.13, name: 'dusk' },
  { alt: -10, c: [124,  84, 176], a: 0.12, name: 'twilight' },
  { alt: -16, c: [ 56,  78, 168], a: 0.11, name: 'blue hour' },
  { alt: -22, c: [ 22,  40,  90], a: 0.10, name: 'night' },
]
const mix = (a, b, t) => a + (b - a) * t
const hex = c => '#' + c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('')

function tintFor(alt) {
  if (alt >= TINT[0].alt) return { color: hex(TINT[0].c), alpha: TINT[0].a, phase: TINT[0].name }
  const last = TINT[TINT.length - 1]
  if (alt <= last.alt) return { color: hex(last.c), alpha: last.a, phase: last.name }
  for (let i = 1; i < TINT.length; i++) {
    const hi = TINT[i - 1], lo = TINT[i]
    if (alt <= hi.alt && alt > lo.alt) {
      const t = (hi.alt - alt) / (hi.alt - lo.alt)
      return {
        color: hex([0, 1, 2].map(k => mix(hi.c[k], lo.c[k], t))),
        alpha: Math.round(mix(hi.a, lo.a, t) * 1000) / 1000,
        phase: t < 0.5 ? hi.name : lo.name,
      }
    }
  }
  return { color: hex(last.c), alpha: last.a, phase: last.name }
}

// Above this the basemap is the warm daytime style. Slightly *below* the
// horizon rather than above it, for two reasons: the world stays bright for a
// while after the sun sets, and it keeps golden hour on the cream base where a
// warm wash glows instead of turning the dark base to mud.
const LIGHT_ABOVE = -2

function daylightAt(date, lngLat) {
  const alt = sunAltitude(date, lngLat[1], lngLat[0])
  return { alt, base: alt > LIGHT_ABOVE ? 'light' : 'dark', ...tintFor(alt) }
}

// The sun moves about a quarter of a degree a minute, so a minute is plenty.
function useDaylight(lngLat, everyMs = 60000) {
  const [at, setAt] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setAt(Date.now()), everyMs)
    return () => clearInterval(id)
  }, [everyMs])
  const lng = lngLat ? lngLat[0] : 0, lat = lngLat ? lngLat[1] : 0
  return useMemo(() => daylightAt(new Date(at), [lng, lat]), [at, lng, lat])
}

export { daylightAt, sunAltitude, tintFor, useDaylight }


