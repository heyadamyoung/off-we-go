import { useRef } from 'react'
import { connectionGap, type Segment } from '../../../segments-core'
import SegmentCard from './segment-card'

/* The travel day read as a chain: legs in departure order, and between each
   pair the gap judging itself. The chain is the design thesis — competitors
   silo the modes; travel days are sequences of getting-there. */

export default function SegmentChain({
  segments,
  now,
  canEdit,
  onEdit,
  onShowGate,
  onAttach,
}: {
  segments: Segment[]
  now: number
  canEdit: boolean
  onEdit: (segment: Segment) => void
  /** taken by the Travel panel's header action; the chain itself never adds */
  onAdd: () => void
  onShowGate: (segment: Segment) => void
  onAttach: (segment: Segment, file: File) => void
}) {
  const picking = useRef<Segment | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  if (!segments.length) return null

  const verdictWord = { roomy: 'roomy', tight: 'tight', short: 'too short' } as const

  return (
    <section className="mb-4">
      <div className="flex flex-col gap-2">
        {segments.map((segment, index) => {
          const previous = segments[index - 1]
          const gap = previous ? connectionGap(previous, segment) : null
          return (
            <div key={segment.id} className="flex flex-col gap-2">
              {gap && gap.minutes > 0 && gap.minutes < 12 * 60 && (
                <div className="pl-2 text-[11px] text-muted">
                  ↳ {Math.floor(gap.minutes / 60) ? `${Math.floor(gap.minutes / 60)} h ` : ''}
                  {gap.minutes % 60} m to change —{' '}
                  <b className={gap.verdict === 'short' ? 'text-tight' : ''}>
                    {verdictWord[gap.verdict]}
                  </b>
                </div>
              )}
              <SegmentCard
                segment={segment}
                now={now}
                canEdit={canEdit}
                onEdit={onEdit}
                onShowGate={onShowGate}
                onAttach={target => {
                  picking.current = target
                  fileInput.current?.click()
                }}
              />
            </div>
          )
        })}
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="image/*,application/pdf"
        hidden
        onChange={event => {
          const file = event.target.files?.[0]
          if (file && picking.current) onAttach(picking.current, file)
          event.target.value = ''
        }}
      />
    </section>
  )
}
