import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

/* How the workflows pin the actions they run.
 *
 * Two rules, and the second is the one that bit.
 *
 * A tag is not a pin: `@v4` is a name its owner can move, so pinning to one
 * means running whatever they push to it — with this repository's App Store
 * key, its deployment SSH key and its signing certificate in the environment.
 * A commit cannot be moved, so that is what gets named, with the tag written
 * beside it as the only thing a person can read.
 *
 * And one action means one pin. The deploy workflow had been moved to a newer
 * checkout and setup-node; the other six files had not, so the same action ran
 * at two different versions depending on which workflow you were in — and the
 * six stale ones sat on a Node the runners had already deprecated, which is
 * how it was noticed. Drift like that is invisible in a diff of one file and
 * obvious across all of them.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const workflowRoot = path.join(repoRoot, '.github', 'workflows')

/** Every `uses:` across every workflow, with the file it came from. */
async function pinned() {
  const files = (await readdir(workflowRoot)).filter(name => /\.ya?ml$/.test(name))
  const used = []
  for (const file of files) {
    const contents = await readFile(path.join(workflowRoot, file), 'utf8')
    for (const [, action, ref, comment] of contents.matchAll(
      /uses:\s*([\w.-]+\/[\w.-]+)@(\S+)(?:\s*#\s*(\S+))?/g,
    ))
      used.push({ file, action, ref, comment })
  }
  return used
}

test('every action is pinned to a commit, not to a name its owner can move', async () => {
  const used = await pinned()
  assert.ok(used.length > 0, 'no actions found — has the workflow directory moved?')

  const loose = used
    .filter(({ ref }) => !/^[0-9a-f]{40}$/.test(ref))
    .map(({ file, action, ref }) => `${file}: ${action}@${ref}`)
  assert.deepEqual(loose, [], `Pin these to a commit:\n${loose.join('\n')}`)

  /* The tag beside it is not decoration: a bare forty characters tells a
     reader nothing about how old it is or what moving it would mean. */
  const unlabelled = used
    .filter(({ comment }) => !/^v\d+/.test(comment || ''))
    .map(({ file, action }) => `${file}: ${action}`)
  assert.deepEqual(unlabelled, [], `Name the version beside the pin:\n${unlabelled.join('\n')}`)
})

test('one action is pinned to one commit everywhere it is used', async () => {
  const used = await pinned()
  const byAction = new Map()
  for (const { file, action, ref, comment } of used) {
    if (!byAction.has(action)) byAction.set(action, new Map())
    const refs = byAction.get(action)
    if (!refs.has(ref)) refs.set(ref, { comment, files: [] })
    refs.get(ref).files.push(file)
  }

  const drifted = []
  for (const [action, refs] of byAction) {
    if (refs.size < 2) continue
    const where = [...refs]
      .map(([ref, { comment, files }]) => `  ${comment || ref.slice(0, 8)} in ${files.join(', ')}`)
      .join('\n')
    drifted.push(`${action} is pinned ${refs.size} different ways:\n${where}`)
  }

  assert.deepEqual(drifted, [], drifted.join('\n\n'))
})
