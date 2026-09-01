/* The trip screen's whole visible state lives in the URL: which side panel is
   open, which day is filtered, what is selected, what was searched for, and
   which sheet is up. That makes every view linkable and the back button do what
   people expect, and it keeps this parsing testable away from React. */

export const TRIP_VIEWS = ['map', 'timeline', 'photos', 'sights', 'people'] as const
export const TRIP_SHEETS = ['add', 'settings'] as const
export const SETTINGS_TABS = ['trip', 'people', 'phones'] as const
export const ALL_DAYS = 'all'

export type TripView = (typeof TRIP_VIEWS)[number]
export type TripSheet = (typeof TRIP_SHEETS)[number]
export type SettingsTab = (typeof SETTINGS_TABS)[number]

export interface TripSearch {
  /** absent means the map, so an ordinary trip link stays free of query string */
  view?: TripView
  day?: string
  sel?: string
  q?: string
  sheet?: TripSheet
  tab?: SettingsTab
}

const oneOf = <T extends string>(options: readonly T[], value: unknown): T | undefined => {
  const text = typeof value === 'string' ? value : ''
  return (options as readonly string[]).includes(text) ? (text as T) : undefined
}

const text = (value: unknown, max: number) => {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed ? trimmed.slice(0, max) : undefined
}

export function parseTripSearch(input: Record<string, unknown>): TripSearch {
  const search: TripSearch = {}
  const view = oneOf(TRIP_VIEWS, input.view)
  if (view && view !== 'map') search.view = view
  const day = text(input.day, 40)
  if (day) search.day = day
  const selected = text(input.sel, 64)
  if (selected) search.sel = selected
  const query = text(input.q, 120)
  if (query) search.q = query
  const sheet = oneOf(TRIP_SHEETS, input.sheet)
  if (sheet) search.sheet = sheet
  const tab = oneOf(SETTINGS_TABS, input.tab)
  if (sheet === 'settings') search.tab = tab || 'trip'
  return search
}

export const DEFAULT_VIEW: TripView = 'map'
