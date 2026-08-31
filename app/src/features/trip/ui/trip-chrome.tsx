import { memo, useEffect, useRef, useState } from 'react'
import Icon from '../../../shared/ui/icon'
import Img from '../../../shared/ui/img'
import { ALL_DAYS } from '../../../shared/constants/trip'

const LivePill = memo(function LivePill({ resetKey }: any) {
  const [ago, setAgo] = useState(0)
  useEffect(() => { setAgo(0) }, [resetKey])
  useEffect(() => {
    const id = setInterval(() => setAgo(a => a + 1), 1000)
    return () => clearInterval(id)
  }, [])
  /* Capped at 99 minutes and rendered in a fixed-width slot. The label goes
     "now" then "5s" then "12m", and each is a different width, so every tick
     nudged the People button sideways. */
  const mins = Math.min(99, Math.floor(ago / 60))
  const label = ago < 5 ? 'now' : ago < 60 ? `${ago}s` : `${mins}m`
  return <div className="tlive"><span className="d" />LIVE<span className="n">{label}</span></div>
})

const PresenceFaces = memo(function PresenceFaces({ viewers = [] }: any) {
  if (!viewers.length) return null
  const shown = viewers.slice(0, 3)
  const names = viewers.map(person => person.name).join(', ')
  return (
    <div className="tpresence" aria-label={`Viewing now: ${names}`}>
      {shown.map(person => person.avatar
        ? <img key={person.id || person.name} src={person.avatar} alt=""
               title={`${person.name} is viewing now`} />
        : <span key={person.id || person.name} className="ini"
                title={`${person.name} is viewing now`}>{(person.name || '?')[0]}</span>)}
      {viewers.length > shown.length && <span className="more">+{viewers.length - shown.length}</span>}
    </div>
  )
})

const Ticker = memo(function Ticker({ trip, km, doneCount, stopCount, photoCount, nowStop, nextStop,
                                     liveKey, onPeople, tab, setTab, onUpload, theme, onToggleTheme,
                                     sunPhase, canEdit, editing, onToggleEdit, me, onSignOut,
                                     attractionsOn, onToggleAttractions, viewers }: any) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menuOpen) return
    const closeFromOutside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const closeFromKeyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('pointerdown', closeFromOutside)
    document.addEventListener('keydown', closeFromKeyboard)
    return () => {
      document.removeEventListener('pointerdown', closeFromOutside)
      document.removeEventListener('keydown', closeFromKeyboard)
    }
  }, [menuOpen])

  const chooseMenuAction = (action: () => void) => {
    setMenuOpen(false)
    action()
  }
  const Item = ({ children, hot = false }: any) => <><span className="dot">·</span><span className={hot ? 'hot' : ''}>{children}</span></>
  return (
    <header className="ticker">
      <div className="tmenu" ref={menuRef}>
        <button className="tlogo" type="button" aria-label="Open menu" aria-haspopup="menu"
                aria-expanded={menuOpen} onClick={() => setMenuOpen(open => !open)}>
          <span className="mk brand"><img src="/wayfare-icon.png" alt="" /></span>
          <span className="wm">Wayfare</span>
        </button>
        {menuOpen && (
          <div className="tmenu-pop" role="menu" aria-label="Wayfare menu">
            <div className="tmenu-account">
              <span>{me?.avatar
                ? <img src={me.avatar} alt="" />
                : (me?.name || 'You').slice(0, 1).toUpperCase()}</span>
              <div><small>Signed in as</small><b>{me?.name || 'You'}</b></div>
            </div>
            <button type="button" role="menuitem" onClick={() => chooseMenuAction(onPeople)}>
              <Icon n="users" s={16} />People
            </button>
            <button type="button" role="menuitem" onClick={() => chooseMenuAction(onUpload)}>
              <Icon n="camera" s={16} />Add a photo
            </button>
            {onSignOut && (
              <button className="signout" type="button" role="menuitem"
                      onClick={() => chooseMenuAction(onSignOut)}>
                <Icon n="logout" s={16} />Sign out
              </button>
            )}
          </div>
        )}
      </div>
      <div className="tflow">
<span className="crew">{(trip.crew || '').toUpperCase()}</span>
        <Item>{trip.title}</Item>
        {trip.dates ? <Item hot>{trip.dates}</Item> : null}
        <Item>{km.toFixed(1)} km walked</Item>
        <Item>{doneCount} of {stopCount} stops</Item>
        <Item>{photoCount} photos</Item>
        {nowStop && <Item hot>NOW AT {(nowStop.name || '').toUpperCase()}</Item>}
        {nextStop && <Item>next: {nextStop.name}</Item>}
      </div>
      <div className="tright">
        <nav className="tnav">
          {[['map', 'map'], ['timeline', 'list'], ['photos', 'grid'],
            ['sights', 'star'], ['family', 'users']].map(([k, ic]) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)} title={k}>
              <Icon n={ic} s={15} />
            </button>
          ))}
        </nav>
        {canEdit && (
          <button className={'tbtn ghost' + (editing ? ' on' : '')} onClick={onToggleEdit}
                  title={editing ? 'Done editing' : 'Edit the itinerary'}>
            <Icon n={editing ? 'check' : 'edit'} s={15} />
          </button>
        )}
        <button className={'tbtn ghost pref attr' + (attractionsOn ? ' on' : '')} onClick={onToggleAttractions}
                title={attractionsOn ? 'Hide attractions on the map' : 'Show attractions on the map'}>
          <Icon n="pin" s={15} />
        </button>
        <button className="tbtn ghost" onClick={onUpload} title="Add a photo"><Icon n="camera" s={15} /></button>
        <button className="tbtn ghost pref theme" onClick={onToggleTheme}
                title={sunPhase ? `Theme · the map is following ${sunPhase} where the family is`
                                : 'Theme'}>
          <Icon n={theme === 'dark' ? 'sun' : 'moon'} s={15} />
        </button>
        <LivePill resetKey={liveKey} />
        <PresenceFaces viewers={viewers} />
        <button className="tbtn hot people-action" onClick={onPeople} title="People" aria-label="People">
          <Icon n="users" s={14} c="#0a0c10" w={2.2} /><span className="lbl">People</span>
          {viewers?.length ? <span className="pcnt" aria-hidden="true">{viewers.length}</span> : null}
        </button>
      </div>
    </header>
  )
})

