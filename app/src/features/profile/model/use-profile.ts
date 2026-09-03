import { useCallback, useEffect, useState } from 'react'
import { loadMyProfile, updateMe, uploadAvatar } from '../../../backend'
import { appErrorMessage } from '../../../user-messages-core'
import { useToast } from '../../../shared/ui/toast'
import { readPreferences, type Preferences } from '../../../preferences-core'
import type { MyProfile } from '../../../shared/model/types'

export interface ProfileState {
  profile: MyProfile | null
  preferences: Preferences
  loading: boolean
  error: Error | null
  saving: boolean
  reload: () => void
  save: (changes: Partial<MyProfile>, said?: string) => Promise<void>
  savePreferences: (next: Preferences) => Promise<void>
  saveAvatar: (file: File) => Promise<void>
}

export default function useProfile(): ProfileState {
  const notify = useToast()
  const [profile, setProfile] = useState<MyProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [attempt, setAttempt] = useState(0)

  const reload = useCallback(() => setAttempt(value => value + 1), [])

  useEffect(() => {
    let alive = true
    setError(null)
    loadMyProfile()
      .then(value => {
        if (alive) {
          setProfile(value)
          setLoading(false)
        }
      })
      .catch((caught: unknown) => {
        if (!alive) return
        setError(caught instanceof Error ? caught : new Error(String(caught)))
        setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [attempt])

  /* Optimistic, then reconciled with what the server actually stored — a handle
     can come back rejected, and the field should show the one in force. */
  const save = useCallback(
    async (changes: Partial<MyProfile>, said = 'Saved') => {
      const before = profile
      setSaving(true)
      setProfile(current => (current ? { ...current, ...changes } : current))
      try {
        const saved = await updateMe(changes)
        setProfile(saved)
        notify(said)
      } catch (caught) {
        setProfile(before)
        notify(appErrorMessage(caught, 'save-profile'), 'error')
      } finally {
        setSaving(false)
      }
    },
    [profile, notify],
  )

  const savePreferences = useCallback(
    async (next: Preferences) => {
      setProfile(current => (current ? { ...current, preferences: next } : current))
      try {
        await updateMe({ preferences: next as unknown as Record<string, unknown> })
      } catch (caught) {
        notify(appErrorMessage(caught, 'save-profile'), 'error')
      }
    },
    [notify],
  )

  const saveAvatar = useCallback(
    async (file: File) => {
      setSaving(true)
      try {
        const avatar = await uploadAvatar(file)
        setProfile(current => (current ? { ...current, avatar } : current))
        notify('Picture updated')
      } catch (caught) {
        notify(appErrorMessage(caught, 'save-profile'), 'error')
      } finally {
        setSaving(false)
      }
    },
    [notify],
  )

  return {
    profile,
    preferences: readPreferences(profile?.preferences),
    loading,
    error,
    saving,
    reload,
    save,
    savePreferences,
    saveAvatar,
  }
}
