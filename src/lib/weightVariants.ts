import { query } from './db'

// Shared, idempotent migration for the weight-variants feature. Called (cheaply, guarded by each
// caller's own once-per-cold-start flag) from every route that touches weight_variants or
// order_items.weight_variant_id, so no matter which route hits a fresh serverless instance first,
// the schema is there.
//
// Design notes (see the "EMS weight variants" feature):
// - weight_variants is a GLOBAL, reusable library (not per-box). group_id scopes a variant to one
//   K-pop group's picker (izna's "Ver A" is a different row from Heart Of Woman's "Ver A"); NULL
//   group_id means "shows up for every group" (used for personal orders, which have no group).
// - item_type mirrors the 4 categories orders already use (photocard/album/photobook/custom) —
//   each variant belongs to exactly one, and the Orders UI only offers variants matching the
//   pricing option's chosen type.
// - weight_g starts NULL ("not weighed yet") and gets filled in later from the Boxes page once the
//   physical item has actually been weighed. Boxes refuse to publish EMS/Customs while any
//   in-use variant still has a NULL weight — see api/boxes/[id]/route.ts.
// - order_items.weight_variant_id is nullable and additive: existing rows (created before this
//   feature shipped) stay NULL forever and keep resolving their weight through the old
//   box_item_types (item_type/custom_label) lookup, untouched. Only NEW order_items — created
//   after the Orders form started asking for a variant — carry this column, and those use the
//   variant's own weight_g instead. The two resolution paths can coexist in the same box.
export async function ensureWeightVariantsSchema() {
  await Promise.all([
    query(`CREATE TABLE IF NOT EXISTS weight_variants (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
      item_type TEXT NOT NULL,
      label TEXT NOT NULL,
      weight_g NUMERIC(10,2),
      created_at TIMESTAMPTZ DEFAULT now()
    )`).catch(() => {}),
    query('CREATE INDEX IF NOT EXISTS idx_weight_variants_lookup ON weight_variants(item_type, group_id)').catch(() => {}),
    query('ALTER TABLE order_items ADD COLUMN IF NOT EXISTS weight_variant_id UUID REFERENCES weight_variants(id) ON DELETE SET NULL').catch(() => {}),
    query('CREATE INDEX IF NOT EXISTS idx_order_items_weight_variant_id ON order_items(weight_variant_id)').catch(() => {}),
  ])
}
