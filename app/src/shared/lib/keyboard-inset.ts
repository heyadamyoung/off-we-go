/* How much of the screen the on-screen keyboard is covering, published as a CSS
   variable so layout can stay out of its way.

   Chrome honours interactive-widget=resizes-content and shrinks the layout
   viewport itself, which leaves this at zero. iOS does not: there the layout
   viewport keeps its full height and only the visual viewport shrinks, so a
   panel anchored to the bottom of the page ends up behind the keyboard being
   typed into. This measures the difference and lets the panels lift. */
export function keyboardInset(view: { height: number; offsetTop: number }, windowHeight: number) {
  const covered = windowHeight - view.height - view.offsetTop
  return covered > 80 ? Math.round(covered) : 0
}

export function trackKeyboardInset(target: Window = window) {
  const view = target.visualViewport
  if (!view) return () => {}

  const publish = () => {
    const inset = keyboardInset(view, target.innerHeight)
    target.document.documentElement.style.setProperty('--keyboard', `${inset}px`)
  }

  publish()
  view.addEventListener('resize', publish)
  view.addEventListener('scroll', publish)
  return () => {
    view.removeEventListener('resize', publish)
    view.removeEventListener('scroll', publish)
  }
}
