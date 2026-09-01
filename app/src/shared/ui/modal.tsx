import { useEffect, type ReactNode } from 'react'
import Icon from './icon'

interface ModalProps {
  title: ReactNode
  onClose: () => void
  children: ReactNode
  className?: string
}

function Modal({ title, onClose, children, className }: ModalProps) {
  useEffect(() => {
    const k = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="scrim" onClick={onClose}>
      <div className={'modal' + (className ? ` ${className}` : '')} onClick={e => e.stopPropagation()}>
        <div className="mh"><b>{title}</b><button onClick={onClose}><Icon n="x" s={17} w={2} /></button></div>
        {children}
      </div>
    </div>
  )
}

export default Modal




