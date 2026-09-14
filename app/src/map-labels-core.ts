/* How much the basemap says out loud.

   The roads were always drawn and none of them were named. CARTO sets its
   street names for a map you browse at a desk: the majors from zoom 13 and
   everything else from 14, 15 and 16. A trip sits at 11 or 12 — the whole of
   a day on one screen — so the answer to "what road are we on" was there in
   the tiles and never on the glass.

   Two zooms earlier brings the A-road under the car within reach of the zoom
   somebody actually looks at, while the minor streets still wait until you
   are inside a town, which is the only place they are worth having. Nothing
   is invented: below these zooms the tiles carry no name to draw.

   And a way out, because a city at full detail is a mat of text laid over the
   itinerary. Off is off entirely rather than back to CARTO's numbers — half a
   measure is a control nobody can tell they have used. */

/** Layer id → the zoom its names should start at. The ids are the fork's own. */
export const STREET_NAME_ZOOM: Record<string, number> = {
  roadname_major: 11,
  roadname_pri: 12,
  roadname_sec: 13,
  roadname_minor: 15,
}

/** MapLibre's own ceiling; these layers have never had one of their own. */
export const MAX_ZOOM = 24

export interface LabelLayerChange {
  id: string
  visibility: 'visible' | 'none'
  minzoom: number
  maxzoom: number
}

/** What to do to each street-name layer, given whether they are wanted. */
export function streetNamePlan(shown: boolean): LabelLayerChange[] {
  return Object.entries(STREET_NAME_ZOOM).map(([id, minzoom]) => ({
    id,
    visibility: shown ? 'visible' : 'none',
    minzoom,
    maxzoom: MAX_ZOOM,
  }))
}

const KEY = 'wf-street-names'

/* On unless somebody turned it off. The whole point is that the map names its
   roads; a preference that has to be found before the map is useful is a
   preference nobody finds. */
export function streetNamesWanted(store?: Pick<Storage, 'getItem'> | null): boolean {
  try {
    return store?.getItem(KEY) !== 'off'
  } catch {
    return true // private mode: the map still names its roads
  }
}

export function rememberStreetNames(shown: boolean, store?: Pick<Storage, 'setItem'> | null) {
  try {
    store?.setItem(KEY, shown ? 'on' : 'off')
  } catch {
    /* private mode — the choice lasts the session and no longer */
  }
}
