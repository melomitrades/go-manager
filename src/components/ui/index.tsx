import * as React from 'react'
import { cn } from '@/lib/utils'
import type { OrderStatus } from '@/types'
import { ORDER_STATUS_LABELS } from '@/types'

// ── Button ────────────────────────────────────────────────
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'secondary' | 'outline' | 'ghost' | 'destructive' | 'gold'
  size?: 'sm' | 'md' | 'lg' | 'icon'
}
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'default', size = 'md', className, ...props }, ref) => (
    <button ref={ref} className={cn(
      'inline-flex items-center justify-center gap-2 font-semibold transition-all duration-200 disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring select-none',
      {
        default:     'bg-primary text-primary-foreground rounded-xl hover:opacity-90 shadow-rose-sm hover:shadow-rose-md active:scale-[0.98]',
        secondary:   'bg-secondary text-secondary-foreground rounded-xl hover:bg-secondary/70',
        outline:     'border border-border bg-card rounded-xl hover:bg-secondary hover:border-primary/30',
        ghost:       'rounded-xl hover:bg-secondary text-muted-foreground hover:text-foreground',
        destructive: 'bg-destructive text-destructive-foreground rounded-xl hover:opacity-90',
        gold:        'bg-gold text-white rounded-xl hover:opacity-90 shadow-sm',
      }[variant],
      { sm: 'text-xs px-3 py-1.5', md: 'text-sm px-4 py-2.5', lg: 'text-sm px-5 py-3', icon: 'w-8 h-8' }[size],
      className
    )} {...props} />
  )
)
Button.displayName = 'Button'

// ── Badge ─────────────────────────────────────────────────
export function Badge({ children, className, variant, ...props }: { children: React.ReactNode; className?: string; variant?: string } & React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn('inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold', variant && `status-${variant}`, className)} {...props}>{children}</span>
}

export function StatusBadge({ status }: { status: OrderStatus }) {
  return <Badge variant={status}>{ORDER_STATUS_LABELS[status]}</Badge>
}

// ── Card ──────────────────────────────────────────────────
export function Card({ children, className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('bg-card border border-border rounded-2xl overflow-hidden shadow-sm', className)} {...props}>{children}</div>
}
export function CardHeader({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('px-5 py-4 border-b border-border', className)}>{children}</div>
}
export function CardContent({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('px-5 py-4', className)}>{children}</div>
}

// ── Input ─────────────────────────────────────────────────
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(
      'w-full px-3.5 py-2.5 rounded-xl border border-input bg-background text-sm placeholder:text-muted-foreground/50',
      'focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary/60 transition-all duration-200 disabled:opacity-50',
      className
    )} {...props} />
  )
)
Input.displayName = 'Input'

// ── Textarea ──────────────────────────────────────────────
export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea ref={ref} className={cn(
      'w-full px-3.5 py-2.5 rounded-xl border border-input bg-background text-sm placeholder:text-muted-foreground/50',
      'focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary/60 transition-all duration-200 resize-none',
      className
    )} {...props} />
  )
)
Textarea.displayName = 'Textarea'

// ── Select ────────────────────────────────────────────────
interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  options: { value: string; label: string }[]
  placeholder?: string
}
export function Select({ options, placeholder, className, ...props }: SelectProps) {
  return (
    <select className={cn(
      'w-full px-3.5 py-2.5 rounded-xl border border-input bg-background text-sm',
      'focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary/60 transition-all duration-200 appearance-none cursor-pointer',
      className
    )} {...props}>
      {placeholder && <option value="">{placeholder}</option>}
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

// ── Label ─────────────────────────────────────────────────
export function Label({ children, className, htmlFor }: { children: React.ReactNode; className?: string; htmlFor?: string }) {
  return <label htmlFor={htmlFor} className={cn('text-xs font-semibold text-muted-foreground uppercase tracking-wider', className)}>{children}</label>
}

// ── FormField ─────────────────────────────────────────────
export function FormField({ label, children, required }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}{required && <span className="text-destructive ml-0.5">*</span>}</Label>
      {children}
    </div>
  )
}

