import Icon from '../../../shared/ui/icon'
import { failed, type Upload } from '../../../upload-queue-core'

/* What is still going up, in the corner, out of the way. Uploading a
   photograph should not hold the screen: the tray says what is happening and
   the trip carries on underneath it. */
export default function UploadTray(
  { uploads, onRetry, onDismiss }:
  { uploads: Upload[]; onRetry: (key: string) => void; onDismiss: (key: string) => void },
) {
  if (!uploads.length) return null
  const going = uploads.length - failed(uploads).length

  return (
    <div className="sheet absolute bottom-[var(--trip-2)] left-4 z-[9] w-[min(300px,calc(100%-2rem))]
                    overflow-hidden rounded-2xl sm:bottom-[var(--trip-1)]"
         role="status" aria-live="polite">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-[12px] text-muted">
        {going > 0 && <span className="size-2 animate-pulse rounded-full bg-accent" />}
        {going > 0
          ? `Adding ${going} photo${going === 1 ? '' : 's'}…`
          : `${failed(uploads).length} did not go up`}
      </div>
      <ul className="m-0 flex max-h-[168px] list-none flex-col gap-1 overflow-y-auto p-1.5">
        {uploads.map(upload => (
          <li key={upload.key} className="flex items-center gap-2.5 rounded-lg px-1.5 py-1">
            {upload.preview
              ? <img src={upload.preview} alt="" className="size-9 flex-none rounded-md object-cover" />
              : <span className="grid size-9 flex-none place-items-center rounded-md bg-raised text-faint">
                  <Icon n="camera" s={14} />
                </span>}
            <span className="flex min-w-0 flex-1 flex-col">
              <b className="truncate text-[12px] font-semibold">{upload.name}</b>
              <span className="truncate text-[11px] text-faint">
                {upload.state === 'failed' ? upload.error : 'Uploading…'}
              </span>
            </span>
            {upload.state === 'failed' && (
              <>
                <button className="mini" onClick={() => onRetry(upload.key)}>Retry</button>
                <button className="grid size-7 flex-none place-items-center rounded-lg text-faint
                                   hover:bg-raised2 hover:text-ink"
                        aria-label={`Forget ${upload.name}`} onClick={() => onDismiss(upload.key)}>
                  <Icon n="x" s={12} />
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
