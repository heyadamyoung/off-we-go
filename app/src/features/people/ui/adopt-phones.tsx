import { useEffect, useState } from 'react'
import { adoptDevice, listAdoptableDevices, listDevices } from '../../../backend'
import type { Device, Toast } from '../../../shared/model/types'

/* Phones the user registered on OTHER trips they edit. A token is a
   registration, so a phone keeps posting to the trip that minted it —
   faithfully, invisibly, to the wrong map. The night this shipped, the
   owner's own phone had been narrating an old trip for days. One tap
   brings the phone here, along with its last day of positions. */

export default function AdoptPhones({
  tripId,
  toast,
  onChange,
}: {
  tripId: string
  toast: Toast
  onChange: (phones: Device[]) => void
}) {
  const [elsewhere, setElsewhere] = useState<
    Array<{ id: string; name: string; tripTitle: string }>
  >([])
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    listAdoptableDevices(tripId)
      .then(setElsewhere)
      .catch(() => {})
  }, [tripId])

  if (!elsewhere.length) return null
  return (
    <div className="mt-3 rounded-xl border border-line bg-raised2 p-3">
      <div className="text-[10px] font-bold uppercase tracking-[.08em] text-faint">
        Phones on your other trips
      </div>
      <p className="hint mt-1">
        A phone shares its location with the trip it was set up on. Bring one here and its fixes —
        including the last day of them — follow.
      </p>
      <div className="mt-2 flex flex-col gap-1.5">
        {elsewhere.map(phone => (
          <div key={phone.id} className="flex items-center gap-2 text-xs">
            <b>{phone.name}</b>
            <span className="text-muted">on {phone.tripTitle || 'another trip'}</span>
            <button
              className="mini ml-auto"
              disabled={busy === phone.id}
              onClick={async () => {
                setBusy(phone.id)
                try {
                  const moved = await adoptDevice(tripId, phone.id)
                  toast(
                    `${phone.name} now shares with this trip` +
                      (moved.movedPositions ? ` — ${moved.movedPositions} fixes came along` : ''),
                  )
                  setElsewhere(current => current.filter(p => p.id !== phone.id))
                  onChange(await listDevices(tripId))
                } catch {
                  toast('That phone could not be moved', 'error')
                } finally {
                  setBusy(null)
                }
              }}>
              Bring it here
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
