import { useCallback, useEffect, useState } from 'react'
import { functionsUrl, issuePairCode } from '../../../backend'
import { isNativeApp, mobilePlatform } from '../../../mobile'
import type { TrackerState } from '../../../mobile-tracking-core'
import { pairCodeLifeWords, spellPairCode } from '../../../pair-code-core'
import Icon from '../../../shared/ui/icon'
import { appErrorMessage } from '../../../user-messages-core'
import type { Device, PairCode, Toast } from '../../../shared/model/types'

/* The card that sets a phone up: six characters to type on the phone that
   will share, or a button when that phone is this one. The code is asked
   for when the card opens and again on request; each one retires the last,
   and the quarter hour it lives is said. The raw token stays behind an
   Advanced fold for people bringing their own tracker app. */

const PAIR_PATH = '/pair'

export default function SetupCard({
  tripId,
  card,
  toast,
  tracking,
  onEnable,
  onClose,
}: {
  tripId: string
  card: Device
  toast: Toast
  tracking: TrackerState
  onEnable: (phone: Device) => Promise<void>
  onClose: () => void
}) {
  const [code, setCode] = useState<PairCode | null>(null)
  const [asking, setAsking] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const sayShareFailed = (error: unknown) =>
    toast(appErrorMessage(error, 'share-location'), 'error')
  const copy = (label: string, value: string) =>
    navigator.clipboard
      ?.writeText(value)
      .then(() => toast(`${label} copied`))
      .catch(error => toast(appErrorMessage(error, 'copy'), 'error'))
  const trackUrl = `${functionsUrl}/track`
  const pairUrl = `${typeof window === 'undefined' ? '' : window.location.origin}${PAIR_PATH}`

  const ask = useCallback(async () => {
    setAsking(true)
    try {
      setCode(await issuePairCode(tripId, String(card.id)))
    } catch (error) {
      toast(appErrorMessage(error, 'add-phone'), 'error')
    } finally {
      setAsking(false)
    }
  }, [tripId, card.id, toast])

  useEffect(() => {
    ask()
  }, [ask])
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(tick)
  }, [])

  const life = code ? pairCodeLifeWords(code.expiresAt, now) : null
  /* The token to share this phone with: the code's fresh one once it is
     here, the one the phone was made with until then. */
  const token = code?.token ?? String(card.token || '')
  const mine = tracking?.deviceId === card.id && tracking.status === 'tracking'

  const Row = ({ k, v }: { k: string; v: string }) => (
    <div className="grid grid-cols-[110px_1fr_auto] items-center gap-2">
      <span className="text-[11px] text-faint">{k}</span>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: click-to-copy is a convenience; the Copy button beside it is the accessible path */}
      <code
        className="min-w-0 cursor-copy break-all rounded-lg border border-line bg-raised px-2 py-1.5
                       font-mono text-[11px] leading-snug text-ink"
        onClick={() => copy(k, v)}
        title="Click to copy">
        {v}
      </code>
      <button
        className="grid size-9 place-items-center rounded-lg border border-line bg-raised"
        title={`Copy ${k}`}
        onClick={() => copy(k, v)}>
        <Icon n="copy" s={14} />
      </button>
    </div>
  )

  return (
    <div className="surface setupcard flex flex-col gap-2.5 p-3.5">
      <b className="text-sm font-extrabold tracking-[-.01em]">{card.name} — set-up</b>

      <em className="text-[11px] font-extrabold uppercase not-italic tracking-[.06em] text-accent">
        On the phone that will share
      </em>
      <div className="flex items-center gap-3">
        <output
          className="paircode rounded-xl border border-line bg-canvas px-4 py-2.5 font-mono text-[26px]
                        font-extrabold tracking-[.12em] text-ink"
          aria-label="Pairing code">
          {code ? spellPairCode(code.code) : asking ? '· · ·' : '—'}
        </output>
        <div className="flex min-w-0 flex-col gap-1">
          <span className="pairlife text-[11px] text-muted">
            {code
              ? life
                ? `Good for ${life}`
                : 'This code has expired — ask for a new one'
              : asking
                ? 'Asking for a code…'
                : 'No code yet'}
          </span>
          <button className="mini self-start" onClick={ask} disabled={asking}>
            New code
          </button>
        </div>
      </div>
      <p className="hint">
        Open <b className="text-ink">{pairUrl.replace(/^https?:\/\//, '')}</b> on that phone and
        type the code. The Off We Go app keeps sharing while the screen is locked; a browser shares
        only while the page is open. Each new code retires the one before it.
      </p>

      <em className="text-[11px] font-extrabold uppercase not-italic tracking-[.06em] text-accent">
        Or use this {isNativeApp ? 'phone' : 'browser'}
      </em>
      <p className="hint">
        {isNativeApp
          ? mobilePlatform === 'android'
            ? 'Allow precise location and notifications so sharing continues while the screen is locked.'
            : 'Choose Allow While Using App, then approve Always Allow when iOS asks, so fixes continue while the screen is locked.'
          : 'The browser will ask for your location. Sharing runs while this page is open, and stops when it is closed.'}
      </p>
      <div>
        <button
          className="btn btn-accent"
          disabled={tracking?.status === 'starting' || !token}
          onClick={() => onEnable({ ...card, token }).catch(sayShareFailed)}>
          {mine
            ? 'Sharing from here'
            : `Share this ${isNativeApp ? "phone's" : "browser's"} location`}
        </button>
      </div>

      <details>
        <summary className="cursor-pointer text-[11px] font-bold text-faint">
          Advanced — bring your own tracker app
        </summary>
        <div className="mt-2.5 flex flex-col gap-2">
          <Row k="Device token" v={token} />
          <Row k="Server URL" v={trackUrl} />
          <p className="hint">
            Traccar Client, OwnTracks and GPSLogger all work: post to{' '}
            <code className="break-all">{trackUrl}?id=</code>token, every 30 seconds, high accuracy.
          </p>
        </div>
      </details>
      <div>
        <button className="mini" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  )
}
