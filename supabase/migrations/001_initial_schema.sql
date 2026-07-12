-- ============================================================
-- GO MANAGER – Neon/PostgreSQL Schema
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Enums
CREATE TYPE user_role AS ENUM ('admin', 'gom', 'joiner');
CREATE TYPE order_type AS ENUM ('group', 'personal');
CREATE TYPE order_status AS ENUM (
  'to_be_ordered','ordered','at_k_addy','at_c_addy','at_j_addy','otw_to_gom','at_gom'
);
CREATE TYPE pricing_type AS ENUM ('pob_only','pob_inclusions','custom');
CREATE TYPE addy_country AS ENUM ('KR','CN','JP');
CREATE TYPE payment_recipient AS ENUM ('kaddy','shop','proxy','seller');
CREATE TYPE shipping_status AS ENUM ('unpacked','packing','sorting','sent');
CREATE TYPE weight_type AS ENUM ('letter','package');

-- Profiles (users)
CREATE TABLE profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT UNIQUE NOT NULL,
  display_name TEXT,
  password_hash TEXT NOT NULL,
  role user_role NOT NULL DEFAULT 'joiner',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Groups & Members
CREATE TABLE groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Shops
CREATE TABLE shops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  website TEXT,
  ships_to_korea BOOLEAN DEFAULT false,
  accepts_id BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Addy addresses (one row per country, seeded)
CREATE TABLE addy_addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country addy_country NOT NULL UNIQUE,
  address TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);
INSERT INTO addy_addresses (country) VALUES ('KR'),('CN'),('JP');

-- Orders
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type order_type NOT NULL DEFAULT 'group',
  shop_id UUID REFERENCES shops(id) ON DELETE SET NULL,
  group_id UUID REFERENCES groups(id) ON DELETE SET NULL,
  round_number INTEGER,
  is_fancall BOOLEAN DEFAULT false,
  status order_status NOT NULL DEFAULT 'to_be_ordered',
  addy_country addy_country,
  notes TEXT,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Order items
CREATE TABLE order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  member_id UUID REFERENCES members(id) ON DELETE SET NULL,
  joiner_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  pricing_type pricing_type NOT NULL DEFAULT 'pob_only',
  description TEXT,
  amount_claimed INTEGER NOT NULL DEFAULT 1,
  price_eur NUMERIC(10,2),
  weight_g NUMERIC(10,2),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Boxes
CREATE TABLE boxes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  label TEXT,
  ems_total_eur NUMERIC(10,2) DEFAULT 0,
  ems_total_krw NUMERIC(12,0) DEFAULT 0,
  customs_total_eur NUMERIC(10,2) DEFAULT 0,
  customs_total_krw NUMERIC(12,0) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Payments
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_type payment_recipient NOT NULL,
  amount_eur NUMERIC(10,2) NOT NULL DEFAULT 0,
  amount_krw NUMERIC(12,0),
  shop_id UUID REFERENCES shops(id) ON DELETE SET NULL,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  payment_method TEXT,
  deadline TIMESTAMPTZ,
  notes TEXT,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE covering_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID REFERENCES payments(id) ON DELETE CASCADE UNIQUE,
  amount_to_send_eur NUMERIC(10,2) DEFAULT 0,
  amount_claimed_eur NUMERIC(10,2) DEFAULT 0,
  amount_difference_eur NUMERIC(10,2) GENERATED ALWAYS AS (amount_claimed_eur - amount_to_send_eur) STORED,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Fancalls
CREATE TABLE fancalls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  shop_id UUID REFERENCES shops(id) ON DELETE SET NULL,
  entered_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  fancall_datetime TIMESTAMPTZ,
  won BOOLEAN DEFAULT false,
  received BOOLEAN DEFAULT false,
  benefits_to_kaddy TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Addy items
CREATE TABLE addy_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country addy_country NOT NULL,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  shop_id UUID REFERENCES shops(id) ON DELETE SET NULL,
  description TEXT,
  arrived_at TIMESTAMPTZ,
  picture_url TEXT,
  is_personal BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Sending out
