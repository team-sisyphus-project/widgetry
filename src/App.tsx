import { useCallback, useEffect, useState } from 'react'
import type { Props, WidgetSpec } from './lib/types'
import { getWidget } from './widgets'
import { Gallery } from './components/Gallery'
import { Studio } from './components/Studio'
import { buildHash, parseRoute } from './lib/share'

export default function App() {
  const [route, setRoute] = useState(() => parseRoute(location.hash))

  useEffect(() => {
    const onHash = () => setRoute(parseRoute(location.hash))
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const spec = route.widget ? getWidget(route.widget) : undefined

  const open = useCallback((next: WidgetSpec) => {
    location.hash = buildHash(next, {}, false)
  }, [])

  const close = useCallback(() => {
    history.pushState(null, '', location.pathname + location.search)
    setRoute({ widget: null, props: null })
  }, [])

  const sync = useCallback(
    (props: Props) => {
      if (!spec) return
      const next = buildHash(spec, props, true)
      if (location.hash !== next) history.replaceState(null, '', next)
    },
    [spec],
  )

  return (
    <div className="shell">
      {spec ? (
        <Studio spec={spec} initial={route.props} onClose={close} onPropsChange={sync} />
      ) : (
        <>
          <Gallery onOpen={open} />
          <footer className="foot">
            <span>Widgetry</span>
            <span>MIT licensed. Built to be given away.</span>
          </footer>
        </>
      )}
    </div>
  )
}
