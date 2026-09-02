import type { WidgetSpec } from '../lib/types'
import { clock, agenda, countdown } from './time'
import { battery, brightness, toggle, compass, signal } from './system'
import { player, waveform, recordbutton } from './media'
import { weather, waterwave, wallet, contactCard } from './data'
import { checklist, sleepmode } from './life'

export const WIDGETS: WidgetSpec[] = [
  clock,
  brightness,
  weather,
  player,
  toggle,
  battery,
  waveform,
  compass,
  sleepmode,
  checklist,
  waterwave,
  wallet,
  contactCard,
  agenda,
  countdown,
  signal,
  recordbutton,
]

export const WIDGET_BY_ID = new Map(WIDGETS.map((w) => [w.id, w]))

export function getWidget(id: string): WidgetSpec | undefined {
  return WIDGET_BY_ID.get(id)
}
