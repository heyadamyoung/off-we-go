const ACCENT = '#F5B84A'
const TRAIL = '#6FD3A8'    // where the phones actually went, as distinct from the route drawn by hand

const STYLE = {
  dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  // Voyager rather than Positron for daytime: cream land (#fbf8f3) and muted
  // teal water instead of Positron's clinical grey-on-white, which read cold
  // and flat under a warm accent colour.
  light: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
}

const linesOf = lines => ({
  type: 'FeatureCollection',
  features: lines.map(c => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: c } })),
})

export { ACCENT, TRAIL, STYLE, linesOf }


