import Icon from '../../../shared/ui/icon'

/* The AI's own island, floating clear of the camera controls: it is not a
   map tool, it starts a conversation. On a phone the map chrome is a flex
   row, so it becomes its own circle beside the controls pill. */
export default function AssistantButton({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      className={
        /* ml-auto leads the right-hand group: with the capsule hidden — a
           sample trip, a panel open — the AI button and the map controls hold
           the right edge together instead of drifting apart across the row.
           In the row the button must stay POSITIONED (relative, never static):
           hitslop's tap-expanding ::after anchors to the nearest positioned
           ancestor, and on a static button that was the whole chrome row — an
           invisible plate over the capsule that opened the AI from any tap. */
        'glass hitslop relative z-[4] ml-auto grid size-11 flex-none place-items-center ' +
        'rounded-full sm:absolute sm:bottom-[calc(var(--trip-1)+175px)] sm:right-4 sm:ml-0 ' +
        (on ? 'bg-accent text-accent-ink' : 'text-accent hover:bg-raised2')
      }
      title="Ask the AI about this trip"
      aria-label="Ask the AI about this trip"
      onClick={onClick}>
      <Icon n="spark" s={18} />
    </button>
  )
}
