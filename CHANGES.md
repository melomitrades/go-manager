# Packing: joiner's note as the last step + full name in the address preview — 2026-10-28

**Edited:** `src/app/gom/sending-out/page.tsx`

- **Pack wizard:** when the joiner filled in the Notes field on their shipping form, it's shown as an extra **final step**
  after every item (highlighted card, line breaks kept). It's not a checklist row: nothing to confirm or skip, and it
  doesn't count in progress. The subtitle shows "+ note" so the GOM knows one is coming. Empty notes add no step.
- **Shipment list address preview:** shows the **full name** (bold) above the address, and keeps the address's line breaks.
- **Shipping Address** in the GOM's manual-entry and edit forms is now a **multi-line text box** (3 rows, resizable), like
  the joiner form already was.

# Packing order by group/shop + pack marks (📦 / ✉️ / ✅) on orders — 2026-10-25

No manual SQL needed: nothing new is stored, marks are read from the existing packing checklist (`shipment_items`).

**New:** `src/components/shared/PackMark.tsx`
**Edited:** `src/lib/shipments.ts`, `src/lib/winnerItems.ts`, `src/app/api/orders/route.ts`, `src/app/api/orders/[id]/route.ts`,
`src/app/api/pc-sorter/results/route.ts`, `src/app/gom/sending-out/page.tsx`, `src/app/joiner/shipping/page.tsx`,
`src/app/gom/orders/page.tsx`, `src/app/joiner/orders/page.tsx`, `src/components/shared/OrderDetail.tsx`, `src/components/shared/WinnerItems.tsx`

