-- ============================================================
-- GO MANAGER – Neon PostgreSQL Schema
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Enums ─────────────────────────────────────────────────
CREATE TYPE user_role AS ENUM ('admin', 'gom', 'joiner');
CREATE TYPE order_type AS ENUM ('group', 'personal');
CREATE TYPE order_status AS ENUM (
  'to_be_ordered','ordered',
  'at_k_addy','at_c_addy','at_j_addy',
  'otw_to_gom','at_gom'
);
CREATE TYPE pricing_type AS ENUM ('pob_only','pob_inclusions','custom');
CREATE TYPE addy_country AS ENUM ('KR','CN','JP');
CREATE TYPE payment_recipient AS ENUM ('kaddy','shop','proxy','seller');
CREATE TYPE shipping_status AS ENUM ('unpacked','packing','sorting','sent');
CREATE TYPE weight_type AS ENUM ('letter','package');
CREATE TYPE notification_type AS ENUM (
  'order_status_update',
  'deadline_48h','deadline_24h','deadline_1h',
  'new_deadline','payment_submitted'
);

-- ── Profiles ──────────────────────────────────────────────
CREATE TABLE profiles (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  username      TEXT UNIQUE NOT NULL,
  display_name  TEXT,
  email         TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  role          user_role NOT NULL DEFAULT 'joiner',
  avatar_url    TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── Groups & Members ──────────────────────────────────────
CREATE TABLE groups (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  name       TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE members (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  group_id   TEXT REFERENCES groups(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Shops ─────────────────────────────────────────────────
CREATE TABLE shops (
  id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  name             TEXT NOT NULL UNIQUE,
  website          TEXT,
  ships_to_korea   BOOLEAN DEFAULT FALSE,
  accepts_id       BOOLEAN DEFAULT FALSE,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ── Addy Addresses ────────────────────────────────────────
CREATE TABLE addy_addresses (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  country    addy_country NOT NULL UNIQUE,
  address    TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO addy_addresses (country) VALUES ('KR'),('CN'),('JP');

-- ── Orders ────────────────────────────────────────────────
CREATE TABLE orders (
  id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  type         order_type NOT NULL DEFAULT 'group',
  shop_id      TEXT REFERENCES shops(id) ON DELETE SET NULL,
  group_id     TEXT REFERENCES groups(id) ON DELETE SET NULL,
  round_number INTEGER,
  is_fancall   BOOLEAN DEFAULT FALSE,
  status       order_status NOT NULL DEFAULT 'to_be_ordered',
  addy_country addy_country,
  notes        TEXT,
  created_by   TEXT REFERENCES profiles(id),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── Order Items ───────────────────────────────────────────
CREATE TABLE order_items (
  id             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  order_id       TEXT REFERENCES orders(id) ON DELETE CASCADE,
  member_id      TEXT REFERENCES members(id) ON DELETE SET NULL,
  joiner_id      TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  pricing_type   pricing_type NOT NULL DEFAULT 'pob_only',
  description    TEXT,
  amount_claimed INTEGER NOT NULL DEFAULT 1,
  price_eur      NUMERIC(10,2),
  weight_g       NUMERIC(10,2),
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ── Boxes ─────────────────────────────────────────────────
CREATE TABLE boxes (
  id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  order_id         TEXT REFERENCES orders(id) ON DELETE CASCADE,
  label            TEXT,
  ems_total_eur    NUMERIC(10,2) DEFAULT 0,
  ems_total_krw    NUMERIC(12,0) DEFAULT 0,
  customs_total_eur NUMERIC(10,2) DEFAULT 0,
  customs_total_krw NUMERIC(12,0) DEFAULT 0,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ── Payments ──────────────────────────────────────────────
CREATE TABLE payments (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  recipient_type  payment_recipient NOT NULL,
  amount_eur      NUMERIC(10,2) NOT NULL DEFAULT 0,
  amount_krw      NUMERIC(12,0),
  shop_id         TEXT REFERENCES shops(id) ON DELETE SET NULL,
  order_id        TEXT REFERENCES orders(id) ON DELETE SET NULL,
  payment_method  TEXT,
  deadline        TIMESTAMPTZ,
  notes           TEXT,
  created_by      TEXT REFERENCES profiles(id),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE covering_log (
  id                    TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  payment_id            TEXT REFERENCES payments(id) ON DELETE CASCADE,
  amount_to_send_eur    NUMERIC(10,2) DEFAULT 0,
  amount_claimed_eur    NUMERIC(10,2) DEFAULT 0,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ── Fancalls ──────────────────────────────────────────────
CREATE TABLE fancalls (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  order_id          TEXT REFERENCES orders(id) ON DELETE SET NULL,
  shop_id           TEXT REFERENCES shops(id) ON DELETE SET NULL,
  entered_by        TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  fancall_datetime  TIMESTAMPTZ,
  won               BOOLEAN DEFAULT FALSE,
  received          BOOLEAN DEFAULT FALSE,
  benefits_to_kaddy TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ── Addy Items ────────────────────────────────────────────
CREATE TABLE addy_items (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  country     addy_country NOT NULL,
  order_id    TEXT REFERENCES orders(id) ON DELETE SET NULL,
  shop_id     TEXT REFERENCES shops(id) ON DELETE SET NULL,
  description TEXT,
  arrived_at  TIMESTAMPTZ,
  picture_url TEXT,
  is_personal BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── Sending Out ───────────────────────────────────────────
CREATE TABLE sending_out (
  id                 TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  order_id           TEXT REFERENCES orders(id) ON DELETE CASCADE,
  joiner_id          TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  courier            TEXT,
  address            TEXT,
  status             shipping_status NOT NULL DEFAULT 'unpacked',
  weight_type        weight_type,
  weight_g           NUMERIC(8,2),
  claims_picture_url TEXT,
  shipping_deadline  TIMESTAMPTZ,
  notes              TEXT,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ── PC Sorter ─────────────────────────────────────────────
CREATE TABLE pc_sorting_sessions (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  group_id   TEXT REFERENCES groups(id) ON DELETE SET NULL,
  title      TEXT NOT NULL,
  form_open  BOOLEAN DEFAULT TRUE,
  created_by TEXT REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE pc_versions (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  session_id TEXT REFERENCES pc_sorting_sessions(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE pc_photocards (
  id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  version_id   TEXT REFERENCES pc_versions(id) ON DELETE CASCADE,
  member_id    TEXT REFERENCES members(id) ON DELETE SET NULL,
  total_pulled INTEGER NOT NULL DEFAULT 0,
  available    INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE pc_joiner_needs (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  session_id TEXT REFERENCES pc_sorting_sessions(id) ON DELETE CASCADE,
  joiner_id  TEXT REFERENCES profiles(id) ON DELETE CASCADE,
  version_id TEXT REFERENCES pc_versions(id) ON DELETE CASCADE,
  amount_needed INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE pc_priority_forms (
  id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  session_id   TEXT REFERENCES pc_sorting_sessions(id) ON DELETE CASCADE,
  joiner_id    TEXT REFERENCES profiles(id) ON DELETE CASCADE,
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  form_data    JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE pc_assignments (
  id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  session_id   TEXT REFERENCES pc_sorting_sessions(id) ON DELETE CASCADE,
  joiner_id    TEXT REFERENCES profiles(id) ON DELETE CASCADE,
  photocard_id TEXT REFERENCES pc_photocards(id) ON DELETE CASCADE,
  sort_method  TEXT NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── Notifications ─────────────────────────────────────────
CREATE TABLE notifications (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  user_id    TEXT REFERENCES profiles(id) ON DELETE CASCADE,
  type       notification_type NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT,
  read       BOOLEAN DEFAULT FALSE,
  link       TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