CREATE TABLE sending_out (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  joiner_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  courier TEXT,
  address TEXT,
  status shipping_status NOT NULL DEFAULT 'unpacked',
  weight_type weight_type,
  weight_g NUMERIC(8,2),
  claims_picture_url TEXT,
  shipping_deadline TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- PC Sorter
CREATE TABLE pc_sorting_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID REFERENCES groups(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  form_open BOOLEAN DEFAULT true,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE pc_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES pc_sorting_sessions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE pc_photocards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id UUID REFERENCES pc_versions(id) ON DELETE CASCADE,
  member_id UUID REFERENCES members(id) ON DELETE SET NULL,
  total_pulled INTEGER NOT NULL DEFAULT 0,
  available INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE pc_priority_forms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES pc_sorting_sessions(id) ON DELETE CASCADE,
  joiner_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  submitted_at TIMESTAMPTZ DEFAULT now(),
  form_data JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE pc_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES pc_sorting_sessions(id) ON DELETE CASCADE,
  joiner_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  photocard_id UUID REFERENCES pc_photocards(id) ON DELETE CASCADE,
  sort_method TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Box joiner payment shares (add to schema if not exists)
CREATE TABLE IF NOT EXISTS box_joiner_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  box_id UUID REFERENCES boxes(id) ON DELETE CASCADE,
  joiner_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  ems_paid BOOLEAN DEFAULT false,
  customs_paid BOOLEAN DEFAULT false,
  UNIQUE(box_id, joiner_id)
);

-- Sending out extended fields (run ALTER if table already exists)
ALTER TABLE sending_out ADD COLUMN IF NOT EXISTS shipping_type TEXT; -- letter, package, inpost, vinted_go, vinted
ALTER TABLE sending_out ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE sending_out ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE sending_out ADD COLUMN IF NOT EXISTS joiner_submitted BOOLEAN DEFAULT false;

-- Inclusions count per order item
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS inclusions_count INTEGER DEFAULT 0;

-- Box multi-order support
CREATE TABLE IF NOT EXISTS box_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  box_id UUID REFERENCES boxes(id) ON DELETE CASCADE,
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  UNIQUE(box_id, order_id)
);

-- Box item type weights
CREATE TABLE IF NOT EXISTS box_item_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  box_id UUID REFERENCES boxes(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL, -- photocard, album, photobook, custom
  custom_label TEXT,       -- for custom type
  weight_g NUMERIC(10,2) NOT NULL DEFAULT 0
);

-- Item type on order_items (replaces weight_category)
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS item_type TEXT DEFAULT 'photocard';

-- Orders: deadline and order date
ALTER TABLE orders ADD COLUMN IF NOT EXISTS deadline TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ordered_at TIMESTAMPTZ;

-- Payments: proof of payment
ALTER TABLE payments ADD COLUMN IF NOT EXISTS proof_url TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS joiner_submitted BOOLEAN DEFAULT false;

-- App settings
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- PC Sorter session deadline (auto-closes form when passed)
ALTER TABLE pc_sorting_sessions ADD COLUMN IF NOT EXISTS deadline TIMESTAMPTZ;
-- Sending out global deadline
ALTER TABLE boxes ADD COLUMN IF NOT EXISTS ems_deadline TIMESTAMPTZ;
ALTER TABLE boxes ADD COLUMN IF NOT EXISTS customs_deadline TIMESTAMPTZ;

-- PC Sorter: link sessions to boxes
ALTER TABLE pc_sorting_sessions ADD COLUMN IF NOT EXISTS box_id UUID REFERENCES boxes(id) ON DELETE SET NULL;
-- PC assignments: track inclusions assigned
ALTER TABLE pc_assignments ADD COLUMN IF NOT EXISTS inclusions_count INTEGER DEFAULT 0;
-- PC versions: link to orders from box for inclusions tracking
ALTER TABLE pc_versions ADD COLUMN IF NOT EXISTS order_ids TEXT; -- comma-separated order IDs linked to this version

-- PC Sorter inclusions system
ALTER TABLE pc_sorting_sessions ADD COLUMN IF NOT EXISTS box_id UUID REFERENCES boxes(id) ON DELETE SET NULL;
ALTER TABLE pc_versions ADD COLUMN IF NOT EXISTS order_ids TEXT DEFAULT '';

CREATE TABLE IF NOT EXISTS pc_inclusion_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES pc_sorting_sessions(id) ON DELETE CASCADE,
  version_id UUID REFERENCES pc_versions(id) ON DELETE CASCADE,
  joiner_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  inclusions_assigned INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(version_id, joiner_id)
);

CREATE TABLE IF NOT EXISTS pc_sorting_session_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES pc_sorting_sessions(id) ON DELETE CASCADE,
  joiner_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  version_id UUID REFERENCES pc_versions(id) ON DELETE CASCADE,
  inclusions_assigned INTEGER NOT NULL DEFAULT 0,
  UNIQUE(session_id, joiner_id, version_id)
);
