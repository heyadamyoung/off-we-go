import { useEffect, useRef, useState } from 'react'

/* Deleting is the one act with no undo, so it asks for commitment: press and
   hold while the red fills, let go early and nothing happens. A plain tap —
   the gesture that does everything else — can never take something away.
   Styling rides the .vdel recipe in styles.css. */
export default function HoldToDelete({
  onDelete,
  what = 'this',
}: {
  onDelete: () => void
  what?: string
}) {
  const [holding, setHolding] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const start = () => {
    if (timer.current) return
    setHolding(true)
    timer.current = setTimeout(() => {
      timer.current = null
      setHolding(false)
      onDelete()
    }, 650)
  }
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    setHolding(false)
  }
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )
  return (
    <button
      type="button"
      className={'vdel' + (holding ? ' holding' : '')}
      title={`Press and hold to delete ${what}`}
      aria-label={`Press and hold to delete ${what}`}
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onKeyDown={e => {
        if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) start()
      }}
      onKeyUp={cancel}
      onContextMenu={e => e.preventDefault()}>
      <span>Delete</span>
    </button>
  )
}
