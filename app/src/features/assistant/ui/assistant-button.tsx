import Icon from '../../../shared/ui/icon'

/* The AI's own island, floating clear of the camera controls: it is not a
   map tool, it starts a conversation. On a phone the map chrome is a flex
   row, so it becomes its own circle beside the controls pill. */
export default function AssistantButton({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      className={
        'glass hitslop absolute bottom-[calc(var(--trip-1)+175px)] right-4 z-[4] grid size-11 ' +
        'place-items-center rounded-full max-sm:static max-sm:size-9 max-sm:flex-none ' +
        (on ? 'bg-accent text-accent-ink' : 'text-accent hover:bg-raised2')
      }
      title="Ask the AI about this trip"
      aria-label="Ask the AI about this trip"
      onClick={onClick}>
      <Icon n="spark" s={18} />
    </button>
  )
}
