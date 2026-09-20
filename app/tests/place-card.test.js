import assert from 'node:assert/strict'
import test from 'node:test'
import { cardFrom } from '../src/place-card-core.ts'

/* Which of three sources wins each part of a card.
 *
 * Worth stating because the precedence is not obvious and it used to live as
 * a chain of `||` inside a component, where the only way to know what a card
 * would show was to run one. */

const credit = { text: 'Jane · Commons · CC BY-SA 4.0', license: 'CC BY-SA 4.0' }
const said = { text: 'Wikipedia · CC BY-SA 4.0', license: 'CC BY-SA 4.0' }

const about = {
  status: 'ready',
  waiting: false,
  description: {
    text: 'Edinburgh Castle is a historic castle in Edinburgh.',
    sourceUrl: 'https://en.wikipedia.org/wiki/Edinburgh_Castle',
    attribution: said,
  },
  images: [
    { url: 'https://commons/x.jpg', thumbUrl: 'https://commons/x-t.jpg', attribution: credit },
  ],
}

test('what a card shows', async t => {
  await t.test('prefers what we found out over the legacy article', () => {
    const card = cardFrom({
      about,
      article: { image: 'https://old/pic.jpg', note: 'An older note.', source: 'https://old' },
    })
    assert.equal(card.picture, 'https://commons/x-t.jpg', 'the thumbnail, not the full file')
    assert.match(card.note, /^Edinburgh Castle is a historic castle/)
    assert.equal(card.source, 'https://en.wikipedia.org/wiki/Edinburgh_Castle')
    assert.deepEqual(card.credits, [credit, said], 'the picture’s first, then the words’')
  })

  /* A card that blanks and refills is worse than one that starts partly
     filled, so a caption already on screen is never replaced. */
  await t.test('never replaces a caption the pin already carried', () => {
    const card = cardFrom({ pinNote: 'What the pin said.', about })
    assert.equal(card.note, 'What the pin said.')
    assert.equal(card.picture, 'https://commons/x-t.jpg', 'but the better picture still wins')
  })

  await t.test('falls back to the article, then to the pin thumbnail', () => {
    const only = cardFrom({
      pinPicture: 'https://pin/thumb.jpg',
      article: { image: 'https://old/pic.jpg', note: 'An older note.', source: 'https://old' },
    })
    assert.equal(only.picture, 'https://old/pic.jpg')
    assert.equal(only.note, 'An older note.')

    const bare = cardFrom({ pinPicture: 'https://pin/thumb.jpg' })
    assert.equal(bare.picture, 'https://pin/thumb.jpg')
    assert.equal(bare.note, '')
  })

  /* The article is about the place; the website is sold by it. */
  await t.test('links the article above the website', () => {
    assert.equal(
      cardFrom({ about, website: 'https://edinburghcastle.scot' }).source,
      'https://en.wikipedia.org/wiki/Edinburgh_Castle',
    )
    assert.equal(
      cardFrom({ about: { ...about, description: null }, website: 'https://edinburghcastle.scot' })
        .source,
      'https://edinburghcastle.scot',
    )
  })

  await t.test('a place we know nothing about is a card with nothing extra', () => {
    const card = cardFrom({})
    assert.deepEqual(
      { picture: card.picture, note: card.note, source: card.source },
      {
        picture: '',
        note: '',
        source: '',
      },
    )
    assert.deepEqual(card.credits.filter(Boolean), [])
  })
})
