/* The picture a trip link unfurls into when it lands in the family chat.
   Deliberately content-free — every trip is private, so the card sells the
   idea, not anyone's whereabouts: the night ground, the travelled amber line,
   the live dot, the wordmark. Regenerate with `node scripts/generate-og-card.mjs`. */
import sharp from 'sharp'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'og-card.png')

const streets = []
for (let x = 140; x < 1200; x += 190) {
  streets.push(`<line x1="${x}" y1="0" x2="${x}" y2="630" stroke="#12161D" stroke-width="10"/>`)
}
for (let y = 90; y < 630; y += 150) {
  streets.push(`<line x1="0" y1="${y}" x2="1200" y2="${y}" stroke="#12161D" stroke-width="10"/>`)
}

const route = 'M-40 480 L330 480 L330 345 L610 345 L610 445 L850 445'

const svg = `<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="11"/>
    </filter>
  </defs>
  <rect width="1200" height="630" fill="#0B0D11"/>
  ${streets.join('\n  ')}
  <path d="${route}" stroke="#FFB454" stroke-width="30" stroke-linecap="round"
        stroke-linejoin="round" fill="none" opacity=".3" filter="url(#glow)"/>
  <path d="${route}" stroke="#F0A63C" stroke-width="9" stroke-linecap="round"
        stroke-linejoin="round" fill="none"/>
  <path d="M850 445 C 960 445 1020 380 1130 355" stroke="#F0A63C" stroke-width="6"
        stroke-dasharray="2 20" stroke-linecap="round" fill="none" opacity=".7"/>
  <circle cx="850" cy="445" r="36" fill="none" stroke="#F0A63C" stroke-width="4" opacity=".5"/>
  <circle cx="850" cy="445" r="17" fill="#F0A63C"/>
  <circle cx="850" cy="445" r="21" fill="none" stroke="#F2F4F7" stroke-width="3"/>
  <text x="84" y="168" font-family="Segoe UI, Arial, sans-serif" font-size="104"
        font-weight="800" fill="#F2F4F7" letter-spacing="-3">Off We Go</text>
  <text x="88" y="232" font-family="Segoe UI, Arial, sans-serif" font-size="34"
        fill="#98A2B3">Go places together — and bring everyone along, live.</text>
</svg>`

await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(out)
console.log('wrote', out)