## Packing order
- Claimed orders in the Pack wizard are sorted by **group A→Z**, then **shop A→Z**, then round number (#2 before #10). Orders
  with no group (personal orders) come last. Sorted photocards and winner items stay at the end, as before.
- Each order step has a **group banner**: group name, "Group 1 of 3", and "Order 2 of 5" within that group.
- The joiner's Shipping page "Your items" list follows the same order.

## Pack marks
- 📦 **Packed**: the claim's step was confirmed in the Pack wizard (shows right away, before "Mark as Packed").
- Crossed-out box **Skipped**: skipped in the Pack wizard. It stays skipped even after shipping, because it wasn't in the parcel.
- ✉️ **Shipped**: confirmed and the shipment status is Shipped. Hover shows the shipping form and tracking code.
- ✅ **Received**: confirmed and the shipment status is Complete.
- Where: next to each claim in the order detail (GOM: inside each member pill; joiner: on the claim line), next to each
  sorted photocard ("Sorting results"), on winner items (GOM order/era lists, joiner My Orders), and as a count summary
  on each order row in the Orders list (GOM all claims, joiner only their own).
- Resetting packing progress removes the marks again. Unconfirmed items in a shipped shipment get no mark.

# Events (every event entered, won or lost) + winner items from events — 2026-10-24

No manual SQL needed: `era_events` self-migrates, `winner_items` gets `event_id`.

**New:** `src/lib/events.ts`, `src/lib/eventTypes.ts`, `src/components/shared/Events.tsx`, `src/components/shared/FancallArchive.tsx`,
`src/app/api/events/route.ts`, `src/app/api/events/options/route.ts`, `src/app/gom/events/page.tsx`
**Edited:** `src/lib/winnerItems.ts`, `src/components/shared/WinnerItems.tsx`, `src/app/api/winner-items/route.ts`,
`src/app/api/winner-items/options/route.ts`, `src/app/api/orders/route.ts`, `src/app/api/orders/[id]/route.ts`, `src/app/api/eras/route.ts`,
`src/app/gom/eras/[id]/page.tsx`, `src/app/gom/fancalls/page.tsx` (now a redirect), `src/app/gom/dashboard/page.tsx`,
`src/components/shared/Sidebar.tsx`, `src/components/shared/EraManager.tsx`

## Events
- Sidebar **Fancalls → Events**. Tabs: **Events** (all types, filter by era — active eras by default —, type, result) and **Archive**.
- An event = Fansign, Fancall, DIY event, Lucky draw, VCE, POB / pre-order event or Other + name. Era + type required; order
  optional (one); date & time (Paris), shop, entered by, entries / albums used, **winner spots**, note.
- **Result chips: Pending / Won / Lost.** Lost = we didn't get any winner item. Totals: "4 entered · 1 won · 1 lost · 2 pending · win rate 50%".
- Setting **Won** (chip, form or dashboard) opens "Add winner item" for that event. An event with winner items can't be set to Lost
  or deleted.
- **Raffle** stays on Fancall events with an order (same entries + fixed / semi-fixed bonus). The order's 🏆 raffle badge reads
  Fancall events and archive fancalls.
- A new **fancall order in an era** creates a Fancall event (Pending). Without an era it still creates an archive fancall row.
- "Benefits to K-Addy" isn't on events. "Received" is tracked on winner items only.
- **Era page:** an Events section above Winner items, same list + totals for that era.
- **Dashboard:** "Results to enter" card (Pending events whose date has passed) with Won / Lost buttons. Hidden when empty.

## Winner items
- Every new item is **won at an event** ("Won at" picker + "+ New event"). Era, order, source and date come from the event and
  follow it when the event is edited. Adding an item to a Pending event marks it Won. Lost events can't be picked.
- Item status "Lost" renamed **Missing** (existing rows converted). "Won (pending)" now reads **Not received yet**.
- Era page groups items **by event**.

## Archive (before events)
- Old fancall records → Events → **Archive** (unchanged table, still editable, raffle included, can still add one).
- Winner items without an event → collapsible **"🗄 Archive (before events)"** block on the era page, grouped by order, still editable
  with their own order / source / fancall / date fields. Shipping and joiner views treat them exactly as before.

# Winner items (polaroids, signed PCs…) — 2026-10-24

No manual SQL needed: the new tables self-migrate on first use (`winner_items`, `winner_item_types`).

**New:** `src/lib/winnerItems.ts`, `src/components/shared/WinnerItems.tsx`, `src/app/api/winner-items/route.ts`,
`src/app/api/winner-items/options/route.ts`, `src/app/api/winner-items/types/route.ts`, `src/app/api/winner-items/[id]/photo/route.ts`
**Edited:** `src/lib/shipments.ts`, `src/app/gom/eras/[id]/page.tsx`, `src/app/gom/eras/page.tsx`, `src/components/shared/OrderDetail.tsx`,
`src/app/joiner/orders/page.tsx`, `src/app/gom/sending-out/page.tsx`, `src/app/joiner/shipping/page.tsx`, `src/app/api/orders/route.ts`,
`src/app/api/eras/route.ts`, `src/components/shared/EraManager.tsx`

## What an item is
- One row per physical item. "How many identical items?" on Add, and a Duplicate button on each row (the copy isn't kept/sold yet).
- **Type:** Polaroid and Signed PC built in, plus your own types ("+ New type" in the form, or **Types** on the era page to rename / archive).
  Archived types stay on existing items but aren't offered for new ones.
- **Members:** one or several of the era's group, or "Not revealed yet". Optional photo (resized), GOM-only note, era version.

## Where it came from
- Fansign, Fancall, DIY event, Lucky draw, VCE, POB / pre-order event, or Other + your own name.
- **Fancall:** pick an existing record from the Fancalls tab (this era's first); its date becomes the event date (Paris day).
- Event date required; received date optional.

## Link
- Era required. Order optional (one), and optionally the part of the order (version / VCE / Fansign). With an order, the era always
  follows the order's era. Deleting an order keeps its items on the era without an order; deleting an era deletes its items.

## Status
- Won (pending) → Received → Listed for sale → Kept / Sold / Given away / Lost. Setting Received fills today's received date if empty.
- **Kept by** a GOM/admin. **Sold to** / **Given to** any user. Sold: price € and/or ₩ + sale date (today if empty).
  Tracking only: no joiner payment, not counted in GOM payments coverage.

## Where it shows
- **Era page → Winner items:** grouped by order (+ "No order"), filters (type, member, source, status), totals
  ("5 items · 1 pending · 1 kept · 2 sold · 1 given · 84,00 € sold"), Add per order.
- **Eras list:** "🏆 N winner items" on each era card.
- **GOM order panel:** "🏆 N winner items" block with Add / edit / duplicate / delete (needs the order to be in an era).
- **Joiners:** the buyer / recipient sees "🏆 My winner items" on My Orders (type, members, source + date, version, photo, price paid or
  "Gift", order), a "🏆 Winner item" badge on that order, and the item in the order's detail. They're notified when it's handed to them.
  They never see notes, who kept what, or other people's items.

## Shipping
- A sold / given item joins the recipient's packing checklist as one "🏆 Winner items" step (after claimed items and sorted
  photocards) when it's in one of the form's boxes and physically at the GOM:
  - with an order: the order is in a form box, and the order is At GOM **or** the item has a received date;
  - without an order: "Ship with box…" is set to a form box **and** it has a received date.
- Also makes the joiner eligible for that shipping form. Shown on the joiner's Shipping → Your items.

# PC Sorter: complete a submitted form with new options — 2026-10-24

**Edited:** `src/app/joiner/pc-sorter/page.tsx`, `src/app/api/pc-sorter/[sessionId]/route.ts`, `src/lib/pcSorter.ts`,
`src/app/gom/pc-sorter/page.tsx`

- **Joiners:** after submitting, if options appear that weren't on the form (an item whose quantities were all 0,
  a member added later), the Sorting page shows "New options to rank" while the form is open, for the affected
  items only. A brand-new item is ranked from scratch; an item that got a new member is **re-ranked entirely**
  (their previous order is the starting point, the new member is marked "new" at the bottom). "Save new ranking"
  replaces their ranking of those items only — every other item stays as submitted. Their submission time is kept.
- **GOM:** each submitted form in "Forms & Inclusions" shows "⚠ N new options not ranked yet" when that applies.
  The form must be open (reopen it if you closed it) for joiners to complete.
- **Sort fix:** a joiner who submitted but has no ranking for an item (or whose ranked options ran out while
  unranked ones remain) used to get nothing for it. They now get a random pick from what's left, served before
  non-submitters (by submission time).

# PC Sorter: packs of different sizes (e.g. Bread set 44 pcs / Letter set 30 pcs) — 2026-10-24

No manual SQL needed: the new columns self-migrate on first use.

**Edited:** `src/lib/pcSorter.ts`, `src/app/api/pc-sorter/route.ts`, `src/app/gom/pc-sorter/page.tsx`, `src/app/joiner/pc-sorter/page.tsx`

- **Opt-in per session:** checkbox "Interchangeable packs (e.g. trading card sets)" in New/Edit session, off by
  default (`packs_interchangeable`). Sessions with it get a "⇄ Interchangeable packs" badge. Everything below only
  applies to those sessions; all other sessions sort exactly as before.

- **Sort — overflow:** when a pack runs out, every inclusion of it that got nothing is filled from a pack that
  still has stock. Picked by the joiner's ranking (of that pack, else of the pack they were due), else at random;
  same ownership/repeat rule. Submitters first by submission time, then non-submitters at random. Saved with
  `is_overflow`; shown with a ⇄ icon for the GOM and "(replacement)" for the joiner. The sort summary says how
  many were filled from another pack, and "Unfulfilled" only counts what really couldn't be filled.
- **Auto-fill — stock-aware split:** when every pack has its quantities entered, inclusions are split in
  proportion to each pack's stock (44 bread / 30 letter instead of 37/37). A joiner with 2+ inclusions still
  gets one of each pack first. Without quantities, the old even split is used (overflow still fixes it at sort).
- Tested on a simulated session: 74 claims on 44 + 30 cards → all 74 filled, no pack over its stock;
  80 claims → 74 filled, 6 reported unfulfilled.

# Fix: manual inclusion edits not saving — 2026-10-24

**Edited:** `src/app/gom/pc-sorter/page.tsx`, `src/app/api/pc-sorter/[sessionId]/route.ts`

- Lowering a number to 0 or clearing it in Manage inclusions now saves (before, only numbers above 0 were sent,
  so the old value stayed). A joiner at 0 in every pack is removed from the session, same as auto-fill.
- The box now always opens with that session's saved numbers. Before, opening/refreshing another session or
  cancelling an edit left wrong numbers in the box, which then looked saved.
- A failed save (e.g. locked session) now shows an error instead of closing silently.

# PC Sorter: sort only some items of an order — 2026-10-24

No manual SQL needed: the new column self-migrates on first use.

**Edited:** `src/lib/pcSorter.ts`, `src/app/api/pc-sorter/route.ts`, `src/app/gom/pc-sorter/page.tsx`

## What it does
- In **New session / Edit session**, each checked order with more than one item now lists its items under
  "Items to sort" (all checked by default). Uncheck items, or click **Only this** next to e.g. "Trading cards".
- In a narrowed order, only claims on the checked items count, and **every** claim on them counts:
  1 inclusion per item claimed (no need for "album" in the name or an inclusions number; a typed inclusions
  number still wins).
- Applies to the normal auto-fill, the "per amount spent" auto-fill (only ₩ spent on the checked items counts),
  the guaranteed unit claims, and the per-joiner sources breakdown in Manage inclusions.
- Orders with nothing unchecked behave exactly as before. Changing the box clears the item choices.

# PC Sorter: inclusions per amount spent — 2026-10-24

No manual SQL needed: the new column self-migrates on first use.

**Edited:** `src/lib/pcSorter.ts`, `src/app/api/pc-sorter/[sessionId]/route.ts`, `src/app/gom/pc-sorter/page.tsx`

## What it does
- **Manage inclusions → "Auto-fill per amount spent".** Type a ₩ amount (e.g. 70000) and click "₩ Auto-fill":
  each joiner gets 1 inclusion per that amount claimed, rounded down (10k ₩ → 0, 70k → 1, 150k → 2).
- **Spend** = ₩ price of the pricing option × quantity, for every claim of the joiner in the session's selected
  order(s). Lost claims and version-narrowed-out claims don't count. EMS/customs/shipping don't count.
- **Each order is checked separately**: 40k in one order + 40k in another order doesn't make 1 inclusion.
- Joiners under the amount get no inclusion, so the session stays hidden for them (existing behaviour).
- After running, a table shows each joiner's ₩ total and inclusions ("none" when under the amount). Claims that
  have a € price but no ₩ price are flagged ⚠, since they can't be counted — add the ₩ price on the order and rerun.
- It fully replaces the session's inclusions, split across packs like the normal auto-fill. You can still edit any
  number by hand and save. The amount is remembered per session.

# Eras: album, versions and inclusion packs — 2026-10-24

No manual SQL needed: everything self-migrates on first use.

**New files:** `src/lib/eraAlbums.ts`, `src/app/api/era-albums/route.ts`, `src/app/gom/eras/page.tsx`,
`src/app/gom/eras/[id]/page.tsx`, `src/components/shared/EraAlbum.tsx`

**Edited:** `src/app/gom/orders/page.tsx`, `src/app/api/orders/route.ts`, `src/app/api/eras/route.ts`,
`src/components/shared/EraManager.tsx`, `src/components/shared/Sidebar.tsx`

## What it does
- **Eras page** (new in the GOM menu, under Orders). It lists every group's eras with their pack totals. Click an era
  to open its page. Creating, ending and the semi-fixed settings stay in Settings, and each era there now has a
  "💿 Album" shortcut to its page.
- **One era = one album.** On the era page:
  - **Album name:** set it at the top.
  - **Versions:** each has a name, an optional weight profile and an optional photo. You can reorder them. Version names
    are unique within an era.
- **Counted in inclusion packs: one album copy = one pack.**
  - *Inclusions bought* = albums bought on the era's orders + extra albums.
  - *Inclusions claimed* = for each claim line, its Inclusions number, or one per album copy claimed (item type Album,
    or "album" in the option name, the same rule as the PC Sorter). If a line has both, the larger one counts, never
    both added. An Inclusions number is counted once per claim line, however many members it's split across.
  - *Inclusions unclaimed* = bought − claimed. A negative number shows as "Over-claimed" in red.
  - Lost claims don't count as claimed, so they show up as unclaimed.
  - The era page shows these totals overall, per version, per order, and for parts of orders not linked to a version.
- **Extra albums:** copies bought outside an order (quantity, version, note). They count as bought.

## Orders ↔ versions
- An order is split into parts:
  - a multi-version order: one part per version
  - a VCE/Fansign order: one VCE part and one Fansign part
  - any other order: one "All albums" part.

  Each part can be linked to one era version (`orders.era_version_map`).
- **Automatic linking:** a part whose name matches a version name (ignoring case and spaces) is linked on its own,
  so existing orders link themselves. Parts that don't match are listed under "Not linked to a version" on the era
  page, with a picker to link them. They still count in the era totals.
- **Order form (era picked):**
  - Turning on "Multi-version album" creates one section per era version, already linked.
  - "Add from era" adds any version not used yet.
  - Each version chip has a picker to link it to an era version (or mark it as not one). Picking renames the section
    to the version's name and puts the version's weight profile on that section's Album options that don't have one.
  - Single-version orders get an "Album version…" picker next to Albums Bought, and VCE/Fansign orders get one per line.
- Renaming a version section in the form now keeps its "albums bought" number and its link.
- Deleting a version removes its extra albums and its manual links. Those parts fall back to name matching.

## Fix
- **Creating a multi-version order didn't save each claim's version.** It was only saved after editing and saving the
  order again. It's now saved on creation.

---

# GOM payments rework + bulk order status + box received — 2026-10-23

No manual SQL needed: everything self-migrates on first use.

**New files:** `src/lib/gomPayments.ts`, `src/lib/orderStatus.ts`, `src/app/api/gom-payments/route.ts`,
`src/components/shared/GomPaidModal.tsx`, `src/components/shared/GomCoverage.tsx`

**Edited:** `src/app/gom/payments/page.tsx`, `src/app/gom/orders/page.tsx`, `src/app/gom/boxes/page.tsx`,
`src/app/api/orders/route.ts`, `src/app/api/boxes/route.ts`, `src/app/api/boxes/[id]/route.ts`,
`src/app/api/payments/route.ts`, `src/app/api/stats/route.ts`

## Cut-over: only orders not yet ordered use the new system
On first start, every order that is already **Ordered or further** (incl. Closed) is marked as legacy
(`orders.gom_payments_legacy = true`). Legacy orders never show in the GOM Payments tab, never show "€ paid missing"
and never trigger the amount prompt — their old payments stay in the Archive. Orders still **To be ordered** at that
moment, and every new order, use the new system. This runs exactly once (only when the column is first created), so
later status changes never make an order legacy.

## Payments
- **Archive.** Every entry of the old GOM payments log (`payments` table + `covering_log`) is now the read-only
  **Archive** tab. Nothing is deleted, and `/api/payments` refuses new writes (410).
- **GOM Payments tab = coverage per order.** It lists every order that's at least **Ordered**, organised
  **Group → Era → orders** (eras collapsible; active era first, "No era" last; personal orders and orders with no
  group go under **Other / personal**). Subtotals are shown per group and per era, with grand totals on top.
  - *Received* = order payments of joiners that you validated, plus money already paid for claims later marked
    lost. Proofs that were sent but not yet validated show separately as *pending*. EMS, customs and shipping are
    not included.
  - *Paid* = the sum of the order's payment lines. An order can have several (deposit + balance, shop + proxy…),
    each with an amount, paid to (shop / K-addy / proxy / seller / other), a date and a note.
  - *Covered* = received − paid. Green if ≥ 0, red if short. Orders with no amount entered show "Enter amount"
    and aren't counted in Covered, so they can't look falsely covered. The "Missing amount paid" card filters to them.
  - Amounts can be typed in € or in ₩ with a "1 € = … ₩" rate. € is what the maths uses, and ₩ + rate are kept and
    shown. The last rate is remembered per browser.
- New table `gom_order_payments`. Lines of a deleted order are removed with it. Admin stats count archived + new.

## Old orders stay on the old system (cut-over)
- **Every order created before 22 Oct 2026** stays on the old system, whatever its status. Its GOM payments are the
  ones in the Archive, it doesn't appear on the GOM Payments tab, it never shows "€ paid missing" and never asks for
  an amount paid, even when its status changes later. Payment lines can't be added to it.
- Orders created from 22 Oct 2026 use the new system.
- New column `orders.gom_payments_legacy`, set from the creation date when the app starts.

## Orders
- **Status changes no longer reload the page.** The row updates in place, and it rolls back with a message if
  saving fails. Saving/deleting an order refreshes in the background without the full-page spinner.
- **Multi-select.** There's a checkbox per order (and "select all" in the header). A bar appears with
  "Set status to… / Apply". It only acts on selected orders that are visible with the current filters.
- **Amount paid prompt.** When orders become **Ordered** (inline, in bulk, or via the edit form), a pop-up asks
  for the amount paid, with one row per order. Leave a field empty or click "Skip — fill in later". Orders that
  already have an amount aren't asked again. Orders past "To be ordered" with no amount show "€ paid missing",
  which opens the same pop-up.
- Becoming Ordered fills `ordered_at` if it was empty. Joiners are now notified only when the status actually
  changes (a bulk change that includes orders already at that status won't re-notify them).
- API: `PATCH /api/orders { ids: [...], status }` for bulk changes.

## Boxes
- **Mark received / Undo received** button per box (new `boxes.received_at`), with a "Received <date>" badge.
- Marking a box received moves every order in it to **At GOM**, but only once **all** boxes that order is in are
  received, and only forward: orders already At GOM or Closed are left alone. A line under the box says what
  happened, e.g. "1 order moved to At GOM · 1 waiting for another box". Order chips on the box show their status.
- Linking an order to a box that's already received moves it too (same rules).
- Undo only clears the flag. Orders keep their status.

Verified on Postgres 16 with the app's own routes (coverage maths incl. pending, multi-line, ₩ conversion,
bulk status, box received with shared boxes / forward-only / undo) and in the browser (desktop + mobile).

---

# Fixed / semi-fixed spots + eras — what's in this zip

No manual SQL needed. The app creates the `eras` and `semi_fixed_spots` tables and the `orders.era_id` column itself the first time they're used.

**New files:** `src/lib/semiFixed.ts`, `src/app/api/eras/route.ts`, `src/app/api/semi-fixed/route.ts`,
`src/app/api/raffle-entries/route.ts`, `src/components/shared/EraManager.tsx`

**Edited:** `src/app/api/orders/route.ts` (era_id), `src/app/gom/orders/page.tsx` (Era picker, semi-fixed auto-add),
`src/app/gom/settings/page.tsx` (Eras section per group), `src/app/gom/fancalls/page.tsx` (raffle bonus),
`src/app/joiner/orders/page.tsx` (My semi-fixed spots + Renew)

- **Eras** live in Settings → Groups & Members → expand a group. Each era has its own "events per round" and "days to renew". Use **End era** when the album cycle is over. Ending an era also ends its semi-fixed spots.
- **Semi-fixed spots** are a joiner plus member(s) inside an era. An order in that era where the joiner has a claim counts as 1 event, however many claims are in it. Lost claims don't count.
- When a round is complete, the joiner is notified and sees **Renew spot** in My Orders. Renewing resets the counter, and any extra events carry over. If they don't renew within the set days, they lose the spot. There's no background job: this is checked whenever Orders, Settings or My Orders is loaded, or when an order is saved.
- **Auto-add:** on a new group order, the group's active era is pre-selected. Fixed joiners and the era's semi-fixed joiners are both added with their members.
- **Raffle bonus:** +2 for fixed joiners of the order's group, +1 for semi-fixed spot holders of that group. The bonus only applies if they have a claim in the order. If someone is both, they get only the higher bonus (+2). The raffle list shows the breakdown, e.g. "4 + 2 fixed".
- Fixed joiners are no longer added to every raffle with 2 entries. Before, they were added even when they weren't in the order and were fixed for a different group.

---

# PC Sorter redesign — what's in this zip

Drop these files into your `go-manager` project at the same paths (they overwrite the
old versions where a path already exists) and restart `npm run dev` / redeploy. The
app self-migrates its schema at runtime — no manual SQL required.

## Files

**New:**
- `src/lib/pcSorter.ts` — schema migration, inclusion auto-fill, and both sort algorithms
- `src/app/api/pc-sorter/[sessionId]/sort/route.ts` — POST endpoint that runs a sort
- `src/app/api/pc-sorter/results/route.ts` — GET endpoint used by OrderDetail + Sending Out
- `supabase/migrations/002_pc_sorter_redesign.sql` — reference schema (not required to run by hand)

**Rewritten:**
- `src/app/api/pc-sorter/route.ts` — session list/create/edit (sessions now always start closed)
- `src/app/api/pc-sorter/[sessionId]/route.ts` — packs/items/quantities/inclusions/priority-form endpoints
- `src/app/gom/pc-sorter/page.tsx` — GOM UI: build packs of items, manage inclusions, run sort, view results
- `src/app/joiner/pc-sorter/page.tsx` — joiner UI: rank members independently per item
- `src/types/index.ts` — PC Sorter types section replaced (PCPack/PCItem/PCItemQuantity/etc.)

**Edited in place (small additions only):**
- `src/components/shared/OrderDetail.tsx` — adds a "Sorting results" block under each joiner's claimed items
- `src/app/gom/sending-out/page.tsx` — adds a "Sorted PC items to pack" block to the joiner panel

## Behavior notes worth knowing

- **Old tables** (`pc_versions`, `pc_photocards`, `pc_joiner_needs`, `pc_inclusion_assignments`) are left in
  place but unused — nothing reads/writes them anymore. Safe to drop later if you want, not required.
- **Sessions now start closed.** Creating a session no longer makes it visible to joiners — you build packs/items/
  quantities first, then click "Open form."
- **Ownership matches by name.** Cross-session "already has this item" tracking matches pack name + item name
  across different sessions — keep names consistent (e.g. always "Ver. A" / "Photocard") if you want it to link up.
- **Editing quantities resets `available` to the new total.** If you edit an item's pull counts after a sort has
  already run and consumed stock, `available` resets to the new `total_pulled` — re-run the sort if you do this.
- **A joiner who never submitted the priority form at all still gets served, at random.** After every joiner who
  DID submit a form has been processed by whichever sort method you picked, any leftover stock for that item is
  handed out at random to joiners who have inclusions assigned but no submitted form — still skipping members they
  already own until every option is exhausted (same rule as everyone else). These show up in the results with a
  🔀 badge (GOM view) or "(random — no form submitted)" note (joiner/Sending Out views), so it's clear which
  assignments weren't priority-driven. If a joiner submitted a form but simply left one item unranked, that item is
  their own choice to skip — the random fallback only kicks in for joiners with zero submission for the whole session.
- **Fair sort** processes priority levels in rounds; ties at the same level go to whoever submitted earliest.
  **Timestamp sort** just serves joiners strictly in submission order. Both skip members a joiner already owns
  (this session or past sessions with matching pack+item names) until every option is exhausted, then allow repeats.
- **Auto-fill only counts the session's selected orders — never the whole box.** If a session has no orders
  selected, auto-fill has nothing to work from and does nothing. Within the selected orders, a line counts toward
  a joiner's inclusions if it has an explicit `inclusions_count`, OR if its description mentions "album" (using
  its claimed quantity) — so album claims that never got an inclusions_count filled in still feed the sort. A
  line that qualifies both ways is only counted once.
