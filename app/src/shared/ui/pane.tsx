import type { ReactNode } from 'react'
import Icon from './icon'

interface PaneProps {
  title: ReactNode
  sub?: ReactNode
  onClose: () => void
  actions?: ReactNode
  children: ReactNode
}

function Pane({ title, sub, onClose, actions, children }: PaneProps) {
  return (
    <div className="pane">
      <div className="paneIn">
        <div className="paneHd">
          <div><h1>{title}</h1><p>{sub}</p></div>
          <div className="paneActs">{actions}
            <button className="wbtn" onClick={onClose}><Icon n="x" s={16} w={2} />Back to map</button></div>
        </div>
        {children}
      </div>
    </div>
  )
}

export default Pane




