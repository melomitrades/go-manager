'use client'
import { useEffect, useState } from 'react'
import { Users, Plus, Pencil, KeyRound } from 'lucide-react'
import { Card, Table, Th, Td, Tr, Badge, Button, Modal, Input, Select, FormField, PageHeader, EmptyState } from '@/components/ui'
import { formatDate } from '@/lib/utils'
import type { Profile, UserRole } from '@/types'

const ROLE_COLORS: Record<UserRole,string> = {
  admin:'bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-900/20 dark:text-rose-300',
  gom:'bg-violet-50 text-violet-700 border border-violet-200 dark:bg-violet-900/20 dark:text-violet-300',
  joiner:'bg-sky-50 text-sky-700 border border-sky-200 dark:bg-sky-900/20 dark:text-sky-300',
}

export default function AdminJoinersPage() {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [editModal, setEditModal] = useState(false)
  const [createModal, setCreateModal] = useState(false)
  const [pwModal, setPwModal] = useState(false)
  const [selected, setSelected] = useState<Profile | null>(null)
  const [editForm, setEditForm] = useState({ display_name:'', role:'joiner' as UserRole })
  const [createForm, setCreateForm] = useState({ username:'', display_name:'', password:'', role:'joiner' as UserRole })
  const [newPassword, setNewPassword] = useState('')
  const [saving, setSaving] = useState(false)

  async function fetchData() {
    setLoading(true)
    const data = await fetch('/api/users').then(r=>r.json())
    setProfiles(Array.isArray(data)?data:[])
    setLoading(false)
  }
  useEffect(() => { fetchData() }, [])

  function openEdit(p: Profile) {
    setSelected(p)
    setEditForm({ display_name:p.display_name||'', role:p.role })
    setEditModal(true)
  }

  async function handleEdit() {
    if (!selected) return
    setSaving(true)
    await fetch('/api/users', { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id:selected.id, role:editForm.role, display_name:editForm.display_name }) })
    setEditModal(false); fetchData(); setSaving(false)
  }

  async function handleCreate() {
    setSaving(true)
    await fetch('/api/users', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(createForm) })
    setCreateModal(false); setCreateForm({username:'',display_name:'',password:'',role:'joiner'}); fetchData(); setSaving(false)
  }

  async function handlePasswordReset() {
    if (!selected || !newPassword) return
    setSaving(true)
    await fetch('/api/users', { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id:selected.id, password:newPassword }) })
    setPwModal(false); setNewPassword(''); setSaving(false)
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Users" subtitle={`${profiles.length} accounts`} action={<Button onClick={()=>setCreateModal(true)}><Plus size={14}/> Add User</Button>}/>
      <div className="flex-1 overflow-auto p-4 sm:p-6">
        {loading ? <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"/></div>
        : profiles.length===0 ? <EmptyState icon={Users} title="No users yet" action={<Button onClick={()=>setCreateModal(true)}><Plus size={14}/> Add User</Button>}/>
        : <Card><Table><thead><tr><Th>Name</Th><Th>Username</Th><Th>Role</Th><Th>Joined</Th><Th></Th></tr></thead>
          <tbody>{profiles.map(p => (
            <Tr key={p.id}>
              <Td className="font-semibold">{p.display_name||<span className="text-muted-foreground/50 italic text-xs">No display name</span>}</Td>
              <Td className="text-muted-foreground font-mono text-sm">{p.username}</Td>
              <Td><Badge className={ROLE_COLORS[p.role]}>{p.role}</Badge></Td>
              <Td className="text-xs text-muted-foreground">{formatDate(p.created_at)}</Td>
              <Td>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" onClick={()=>openEdit(p)} title="Edit user"><Pencil size={13}/></Button>
                  <Button variant="ghost" size="icon" onClick={()=>{setSelected(p);setNewPassword('');setPwModal(true)}} title="Reset password"><KeyRound size={13}/></Button>
                </div>
              </Td>
            </Tr>
          ))}</tbody></Table></Card>}
      </div>

      {/* Edit user modal */}
      <Modal open={editModal} onClose={()=>setEditModal(false)} title="Edit User" subtitle={selected?.username} size="sm">
        <div className="space-y-4">
          <FormField label="Display Name"><Input placeholder="Alice" value={editForm.display_name} onChange={e=>setEditForm(f=>({...f,display_name:e.target.value}))}/></FormField>
          <FormField label="Role">
            <Select options={[{value:'joiner',label:'Joiner'},{value:'gom',label:'GOM'},{value:'admin',label:'Admin'}]} value={editForm.role} onChange={e=>setEditForm(f=>({...f,role:e.target.value as UserRole}))}/>
          </FormField>
          <div className="flex justify-end gap-3 pt-2"><Button variant="outline" onClick={()=>setEditModal(false)}>Cancel</Button><Button onClick={handleEdit} disabled={saving}>{saving?'Saving…':'Update'}</Button></div>
        </div>
      </Modal>

      {/* Password reset modal */}
      <Modal open={pwModal} onClose={()=>setPwModal(false)} title="Reset Password" subtitle={selected?.username} size="sm">
        <div className="space-y-4">
          <FormField label="New Password" required><Input type="password" placeholder="New password" value={newPassword} onChange={e=>setNewPassword(e.target.value)}/></FormField>
          <div className="flex justify-end gap-3 pt-2"><Button variant="outline" onClick={()=>setPwModal(false)}>Cancel</Button><Button onClick={handlePasswordReset} disabled={saving||!newPassword}>{saving?'Saving…':'Set Password'}</Button></div>
        </div>
      </Modal>

      {/* Create user modal */}
      <Modal open={createModal} onClose={()=>setCreateModal(false)} title="Create Account" size="sm">
        <div className="space-y-4">
          <FormField label="Username" required><Input placeholder="alice123" value={createForm.username} onChange={e=>setCreateForm(f=>({...f,username:e.target.value}))}/></FormField>
          <FormField label="Display Name"><Input placeholder="Alice" value={createForm.display_name} onChange={e=>setCreateForm(f=>({...f,display_name:e.target.value}))}/></FormField>
          <FormField label="Password" required><Input type="password" placeholder="••••••••" value={createForm.password} onChange={e=>setCreateForm(f=>({...f,password:e.target.value}))}/></FormField>
          <FormField label="Role"><Select options={[{value:'joiner',label:'Joiner'},{value:'gom',label:'GOM'},{value:'admin',label:'Admin'}]} value={createForm.role} onChange={e=>setCreateForm(f=>({...f,role:e.target.value as UserRole}))}/></FormField>
          <div className="flex justify-end gap-3 pt-2"><Button variant="outline" onClick={()=>setCreateModal(false)}>Cancel</Button><Button onClick={handleCreate} disabled={saving||!createForm.username||!createForm.password}>{saving?'Creating…':'Create'}</Button></div>
        </div>
      </Modal>
    </div>
  )
}
