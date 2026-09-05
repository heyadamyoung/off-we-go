import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import fsPromises from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  bboxOf,
  indexTar,
  keepsTile,
  packSlices,
  parseTarHeader,
  tileBounds,
  tileFromPath,
} from '../src/routing-pack.js'

/* Verified against a real archive built by the production image: Andorra
   (1.5E, 42.5N) produced exactly 0/003/015, 1/047/701 and 2/000/763/926. */
test('tile ids and paths match the engine’s own grid', () => {
  assert.deepEqual(tileFromPath('valhalla_tiles/2/000/763/926.gph'), { level: 2, tileId: 763926 })
  assert.deepEqual(tileFromPath('1/047/701.gph'), { level: 1, tileId: 47701 })
  assert.deepEqual(tileFromPath('0/003/015.gph'), { level: 0, tileId: 3015 })
  assert.equal(tileFromPath('valhalla_tiles/2/000/763/926.gph.index'), null)
  assert.equal(tileFromPath('valhalla.json'), null)

  const andorraL2 = tileBounds(2, 763926)
  assert.ok(andorraL2.west <= 1.5 && 1.5 <= andorraL2.east)
  assert.ok(andorraL2.south <= 42.5 && 42.5 <= andorraL2.north)
  const andorraL0 = tileBounds(0, 3015)
  assert.ok(andorraL0.west <= 1.5 && 1.5 <= andorraL0.east)
  assert.ok(andorraL0.south <= 42.5 && 42.5 <= andorraL0.north)
})

test('a pack keeps the local tiles near the trip and the coarse corridor', () => {
  const amsterdam = bboxOf([
    [4.88, 52.36],
    [4.9, 52.38],
  ])
  // Amsterdam level-2 tile: row 569, col 739 → 820099
  assert.equal(keepsTile('2/000/820/099.gph', amsterdam), true)
  // Andorra's local roads are 1000 km away — never in an Amsterdam pack.
  assert.equal(keepsTile('2/000/763/926.gph', amsterdam), false)
  // But its level-0 highways would join a pack whose bbox spans that far.
  const span = bboxOf([
    [4.88, 52.36],
    [1.5, 42.5],
  ])
  assert.equal(keepsTile('0/003/015.gph', span), true)
})

test('the tar index and pack slices survive a crafted archive round-trip', async () => {
  const header = (name, size) => {
    const block = Buffer.alloc(512)
    block.write(name, 0)
    block.write(size.toString(8).padStart(11, '0') + ' ', 124)
    block.write('0', 156)
    // ustar magic keeps strict readers happy
    block.write('ustar', 257)
    let sum = 0
    block.fill(' ', 148, 156)
    for (const b of block) sum += b
    block.write(sum.toString(8).padStart(6, '0') + '\0 ', 148)
    return block
  }
  const entry = (name, data) =>
    Buffer.concat([
      header(name, data.length),
      data,
      Buffer.alloc((512 - (data.length % 512)) % 512),
    ])
  const near = Buffer.from('near-tile-bytes')
  const far = Buffer.from('far-tile-bytes-far-away')
  const tar = Buffer.concat([
    entry('valhalla_tiles/2/000/820/099.gph', near),
    entry('valhalla_tiles/2/000/763/926.gph', far),
    entry('valhalla.json', Buffer.from('{}')),
    Buffer.alloc(1024),
  ])
  const dir = await mkdtemp(path.join(tmpdir(), 'pack-'))
  const file = path.join(dir, 'tiles.tar')
  await writeFile(file, tar)

  const entries = await indexTar(fsPromises, file)
  assert.equal(entries.length, 3)
  assert.equal(parseTarHeader(tar).name, 'valhalla_tiles/2/000/820/099.gph')

  const amsterdam = bboxOf([
    [4.88, 52.36],
    [4.9, 52.38],
  ])
  const pack = packSlices(entries, amsterdam)
  assert.equal(pack.kept.length, 1)
  assert.equal(pack.kept[0].name, 'valhalla_tiles/2/000/820/099.gph')
  // header (512) + padded data (512) + the closing zero blocks
  assert.equal(pack.bytes, 512 + 512 + 1024)
  const slice = tar.subarray(pack.kept[0].start, pack.kept[0].end + 1)
  assert.equal(parseTarHeader(slice).name, 'valhalla_tiles/2/000/820/099.gph')
  assert.ok(slice.includes(near))
})
