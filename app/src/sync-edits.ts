import { addComment, deleteComment, setLike } from './backend-social'
import { createStop, deleteStop, replaceRoute, updateStop, updateTrip } from './backend'
import { syncEdits, type EditRunner } from './offline-edits'
import { describeSync } from './offline-edits-core'

/* Replaying a queued change is just making the same call again — the same one
   the screen made when there was no signal to carry it. Kept here because this
   is the module that knows how to reach the API; the queue does not. */
const runEdit: EditRunner = async edit => {
  switch (edit.kind) {
    case 'stop.create': {
      const saved = await createStop(edit.tripId, edit.fields)
      return { id: saved.id }
    }
    case 'stop.update':
      await updateStop(edit.tripId, edit.target, edit.fields)
      return undefined
    case 'stop.delete':
      await deleteStop(edit.tripId, edit.target)
      return undefined
    case 'route.replace':
      await replaceRoute(edit.tripId, edit.points)
      return undefined
    case 'trip.update':
      await updateTrip(edit.tripId, edit.fields)
      return undefined
    case 'comment.add': {
      const saved = await addComment(edit.tripId, edit.photoId, edit.body)
      return { id: saved.id }
    }
    case 'comment.delete':
      await deleteComment(edit.tripId, edit.target)
      return undefined
    case 'like.set':
      await setLike(edit.tripId, edit.photoId, edit.on)
      return undefined
  }
}

/** Empties the queue, and says what happened, or null if there was nothing. */
export async function syncTripEdits() {
  const report = await syncEdits(runEdit)
  return report ? describeSync(report) : null
}