- **Auto-fill now truly overwrites.** It used to only upsert, so a joiner who qualified on a previous run (or was
  set by hand) but no longer does — an order got deselected, a claim's `inclusions_count` got zeroed out, etc. —
  kept their stale number forever. It now clears every inclusion row for the session first, then inserts the
  freshly computed ones, so a re-run always matches the current selected orders exactly.
- **New "Reset all inclusions" button** in the Inclusions modal, next to Auto-fill. Wipes every joiner's inclusion
  count for the session back to zero, independent of auto-fill — for starting over by hand, or just confirming a
  session really has nothing assigned. Asks for confirmation before clearing.
- **GOM: "Awaiting submission" list.** Each session now shows an amber block listing every joiner who has
  inclusions assigned (so they're expected to rank) but hasn't submitted a priority form yet, each with their
  total inclusions due. The "Priority forms" header also now reads "X of Y submitted" once there's a known
  expected total. A joiner with zero inclusions assigned is never counted as "expected" — nothing to chase there.
- **Joiners now see their own inclusion count.** Each session card shows a badge with how many total inclusions
  they have to get sorted this session, and each pack heading shows how many of that specific pack are due to
  them — so joiners know how many items they should expect out of the sort before they even rank anything.
- **GOM Results list redesigned.** The old view was one flat comma-separated line of text per joiner. It's now a
  card grid — one card per joiner with initials, their item count, and their assignments grouped by pack as
  chips (item → member), still carrying the repeat/random icons. A summary line above the grid gives total items
  assigned, joiner count, and random/repeat totals at a glance.
- **"Inclusions assigned" vs "items sorted" — not a bug, but the old label was misleading, now fixed.** The sort
  algorithm was never double-counting: one inclusion = one of EVERY item in its pack, so a pack with 2 items
  turns 1 inclusion into 2 assigned items on purpose (that's the spec, unchanged). What actually caused the
  confusing "31 vs 41" was the "Inclusions assigned" card, which showed the number of joiner-pack ROWS
  (`pc_pack_inclusions` entries) rather than the sum of their `inclusions_assigned` values — those aren't the
  same number the moment any joiner has more than 1 inclusion on a row. It now shows the real total inclusion
  units, plus (when a pack has more than one item) the item count that total will expand into once sorted. The
  "Run sort" block and the Results summary both now show this same "expected" number (inclusions × items per
  pack) next to the actual assigned/unfulfilled counts, and flag in amber if they no longer match — which only
  happens if inclusions or items were edited after the last sort ran, not from any miscounting in the sort
  itself. Re-running the sort always reconciles it.
- **Re-running the sort is now safe, and redoes assignments cleanly from current inclusions — without ever
  touching priority forms.** Previously, running the sort a second time for the same session would ADD to the
  previous results instead of replacing them: `inclusions_assigned` is always the full amount a joiner is due
  (not a remaining balance), so a second run asked for the full amount again on top of what they'd already been
  given, against whatever stock was left over from the first run — silently over-assigning and leaving stale
  results mixed in with new ones. `runPcSort()` now clears this session's previous `pc_assignments` and restores
  every item's `available` stock back to its full pulled total before computing, every single time it runs. It
  never deletes or modifies `pc_priority_forms` / `pc_priority_entries` — those are only ever touched when a
  joiner submits their own form. So the flow for "change some inclusion numbers and redo the assignments" is
  simply: adjust inclusions (or Auto-fill / Reset all inclusions, neither of which touch forms either) → click
  Run Sort again. It always recomputes from scratch using the forms already on file — joiners never have to
  resubmit their rankings just because the GOM reran the sort.
- **Expanded session card is now tabbed instead of one long scroll.** Clicking "Details" used to stack six
  sections vertically (Packs & Items, Inclusions, Awaiting submission, Priority forms, Run sort, Results), which
  got very tall for any session with more than a couple joiners. It's now three tabs: "Packs & Items", "Forms &
  Inclusions" (Inclusions summary + Awaiting submission + Priority forms combined), and "Results" (Run sort +
  Results combined) — each showing its count in the tab label. Opens on Results by default once a sort has run
  for that session, otherwise Packs & Items, since that's usually what you're there to check.
- **Joiners can no longer edit their submitted rankings, and now see their own results.** Two separate bugs:
  (1) the joiner page had an "Edit my ranking" link that let a joiner reopen and resubmit their priorities at
  any time, even after the GOM had already sorted — removed, and the priorities endpoint now rejects a second
  submission server-side too ("You've already submitted your priorities for this session — they can't be
  changed."), so it can't be done via a raw request either. (2) `/api/pc-sorter` was only ever showing joiners
  sessions whose form was currently open — but running the sort always closes the form, so the session (and
  every result in it) simply vanished from a joiner's Sorting page the moment the GOM sorted. It now also shows
  sessions that have already been sorted, and the joiner page renders a proper read-only results view (grouped
  by pack, with the same repeat/random notes as everywhere else) instead of the ranking form once a session is
  sorted — including for joiners who never submitted at all and got random-filled. Reopening a form after a sort
  still works exactly as before, but only for joiners who haven't submitted yet; anyone who already has a
  submission on file stays locked out of editing even while the form is reopened.
- **Joiner pages now redirect away non-joiner accounts (and vice versa).** Neither `/joiner/*` nor `/gom/*` had
  any role guard — any authenticated account could load either simply by navigating there directly (only
  `/admin` was ever guarded). The pc-sorter APIs filter "your own data only" strictly for `role === 'joiner'`,
  so a GOM/admin account browsing `/joiner/pc-sorter` to preview it never tripped that check and got everything
  completely unfiltered — every joiner's priorities and results on one screen, which is what "shows all joiners'
  pulls instead of just the joiner's specific pull" was. `joiner/layout.tsx` now sends `gom`/`admin` accounts to
  their own dashboard instead of rendering the joiner shell for them, and `gom/layout.tsx` sends `joiner`
  accounts back to `/joiner` for the same reason. A real joiner account was never affected by this — the API
  filtering itself was always correct for them — this only ever showed unfiltered data to an already-privileged
  account looking at the wrong page.
- **GOMs can preview the joiner side again — properly scoped this time.** The redirect from the previous fix
  was too blunt: it blocked GOM/admin accounts from `/joiner/*` entirely, which broke the legitimate need to
  check what a joiner sees. `joiner/layout.tsx` no longer redirects them away. Instead, the Sorting page now
  shows a "Preview as joiner" picker for gom/admin accounts (a dropdown of every joiner) — nothing loads until
  one is chosen. Both `/api/pc-sorter` and `/api/pc-sorter/[sessionId]` accept a `viewAsJoiner=<id>` param that a
  gom/admin can pass to see the exact same data an actual joiner with that id would see — scoped with the
  identical filtering logic, just keyed off the chosen id instead of `user.id`. A real joiner account can't use
  this param to see anyone else's data; it's only ever honored for gom/admin. Preview mode is read-only —
  ranking and submitting are disabled — so a GOM can't accidentally submit priorities on a joiner's behalf.
- **Replaced the "Preview as joiner" picker with the same convention Orders already uses — no picker, a GOM just
  sees their own side.** The picker from the previous fix was more than what was actually wanted: it let a
  gom/admin browse any joiner's data read-only, when what's actually needed is for a gom/admin's OWN joiner
  activity (their own claims, their own sorting priorities/results) to show up exactly like a real joiner's,
  fully interactive — no selection step, no read-only mode, indistinguishable from any other joiner's page. This
  is exactly the pattern `/api/orders` already used (`?viewAs=joiner` scopes the response to the caller's own
  id, for every role), so pc-sorter and sending-out now match it instead of inventing a separate mechanism:
  `/api/pc-sorter` and `/api/pc-sorter/[sessionId]` dropped the arbitrary `viewAsJoiner=<id>` param for a plain
  `viewAs=joiner` boolean, always scoped to `user.id` (never an arbitrary chosen joiner — a gom/admin can only
  ever see their own participation this way, same as a real joiner). `joiner/pc-sorter/page.tsx` is back to
  behaving like a normal joiner page — no picker, no preview banner, ranking and submitting both fully enabled —
  just with `?viewAs=joiner` on its two fetches. While auditing for the same bug class elsewhere, found and
  fixed the identical gap in `/api/sending-out` (used by the Shipping page) and an unscoped `pc-sorter` fetch in
  the Deadlines page, both of which would have shown a gom/admin ALL joiners' shipping submissions / deadlines
  instead of their own — both now send `?viewAs=joiner` too, for the same reason. `joiner/layout.tsx` still lets
  gom/admin accounts through without a redirect (that part of the earlier fix was correct and stays); the
  comment there now describes this convention instead of the removed picker.
- **Multi-version orders can now be narrowed to specific album versions when linking them to a sorting
  session.** Previously, the "Orders included in this session" list (in New/Edit Session) only let you check or
  uncheck a whole order — if that order was multi-version (e.g. 3 different album versions bought together),
  every version's claims counted toward inclusions with no way to leave one out. Checking a multi-version order
  now reveals its versions underneath as their own checkboxes (all checked by default, so nothing changes for
  sessions that don't need this); unchecking a version excludes just that version's claims from this session's
  auto-filled inclusion counts while the rest of the order still counts normally. This only affects "Auto-fill
  inclusions" — it filters which `order_items` rows are summed per joiner by their `version_name`, using a new
  `order_versions` column on the session (`{order_id: [versions still included]}`); an order with no entry there
  behaves exactly as before (every version counts). Manually-entered inclusion numbers, priority forms, and the
  sort algorithm itself are unaffected — this only changes what auto-fill computes.
- **Fixed: auto-filled inclusions were inflated when a claim was split across multiple members (e.g. "4 pobs + 4
  inclusions" auto-populated as 16, not 4).** Root cause: when a GOM types an "Inclusions" number once for a
  claim line but selects several member pills for it (e.g. 4 members = "I want a photocard of any of these 4"),
  that one line is saved as 4 separate `order_items` rows — one per member — and by design every one of those
  rows carries the SAME inclusions number (the Orders edit form already reads it back from just the first row of
  the group, never a sum, so this duplication is intentional at the storage layer). Two places that later READ
  those rows got this wrong by summing across the group instead of reading it once: "Auto-fill inclusions" in PC
  Sorter (`autoFillInclusions`) and the consolidated line totals on the Order Detail page — both were adding the
  same number once per member row, so a claim split across N members inflated its total by ×N (4 members × 4
  inclusions = 16). Both now dedupe the same way the Boxes page already correctly did: an explicit inclusions
  number is only counted once per (joiner, item, price, version) group, no matter how many member rows it was
  saved across. This does NOT affect claims with no explicit inclusions number set (those "album"-fallback rows
  are genuinely one-inclusion-per-member-row and still add up normally), and doesn't touch how inclusions get
  entered or stored — only how already-saved rows are read back and summed. Existing sessions just need
  "Auto-fill inclusions" run again to pick up the corrected numbers — no need to touch the order itself.
- **Manage Inclusions box: each joiner's name is now a dropdown showing which orders their auto-filled number
  came from.** Click a joiner's name in the inclusions table to expand a small panel listing every source order
  and how many inclusions it contributed (e.g. "Round 2 · ShopName · 4"), so a number that looks off can be
  traced back to its order instead of guessed at. If a joiner's total wasn't from this session's orders at all
  (entered by hand, or the source order got unlinked from the session since), it says so instead of showing a
  breakdown. This mirrors the exact same counting logic "Auto-fill" itself uses server-side (including the
  per-claim dedupe from the fix above), so the numbers shown always explain what auto-fill actually assigned —
  it's read-only and doesn't change any saved data.
- **Fixed the flip side of the inclusions dedupe fix: it could under-count when two genuinely separate claims
  happened to share the same description/price.** The fix above told rows apart from each other by matching
  description+price+version, on the assumption that matching = "same claim split across members." That's not
  always true — a GOM can legitimately add two separate item lines using the same pricing option (e.g. the same
  "POB" claimed for two different groups of members), and those got wrongly collapsed into one, which is exactly
  what showed up as "the sources dropdown says 2, but 4 are actually assigned." Fixed properly this time by
  giving every item line its own id at save time (`claim_group_id`, one per line, shared by every row it explodes
  into) instead of guessing from description/price — order_items now carries this column, and every reader that
  needs to tell "same claim" from "different claim" (Auto-fill, the new sources dropdown, Order Detail's
  consolidated totals, and — found while fixing this — the Boxes page's per-joiner weight and EMS/customs cost
  split, which had the exact same "only count the first row" bug and could overcharge a joiner whose claim was
  split across members) now uses it. Rows saved before this column existed have no id to key off, so those still
  fall back to the description+price+version guess — **existing orders need to be re-opened and saved once (Edit
  → Save, no changes needed) to get this fix applied to their claims**; new orders and any order you resave get
  it automatically. This is a read/aggregation fix only — it doesn't change how inclusions are entered, and
  doesn't touch stored EMS/customs amounts that have already been locked in for a box.
- **Packs & Items now shows how many of each member's photocards are still unassigned after a sort.** Previously
  the quantity boxes always showed the original total pulled, with no way to see what's actually left once
  sorting has consumed some of it. Once a session has been sorted, a small "N left" badge appears next to each
  member — green if untouched, amber if partially assigned, gray if fully assigned out — reflecting
  `pc_item_quantities.available` (the same running stock the sort algorithm itself decrements from and always
  resets before a fresh run). The quantity box itself is unchanged: it's still the editable original total,
  still what "Save quantities" writes and what a re-run starts fresh from — the badge is a read-only add-on next
  to it, so nothing about editing or resaving stock changes.
- **Added a "Save sort" button to lock a session's results once they're final.** Once a sort has run, the
  Results tab now shows a "💾 Save sort" button next to "Run sort". Clicking it locks the session: packs, items,
  quantities, and inclusions all become read-only (their add/delete/edit controls and Manage Inclusions'
  Auto-fill/Reset/number boxes disappear or gray out — the inclusions modal switches to a view-only "View
  inclusions" mode so the sources dropdown still works), "Run sort" is replaced with a locked notice, and the
  form is force-closed so a joiner can't slip in a late submission that never gets sorted. Every one of those
  actions is also blocked server-side, not just hidden in the UI. A locked session shows a "🔒 Sort locked" badge
  where "Form open/closed" normally shows. It's reversible — an "🔓 Unlock" button (with a confirmation, since
  it reopens editing on something that may already look final) puts the session back to normal. Locking requires
  a sort to have actually run at least once; it doesn't touch or re-run the sort itself, and doesn't affect
  anything for sessions you never lock.
- **Fixed a Vercel build failure introduced by the "Save sort" feature.** The locked-session badge ("🔒 Sort
  locked") passed a `title` attribute (for a hover tooltip showing when it was locked) to the shared `Badge`
  component, but `Badge` only accepted `children`/`className`/`variant` — TypeScript correctly rejected the
  build. Fixed by widening `Badge` to accept any standard `<span>` attribute (`title` included) like the other
  shared components (`Button`, `Card`, `Input`) already do, rather than special-casing `title`. Also manually
  re-audited every other shared-component usage touched across this whole redesign (`StatusBadge`, `Card`-
  family, `Label`, `FormField`, `Modal`, `PageHeader`, `EmptyState`, `Table`/`Th`/`Td`/`Tr`) against their actual
  prop signatures in `src/components/ui/index.tsx` — no other instance of this bug class found. Worth knowing:
  this sandbox can't run a full `npm install`/`next build` (its registry access is blocked here), so local
  verification this whole project has been single-file `tsc` checks plus manual auditing, which is exactly what
  missed this one — pasting a Vercel build log here whenever a deploy goes red is the fastest way to catch
  anything that slips through, and is genuinely useful, not just a fallback.
- **New: "unit" items in Packs & Items, for photocards that feature several members at once (e.g. a "Mai +
  Jungeun" unit photocard).** Previously every item's sortable options were exactly the group's real members —
  no way to combine several of them into one option, so a unit photocard had to be entered as separate solo rows
  even though it only actually comes as the combo. When adding a new item, a "Unit item — combine several
  members into one sorting option" checkbox tags it as a unit item permanently (like an item's name, this can't
  be flipped after creation — delete and re-add if you got it wrong). A unit item shows a "👥 Unit" badge and,
  instead of one quantity row per real member, gives you a "New unit combo" builder: tick which real members
  are in the combo, optionally override the auto-generated name (defaults to "Member A + Member B"), and add it
  — it becomes its own row with its own quantity box, exactly like a solo member row. Joiners then rank "Mai +
  Jungeun" as a single option on their priority form, and it's assigned as a single option by the sort, same as
  any solo item — no other change to how ranking, the sort itself, or results/ownership displays work, since a
  unit combo behaves exactly like a member everywhere else in PC Sorter. Unit combos are scoped to the one item
  they're built on — they never appear in the group's member list used elsewhere in the app (Orders, Boxes,
  Shipping, Settings), and owning solo cards of Mai and Jungeun individually is never treated as already owning
  their unit combo (or vice versa) — those stay completely independent, same as any two different items.
- **Unit combos are told apart (for "already owns this" purposes) by name, not by which members are in them —
  so two different unit photocards featuring the same members stay independent.** A unit combo's cross-session
  repeat-avoidance (the same rule that keeps a joiner from being handed the same solo member's card twice, until
  every option is exhausted) needs a way to recognize "this is the same combo being sold again" even though
  every session creates a brand-new row for it. The first version of this keyed that off which real members were
  in the combo — which meant two GENUINELY DIFFERENT unit photocards that happen to feature the same two members
  (e.g. two different "Mai + Jungeun" designs across two boxes) would have been wrongly treated as the same
  item, both within one sort and across sessions, and the sort could have skipped a joiner past the second one
  as if they already owned it. Fixed to match by the combo's NAME instead — the exact same rule packs and items
  already use for their own cross-session ownership. So: to sell two different unit PCs that happen to share the
  same members, just give the two unit combos different names (they can still be built from the identical
  member checkboxes) — e.g. "Mai + Jungeun (Photocard)" and "Mai + Jungeun (Postcard)", or even just "MJ Unit 1"
  / "MJ Unit 2". They'll be ranked, assigned, and repeat-tracked as fully separate items. Conversely, naming a
  unit combo the exact same thing in a later session is what lets a repeat sale of the SAME product carry over
  ownership tracking the way solo members already do.
- **New: "guaranteed" unit claims — for a multi-version release (e.g. a 3-way unit album) where the bundled ID
  card set is physically fixed to whichever version you get, not something to sort at all for the joiners who
  picked a version on purpose.** The scenario: an album has several "unit versions" (e.g. "MAI + JUNGEUN" /
  "JEEMIN + KOKO" / a third), each one guaranteed to come with that exact member combo's ID card set. Some
  joiners claimed a SPECIFIC version in their order — they're entitled to that exact set, no ranking, no
  competing with anyone. Other joiners claimed the release without picking a version — which set they end up
  with genuinely needs the normal priority sort, using whatever's left once every guaranteed claim is accounted
  for. Previously there was no way to express "guaranteed for some, sorted for others" — every item was either
  fully random/ranked or fully manual.
  **Setup**: model the release as ONE unit-tagged item (e.g. named "ID Card Set") with one unit combo per
  version — NOT three separate items. (Three separate items would mean "1 of every item" under this app's
  existing pack rule — one of EACH version — when really a joiner should get exactly ONE.) Name each unit combo
  to match EXACTLY (case/whitespace-insensitive, but the words must match) the `version_name` used on the
  matching multi-version order in Orders — that's the only thing that links a claim to a guarantee.
  **What happens automatically**: when the sort runs, for each unit-tagged item, any joiner whose order claimed
  one of its units BY NAME is granted that exact unit directly — before anyone's priorities are even looked at —
  consumed from that unit's own stock and subtracted from that joiner's remaining pack inclusions for this item
  only (their other items in the same pack, and any additional non-version-specific inclusions on this same
  item, are completely unaffected and still go through the normal flow). Whatever's left — stock, and joiners'
  remaining need — then runs through the regular priority sort exactly as before. Guaranteed assignments show up
  in Results/joiner views/Sending Out with a green "guaranteed" note (a ShieldCheck icon in the GOM view), same
  as repeat/random already do, and count as "already owns this" for future sessions the same as any other
  assignment. If a guaranteed total can't be fully covered (not enough of that version was actually pulled), the
  shortfall just falls through to "unfulfilled," the same as the sort already handles any other stock shortage —
  nothing crashes or over-assigns. Uses the exact same per-claim-line counting rules as auto-fill inclusions
  (explicit `inclusions_count`, or the "album" `amount_claimed` fallback, deduped by `claim_group_id`), so a
  guaranteed count is never inflated by the same multi-member-claim-row duplication that was fixed earlier in
  this doc. One thing to keep in mind: matching is by unit NAME only, scoped to the item it's checked against —
  if two different unit-tagged items in the same session happen to reuse the same unit name, a matching claim
  would guarantee against both, so keep unit names unique across a session if that's a possibility.

- **Joiners with nothing to sort no longer see a ranking form.** Previously, the joiner-facing Sorting page
  rendered a ranking form for every item that had stock, regardless of whether that particular joiner actually
  had any inclusions due to them for that item — and, since guaranteed unit claims (above) can now cover a
  joiner's *entire* need for an item automatically, a joiner could be shown a form to rank something that was
  already fully decided for them before they ever opened the page.
  **What changed**: for each item, the joiner's remaining need is now computed as their pack's due-count minus
  whatever's already covered by a guaranteed unit claim for that specific item (non-unit items are unaffected —
  guaranteed claims only ever apply to unit-tagged items). An item only appears on the form if that remaining
  need is greater than zero AND there's stock to rank. A pack with no such items is hidden entirely, and if a
  joiner has nothing left to sort anywhere in the session — whether because they simply have zero inclusions, or
  because everything due to them is already guaranteed — the session card shows a plain "nothing to sort" note
  instead of an empty or pointless form. The submit payload is filtered the same way, so priorities are never
  submitted for an item that was never shown.
  **Adjacent fix**: the GOM's "Awaiting submission" list (and the "X of Y submitted" count above it) previously
  flagged any joiner with inclusions assigned and no submitted form as pending — which meant a joiner whose
  entire need was covered by guaranteed claims, and who therefore has no form to submit, would sit there
  permanently as "awaiting submission" forever. That list now uses the same guaranteed-aware check, so those
  joiners are correctly left off it.
  Both sides pull from a new `guaranteed` field returned by the session detail API (self-scoped to the joiner's
  own claims when viewed as a joiner), computed with the exact same `computeGuaranteedUnitClaims` function the
  sort itself uses at run time — so what the form hides can never disagree with what the sort would actually
  pre-assign.

# Lost claims + Leftovers

When a joiner doesn't pay, the GOM can now mark their claims as **lost**. Lost claims stop
belonging to the joiner and become **leftovers** that can be reassigned (or given back).

## Files

**New:**
- `src/lib/lostClaims.ts` — schema (self-migrating), mark-lost transaction, dry-run preview, restore, reassign, leftover requests, unpaid-payments list
- `src/app/api/lost-claims/route.ts` — mark lost (POST, with `dry_run`), restore / reassign (PATCH), the caller's own lost claims (GET)
- `src/app/api/lost-claims/candidates/route.ts` — a joiner's claims + relevant unpaid payments for the picker
- `src/app/api/joiner-payments/unpaid/route.ts` — every unpaid joiner payment (GOM)
- `src/app/api/leftovers/manage/route.ts`, `available/route.ts`, `requests/route.ts` — GOM/joiner leftovers data and requests
- `src/components/shared/MarkLostModal.tsx` — the "Mark claims as lost" picker (+ `LostBadge`, `PaymentTypeChip`)
- `src/components/shared/LeftoverBoard.tsx` — the combined leftovers list (by order / by member), shared by both pages
- `src/lib/leftoverSlots.ts` — open-slot maths (moved out of `/api/leftovers`) + the pricing options a slot can be claimed with
- `src/app/api/leftovers/slot-options/route.ts` — those pricing options for one slot
- `src/app/gom/leftovers/page.tsx`, `src/app/joiner/leftovers/page.tsx` — the new Leftovers pages

**Edited:** `api/orders/route.ts`, `api/orders/[id]/route.ts`, `api/boxes/[id]/route.ts`,
`api/joiner-payments/route.ts`, `api/joiner-payments/all-paid/route.ts`, `api/leftovers/route.ts`,
`lib/shipments.ts`, `lib/pcSorter.ts`, `components/shared/OrderDetail.tsx`, `components/shared/Sidebar.tsx`,
`gom/orders`, `gom/payments`, `gom/boxes`, `gom/pc-sorter`, `gom/sending-out`, `joiner/orders`,
`joiner/boxes`, `joiner/shipping` pages.

## How it works

- **Where the button is.** "Lost" on each joiner in an order (Order Detail), "Mark claims lost" on every row of the
  new **Payments → Unpaid** tab, "Lost" on unvalidated rows of Payments → Joiner Payment Proofs, and "Lost" next to
  each joiner in a box's Joiner Shares on the **Boxes** page (shows that box's claims, with the unpaid EMS — or customs —
  pre-selected). GOM/admin only.
- **It needs an unpaid payment.** The picker first asks which unpaid payment this is about (order, EMS, customs or
  shipping — only payments currently owed and not validated). Then you pick claim lines (or single member rows of a
  line) with a "select all in this order" shortcut, add a note the joiner will see, click **Review** (a real dry run of
  the same database transaction, rolled back, showing exactly what will change) and confirm.
- **Order claims.** The rows stay in the order (so member counts and albums-bought maths still see the item) but their
  joiner is cleared and they're tagged as a leftover (`order_items.lost_claim_id`). They drop out of the joiner's order
  payment, EMS/customs weight, packing checklist and PC Sorter auto-fill. The order edit form doesn't show leftover rows,
  and saving the order no longer deletes them (their ids stay stable for reassign/restore).
- **Sorted photocards.** For each sorting session that counts an affected order, the joiner's inclusions are recomputed
  without the lost claims (same rules as auto-fill, incl. the claim_group dedupe). The difference comes off their
  inclusions, and for each removed inclusion one card of every item in the pack is released — the most recently
  assigned first; for a lost version-specific claim, the matching guaranteed unit card is released first. Cards go back
  into stock and are listed as leftovers. Locked sessions are edited in place without unlocking or re-running the sort.
  Losing one member row of a claim that still has other rows doesn't release inclusions (the claim still exists).
- **EMS / customs.** Unpaid EMS → that joiner's EMS share is cancelled, they're removed from the box's customs split
  (new `customs_excluded` flag, separate from the existing EMS+customs `excluded`), and an unpaid customs share there is
  cancelled. A joiner left with nothing in a box is removed the same way. Unpaid customs → that customs share is
  cancelled. Published amounts of other joiners never change. Cancelled shares disappear from the joiner's Payments.
- **Shipping.** Lost claims fall out of the packing checklist. A shipment left with nothing to pack gets flagged
  ("⚠ Lost claims" on Sending Out, a note on the joiner's Shipping page) and its unpaid shipping payment is cancelled.
  Nothing is deleted.
- **Paid money stays counted.** If the order was already paid, that amount still counts as collected in the Payments
  covering maths.
- **Joiner side.** A "Claims lost — payment not received" card on My Orders (each claim with "Lost — unpaid EMS/…",
  which payment, its amount, the date and the GOM's note), a "Lost claims" badge on the order row, the same list inside
  the order, and "Cancelled — claims lost" on Boxes. The joiner gets a notification.
- **Leftovers page (GOM).** *Leftovers* is one combined list of lost order claims, open member slots and released
  sorted cards. Open slots are **guaranteed copies only** — the same "Guaranteed sets" maths as the Albums Bought panel
  (floor(albums bought ÷ members) per member, minus what's claimed). The random remainder albums and orders with no
  albums bought don't produce leftovers. A **By order / By member** toggle switches the grouping (sorted cards group under their sorting session
  in the order view), and chips filter by kind. Each lost item shows who lost it, which payment and why. Tabs:
  *Requests* (Accept / Decline) and *History* (every mark-lost action, with **Restore**).
- **Leftovers page (joiner).** The same combined list, with the same order/member toggle but no type filter or
  lost-claim/open-slot labels — joiners just see leftovers, and **Request** on each item
  (+ optional note). For an open slot, the joiner picks which of the order's pricing options they want, so they see the
  price before asking. Joiners never see who lost a leftover or why. Their requests show as waiting / accepted / declined.
- **Accepting puts it straight into their claims.** Accepting a request is automatic: a lost claim moves into the
  joiner's order; an open slot becomes a new claim row in the order (that member, the pricing option they picked, its
  price/weight/version; a line's "Inclusions" number is divided per member, so "4 POBs + 4 inclusions" gives 1); a
  sorted card is added to their sorting results if still in stock. Their order payment goes up by itself. When the last
  copy of a leftover/slot is given, the other pending requests for it are declined automatically with a notification.
- **Direct give.** The GOM can still give a leftover without a request (Reassign on lost items, **Give** on an open
  slot with a pricing-option picker) — the GOM giving it counts as accepted.
- **Not changed automatically:** PC Sorter inclusions (re-run auto-fill if the order is in a session), and EMS/customs
  shares that were already published for that box (add the new owner's share on the Boxes page).
- **Restore.** Gives back everything from that batch that's still a leftover, re-adds the inclusions and the released
  cards still in stock, and undoes the EMS/customs/shipping cancellations (unless another active batch for the same
  joiner set them too). Anything already reassigned stays with its new owner; the result says how many were skipped.

## Notes
- Schema self-migrates on first use (new tables `lost_claim_batches`, `lost_claims`, `lost_pc_items`,
  `lost_pc_inclusions`, `leftover_requests`; new columns on `order_items`, `box_joiner_shares`, `shipments`). The
  migrations run sequentially — running these CREATE TABLEs in parallel deadlocked on a fresh database in testing.
- `order_items.lost_claim_id` is also added by `shipments.ts`/`pcSorter.ts` before their queries filter on it, so a
  cold start that hits Sorting or Sending Out first can never make auto-fill silently see "no claims".
- Verified against a real Postgres 16 with the app's own code (dry run changes nothing; partial vs full loss; PC release
  incl. guaranteed unit cards; EMS/customs/shipping effects; request → reassign; restore with a reassigned item skipped;
  order resave keeps leftover rows), plus a full `next build` and the GOM/joiner pages in a browser.

## Follow-up: change claims from the Orders page (2026-10-20)

**What.** In the order detail panel (GOM view), each claimed member shows as a small chip. Click it → **Change claim**:
pick the member it will be packed as + a reason for the joiner, or **Revert to <original>**. Changed claims show as an
amber chip "~~Karina~~ Winter"; joiners see "Winter (was Karina)" in their own order view.

**One shared change.** The override moved from the packing checklist row (`shipment_items`) onto the claim itself:
`order_items.override_member_id`, `override_reason`, `overridden_at` (runtime migration in `ensureShipmentsSchema`).
`member_id` stays the joiner's original claim. Changing it from Orders or from the Sending Out pack wizard edits the same
value, so both always agree, and it works before any shipment exists. Existing packing overrides are copied onto their
claims once on first run (old `shipment_items` override columns are kept but no longer read).

**Behaviour.**
- `setOrderItemOverride()` in `src/lib/shipments.ts` (the wizard's `setClaimOverride` now calls it): member must be in
  the order's group; blocked once the claim is on a shipment that's `shipped`/`complete`; no member or the original
  member clears it. The joiner gets a notification.
- New `POST /api/claim-overrides` `{ order_item_id, member_id, reason }` (GOM/admin). `GET` unchanged in shape, now reads
  from the claims (with the shipment, when the claim is on a packing list), so the joiner Orders badge, Shipping banner
  and Deadlines notice keep working.
- **Leftover maths use the new member**: Albums Bought panel and leftover calculators in the order view, guaranteed
  open slots on the Leftovers pages. Boxes item lists and the lost-claims picker/snapshot also show the packed member.
- **Survives saving the order**: the edit form rewrites claim rows, so before rewriting, changes are remembered and put
  back on the matching new row (same joiner, member, option, version, price). Renaming the option or removing that
  member from the claim drops the change.
- Verified on Postgres (override, slot maths, packing checklist, shared edit from packing, revert, order re-save,
  shipped lock) and in the browser (Orders panel chips + dialog).

## Copies received per member (Albums Bought panel) — 2026-10-20

Once an order is **At GOM** (or Closed), each Albums Bought panel in the order detail (GOM view) has
**📦 Enter copies received per member**: one number per member for what actually came out of the albums.
Multi-version and VCE/Fansign orders are entered per version. Saved in `orders.albums_received`
(`{ section: { member_id: copies } }`, section = `__all__`, the version name, or `VCE`/`Fansign`); runtime migration, no SQL.
Saved via `PATCH /api/orders/[id]` `{ action: 'albums_received', section, counts }` (`counts: null` clears it), GOM/admin
only, refused before At GOM.

- **Panel:** shows "📦 Received 18 / 20 bought" (amber ⚠ if the total doesn't match — you can still save). Per member:
  ✓ guaranteed, 🎲 claims won from the random albums, ✗ *n* short (claimed more than came out — flag only), +*n* leftover.
  The "random candidates" list disappears once real counts are in. **Edit** / **Clear (back to estimate)** any time.
- **Leftovers pages:** for that order/section, open slots become the real numbers — received − claimed per member,
  copies from the random albums included — instead of the guaranteed-sets estimate. Changed claims count as the new member.
