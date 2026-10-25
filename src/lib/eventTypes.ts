// Shared (client + server) labels for events and winner items. No server imports here.

export const EVENT_TYPES = ['fansign', 'fancall', 'diy_event', 'lucky_draw', 'vce', 'pob_event', 'other'] as const
export type EventType = typeof EVENT_TYPES[number]
export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  fansign: 'Fansign', fancall: 'Fancall', diy_event: 'DIY event', lucky_draw: 'Lucky draw', vce: 'VCE', pob_event: 'POB / pre-order event', other: 'Other',
}

export const EVENT_RESULTS = ['pending', 'won', 'lost'] as const
export type EventResult = typeof EVENT_RESULTS[number]
export const EVENT_RESULT_LABELS: Record<EventResult, string> = { pending: 'Pending', won: 'Won', lost: 'Lost' }

export function eventTypeText(e: { type: string; type_label?: string | null }) {
  if (e.type === 'other') return e.type_label || 'Other'
  return EVENT_TYPE_LABELS[e.type as EventType] || e.type
}
