'use client'
import { useState, useEffect, useCallback } from 'react'
import { Send, Check, Printer, ChevronDown, ChevronUp, PackageCheck } from 'lucide-react'
import { Button, Card, CardContent, FormField, Input, Select, PageHeader, Badge, EmptyState } from '@/components/ui'
import { formatDate } from '@/lib/utils'

const SHIPPING_TYPES = [
  { value: 'stamped_letter', label: '✉️ Stamped Letter' },
  { value: 'tracked_letter', label: '📨 Tracked Letter' },
  { value: 'package', label: '📦 Package' },
  { value: 'inpost_mondial', label: '🏪 InPost / Mondial Relay' },
  { value: 'vinted_go', label: '🛍️ Vinted Go' },
  { value: 'vinted', label: '🛍️ Vinted' },
]
const STATUS_LABELS: Record<string, string> = {
  pending: 'Submitted — waiting to be packed',
  packed: 'Packed',
  payment_requested: 'Payment requested',
  payment_complete: 'Payment received',
  shipped: 'Shipped',
  complete: 'Delivered',
}
const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-secondary text-muted-foreground border border-border',
  packed: 'bg-sky-50 text-sky-700 border border-sky-200',
  payment_requested: 'bg-amber-50 text-amber-700 border border-amber-200',
  payment_complete: 'bg-teal-50 text-teal-700 border border-teal-200',
  shipped: 'bg-violet-50 text-violet-700 border border-violet-200',
  complete: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
}
const emptyForm = { shipping_type: '', full_name: '', address: '', email: '', phone: '', notes: '' }

