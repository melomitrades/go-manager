'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { Plus, Pencil, Trash2, ChevronDown, ChevronRight, GripVertical, KeyRound, Eye, EyeOff } from 'lucide-react'
import { Button, Card, CardHeader, CardContent, Modal, Input, FormField, PageHeader } from '@/components/ui'
import type { Group, Member, Profile } from '@/types'

export default function GomSettingsPage() {
  const [groups, setGroups] = useState<Group[]>([])
  const [users, setUsers] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [activeSection, setActiveSection] = useState<'groups' | 'users' | 'shops'>('groups')
  const [shops, setShops] = useState<any[]>([])
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null)

  // Local member order state (per group, for optimistic drag reorder)
  const [memberOrder, setMemberOrder] = useState<Record<string, Member[]>>({})

  // Drag state
  const dragIdx = useRef<number | null>(null)
  const dragGroupId = useRef<string | null>(null)

  const [shopModal, setShopModal] = useState(false)
  const [editingShop, setEditingShop] = useState<any>(null)
  const [shopForm, setShopForm] = useState({ name:'', website:'', ships_to_korea:false, accepts_id:false })
  const [groupModal, setGroupModal] = useState(false)
  const [editingGroup, setEditingGroup] = useState<Group | null>(null)
  // fixedJoiners: { joiner_id: string; member_ids: string[] }[]
  const [fixedJoiners, setFixedJoiners] = useState<{ joiner_id: string; member_ids: string[] }[]>([])
  const [showPasswords, setShowPasswords] = useState(false)
  const [userSearch, setUserSearch] = useState('')
  const [groupName, setGroupName] = useState('')
  const [memberModal, setMemberModal] = useState(false)
  const [memberGroupId, setMemberGroupId] = useState('')
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null)
  const [memberName, setMemberName] = useState('')
  const [userModal, setUserModal] = useState(false)
  const [editingUser, setEditingUser] = useState<Profile | null>(null)
  const [userForm, setUserForm] = useState({ username: '', display_name: '', password: '', role: 'joiner' as 'joiner' | 'gom' | 'admin' })
  const [saving, setSaving] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [g, u, shops_data] = await Promise.all([
      fetch('/api/groups').then(r => r.json()),
      fetch('/api/users').then(r => r.json()),
      fetch('/api/shops').then(r => r.json()),
    ])
    setGroups(Array.isArray(g) ? g : [])
    const sortedUsers = Array.isArray(u) ? [...u].sort((a: any, b: any) => (a.display_name || a.username || '').localeCompare(b.display_name || b.username || '')) : []
    setUsers(sortedUsers)
    setShops(Array.isArray(shops_data) ? shops_data : [])
    // Sync memberOrder from fetched data
    const order: Record<string, Member[]> = {}
    if (Array.isArray(g)) g.forEach((group: Group) => { if (group.members) order[group.id] = group.members })
    setMemberOrder(order)
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // ── Drag & drop ───────────────────────────────────────
  function onDragStart(groupId: string, idx: number) {
    dragIdx.current = idx
    dragGroupId.current = groupId
  }

  function onDragOver(e: React.DragEvent, groupId: string, idx: number) {
    e.preventDefault()
    if (dragGroupId.current !== groupId) return
    if (dragIdx.current === null || dragIdx.current === idx) return

    setMemberOrder(prev => {
      const list = [...(prev[groupId] || [])]
      const [moved] = list.splice(dragIdx.current!, 1)
      list.splice(idx, 0, moved)
      dragIdx.current = idx
      return { ...prev, [groupId]: list }
    })
  }

  async function onDrop(groupId: string) {
    dragIdx.current = null
    dragGroupId.current = null
    // Persist new order
    const list = memberOrder[groupId] || []
    await fetch('/api/members', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reorder: list.map((m, i) => ({ id: m.id, sort_order: i }))
      }),
    })
  }

  // ── Group CRUD ────────────────────────────────────────
  async function saveGroup() {
    setSaving(true)
    if (editingGroup) {
      await fetch('/api/groups', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: editingGroup.id, name: groupName, fixed_joiners: fixedJoiners }) })
    } else {
      await fetch('/api/groups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: groupName }) })
    }
    setGroupModal(false); setGroupName(''); setEditingGroup(null)
    fetchData(); setSaving(false)
  }

  async function deleteGroup(id: string) {
    if (!confirm('Delete this group and all its members?')) return
    await fetch('/api/groups', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    fetchData()
  }

  // ── Member CRUD ───────────────────────────────────────
  async function saveMember() {
    setSaving(true)
    if (editingMemberId) {
      await fetch('/api/members', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: editingMemberId, name: memberName }) })
    } else {
      await fetch('/api/members', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ group_id: memberGroupId, name: memberName }) })
    }
    setMemberModal(false); setMemberName(''); setEditingMemberId(null)
    fetchData(); setSaving(false)
  }

  async function deleteMember(id: string) {
    await fetch('/api/members', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    fetchData()
  }

  // ── User CRUD ─────────────────────────────────────────
  function openNewUser() { setEditingUser(null); setUserForm({ username: '', display_name: '', password: '', role: 'joiner' }); setUserModal(true) }
  function openEditUser(u: Profile) { setEditingUser(u); setUserForm({ username: u.username, display_name: u.display_name || '', password: '', role: u.role as any }); setUserModal(true) }

  async function saveUser() {
    setSaving(true)
    if (editingUser) {
      const payload: any = { id: editingUser.id, role: userForm.role, display_name: userForm.display_name, username: userForm.username }
      if (userForm.password) payload.password = userForm.password
      await fetch('/api/users', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    } else {
      await fetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(userForm) })
    }
    setUserModal(false); setUserForm({ username: '', display_name: '', password: '', role: 'joiner' }); setEditingUser(null)
    fetchData(); setSaving(false)
  }

  async function deleteUser(id: string, name: string) {
    if (!confirm('Delete ' + name + '?')) return
    await fetch('/api/users', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    fetchData()
  }

  async function updateUserRole(id: string, role: string) {
    await fetch('/api/users', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, role }) })
    fetchData()
  }

  async function saveShop() {
    setSaving(true)
    if (editingShop) {
      await fetch('/api/shops', { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({...shopForm, id:editingShop.id}) })
    } else {
      await fetch('/api/shops', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(shopForm) })
    }
    setShopModal(false); setEditingShop(null); fetchData(); setSaving(false)
  }

  async function deleteShop(id: string) {
    if (!confirm('Delete this shop?')) return
    await fetch('/api/shops', { method:'DELETE', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id }) })
    fetchData()
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Settings" subtitle="Groups, members and accounts" />

      {/* Tabs */}
      <div className="flex border-b border-border px-4 sm:px-6 overflow-x-auto">
        {([['groups', 'Groups & Members'], ['users', 'User Accounts'], ['shops', 'Shops']] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setActiveSection(key)}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${activeSection === key ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto p-4 sm:p-6">
        {loading
          ? <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
          : activeSection === 'groups' ? (
            <div className="space-y-4">
              <div className="flex justify-end">
                <Button onClick={() => { setEditingGroup(null); setGroupName(''); setGroupModal(true) }}>
                  <Plus size={16} /> New Group
                </Button>
              </div>

              {groups.map(group => {
                const members = memberOrder[group.id] || group.members || []
                const isExpanded = expandedGroup === group.id

                return (
                  <Card key={group.id}>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <button
                          className="flex items-center gap-2 font-medium hover:text-primary transition-colors"
                          onClick={() => setExpandedGroup(isExpanded ? null : group.id)}
                        >
                          {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                          {group.name}
                          <span className="text-xs text-muted-foreground font-normal">({members.length})</span>
                        </button>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" onClick={() => { setEditingGroup(group); setGroupName(group.name); try { const parsed = JSON.parse((group as any).fixed_joiners||'[]'); setFixedJoiners(parsed.map((f:any) => ({ joiner_id: f.joiner_id, member_ids: f.member_ids || (f.member_id ? [f.member_id] : []) }))) } catch { setFixedJoiners([]) } setGroupModal(true) }}>
                            <Pencil size={14} />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => deleteGroup(group.id)}>
                            <Trash2 size={14} className="text-destructive" />
                          </Button>
                        </div>
                      </div>
                    </CardHeader>

                    {isExpanded && (
                      <CardContent>
                        <div
                          className="space-y-1"
                          onDragOver={e => e.preventDefault()}
                          onDrop={() => onDrop(group.id)}
                        >
                          {members.map((m, idx) => (
                            <div
                              key={m.id}
                              draggable
                              onDragStart={() => onDragStart(group.id, idx)}
                              onDragOver={e => onDragOver(e, group.id, idx)}
                              className="flex items-center justify-between py-2 px-2 rounded-lg hover:bg-secondary/50 transition-colors group cursor-default"
                            >
                              {/* Drag handle */}
                              <div className="flex items-center gap-2 flex-1 min-w-0">
                                <GripVertical
                                  size={14}
                                  className="text-muted-foreground/40 group-hover:text-muted-foreground cursor-grab active:cursor-grabbing flex-shrink-0 transition-colors"
                                />
                                <span className="text-sm truncate">{m.name}</span>
                              </div>

                              {/* Actions */}
                              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Button
                                  variant="ghost" size="icon"
                                  onClick={() => { setEditingMemberId(m.id); setMemberName(m.name); setMemberGroupId(group.id); setMemberModal(true) }}
                                >
                                  <Pencil size={12} />
                                </Button>
                                <Button variant="ghost" size="icon" onClick={() => deleteMember(m.id)}>
                                  <Trash2 size={12} className="text-destructive" />
                                </Button>
                              </div>
                            </div>
                          ))}

                          {members.length > 1 && (
                            <p className="text-xs text-muted-foreground/60 text-center pt-1">
                              Drag <GripVertical size={10} className="inline" /> to reorder
                            </p>
                          )}

                          <Button
                            variant="outline" size="sm" className="w-full mt-2"
                            onClick={() => { setMemberGroupId(group.id); setEditingMemberId(null); setMemberName(''); setMemberModal(true) }}
                          >
                            <Plus size={14} /> Add Member
                          </Button>
                        </div>
                      </CardContent>
                    )}
                  </Card>
                )
              })}
            </div>
          ) : activeSection === 'shops' ? (
            <div className="space-y-4">
              <div className="flex justify-end">
                <Button onClick={() => { setEditingShop(null); setShopForm({name:'',website:'',ships_to_korea:false,accepts_id:false}); setShopModal(true) }}>
                  <Plus size={16} /> Add Shop
                </Button>
              </div>
              {shops.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-12">No shops yet. Add your first shop.</p>
              ) : (
                <div className="space-y-3">
                  {shops.map(s => (
                    <Card key={s.id}>
                      <div className="flex items-center justify-between px-5 py-4">
                        <div>
                          <p className="font-semibold text-sm">{s.name}</p>
                          <div className="flex items-center gap-3 mt-1">
                            {s.website && <a href={s.website} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">{s.website}</a>}
                            {s.ships_to_korea && <span className="text-xs text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">Ships to Korea</span>}
                            {s.accepts_id && <span className="text-xs text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">Accepts ID</span>}
                          </div>
                        </div>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" onClick={() => { setEditingShop(s); setShopForm({name:s.name,website:s.website||'',ships_to_korea:s.ships_to_korea||false,accepts_id:s.accepts_id||false}); setShopModal(true) }}><Pencil size={14}/></Button>
                          <Button variant="ghost" size="icon" onClick={() => deleteShop(s.id)}><Trash2 size={14} className="text-destructive"/></Button>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="relative flex-1 max-w-xs">
                  <input
                    type="text"
                    placeholder="Search users…"
                    value={userSearch}
                    onChange={e => setUserSearch(e.target.value)}
                    className="w-full pl-3 pr-8 py-2 text-sm border border-border rounded-xl bg-background focus:outline-none focus:ring-2 focus:ring-primary/25"
                  />
                  {userSearch && <button onClick={() => setUserSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">×</button>}
                </div>
                <button onClick={() => setShowPasswords(v => !v)} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors flex-shrink-0">
                  {showPasswords ? <><EyeOff size={14}/> Hide passwords</> : <><Eye size={14}/> Show passwords</>}
                </button>
                <Button onClick={openNewUser}><Plus size={16} /> Add User</Button>
              </div>
              <Card>
                <div className="divide-y divide-border">
                  {users.filter((u: any) => !userSearch || (u.username||'').toLowerCase().includes(userSearch.toLowerCase()) || (u.display_name||'').toLowerCase().includes(userSearch.toLowerCase())).map(u => (
                    <div key={u.id} className="flex items-center justify-between px-5 py-3 group">
                      <div>
                        <p className="font-semibold text-sm">{u.display_name || u.username}</p>
                        <div className="flex items-center gap-2">
                          <p className="text-xs text-muted-foreground">{u.username} · {u.role}</p>
                          {showPasswords && (
                            <span className={`text-xs font-mono px-2 py-0.5 rounded-lg border ${(u as any).password_plain ? 'bg-secondary border-border text-muted-foreground' : 'bg-amber-50 border-amber-200 text-amber-600'}`}>
                              {(u as any).password_plain || '⚠ not stored — reset to view'}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {u.role === 'joiner' && (u as any).is_fixed && (
                          <span
                            title="Marked as a Fixed Joiner in one or more groups — gets +2 raffle entries"
                            className="text-xs font-semibold px-2 py-1 rounded-lg border bg-primary text-white border-primary flex-shrink-0">
                            📌 Fixed
                          </span>
                        )}
                        <Button variant="ghost" size="icon" onClick={() => openEditUser(u)}><Pencil size={13}/></Button>
                        <Button variant="ghost" size="icon" onClick={() => deleteUser(u.id, u.display_name || u.username)}><Trash2 size={13} className="text-destructive/50 hover:text-destructive"/></Button>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          )
        }
      </div>

      {/* Group modal */}
      <Modal open={groupModal} onClose={() => setGroupModal(false)} title={editingGroup ? 'Edit Group' : 'New Group'} size="md">
        <div className="space-y-4">
          <FormField label="Group Name" required>
            <Input placeholder="e.g. BTS" value={groupName} onChange={e => setGroupName(e.target.value)} />
          </FormField>
          {editingGroup && (() => {
            const groupMembers: any[] = (editingGroup as any).members || []
            const joinerUsers = users.filter((u:any) => u.role === 'joiner')
            return (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Fixed Joiners</p>
                <p className="text-xs text-muted-foreground">Auto-added with their default member when logging a new order for this group. Fixed joiners also get +2 entries on every raffle.</p>
                <div className="border border-border rounded-xl overflow-hidden divide-y divide-border">
                  {joinerUsers.length === 0 && <p className="text-sm text-muted-foreground p-3">No joiners found</p>}
                  {joinerUsers.map((u:any) => {
                    const entry = fixedJoiners.find(f => f.joiner_id === u.id)
                    const isFixed = !!entry
                    return (
                      <div key={u.id} className={`flex items-center gap-3 px-3 py-2.5 ${isFixed ? 'bg-primary/5' : ''}`}>
                        <input type="checkbox" checked={isFixed}
                          onChange={() => {
                            if (isFixed) {
                              setFixedJoiners(prev => prev.filter(f => f.joiner_id !== u.id))
                            } else {
                              setFixedJoiners(prev => [...prev, { joiner_id: u.id, member_ids: [] }])
                            }
                          }}
                          className="w-4 h-4 rounded accent-primary flex-shrink-0"/>
                        <span className={`text-sm flex-1 ${isFixed ? 'font-semibold text-primary' : ''}`}>{u.display_name || u.username}</span>
                        {isFixed && groupMembers.length > 0 && (
                          <div className="flex flex-wrap gap-1 flex-1 justify-end">
                            {groupMembers.map((m:any) => {
                              const sel = (entry?.member_ids || []).includes(m.id)
                              return (
                                <button key={m.id} type="button"
                                  onClick={() => setFixedJoiners(prev => prev.map(f => {
                                    if (f.joiner_id !== u.id) return f
                                    const ids = sel ? f.member_ids.filter(id => id !== m.id) : [...f.member_ids, m.id]
                                    return { ...f, member_ids: ids }
                                  }))}
                                  className={`text-xs px-2 py-0.5 rounded-full border font-semibold transition-all ${sel ? 'bg-primary text-white border-primary' : 'bg-background text-muted-foreground border-border hover:border-primary/50'}`}>
                                  {m.name}
                                </button>
                              )
                            })}
                          </div>
                        )}
                        {isFixed && <span className="text-xs text-primary/50 flex-shrink-0">📌</span>}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setGroupModal(false)}>Cancel</Button>
            <Button onClick={saveGroup} disabled={saving || !groupName}>{saving ? 'Saving…' : editingGroup ? 'Update' : 'Create'}</Button>
          </div>
        </div>
      </Modal>

      {/* Member modal */}
      <Modal open={memberModal} onClose={() => setMemberModal(false)} title={editingMemberId ? 'Edit Member' : 'Add Member'} size="sm">
        <div className="space-y-4">
          <FormField label="Member Name" required>
            <Input placeholder="e.g. RM" value={memberName} onChange={e => setMemberName(e.target.value)} />
          </FormField>
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setMemberModal(false)}>Cancel</Button>
            <Button onClick={saveMember} disabled={saving || !memberName}>{saving ? 'Saving…' : 'Save'}</Button>
          </div>
        </div>
      </Modal>

      {/* Shop modal */}
      <Modal open={shopModal} onClose={() => { setShopModal(false); setEditingShop(null) }} title={editingShop ? 'Edit Shop' : 'Add Shop'} size="sm">
        <div className="space-y-4">
          <FormField label="Name" required><Input placeholder="Weverse Shop" value={shopForm.name} onChange={e=>setShopForm(f=>({...f,name:e.target.value}))}/></FormField>
          <FormField label="Website"><Input type="url" placeholder="https://…" value={shopForm.website} onChange={e=>setShopForm(f=>({...f,website:e.target.value}))}/></FormField>
          <label className="flex items-center gap-2.5 cursor-pointer"><input type="checkbox" checked={shopForm.ships_to_korea} onChange={e=>setShopForm(f=>({...f,ships_to_korea:e.target.checked}))} className="accent-primary w-4 h-4 rounded"/><span className="text-sm font-medium">Ships to Korea (EN site)</span></label>
          <label className="flex items-center gap-2.5 cursor-pointer"><input type="checkbox" checked={shopForm.accepts_id} onChange={e=>setShopForm(f=>({...f,accepts_id:e.target.checked}))} className="accent-primary w-4 h-4 rounded"/><span className="text-sm font-medium">Accepts ID / Passport</span></label>
          <div className="flex justify-end gap-3 pt-2"><Button variant="outline" onClick={()=>{setShopModal(false);setEditingShop(null)}}>Cancel</Button><Button onClick={saveShop} disabled={saving||!shopForm.name}>{saving?'Saving…':editingShop?'Update':'Save'}</Button></div>
        </div>
      </Modal>

      {/* User modal */}
      <Modal open={userModal} onClose={() => setUserModal(false)} title={editingUser ? 'Edit User' : 'Add User'} size="sm">
        <div className="space-y-4">
          <FormField label="Display Name">
            <Input placeholder="Alice" value={userForm.display_name} onChange={e => setUserForm(f => ({ ...f, display_name: e.target.value }))} />
          </FormField>
          <FormField label="Username" required>
            <Input placeholder="alice123" value={userForm.username} onChange={e => setUserForm(f => ({ ...f, username: e.target.value }))} />
          </FormField>
          <FormField label={editingUser ? 'New Password' : 'Password'} required={!editingUser}>
            <div className="relative">
              <KeyRound size={13} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input type="password" placeholder={editingUser ? 'Leave blank to keep current' : '••••••••'} className="pl-9" value={userForm.password} onChange={e => setUserForm(f => ({ ...f, password: e.target.value }))} />
            </div>
          </FormField>
          <FormField label="Role">
            <select value={userForm.role} onChange={e => setUserForm(f => ({ ...f, role: e.target.value as any }))} className="w-full px-3.5 py-2.5 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
              <option value="joiner">Joiner</option>
              <option value="gom">GOM</option>
              <option value="admin">Admin</option>
            </select>
          </FormField>
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setUserModal(false)}>Cancel</Button>
            <Button onClick={saveUser} disabled={saving || !userForm.username || (!editingUser && !userForm.password)}>{saving ? 'Saving…' : editingUser ? 'Update' : 'Create'}</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
