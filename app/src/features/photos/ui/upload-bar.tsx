import { useEffect, useRef, useState } from 'react'
import Icon from '../../../shared/ui/icon'
import { PlayBadge } from '../../../shared/ui/media-thumb'
import {
  countable,
  failed,
  furthest,
  measurable,
  overall,
  type Upload,
} from '../../../upload-queue-core'

/* How far the photographs have got.

   The old tray was a list in a corner that said "Uploading…" against every
   row and nothing about the batch — so twenty photographs on a hotel
   connection looked exactly like twenty photographs that had stopped. Worse,
   it sat under the gallery: add pictures from the Photos screen, which is
   where anybody would, and there was nothing on the screen at all.

   So: one bar, where every phone puts one. A line that fills, a count of the
   whole batch, and the list folded away behind a tap — because the list is
   what you want when something has gone wrong and noise the rest of the time.
   The bar goes when the last one lands; the photographs on the map say more
   than a tick would. */

/* The queue itself, not five pieces of it. A component handed what a hook
   returns cannot be wired up wrong, and the call site stays one line. */
export interface UploadQueue {
  uploads: Upload[]
  /** How many of this batch are already up, for "8 of 20". */
  finished: number
  tryAgain: (key: string) => void
  tryEveryFailure: () => void
  forget: (key: string) => void
}

interface UploadBarProps {
  queue: UploadQueue
  /** A panel covers the trip's own bottom chrome, so the bar can sit lower. */
  lowered?: boolean
}

