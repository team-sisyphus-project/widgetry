import { useCallback, useEffect, useState } from 'react'
import type { Props, WidgetSpec } from './lib/types'
import { getWidget } from './widgets'
import { Landing } from './components/Landing'
import { Gallery } from './components/Gallery'
import { Studio } from './components/Studio'
import { GALLERY_HASH, buildHash, parseRoute } from './lib/share'
import { prefs } from './lib/prefs'

export default function App() {
  const [route, setRoute] = useState(() => parseRoute(location.hash))

  useEffect(() => {
    const onHash = () => setRoute(parseRoute(location.hash))
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const spec = route.widget ? getWidget(route.widget) : undefined

  /*
   * A widget counts as opened when the studio is showing it, whichever way the user
   * got there — a gallery card, a shared link, a bookmark. Recording this at the
   * route rather than at the card is what makes the last two count.
   */
  useEffect(() => {
    if (spec) prefs.markRecent(spec.id)
  }, [spec])

  const open = useCallback((next: WidgetSpec) => {
    location.hash = buildHash(next, {}, false)
  }, [])

  const toGallery = useCallback(() => {
    location.hash = GALLERY_HASH
  }, [])

  const toLanding = useCallback(() => {
    history.pushState(null, '', location.pathname + location.search)
    setRoute(parseRoute(''))
  }, [])

  /* Keep the tuned build in the address bar so the studio stays shareable. */
  const sync = useCallback(
    (props: Props) => {
      if (!spec) return
      const next = buildHash(spec, props, true)
      if (location.hash !== next) history.replaceState(null, '', next)
    },
    [spec],
  )

  if (route.view === 'landing') return <Landing onEnter={toGallery} />

  return (
    <div className="shell">
      {spec ? (
        <Studio spec={spec} initial={route.props} onClose={toGallery} onPropsChange={sync} />
      ) : (
        <>
          <Gallery onOpen={open} onHome={toLanding} />
          <footer className="foot">
            <button type="button" className="foot__home" onClick={toLanding}>
              Widgetry
            </button>
            <span>MIT licensed. Built to be given away.</span>
          </footer>
        </>
      )}
    </div>
  )
}
