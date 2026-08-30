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
