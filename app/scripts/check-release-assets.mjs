/* Fails the image build when the prerendered shell asks for a file the build
   did not ship. That shipped once: the shell named the stylesheet from one
   build pass and dist/ held the other, so every cold load painted unstyled
   until hydration swapped the link in — invisible to a test that waits for the
   app to render, and invisible to CI, whose .gitignore made the two passes
   agree. Checking the artifact itself is the only place it shows. */
import { readFile, access } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const root = resolve(process.argv[2] || 'dist/client')
const shell = join(root, 'index.html')
const html = await readFile(shell, 'utf8')

const referenced = [...html.matchAll(/(?:href|src)="(\/[^"]+\.(?:css|js|svg|png|ico|webmanifest))"/g)]
  .map(match => match[1])

const missing = []
for (const path of new Set(referenced)) {
  try {
    await access(join(root, path))
  } catch {
    missing.push(path)
  }
}

if (missing.length) {
  console.error(`${shell} references ${missing.length} file(s) that were not built:`)
  for (const path of missing) console.error(`  ${path}`)
  process.exit(1)
}
console.log(`release check: ${new Set(referenced).size} referenced files all present`)
