import Icon from '../../../shared/ui/icon'
import Img from '../../../shared/ui/img'
import Pane from '../../../shared/ui/pane'

function TimelineView({ stops, photos, byName, openViewer, onSelect, onClose }: any) {
  const days = [...new Set<any>(stops.map(s => s.day).filter(Boolean))]
  return (
    <Pane title="Timeline" sub="Every stop in order, with what everyone photographed along the way." onClose={onClose}>
      {days.map(d => (
        <div key={d}>
          <div className="tlday">{d}</div>
          <div className="tl">
            {stops.filter(s => s.day === d).map((s, i, arr) => {
              const here = photos.filter(p => p.stopId === s.id)
              return (
                <div key={s.id} className={'tlitem ' + s.status}>
                  <div className="tlax">
                    <div className="d">{s.status === 'done'
                      ? <Icon n="check" s={17} c="#fff" w={2.4} />
                      : <Icon n={s.icon} s={17} c={s.status === 'now' ? '#0a0c10' : 'currentColor'} />}</div>
                    {i < arr.length - 1 && <div className="ln" />}
                  </div>
                  <div className="tlbd">
                    <div className="hh">
                      <b>{s.name}</b><span>{s.time}</span>
                      {s.status === 'now' && <span className="chipnow">NOW</span>}
                      <button className="wbtn sm" onClick={() => onSelect(s.id)}>Show on map</button>
                    </div>
                    <p>{s.note}</p>
                    {here.length > 0 && (
                      <>
                        <div className="tlph">
                          {here.map((p, idx) => (
                            <button key={p.id} onClick={() => openViewer(here, idx)}><Img item={p} w={300} h={230} /></button>
                          ))}
                        </div>
                        <div className="tlwho">
                          {[...new Set<any>(here.map(p => p.by))].map(n => <img key={n} src={byName(n).avatar} alt="" loading="lazy" decoding="async" />)}
                          {[...new Set<any>(here.map(p => p.by))].join(', ')} · {here.length} photo{here.length === 1 ? '' : 's'}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </Pane>
  )
}

function PhotosView({ stops, photos, byName, openViewer, person, setPerson, onClose }: any) {
  const people = [...new Set<any>(photos.map(p => p.by))]
  const list = person ? photos.filter(p => p.by === person) : photos
  const ordered = [...list].reverse()
  return (
    <Pane title="Photos" sub={`${list.length} photo${list.length === 1 ? '' : 's'} from the trip so far, newest first.`}
          onClose={onClose}>
      <div className="filters">
        <button className={!person ? 'on' : ''} onClick={() => setPerson(null)}>Everyone</button>
        {people.map(n => (
          <button key={n} className={person === n ? 'on' : ''} onClick={() => setPerson(n)}>
            <img src={byName(n).avatar} alt="" loading="lazy" decoding="async" />{n}
          </button>
        ))}
      </div>
      <div className="masonry">
        {ordered.map((p, i) => {
          const stop = stops.find(s => s.id === p.stopId)
          return (
            <button className="tile" key={p.id} onClick={() => openViewer(ordered, i)}>
              <Img item={p} w={520} h={400} eager={i < 6} />
              <img className="av" src={byName(p.by).avatar} alt="" loading="lazy" decoding="async" />
              <div className="ov"><b>{p.caption}</b><span>{stop ? stop.name + ' · ' : ''}{p.when}</span></div>
            </button>
          )
        })}
      </div>
    </Pane>
  )
}

export { PhotosView, TimelineView }