export default function UploadBar({ queue, lowered }: UploadBarProps) {
  const {
    uploads,
    finished,
    tryAgain: onRetry,
    tryEveryFailure: onRetryAll,
    forget: onDismiss,
  } = queue
  const [open, setOpen] = useState(false)
  const broken = failed(uploads)
  const state = overall(uploads, finished)
  const going = state.total - state.done
  /* Only ever forwards. The measurement behind it is honest arithmetic over a
     queue that changes shape underneath it; the line somebody is watching is
     not the place to show that. */
  const drawn = useRef(0)
  drawn.current = furthest(drawn.current, state.fraction, uploads.length > 0)

  /* Opened by a failure rather than by a person, because a failure is the one
     time the list is the point. It stays open after that until they close it. */
  useEffect(() => {
    if (broken.length) setOpen(true)
  }, [broken.length])

  if (!uploads.length) return null

  const caption = going
    ? `Adding ${state.working} of ${state.total} ${countable(uploads)}`
    : `${broken.length} did not go up`
  /* A browser that will not give a size gets a bar that moves without
     claiming a number. Nought per cent for four minutes is a worse lie than
     no number at all. */
  const unknown = going > 0 && !measurable(uploads)

  return (
    <div
      /* Above the gallery, which covers the whole screen and used to cover
         this with it. --trip-1 already carries the home bar; the lowered
         anchor adds it directly, because a panel has hidden the chrome that
         offset was measured from. */
      className={
        'absolute inset-x-0 z-[40] px-3 sm:px-4 ' +
        (lowered
          ? 'bottom-[calc(0.75rem+env(safe-area-inset-bottom,0px))]'
          : 'bottom-[var(--trip-1)]')
      }
      role="status"
      aria-live="polite">
      <div className="sheet mx-auto w-full max-w-[440px] overflow-hidden rounded-2xl">
        <button
          className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left"
          aria-expanded={open}
          onClick={() => setOpen(value => !value)}>
          <span className="grid size-7 flex-none place-items-center">
            {going ? (
              <Spinner />
            ) : (
              <Icon n="x" s={14} className={broken.length ? 'text-danger' : 'text-muted'} />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-bold tracking-[-.01em]">
              {caption}
            </span>
            {broken.length > 0 && going > 0 && (
              <span className="block truncate text-[11px] text-muted">
                {broken.length} did not go up
              </span>
            )}
          </span>
          {broken.length > 0 && (
            <button
              className="mini mini-accent flex-none whitespace-nowrap"
              onClick={event => {
                event.stopPropagation()
                onRetryAll()
              }}>
              Try again
            </button>
          )}
          <Icon
            n="chev"
            s={14}
            className={'flex-none text-muted transition-transform ' + (open ? '-rotate-90' : '')}
          />
        </button>

        {/* The line itself, flush along the bottom edge of the header the way
            a download bar sits under a browser's own. */}
        <Track fraction={drawn.current} unknown={unknown} done={going === 0} />

        {open && (
          <ul className="m-0 flex max-h-[184px] list-none flex-col overflow-y-auto overscroll-contain p-1.5 pt-2">
            {uploads.map(upload => (
              <Row
                key={upload.key}
                upload={upload}
                onRetry={() => onRetry(upload.key)}
                onDismiss={() => onDismiss(upload.key)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

/* Three dots rather than a spinning ring: a ring beside a progress bar is two
   things saying the same thing, and one of them is wrong whenever the other
   is waiting on the server rather than on the line. */
function Spinner() {
  return (
    <span className="flex items-center gap-[3px]" aria-hidden="true">
      {[0, 1, 2].map(index => (
        <span
          key={index}
          className="size-1.5 animate-pulse rounded-full bg-accent"
          style={{ animationDelay: `${index * 0.18}s` }}
        />
      ))}
    </span>
  )
}

function Track({ fraction, unknown, done }: { fraction: number; unknown: boolean; done: boolean }) {
  return (
    <div
      className="relative h-[3px] w-full overflow-hidden bg-line"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      /* Absent, not zero, when the size is unknowable: a screen reader
         announcing "0 percent" for four minutes is the same lie. */
      aria-valuenow={unknown ? undefined : Math.round(fraction * 100)}>
      {unknown ? (
        <span className="absolute inset-y-0 w-1/3 animate-[slide_1.4s_ease-in-out_infinite] bg-accent" />
      ) : (
        <span
          className={
            'absolute inset-y-0 left-0 transition-[width] duration-300 ease-out ' +
            (done ? 'bg-muted' : 'bg-accent')
          }
          style={{ width: `${Math.max(2, Math.round(fraction * 100))}%` }}
        />
      )}
    </div>
  )
}

function Row({
  upload,
  onRetry,
  onDismiss,
}: {
  upload: Upload
  onRetry: () => void
  onDismiss: () => void
}) {
  const broken = upload.state === 'failed'
  const share =
    upload.state === 'uploading' && upload.total
      ? Math.min(1, (upload.sent ?? 0) / upload.total)
      : 0
  const note = broken
    ? upload.error
    : upload.state === 'retrying'
      ? upload.error
      : upload.state === 'waiting'
        ? 'Waiting its turn'
        : upload.total
          ? `${Math.round(share * 100)}%`
          : 'Uploading…'

  return (
    <li className="flex items-center gap-2 rounded-lg px-1.5 py-1">
      <span className="relative size-9 flex-none overflow-hidden rounded-lg bg-raised">
        {upload.preview ? (
          <img src={upload.preview} alt="" className="size-full object-cover" />
        ) : (
          /* A film whose opening frame would not decode has no tile of its
             own; the camcorder says what is going up rather than a broken
             picture would. */
          <span className="grid size-full place-items-center text-faint">
            <Icon n={upload.kind === 'video' ? 'video' : 'camera'} s={14} />
          </span>
        )}
        {/* A film reads as a film here too, not just in the gallery. */}
        {upload.kind === 'video' && upload.preview && <PlayBadge size={16} />}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <b className="truncate text-xs font-semibold">{upload.name}</b>
        <span className={'truncate text-[11px] ' + (broken ? 'text-danger' : 'text-faint')}>
          {note}
        </span>
        {upload.state === 'uploading' && (
          /* relative/absolute on purpose: the indeterminate bar is animated by
             `left`, which a statically positioned element ignores — it would
             sit still at a third of the width, looking stuck. */
          <span className="relative block h-[2px] w-full overflow-hidden rounded-full bg-line">
            <span
              className={
                'absolute inset-y-0 bg-accent ' +
                (upload.total
                  ? 'left-0 transition-[width] duration-300 ease-out'
                  : 'w-1/3 animate-[slide_1.4s_ease-in-out_infinite]')
              }
              style={upload.total ? { width: `${Math.max(3, Math.round(share * 100))}%` } : {}}
            />
          </span>
        )}
      </span>
      {broken && (
        <>
          <button className="mini flex-none" onClick={onRetry}>
            Retry
          </button>
          <button
            className="grid size-7 flex-none place-items-center rounded-lg text-faint
                       hover:bg-raised2 hover:text-ink"
            aria-label={`Forget ${upload.name}`}
            onClick={onDismiss}>
            <Icon n="x" s={12} />
          </button>
        </>
      )}
    </li>
  )
}
