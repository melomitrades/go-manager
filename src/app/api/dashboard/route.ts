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

  const [ordersSummary, deadlines, unpaid, leftoversRaw] = await Promise.all([

    // ── Orders summary by status ──────────────────────────────────────────────
    query(`
      SELECT status, COUNT(*) as count
      FROM orders
      WHERE status != 'closed'
      GROUP BY status
      ORDER BY status
    `).catch(() => []),

    // ── Deadlines in next 7 days ──────────────────────────────────────────────
    query(`
      SELECT
        o.id,
        o.deadline,
        o.round_number,
        o.status,
        s.name AS shop_name,
        g.name AS group_name
      FROM orders o
      LEFT JOIN shops s ON s.id = o.shop_id
      LEFT JOIN groups g ON g.id = o.group_id
      WHERE o.deadline IS NOT NULL
        AND o.deadline >= CURRENT_DATE
        AND o.deadline <= CURRENT_DATE + INTERVAL '7 days'
        AND o.status != 'closed'
      ORDER BY o.deadline ASC
    `).catch(() => []),

    // ── Overdue unpaid joiner claims (deadline passed, not paid) ─────────────
    // Derived from order_items so joiners who never submitted proof still appear
    query(`
      SELECT
        joiner_id,
        joiner_name,
        joiner_username,
        SUM(amount_eur) AS total_owed,
        json_agg(json_build_object(
          'order_id', order_id,
          'label', label,
          'deadline', deadline,
          'amount_eur', amount_eur
        ) ORDER BY deadline DESC) AS orders
      FROM (
        SELECT DISTINCT ON (oi.order_id, oi.joiner_id)
          oi.joiner_id,
          p.display_name AS joiner_name,
          p.username AS joiner_username,
          o.id AS order_id,
          o.deadline,
          CONCAT(
            COALESCE(s.name, '?'),
            CASE WHEN g.name IS NOT NULL THEN CONCAT(' · ', g.name) ELSE '' END,
            CASE WHEN o.round_number IS NOT NULL THEN CONCAT(' R', o.round_number) ELSE '' END
          ) AS label,
          COALESCE(SUM(oi.price_eur * oi.amount_claimed) OVER (PARTITION BY oi.order_id, oi.joiner_id), 0) AS amount_eur
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        LEFT JOIN shops s ON s.id = o.shop_id
        LEFT JOIN groups g ON g.id = o.group_id
        JOIN profiles p ON p.id = oi.joiner_id
        WHERE o.deadline IS NOT NULL
          AND o.deadline < NOW()
          AND o.status != 'closed'
          AND oi.joiner_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM order_joiner_paid ojp
            WHERE ojp.order_id = oi.order_id
              AND ojp.joiner_id = oi.joiner_id
              AND ojp.paid = true
          )
      ) sub
      GROUP BY joiner_id, joiner_name, joiner_username
      ORDER BY total_owed DESC
    `).catch(() => []),

    // ── Leftovers (same logic as /api/leftovers) ──────────────────────────────
    query(`
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
    `).catch(() => []),
  ])

  // ── Process leftovers server-side ─────────────────────────────────────────
  const leftovers = []
  for (const order of leftoversRaw as any[]) {
    const groupMembers: { id: string; name: string }[] = order.group_members || []
    const items: any[] = order.items || []
    const setSize = groupMembers.length
    const albumsBought = order.albums_bought
    const isMultiVersion = !!order.is_multi_version
    const isVceFansign = !!order.is_vce_fansign
    const isPerVersion = albumsBought && typeof albumsBought === 'object'

    const label = [
      order.group_name,
      order.round_number ? `R${order.round_number}` : null,
      order.shop_name,
    ].filter(Boolean).join(' · ')

    const computeLeftovers = (filteredItems: any[], bought: number | null, versionLabel?: string) => {
      if (setSize < 2) return null
      const counts: Record<string, number> = {}
      for (const m of groupMembers) counts[m.id] = 0
      for (const item of filteredItems) {
        if (item.member_id && counts[item.member_id] !== undefined) counts[item.member_id]++
      }
      const memberList = groupMembers.map(m => ({ id: m.id, name: m.name, count: counts[m.id] }))
      const totalClaims = memberList.reduce((s, m) => s + m.count, 0)

      if (bought != null) {
        const affordableSets = Math.floor(bought / setSize)
        const ls = memberList
          .map(m => ({ id: m.id, name: m.name, leftover: Math.max(0, affordableSets - m.count) }))
          .filter(m => m.leftover > 0)
        if (ls.length === 0) return null
        return { versionLabel, members: ls, type: 'album' as const }
      } else {
        if (totalClaims === 0) return null
        const maxClaims = Math.max(...memberList.map(m => m.count))
        if (maxClaims === 0) return null
        const ls = memberList
          .map(m => ({ id: m.id, name: m.name, leftover: maxClaims - m.count }))
          .filter(m => m.leftover > 0)
        if (ls.length === 0) return null
        return { versionLabel, members: ls, type: 'standard' as const }
      }
    }

    const sections: ReturnType<typeof computeLeftovers>[] = []
    if (isMultiVersion && isPerVersion) {
      let versionNames: string[] = []
      try { versionNames = Array.isArray(order.version_names) ? order.version_names : JSON.parse(order.version_names || '[]') } catch {}
      for (const vn of versionNames) {
        const vItems = items.filter(i => i.version_name === vn || (i.description || '').toLowerCase().includes(vn.toLowerCase()))
        const bought = (albumsBought as any)[vn] ?? null
        const s = computeLeftovers(vItems, bought != null ? parseInt(bought) : null, vn)
        if (s) sections.push(s)
      }
    } else if (isVceFansign && isPerVersion) {
      for (const [key, lbl] of [['vce', 'VCE'], ['fansign', 'Fansign']]) {
        const vItems = items.filter(i => new RegExp(key, 'i').test(i.description || ''))
        const bought = (albumsBought as any)[key] ?? null
        const s = computeLeftovers(vItems, bought != null ? parseInt(bought) : null, lbl)
        if (s) sections.push(s)
      }
    } else {
      const bought = albumsBought != null ? (typeof albumsBought === 'number' ? albumsBought : parseInt(albumsBought)) : null
      const s = computeLeftovers(items, bought)
      if (s) sections.push(s)
    }

    if (sections.length > 0) leftovers.push({ id: order.id, label, type: order.type, status: order.status, sections })
  }

  // ── Orders summary: last 30 days sparkline ────────────────────────────────
  const sparkline = await query(`
    SELECT DATE(created_at) AS day, COUNT(*) AS count
    FROM orders
    WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
    GROUP BY day ORDER BY day
  `).catch(() => [])

  return NextResponse.json({
    orders: {
      summary: ordersSummary,
      sparkline,
    },
    deadlines,
    unpaid: (unpaid as any[]).map(u => ({
      ...u,
      total_owed: parseFloat(u.total_owed) || 0,
      orders: u.orders.map((o: any) => ({ ...o, amount_eur: parseFloat(o.amount_eur) || 0 })),
    })),
    leftovers,
  })
}
