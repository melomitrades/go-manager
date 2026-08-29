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
