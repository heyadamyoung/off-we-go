import { useEffect, useState } from 'react'

/* The page's clock: now, to the minute. Everything on the trip that reads
   the time — the day face, the countdowns, the walk through the terminal —
   reads this one value, so they all agree and re-render together.

   A test seam beside __offwegoStill: the suite pins the browser's clock,
   moves it on, and then needs the page to notice a minute has passed
   without waiting one. */
export default function useMinuteClock(): number {
  const [clock, setClock] = useState(() => Date.now())
  useEffect(() => {
    const tick = () => setClock(Date.now())
    const timer = setInterval(tick, 60_000)
    window.__offwegoTick = tick
    return () => {
      clearInterval(timer)
      delete window.__offwegoTick
    }
  }, [])
  return clock
}
