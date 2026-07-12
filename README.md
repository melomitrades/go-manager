# GO Manager

A full-stack group order management platform for K-pop GOMs (Group Order Managers), built with **Next.js 14 + Supabase**.

---

## Features

### GOM view
- **All Orders** — create group & personal orders, link members, pricing types (POB only / POB + inclusions / custom), auto-fancall creation
- **Boxes** — log EMS & customs fees per box (€ + ₩)
- **Payments** — track payments to kaddies, shops, proxies, sellers with covering log
- **Fancalls / Shops** — track fancalls, manage shop directory
- **K/C/J-Addy** — per-country address management with click-to-copy, arrived items tracker
- **Sending Out** — manage packages for At GOM orders, status updates
- **PC Sorter** — create sorting sessions, collect priority forms, run Timestamp or Fair sort algorithms
- **Settings** — groups & members, user account management

### Joiner view
- **My Orders** — view all orders they're part of
- **Deadlines** — calendar view with payment & shipping deadlines
- **Shipping** — step-by-step shipping status tracker
- **Payments** — upcoming payment deadlines, upload proof of payment
- **PC Sorter** — priority form with drag-to-reorder

### Admin view
- Everything GOM has, plus:
- **Dashboard** — stats summary (joiners, orders, payments, boxes)
- **Joiners** — manage all user accounts, change roles
- **All Payments** — full cross-joiner payment view

---

## Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router) |
| Styling | Tailwind CSS + custom design tokens |
| UI | Custom component library (Radix-based) |
| Auth | Supabase Auth |
| Database | Supabase (PostgreSQL) |
| Storage | Supabase Storage (payment proofs, addy photos) |
| State | React hooks + Zustand (where needed) |
| Theme | next-themes (light/dark toggle) |
| Fonts | DM Sans + DM Mono |

---

## Setup

### 1. Clone & install

```bash
git clone <your-repo>
cd go-manager
npm install
```

### 2. Create a Supabase project

Go to [supabase.com](https://supabase.com), create a new project.

### 3. Run the database migration

In your Supabase dashboard → **SQL Editor**, paste and run the contents of:

```
supabase/migrations/001_initial_schema.sql
```

This creates all tables, enums, RLS policies, and seeds the addy address rows.

### 4. Set up Storage buckets

In Supabase → **Storage**, create two buckets:
- `proofs` (private) — for joiner payment proof uploads
- `addy-photos` (private) — for addy item photos

### 5. Configure environment variables

```bash
cp .env.local.example .env.local
```

Edit `.env.local` with your Supabase project URL and anon key (found in Settings → API).

### 6. Create your first admin account

In Supabase → **Authentication → Users**, create a user manually. Then in **SQL Editor**, run:

```sql
insert into profiles (id, username, display_name, role)
values ('<user-id-from-auth>', 'admin', 'Admin', 'admin');
```

### 7. Run the app

```bash
npm run dev
```

Visit `http://localhost:3000` — you'll be redirected to `/login`.

---

## Role routing

| Role | Default redirect | Access |
|---|---|---|
| `admin` | `/admin/dashboard` | Everything |
| `gom` | `/gom/orders` | GOM tabs |
| `joiner` | `/joiner/orders` | Joiner tabs |

---

## PC Sorting algorithms

**Timestamp sort** — Forms are sorted by submission time. Joiners who submitted earlier get first pick at their top priority.

**Fair sort** — Goes through priority levels 1→N. At each level, all joiners who listed that priority compete simultaneously. If stock runs out, unfulfilled joiners automatically cascade to priority level N+1 (they don't lose their chance). This ensures no single joiner dominates by submitting early.

---

## Currency rules

- Everything displayed in **€** (EUR)
- Exception: **EMS fees** (Boxes page) → shown in both € and ₩
- Exception: **Payments** page → shown in both € and ₩

---

## Extending

- **Notifications** — the `notifications` table and types are set up; wire up a cron job (Supabase Edge Functions + pg_cron) to send 48h/24h/1h deadline alerts
- **Email** — use Supabase's built-in email or connect Resend/Postmark via Edge Functions
- **File uploads** — addy item photos use `addy-photos` bucket; extend `addy/page.tsx` with `supabase.storage.from('addy-photos').upload(...)`
