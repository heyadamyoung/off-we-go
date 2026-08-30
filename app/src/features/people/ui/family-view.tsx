import Icon from '../../../shared/ui/icon'
import Pane from '../../../shared/ui/pane'

function FamilyView({ family, photos, onClose, onInvite }: any) {
  const travelling = family.filter(f => f.role === 'Travelling').length
  const following = family.length - travelling
  const words = n => ['none', 'one', 'two', 'three', 'four', 'five', 'six'][n] ?? String(n)
  const sub = following
    ? `${words(travelling)} on the road, ${words(following)} following from home.`
    : `${words(travelling)} on the road.`
  return (
    <Pane title="Family" sub={sub[0].toUpperCase() + sub.slice(1)} onClose={onClose}
          actions={<button className="wbtn hot" onClick={onInvite}>
            <Icon n="share" s={15} c="#0a0c10" w={2.2} />Invite someone</button>}>
      <div className="people">
        {family.map(f => {
          const n = photos.filter(p => p.by === f.name).length
          return (
            <div className="person" key={f.id}>
              <img src={f.avatar} alt="" loading="lazy" decoding="async" />
              <div><b>{f.name}</b><span>{f.role}</span></div>
              <div className="n">{f.role === 'Travelling' ? `${n} photo${n === 1 ? '' : 's'}` : 'Viewer'}</div>
            </div>
          )
        })}
      </div>
    </Pane>
  )
}

export default FamilyView





