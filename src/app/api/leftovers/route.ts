import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  if (user.role !== 'gom' && user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Fetch all active non-archived orders with their group members and items
  const orders = await query(`
    SELECT
      o.id,
      o.status,
      o.type,
      o.round_number,
      o.albums_bought,
      o.is_vce_fansign,
      o.is_multi_version,
      o.version_names,
      o.hide_leftovers,
      s.name AS shop_name,
      g.id AS group_id,
      g.name AS group_name,
      (
        SELECT json_agg(json_build_object('id', m.id, 'name', m.name) ORDER BY m.sort_order NULLS LAST, m.name)
        FROM members m WHERE m.group_id = g.id
      ) AS group_members,
      (
        SELECT json_agg(json_build_object(
          'member_id', oi.member_id,
          'description', oi.description,
          'version_name', oi.version_name
        ))
        FROM order_items oi WHERE oi.order_id = o.id
      ) AS items
    FROM orders o
    LEFT JOIN shops s ON s.id = o.shop_id
    LEFT JOIN groups g ON g.id = o.group_id
    WHERE o.status != 'closed' AND o.hide_leftovers IS NOT TRUE
    ORDER BY o.created_at DESC
  `) as any[]

  const results = []

  for (const order of orders) {
    const groupMembers: { id: string; name: string }[] = order.group_members || []
    const items: { member_id: string | null; description: string | null; version_name: string | null }[] = order.items || []
    const setSize = groupMembers.length
    const albumsBought = order.albums_bought  // may be number or object
    const isMultiVersion = !!order.is_multi_version
    const isVceFansign = !!order.is_vce_fansign
    const isPerVersion = albumsBought && typeof albumsBought === 'object'

    const label = [
      order.group_name,
      order.round_number ? `R${order.round_number}` : null,
      order.shop_name,
    ].filter(Boolean).join(' · ')

    // ── helper: compute leftovers for a given subset of items and album count ──
    const computeLeftovers = (
      filteredItems: typeof items,
      bought: number | null,
      versionLabel?: string
    ): { versionLabel?: string; members: { id: string; name: string; leftover: number }[]; type: 'album' | 'standard' } | null => {
      if (setSize < 2) return null

      // Count claims per member
      const counts: Record<string, number> = {}
      for (const m of groupMembers) counts[m.id] = 0
      for (const item of filteredItems) {
        if (item.member_id && counts[item.member_id] !== undefined) counts[item.member_id]++
      }
      const memberList = groupMembers.map(m => ({ id: m.id, name: m.name, count: counts[m.id] }))
      const totalClaims = memberList.reduce((s, m) => s + m.count, 0)

      if (bought != null) {
        // Album-based leftovers: surplus slots per member
        const affordableSets = Math.floor(bought / setSize)
        const leftovers = memberList
          .map(m => ({ id: m.id, name: m.name, leftover: Math.max(0, affordableSets - m.count) }))
          .filter(m => m.leftover > 0)
        if (leftovers.length === 0) return null
        return { versionLabel, members: leftovers, type: 'album' }
      } else {
        // Standard leftover calculator: unclaimed member slots
        if (totalClaims === 0) return null
        const maxClaims = Math.max(...memberList.map(m => m.count))
        if (maxClaims === 0) return null
        const leftovers = memberList
          .map(m => ({ id: m.id, name: m.name, leftover: maxClaims - m.count }))
          .filter(m => m.leftover > 0)
        if (leftovers.length === 0) return null
        return { versionLabel, members: leftovers, type: 'standard' }
      }
    }

    const sections: ReturnType<typeof computeLeftovers>[] = []

    if (isMultiVersion && isPerVersion) {
      let versionNames: string[] = []
      try { versionNames = Array.isArray(order.version_names) ? order.version_names : JSON.parse(order.version_names || '[]') } catch { }
      for (const vn of versionNames) {
        const vItems = items.filter(i => i.version_name === vn || (i.description || '').toLowerCase().includes(vn.toLowerCase()))
        const bought = (albumsBought as any)[vn] ?? null
        const s = computeLeftovers(vItems, bought != null ? parseInt(bought) : null, vn)
        if (s) sections.push(s)
      }
    } else if (isVceFansign && isPerVersion) {
      for (const [key, label] of [['vce', 'VCE'], ['fansign', 'Fansign']]) {
        const vItems = items.filter(i => new RegExp(key, 'i').test(i.description || ''))
        const bought = (albumsBought as any)[key] ?? null
        const s = computeLeftovers(vItems, bought != null ? parseInt(bought) : null, label)
        if (s) sections.push(s)
      }
    } else {
      const bought = albumsBought != null ? (typeof albumsBought === 'number' ? albumsBought : parseInt(albumsBought)) : null
      const s = computeLeftovers(items, bought)
      if (s) sections.push(s)
    }

    if (sections.length > 0) {
      results.push({
        id: order.id,
        label,
        type: order.type,
        status: order.status,
        sections,
      })
    }
  }

  return NextResponse.json(results)
}
