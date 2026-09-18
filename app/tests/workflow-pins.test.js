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
const actionRoot = path.join(repoRoot, '.github', 'actions')

/** The workflows, and the repository's own composite actions, which run
    actions of their own and are pinned by the same rules. */
async function workflowFiles() {
  const files = (await readdir(workflowRoot))
    .filter(name => /\.ya?ml$/.test(name))
    .map(name => path.join(workflowRoot, name))
  const actions = await readdir(actionRoot).catch(() => [])
  for (const action of actions) {
    for (const name of ['action.yml', 'action.yaml']) {
      const file = path.join(actionRoot, action, name)
      if (
        await readFile(file, 'utf8').then(
          () => true,
          () => false,
        )
      )
        files.push(file)
    }
  }
  return files
}

/** Every `uses:` across every workflow, with the file it came from. */
async function pinned() {
  const used = []
  for (const found of await workflowFiles()) {
    const file = path.relative(repoRoot, found)
    const contents = await readFile(found, 'utf8')
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

/** The lines of one `- uses:` step: its own line, plus everything under it. */
function stepFor(contents, action) {
  const lines = contents.split('\n')
  const at = lines.findIndex(line => line.includes(`uses: ${action}@`))
  if (at < 0) return null
  const depth = lines[at].search(/\S/)
  const step = [lines[at]]
  for (let next = at + 1; next < lines.length; next++) {
    const indent = lines[next].search(/\S/)
    if (indent >= 0 && indent <= depth) break
    step.push(lines[next])
  }
  return step.join('\n')
}

test('the Android SDK is asked for the packages it wants, not the action’s defaults', async () => {
  /* The build died in setup, before a line of this app was compiled:
     "Failed to find package 'tools'", and sdkmanager exit 1 takes the job with
     it. setup-android's default package list is "tools platform-tools", and
     `tools` — the old SDK Tools, long since replaced by the cmdline-tools the
     action installs for itself — has now been dropped from Google's SDK
     repository altogether.

     A default that names a package nobody can install any more is a default
     to stop taking, and the same removal will come for others: what this
     build needs is short, and it should say so. */
  const wrong = []
  for (const found of await workflowFiles()) {
    const file = path.relative(repoRoot, found)
    const step = stepFor(await readFile(found, 'utf8'), 'android-actions/setup-android')
    if (!step) continue
    const asked = /\n\s*packages:\s*(.*)/
      .exec(step)?.[1]
      ?.trim()
      .replace(/^['"]|['"]$/g, '')
    if (!asked) {
      wrong.push(`${file}: setup-android takes the action's own default package list`)
      continue
    }
    if (asked.split(/\s+/).includes('tools'))
      wrong.push(`${file}: setup-android still asks for 'tools', which Google has withdrawn`)
  }
  assert.deepEqual(wrong, [], wrong.join('\n'))
})