// ── Checkbox ──────────────────────────────────────────────
interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> { label?: string }
export function Checkbox({ label, className, id, ...props }: CheckboxProps) {
  return (
    <label className="flex items-center gap-2.5 cursor-pointer group" htmlFor={id}>
      <input id={id} type="checkbox" className={cn('w-4 h-4 rounded border-input accent-primary cursor-pointer', className)} {...props} />
      {label && <span className="text-sm font-medium">{label}</span>}
    </label>
  )
}

// ── Modal ─────────────────────────────────────────────────
interface ModalProps { open: boolean; onClose: () => void; title: string; subtitle?: string; children: React.ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl' }
export function Modal({ open, onClose, title, subtitle, children, size = 'md' }: ModalProps) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4">
      <div className="absolute inset-0 bg-black/35 backdrop-blur-sm" onClick={onClose} />
      <div className={cn(
        'relative bg-card border border-border rounded-2xl shadow-rose-lg animate-scale-in w-full max-h-[90vh] overflow-y-auto',
        { sm:'max-w-sm', md:'max-w-md', lg:'max-w-2xl', xl:'max-w-4xl' }[size]
      )}>
        <div className="flex items-start justify-between px-6 py-5 border-b border-border sticky top-0 bg-card/95 backdrop-blur-sm z-10">
          <div>
            <h2 className="font-display font-semibold text-lg leading-snug">{title}</h2>
            {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-all text-base mt-0.5">×</button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  )
}

// ── Page Header ───────────────────────────────────────────
export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-7 py-5 border-b border-border bg-card/60 backdrop-blur-sm sticky top-0 z-10">
      <div>
        <h1 className="font-display font-semibold text-2xl tracking-tight">{title}</h1>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5 font-medium">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

// ── Section Header ────────────────────────────────────────
export function SectionHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">{title}</p>
      {action}
    </div>
  )
}

// ── Empty State ───────────────────────────────────────────
export function EmptyState({ icon: Icon, title, description, action }: {
  icon: React.ElementType; title: string; description?: string; action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
      <div className="w-14 h-14 rounded-2xl bg-primary/6 border border-primary/10 flex items-center justify-center mb-4">
        <Icon size={22} className="text-primary/40" />
      </div>
      <p className="font-display font-semibold text-lg">{title}</p>
      {description && <p className="text-sm text-muted-foreground mt-1.5 max-w-xs leading-relaxed">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

// ── Table ─────────────────────────────────────────────────
export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('overflow-x-auto', className)}><table className="w-full text-sm">{children}</table></div>
}
export function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <th className={cn('text-left text-xs font-bold text-muted-foreground/70 uppercase tracking-wider px-5 py-3 border-b border-border whitespace-nowrap bg-secondary/40', className)}>{children}</th>
}
export function Td({ children, className, onClick }: { children?: React.ReactNode; className?: string; onClick?: (e: React.MouseEvent) => void }) {
  return <td onClick={onClick} className={cn('px-5 py-3.5 border-b border-border/60', className)}>{children}</td>
}
export function Tr({ children, className, onClick }: { children: React.ReactNode; className?: string; onClick?: () => void }) {
  return <tr onClick={onClick} className={cn('hover:bg-primary/[0.025] transition-colors duration-100', onClick && 'cursor-pointer', className)}>{children}</tr>
}

// ── Stat Card ─────────────────────────────────────────────
export function StatCard({ label, value, icon: Icon }: { label: string; value: string | number; icon: React.ElementType }) {
  return (
    <div className="bg-card border border-border rounded-2xl p-5 card-hover">
      <div className="flex items-start justify-between mb-3">
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{label}</p>
        <div className="w-8 h-8 rounded-xl bg-primary/8 flex items-center justify-center"><Icon size={15} className="text-primary" /></div>
      </div>
      <p className="font-display text-2xl font-semibold">{value}</p>
    </div>
  )
}

// ── Tabs ──────────────────────────────────────────────────
export function Tabs({ tabs, active, onChange }: { tabs: string[]; active: string; onChange: (t: string) => void }) {
  return (
    <div className="flex gap-0 border-b border-border">
      {tabs.map(tab => (
        <button key={tab} onClick={() => onChange(tab)} className={cn(
          'px-5 py-3 text-sm font-semibold border-b-2 -mb-px transition-all capitalize',
          active === tab ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
        )}>{tab}</button>
      ))}
    </div>
  )
}
