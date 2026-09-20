import type { PlaceCredit } from '../../../places-about'

/* Who made the picture, and who wrote the words.
 *
 * Under the thing it is about, not in a footer somewhere else on the page. A
 * CC BY-SA photograph obliges us to name its photographer wherever it is
 * shown, and the version of this that put one line at the bottom of the card
 * was crediting the paragraph's author for the photograph.
 *
 * The two are deduplicated by their text, because a place whose picture and
 * article both came from Wikimedia under the same licence is one credit, not
 * the same sentence twice.
 *
 * Nothing renders when there is nothing to credit — and there is nothing to
 * credit exactly when there is nothing to show, because the pipeline refuses
 * to store a picture it cannot name.
 */
export default function PlaceCredits({
  credits,
  className = '',
}: {
  credits: readonly (PlaceCredit | null | undefined)[]
  className?: string
}) {
  const shown = credits.filter(
    (credit, at, all): credit is PlaceCredit =>
      Boolean(credit) && all.findIndex(other => other?.text === credit?.text) === at,
  )
  if (!shown.length) return null
  return (
    <p className={`acredit m-0 text-[10px] leading-snug text-faint ${className}`}>
      {shown.map((credit, at) => (
        <span key={credit.text}>
          {at > 0 && ' · '}
          {credit.sourceUrl ? (
            <a
              className="underline decoration-dotted"
              href={credit.sourceUrl}
              target="_blank"
              rel="noreferrer">
              {credit.text}
            </a>
          ) : (
            credit.text
          )}
        </span>
      ))}
    </p>
  )
}
