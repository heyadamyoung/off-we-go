import { useCallback, useEffect, useState } from 'react'
import { rememberStreetNames, streetNamesWanted } from '../../../map-labels-core'

/* How the map looks, and what the person chose.

   Three switches with nothing to do with any particular trip: the app's own
   light or dark, the basemap that follows from it, and whether that basemap
   names its roads. They belong together because they are one idea — the look
   of the map as somebody set it — and they are here rather than in the page
   because the page is about a trip: its itinerary, its photographs, its live
   layer, its assistant. A preference about the colour of the ground was
   sitting in the middle of that.

   The store is read once and written on every change, so a choice survives
   the tab. Private mode refuses both and neither is an error: the map still
   draws, and the choice lasts the session. */
const THEME_KEY = 'offwego-theme'

export default function useMapLook() {
  const [theme, setTheme] = useState(() =>
    typeof document === 'undefined' ? 'dark' : document.documentElement.dataset.theme || 'dark',
  )
  /* Which basemap, when it is not simply the one the sun would have picked.
     Set in the same breath as the theme: a dark app over a noon-bright map is
     nobody's idea of a choice. */
  const [mapOverride, setMapOverride] = useState<string | null>(theme)
  const [streetNames, setStreetNames] = useState(() =>
    streetNamesWanted(typeof localStorage === 'undefined' ? null : localStorage),
  )

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem(THEME_KEY, theme)
    } catch {
      /* private mode */
    }
  }, [theme])

  /* Both, plainly, rather than one inside the other's updater: a setState
     inside a setState is a side effect in a reducer, and React is entitled to
     run a reducer twice. */
  const toggleTheme = useCallback(() => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    setMapOverride(next)
  }, [theme])

  const toggleStreetNames = useCallback(() => {
    setStreetNames(on => {
      const next = !on
      rememberStreetNames(next, typeof localStorage === 'undefined' ? null : localStorage)
      return next
    })
  }, [])

  return { theme, toggleTheme, mapOverride, streetNames, toggleStreetNames }
}
