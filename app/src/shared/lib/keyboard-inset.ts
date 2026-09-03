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
  const set = (px: number) =>
    target.document.documentElement.style.setProperty('--keyboard', `${px}px`)

  /* Inside the iOS app the visual viewport is a dead signal: WKWebView keeps
     both viewports at full height while the keyboard covers the page — only
     Safari moves visualViewport. The native bridge announces the keyboard
     instead, so there the variable comes from the platform, not the DOM.
     (Android resizes the layout viewport itself and stays on the web path,
     where the measurement correctly reads zero.) */
  if (target.document.documentElement.classList.contains('native-ios')) {
    const handles: Array<Promise<{ remove: () => void }>> = []
    import('@capacitor/keyboard').then(({ Keyboard }) => {
      handles.push(
        Keyboard.addListener('keyboardWillShow', info => set(info.keyboardHeight)),
        Keyboard.addListener('keyboardWillHide', () => set(0)),
      )
    })
    return () => {
      for (const handle of handles) handle.then(listener => listener.remove())
      set(0)
    }
  }

  const view = target.visualViewport
  if (!view) return () => {}

  const publish = () => set(keyboardInset(view, target.innerHeight))

  publish()
  view.addEventListener('resize', publish)
  view.addEventListener('scroll', publish)
  return () => {
    view.removeEventListener('resize', publish)
    view.removeEventListener('scroll', publish)
  }
}
