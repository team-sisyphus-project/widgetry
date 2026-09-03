import { useEffect, useRef, useState } from 'react'
import { defaultProps } from '../lib/types'
import { getWidget } from '../widgets'
import { Live } from './Live'
import '../landing.css'

/** The collage inside the card is built from the real widget specs, at real size. */
const MOSAIC: { id: string; props?: Record<string, string | number | boolean> }[][] = [
  [
    { id: 'clock', props: { size: 168 } },
    { id: 'weather' },
    { id: 'signal', props: { size: 80 } },
  ],
  [
    { id: 'toggle', props: { on: true } },
    { id: 'battery', props: { level: 68 } },
    { id: 'waterwave', props: { size: 148 } },
    { id: 'recordbutton', props: { size: 72, recording: true } },
  ],
]

/** The mosaic is authored at this size and scaled to the card panel. */
const CANVAS = { w: 700 }
const PANEL_W = 420
const PANEL_H = 248
/** Roughly the rendered card height, used to fit the poster to the viewport. */
const CARD_H = 500

export function Landing({ onEnter }: { onEnter: () => void }) {
  const stage = useRef<HTMLDivElement>(null)
  const card = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState(1)

  /* Keep the whole card readable on narrow screens without reflowing the collage. */
  useEffect(() => {
    /*
      One mechanism owns the card size: it grows on roomy screens and shrinks on
      cramped ones. The width allowance is generous because the 3D projection
      spreads the card wider than its layout box.
    */
    const measure = () => {
      const byWidth = (window.innerWidth - 48) / (PANEL_W + 68)
      const byHeight = (window.innerHeight - 300) / CARD_H
      setFit(Math.max(0.5, Math.min(1.28, byWidth, byHeight)))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  useEffect(() => {
    const host = stage.current
    const target = card.current
    if (!host || !target) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    /* Nothing to track on a touch screen, so leave the card at its resting tilt. */
    if (window.matchMedia('(pointer: coarse)').matches) return

    let frame = 0
    let rx = 8
    let ry = -9
    let tx = 8
    let ty = -9
    let glow = { x: 50, y: 30 }

    function paint() {
      rx += (tx - rx) * 0.12
      ry += (ty - ry) * 0.12
      target!.style.setProperty('--rx', `${rx.toFixed(2)}deg`)
      target!.style.setProperty('--ry', `${ry.toFixed(2)}deg`)
      target!.style.setProperty('--gx', `${glow.x.toFixed(1)}%`)
      target!.style.setProperty('--gy', `${glow.y.toFixed(1)}%`)
      frame = requestAnimationFrame(paint)
    }

    function move(e: PointerEvent) {
      const r = host!.getBoundingClientRect()
      const px = (e.clientX - r.left) / r.width
      const py = (e.clientY - r.top) / r.height
      tx = (0.5 - py) * 22
      ty = (px - 0.5) * 26
      glow = { x: px * 100, y: py * 100 }
    }

    function rest() {
      tx = 8
      ty = -9
      glow = { x: 50, y: 30 }
    }

    host.addEventListener('pointermove', move)
    host.addEventListener('pointerleave', rest)
    paint()
    return () => {
      cancelAnimationFrame(frame)
      host.removeEventListener('pointermove', move)
      host.removeEventListener('pointerleave', rest)
    }
  }, [])

  return (
    <div className="landing" style={{ '--fit': fit } as React.CSSProperties}>
      <div className="landing__blobs" aria-hidden="true">
        <i className="landing__blob landing__blob--amber" />
        <i className="landing__blob landing__blob--magenta" />
        <i className="landing__blob landing__blob--indigo" />
      </div>

      <h1 className="landing__wordmark">Widgetry</h1>

      <div className="landing__stage" ref={stage}>
        <div className="landing__float">
          <div className="landing__card" ref={card}>
            <div className="landing__panel">
              <div
                className="landing__mosaic"
                style={{ '--k': PANEL_W / CANVAS.w } as React.CSSProperties}
                aria-hidden="true"
              >
                <div className="landing__canvas" style={{ width: CANVAS.w, height: PANEL_H / (PANEL_W / CANVAS.w) }}>
                  {MOSAIC.map((row, i) => (
                    <div className="landing__row" key={i}>
                      {row.map(({ id, props }) => {
                        const spec = getWidget(id)
                        if (!spec) return null
                        return (
                          <div className="landing__tile" key={id}>
                            <Live spec={spec} props={{ ...defaultProps(spec), ...props }} />
                          </div>
                        )
                      })}
                    </div>
                  ))}
                </div>
              </div>
              <span className="landing__sheen" aria-hidden="true" />
            </div>

            <div className="landing__body">
              <h2 className="landing__headline">
                Live UI utilities
                <br />
                you can take with you.
              </h2>
              <p className="landing__copy">
                Fifteen running widgets. Turn the knobs, then leave with HTML, React, Vue, Svelte or
                a web component. MIT, no runtime, no attribution.
              </p>
              <button className="landing__cta" type="button" onClick={onEnter}>
                Enter the gallery
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="landing__entry">
        <button
          className="landing__enter"
          type="button"
          onClick={onEnter}
          aria-label="Enter the gallery"
        >
          Enter the gallery
        </button>
        <p className="landing__caption">Fifteen utilities are waiting.</p>
      </div>
    </div>
  )
}
