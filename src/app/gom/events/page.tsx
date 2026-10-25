'use client'
import { useEffect, useState } from 'react'
import { PageHeader } from '@/components/ui'
import { EventsList } from '@/components/shared/Events'
import { FancallArchive } from '@/components/shared/FancallArchive'

// Events tab: every fansign / fancall / DIY event / lucky draw / VCE / POB event entered, won or not.
// Archive tab: the old fancall records from before Events.
export default function GomEventsPage() {
  const [tab, setTab] = useState<'events' | 'archive'>('events')
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('tab') === 'archive') setTab('archive')
  }, [])
  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Events" subtitle="Fansigns, fancalls, DIY events, lucky draws… won, lost or pending" />
      <div className="px-4 sm:px-6 pt-4 flex gap-2">
        {(['events', 'archive'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-full text-sm font-semibold border transition-colors ${tab === t ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border text-muted-foreground hover:text-foreground'}`}>
            {t === 'events' ? 'Events' : 'Archive'}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-auto">
        {tab === 'events'
          ? <div className="p-4 sm:p-6"><EventsList showEraFilter title="All events"/></div>
          : <FancallArchive/>}
      </div>
    </div>
  )
}
