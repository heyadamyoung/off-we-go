import { useEffect, useMemo, useRef, useState } from 'react'
import { leaveTripPresence, updateTripPresence } from '../../../backend'
import type { Id, Person } from '../../../shared/model/types'

const heartbeatMs = 15_000

const newClientId = () => {
  try {
    return crypto.randomUUID()
  } catch {
    return `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`
  }
}

export default function useTripPresence(tripId: Id, family: Person[]) {
  const clientId = useRef(newClientId())
  const [viewerIds, setViewerIds] = useState<Id[]>([])

  useEffect(() => {
    let active = true
    const isHidden = () => document.visibilityState === 'hidden'
    const heartbeat = async () => {
      if (isHidden()) return
      try {
        const ids = await updateTripPresence(tripId, clientId.current)
        if (active && !isHidden()) setViewerIds(ids)
      } catch {
        if (active) setViewerIds([])
      }
    }
    const leave = () => {
      setViewerIds([])
      void leaveTripPresence(tripId, clientId.current).catch(() => {})
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') leave()
      else void heartbeat()
    }

    void heartbeat()
    const timer = window.setInterval(heartbeat, heartbeatMs)
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('pagehide', leave)
    return () => {
      active = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pagehide', leave)
      void leaveTripPresence(tripId, clientId.current).catch(() => {})
    }
  }, [tripId])

  return useMemo(() => {
    const people = new Map(family.filter(person => person.id).map(person => [person.id, person]))
    return viewerIds.map(id => people.get(id)).filter(Boolean) as Person[]
  }, [family, viewerIds])
}
