import { useEffect, useRef } from 'react'
import type { Props, WidgetSpec } from '../lib/types'
import { mount } from '../lib/render'

interface Props_ {
  spec: WidgetSpec
  props: Props
  /** Re-mounts whenever this changes, which is how the studio replays animations. */
  generation?: number
}

export function Live({ spec, props, generation = 0 }: Props_) {
  const host = useRef<HTMLDivElement>(null)
  const signature = JSON.stringify(props)

  useEffect(() => {
    if (!host.current) return
    return mount(host.current, spec, props)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec.id, signature, generation])

  return <div ref={host} />
}