const HeroCard = memo(function HeroCard({ stop, photos, onClose, openViewer, toast }: any) {
  const here = photos.filter(p => p.stopId === stop.id)
  const label = stop.status === 'now' ? 'Happening now' : stop.status === 'done' ? 'Visited'
              : stop.status === 'next' ? 'Up next' : 'Planned'
  return (
    <div className="herocard">
      <Img className="hero" item={stop} w={800} h={400} eager />
      <button className="x" onClick={onClose}><Icon n="x" s={15} c="#fff" w={2} /></button>
      <div className="bd">
        <div className="ey"><span>{label}</span>
          <em>{[stop.day, stop.time].filter(Boolean).join(' · ')}</em></div>
        <h2>{stop.name}</h2>
        <p>{stop.note}</p>
        {here.length > 0 && (
          <div className="thumbrow">
            {here.slice(0, 4).map((p, i) => (
              <button key={p.id} onClick={() => openViewer(here, i)}><Img item={p} w={200} h={160} /></button>
            ))}
            {here.length > 4 && (
              <button className="rest" onClick={() => openViewer(here, 4)}>+{here.length - 4}</button>
            )}
          </div>
        )}
        <div className="btns">
          <button className="wbtn hot" disabled={!here.length} onClick={() => openViewer(here, 0)}>
            <Icon n="camera" s={15} c="#0a0c10" w={2.2} />
            {here.length ? `See ${here.length} photo${here.length === 1 ? '' : 's'}` : 'No photos yet'}
          </button>
          <a className="wbtn" title="Open in Google Maps" target="_blank" rel="noopener noreferrer"
             href={`https://www.google.com/maps/search/?api=1&query=${stop.lat},${stop.lng}`}>
            <Icon n="map" s={16} />
          </a>
          <button className="wbtn" onClick={() => toast('Saved to favourites')}><Icon n="heart" s={16} /></button>
          <button className="wbtn" onClick={() => toast('Note sent to the family')}><Icon n="send" s={16} /></button>
        </div>
      </div>
    </div>
  )
})

const Filmstrip = memo(function Filmstrip({ stops, photos, byName, selected, onSelect, day, setDay,
                                            days, openViewer, query, setQuery }: any) {
  return (
    <div className="filmstrip">
      <div className="fh">
        <div className="fdays">
          <button className={day === ALL_DAYS ? 'on' : ''} onClick={() => setDay(ALL_DAYS)}>ALL DAYS</button>
          {days.map(d => (
            <button key={d} className={day === d ? 'on' : ''} onClick={() => setDay(d)}>{d.toUpperCase()}</button>
          ))}
        </div>
        <label className="fsearch">
          <Icon n="search" s={14} c="var(--ink3)" />
          <input value={query} placeholder="Search stops and captions"
                 onChange={e => setQuery(e.target.value)} />
          {query && <button onClick={() => setQuery('')} title="Clear"><Icon n="x" s={13} w={2} /></button>}
        </label>
      </div>
      <div className="frow">
        {stops.map((s, ci) => {
          const here = photos.filter(p => p.stopId === s.id)
          const cover = here[0] || s
          return (
            <div key={s.id} className={'fcard' + (selected === s.id ? ' on' : '') + (s.status === 'now' ? ' now' : '')}
                 onClick={() => onSelect(s.id)}>
              <div className="ph">
                <Img item={cover} w={420} h={220} eager={ci < 4} />
                {here.length > 0 && (
                  <button className="open" onClick={e => { e.stopPropagation(); openViewer(here, 0) }}
                          title={`Open ${here.length} photo${here.length === 1 ? '' : 's'}`}>
                    <Icon n="expand" s={14} c="#fff" w={2} />
                  </button>
                )}
                {here.length > 0 && <img className="av" src={byName(here[0].by).avatar} alt="" loading="lazy" decoding="async" />}
                {s.status === 'now' && <span className="nw">NOW</span>}
              </div>
              <div className="t">
                <b>{s.name}</b>
                {/* A stop added from the map may have no day or time yet, and the
                    old hardcoded "Sat" special case crashed on the first one. */}
                <span>{[s.day, s.time].filter(Boolean).join(' · ') || 'No time set'}
                  {here.length ? ` · ${here.length} photo${here.length === 1 ? '' : 's'}` : ''}</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
})

export { Filmstrip, HeroCard, Ticker }

