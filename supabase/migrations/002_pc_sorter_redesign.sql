-- PC Sorter redesign — reference schema.
--
-- The app auto-migrates itself at runtime (see src/lib/pcSorter.ts →
-- ensurePcSorterSchema(), called from every pc-sorter API route), so applying this
-- file by hand is NOT required. It's kept here, matching this repo's existing
-- convention, purely as a readable reference for what the feature's tables look
-- like once that migration has run.
--
-- Old tables (pc_versions, pc_photocards, pc_joiner_needs, pc_inclusion_assignments)
-- are left in place and unused by the new code — nothing reads or writes them
-- anymore. They're safe to drop by hand later if you want, but nothing requires it.

-- Sessions gain a few columns (existing table, unchanged otherwise)
ALTER TABLE pc_sorting_sessions ADD COLUMN IF NOT EXISTS deadline TIMESTAMPTZ;
ALTER TABLE pc_sorting_sessions ADD COLUMN IF NOT EXISTS box_id UUID REFERENCES boxes(id) ON DELETE SET NULL;
ALTER TABLE pc_sorting_sessions ADD COLUMN IF NOT EXISTS order_ids JSONB DEFAULT NULL;
ALTER TABLE pc_sorting_sessions ADD COLUMN IF NOT EXISTS sort_method TEXT;
ALTER TABLE pc_sorting_sessions ADD COLUMN IF NOT EXISTS sort_run_at TIMESTAMPTZ;
-- form_open already existed (DEFAULT TRUE) — new sessions now always insert it explicitly as false.

-- Packs (was "versions") — a session can hold more than one (e.g. Ver. A / Ver. B)
CREATE TABLE IF NOT EXISTS pc_packs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES pc_sorting_sessions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Items inside a pack (photocard, postcard, lenticular...). One inclusion = one of each item.
CREATE TABLE IF NOT EXISTS pc_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_id UUID REFERENCES pc_packs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Quantity pulled per member per item
CREATE TABLE IF NOT EXISTS pc_item_quantities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID REFERENCES pc_items(id) ON DELETE CASCADE,
  member_id UUID REFERENCES members(id) ON DELETE SET NULL,
  total_pulled INTEGER NOT NULL DEFAULT 0,
  available INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(item_id, member_id)
);

-- How many full packs (inclusions) each joiner is due, per pack
CREATE TABLE IF NOT EXISTS pc_pack_inclusions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES pc_sorting_sessions(id) ON DELETE CASCADE,
  pack_id UUID REFERENCES pc_packs(id) ON DELETE CASCADE,
  joiner_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  inclusions_assigned INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(pack_id, joiner_id)
);

-- pc_priority_forms already existed — now exactly one row per (session, joiner)
CREATE UNIQUE INDEX IF NOT EXISTS pc_priority_forms_session_joiner_uidx ON pc_priority_forms(session_id, joiner_id);

-- Individual ranked entries, one row per (form, item, member) — replaces the old flat
-- JSON blob in pc_priority_forms.form_data, which is what caused the priorities to
-- never actually be read by the old sort.
CREATE TABLE IF NOT EXISTS pc_priority_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id UUID REFERENCES pc_priority_forms(id) ON DELETE CASCADE,
  item_id UUID REFERENCES pc_items(id) ON DELETE CASCADE,
  member_id UUID REFERENCES members(id) ON DELETE CASCADE,
  priority INTEGER NOT NULL,
  UNIQUE(form_id, item_id, member_id)
);

-- pc_assignments already existed — add the columns the new algorithm writes
ALTER TABLE pc_assignments ADD COLUMN IF NOT EXISTS pack_id UUID;
ALTER TABLE pc_assignments ADD COLUMN IF NOT EXISTS item_id UUID;
ALTER TABLE pc_assignments ADD COLUMN IF NOT EXISTS member_id UUID;
ALTER TABLE pc_assignments ADD COLUMN IF NOT EXISTS round INTEGER NOT NULL DEFAULT 1;
ALTER TABLE pc_assignments ADD COLUMN IF NOT EXISTS is_repeat BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE pc_assignments ADD COLUMN IF NOT EXISTS is_random BOOLEAN NOT NULL DEFAULT false;
-- sort_method (TEXT NOT NULL) and photocard_id (nullable, unused going forward) already existed.
