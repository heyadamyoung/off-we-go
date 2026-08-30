import Icon from '../../../shared/ui/icon'

const STOP_ICONS = ['pin', 'plane', 'bed', 'boat', 'museum', 'food', 'walk', 'camera']
const STOP_STATES = [['planned', 'Planned'], ['next', 'Up next'], ['now', 'Now'], ['done', 'Visited']]

function StopEditor({ draft, days, onField, onSave, onDelete, onMove, onLookUp, onClose, busy }: any) {
  const isNew = !draft.id
  return (
    <div className="editor">
      <div className="eh">
        <b>{isNew ? 'New stop' : 'Edit stop'}</b>
        <button onClick={onClose} title="Close"><Icon n="x" s={15} w={2} /></button>
      </div>

      {draft.src && (
        <div className="epic">
          <img src={draft.src} alt="" />
          <button title="Remove this picture" onClick={() => { onField('src', null); onField('sourceUrl', null) }}>
            <Icon n="x" s={13} w={2} />
          </button>
          {draft.sourceUrl && (
            <a href={draft.sourceUrl} target="_blank" rel="noopener noreferrer">Wikipedia</a>
          )}
        </div>
      )}

      <div className="eb">
        <label className="f">
          <span>Name</span>
          <input value={draft.name || ''} autoFocus placeholder="Rijksmuseum"
                 onChange={e => onField('name', e.target.value)} />
        </label>

        <div className="frow">
          <label className="f">
            <span>Day</span>
            <input list="wf-days" value={draft.day || ''} placeholder="Sat 5 Sep"
                   onChange={e => onField('day', e.target.value)} />
            <datalist id="wf-days">{days.map(d => <option key={d} value={d} />)}</datalist>
          </label>
          <label className="f">
            <span>Time</span>
            <input value={draft.time || ''} placeholder="09:30 – 12:30"
                   onChange={e => onField('time', e.target.value)} />
          </label>
        </div>

        <div className="frow">
          <label className="f">
            <span>Kind</span>
            <input value={draft.kind || ''} placeholder="Sight"
                   onChange={e => onField('kind', e.target.value)} />
          </label>
          <label className="f">
            <span>Icon</span>
            <div className="icons">
              {STOP_ICONS.map(n => (
                <button key={n} type="button" title={n}
                        className={(draft.icon || 'pin') === n ? 'on' : ''}
                        onClick={() => onField('icon', n)}>
                  <Icon n={n} s={15} />
                </button>
              ))}
            </div>
          </label>
        </div>

        <label className="f">
          <span>Status</span>
          <div className="seg">
            {STOP_STATES.map(([v, label]) => (
              <button key={v} type="button" className={(draft.status || 'planned') === v ? 'on' : ''}
                      onClick={() => onField('status', v)}>{label}</button>
            ))}
          </div>
        </label>

        <label className="f">
          <span>Note</span>
          <textarea rows={3} value={draft.note || ''} placeholder="What happened here?"
                    onChange={e => onField('note', e.target.value)} />
        </label>

        <p className="coords">
          <Icon n="pin" s={13} />
          {draft.lat.toFixed(5)}, {draft.lng.toFixed(5)}
          <em>{isNew ? 'click the map to move it' : 'drag the pin to move it'}</em>
        </p>

        <button className="lookup" onClick={onLookUp} disabled={busy}>
          <Icon n="search" s={14} />
          Fill in from Wikipedia
        </button>
      </div>

      <div className="ef">
        {!isNew && (
          <>
            <button className="ord" onClick={() => onMove(-1)} disabled={busy} title="Move earlier">
              <Icon n="chevl" s={14} w={2} />
            </button>
            <button className="ord" onClick={() => onMove(1)} disabled={busy} title="Move later">
              <Icon n="chev" s={14} w={2} />
            </button>
            <button className="del" onClick={onDelete} disabled={busy}>Delete</button>
          </>
        )}
        <button className="btn pri" onClick={onSave} disabled={busy || !(draft.name || '').trim()}>
          {busy ? 'Saving…' : isNew ? 'Add stop' : 'Save'}
        </button>
      </div>
    </div>
  )
}

export default StopEditor





