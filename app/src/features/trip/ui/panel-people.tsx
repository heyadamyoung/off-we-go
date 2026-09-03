import { Link } from '@tanstack/react-router'
import type { Person, TripPhoto } from '../../../shared/model/types'

const ROLE: Record<string, string> = { owner: 'Owner', editor: 'Traveller', viewer: 'Following' }

/* Two groups, because the difference matters: people on the road can add to the
   trip, people at home can only watch it. */
export default function PeopleList({
  people,
  photos,
  viewers = [],
}: {
  people: Person[]
  photos: TripPhoto[]
  viewers?: Person[]
}) {
  const viewing = new Set(viewers.map(person => person.id))
  const travelling = people.filter(person => person.memberRole !== 'viewer')
  const following = people.filter(person => person.memberRole === 'viewer')
  const counts = new Map<string, number>()
  for (const photo of photos) counts.set(photo.by, (counts.get(photo.by) || 0) + 1)

  const card = (person: Person) => {
    const taken = counts.get(person.name) || 0
    const travelling = person.memberRole !== 'viewer'
    return (
      <div
        key={person.id || person.name}
        className="surface mx-1 mt-1 flex items-center gap-3 rounded-xl p-3">
        <span className={'avatar size-9 text-sm ' + (travelling ? 'bg-[#5B8DEF]' : 'plain')}>
          {person.avatar ? (
            <img src={person.avatar} alt="" />
          ) : (
            (person.name || '?')[0].toUpperCase()
          )}
        </span>
        <div className="min-w-0 flex-1">
          <b className="block text-sm">
            {person.handle ? (
              <Link to="/users/$handle" params={{ handle: person.handle }}>
                {person.name}
              </Link>
            ) : (
              person.name
            )}
          </b>
          <span className="text-xs text-muted">
            {[
              person.handle ? `@${person.handle}` : null,
              travelling ? 'travelling' : 'following from home',
              taken ? `${taken} photo${taken === 1 ? '' : 's'}` : null,
              viewing.has(person.id) ? 'viewing now' : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </div>
        <span
          className={
            'rounded-lg border px-2 py-1 text-[11px] font-bold ' +
            (travelling
              ? 'border-accent-soft bg-accent-soft text-accent'
              : 'border-line text-faint')
          }>
          {ROLE[person.memberRole || ''] || 'Following'}
        </span>
      </div>
    )
  }

  const group = (label: string, list: Person[], empty: string) => (
    <>
      <div className="px-4 pb-1 pt-3.5 text-[11px] font-bold uppercase tracking-[.1em] text-faint">
        {label}
      </div>
      {list.length ? list.map(card) : <p className="hint px-4">{empty}</p>}
    </>
  )

  return (
    <>
      {group('On the road', travelling, 'Nobody is marked as travelling yet.')}
      {group('Following', following, 'Nobody is following along yet.')}
      <p className="hint px-4 pt-3.5">
        Everyone signs in, including people just following along. Access comes from the invitation,
        not from the link.
      </p>
    </>
  )
}
