import type { Person } from '../../../shared/model/types'

/* A face, or the next best thing.

   Everybody starts without a picture, and an <img> with an empty src is drawn
   by every browser as a broken image — so the photo grid was full of them. An
   SVG data URI rather than a styled <span>, because every place a face appears
   already has CSS aimed at an img, and this way none of it has to change. */
function initialAvatar(name?: string) {
  const label = (name || '?').trim() || '?'
  const initial = label.charAt(0).toUpperCase()
  const hue = [...label].reduce((value, character) => (value * 31 + character.charCodeAt(0)) % 360, 11)
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
    `<rect width="64" height="64" fill="hsl(${hue} 38% 34%)"/>` +
    '<text x="32" y="43" text-anchor="middle" fill="#fff" font-weight="700"' +
    ` font-size="30" font-family="system-ui,-apple-system,sans-serif">${initial}</text></svg>`
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg)
}

export const withFace = (person: Person): Person =>
  (person && person.avatar ? person : { ...person, avatar: initialAvatar(person && person.name) })