export default function JoinerShippingPage() {
  const [forms, setForms] = useState<any[]>([])
  const [shipments, setShipments] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [openFormId, setOpenFormId] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, any>>({})
  const [saving, setSaving] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    const [f, sh] = await Promise.all([
      fetch('/api/shipping-forms?viewAs=joiner').then(r => r.json()).catch(() => []),
      fetch('/api/shipments?viewAs=joiner').then(r => r.json()).catch(() => []),
    ])
    setForms(Array.isArray(f) ? f : [])
    setShipments(Array.isArray(sh) ? sh : [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const shipmentByForm = new Map(shipments.map(s => [s.form_id, s]))
  const formsToFill = forms.filter(f => f.form_open && !shipmentByForm.has(f.id))
  const submitted = shipments

  function draftFor(formId: string) {
    return drafts[formId] || emptyForm
  }
  function setDraft(formId: string, patch: any) {
    setDrafts(d => ({ ...d, [formId]: { ...draftFor(formId), ...patch } }))
  }

  async function handleSubmit(formId: string) {
    const d = draftFor(formId)
    if (!d.shipping_type || !d.address || !d.full_name) return
    setSaving(formId)
    await fetch('/api/shipments', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ form_id: formId, ...d }),
    })
    setSaving(null); setOpenFormId(null)
    await fetchData()
  }

  async function markReceived(id: string) {
    await fetch('/api/shipments', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, mark_complete: true }) })
    await fetchData()
  }

  function handlePrint(sh: any) {
    const content = `
      <html><head><title>Shipping Label</title>
      <style>
        body { font-family: Georgia, serif; padding: 40px; max-width: 500px; margin: 0 auto; }
        h1 { font-size: 18px; border-bottom: 2px solid #000; padding-bottom: 8px; margin-bottom: 20px; }
        .field { margin: 12px 0; }
        .label { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #888; }
        .value { font-size: 14px; font-weight: bold; margin-top: 3px; }
        .box { border: 1px solid #e0e0e0; padding: 20px; border-radius: 8px; margin: 16px 0; }
        .footer { margin-top: 28px; font-size: 10px; color: #aaa; text-align: center; border-top: 1px solid #eee; padding-top: 12px; }
      </style></head><body>
      <h1>✦ Giantz GO — Shipping Form</h1>
      <div class="box">
        <div class="field"><div class="label">Full Name</div><div class="value">${sh.full_name || ''}</div></div>
        <div class="field"><div class="label">Shipping Type</div><div class="value">${SHIPPING_TYPES.find(t => t.value === sh.shipping_type)?.label || sh.shipping_type}</div></div>
        <div class="field"><div class="label">Delivery Address</div><div class="value" style="white-space:pre-wrap">${sh.address || ''}</div></div>
        ${sh.email ? `<div class="field"><div class="label">Email</div><div class="value">${sh.email}</div></div>` : ''}
        ${sh.phone ? `<div class="field"><div class="label">Phone</div><div class="value">${sh.phone}</div></div>` : ''}
        ${sh.notes ? `<div class="field"><div class="label">Notes</div><div class="value">${sh.notes}</div></div>` : ''}
      </div>
      <div class="footer">Generated by Giantz GO · ${new Date().toLocaleDateString()}</div>
      </body></html>`
    const w = window.open('', '_blank')
    if (w) { w.document.write(content); w.document.close(); w.print() }
  }

  if (loading) return (
    <div className="flex-1 flex items-center justify-center h-full">
      <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Shipping" subtitle="Submit your shipping preferences" />
      <div className="flex-1 overflow-auto p-4 sm:p-6 space-y-5">

        {/* Forms open for you to fill */}
        {formsToFill.length > 0 && (
          <div className="space-y-3">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Submit Shipping Info</p>
            {formsToFill.map(f => {
              const isOpen = openFormId === f.id
              const d = draftFor(f.id)
              return (
                <div key={f.id} className="space-y-2">
                  <button onClick={() => setOpenFormId(isOpen ? null : f.id)}
                    className="w-full flex items-center justify-between px-5 py-4 bg-card border border-border rounded-2xl hover:border-primary/30 hover:bg-primary/[0.02] transition-all group">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
                        <Send size={15} className="text-primary" />
                      </div>
                      <div className="text-left">
                        <p className="font-semibold text-sm">{f.title}</p>
                        <p className="text-xs text-muted-foreground">
                          Fill in your address and shipping preferences
                          {f.deadline && ` · Deadline ${formatDate(f.deadline)}`}
                        </p>
                      </div>
                    </div>
                    {isOpen ? <ChevronUp size={16} className="text-muted-foreground" /> : <ChevronDown size={16} className="text-muted-foreground" />}
                  </button>

                  {isOpen && (
                    <Card>
                      <CardContent className="space-y-4 pt-5">
                        <FormField label="Full Name" required>
                          <Input placeholder="As it should appear on the label" value={d.full_name} onChange={e => setDraft(f.id, { full_name: e.target.value })} />
                        </FormField>
                        <FormField label="Shipping Type" required>
                          <Select options={SHIPPING_TYPES} placeholder="How should we ship it?" value={d.shipping_type} onChange={e => setDraft(f.id, { shipping_type: e.target.value })} />
                        </FormField>
                        <FormField label="Shipping Address" required>
                          <textarea className="w-full px-3.5 py-2.5 rounded-xl border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/25" rows={3} placeholder="Full address, city, postcode, country" value={d.address} onChange={e => setDraft(f.id, { address: e.target.value })} />
                        </FormField>
                        <div className="grid grid-cols-2 gap-3">
                          <FormField label="Email"><Input type="email" placeholder="your@email.com" value={d.email} onChange={e => setDraft(f.id, { email: e.target.value })} /></FormField>
                          <FormField label="Phone"><Input type="tel" placeholder="+33 6 00 00 00 00" value={d.phone} onChange={e => setDraft(f.id, { phone: e.target.value })} /></FormField>
                        </div>
                        <FormField label="Notes"><Input placeholder="Any special instructions…" value={d.notes} onChange={e => setDraft(f.id, { notes: e.target.value })} /></FormField>
                        <Button onClick={() => handleSubmit(f.id)} disabled={saving === f.id || !d.shipping_type || !d.address || !d.full_name} className="w-full">
                          {saving === f.id ? 'Submitting…' : <><Send size={14} /> Submit</>}
                        </Button>
                      </CardContent>
                    </Card>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Your shipments */}
        <div>
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-3">Your Shipments</p>
          {submitted.length === 0
            ? <EmptyState icon={Send} title="No shipments yet" description="Once your GOM opens a shipping form for a box you have items in, it'll show up here." />
            : submitted.map(sh => (
              <Card key={sh.id} className="mb-2">
                <CardContent className="py-4 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-sm">{sh.form_title || 'Shipment'}</p>
                      {sh.shipping_type && <p className="text-xs text-muted-foreground mt-0.5">{SHIPPING_TYPES.find(t => t.value === sh.shipping_type)?.label || sh.shipping_type}</p>}
                      {sh.tracking_code && <p className="text-xs text-muted-foreground mt-0.5">📮 Tracking: {sh.tracking_code}</p>}
                    </div>
                    <Badge className={`${STATUS_COLORS[sh.status] || STATUS_COLORS.pending} flex-shrink-0`}>{STATUS_LABELS[sh.status] || sh.status}</Badge>
                  </div>
                  {sh.status === 'payment_requested' && (
                    <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
                      A payment of {sh.price_eur != null ? `${sh.price_eur}€` : ''} has been requested for this shipment — submit proof on your Payments page.
                    </div>
                  )}
                  <div className="flex items-center gap-2 pt-1">
                    <Button variant="outline" size="sm" onClick={() => handlePrint(sh)}><Printer size={13} /> Print label</Button>
                    {sh.status === 'shipped' && (
                      <Button size="sm" onClick={() => markReceived(sh.id)}><PackageCheck size={13} /> I received it</Button>
                    )}
                    {sh.status === 'complete' && (
                      <span className="flex items-center gap-1 text-xs text-emerald-600 font-semibold"><Check size={13} /> Delivered</span>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))
          }
        </div>
      </div>
    </div>
  )
}
