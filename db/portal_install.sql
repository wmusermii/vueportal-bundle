-- =====================================================================
--  komibank / schema portal  –  INSTALASI BARU (SKEMA + SEED) – 1 FILE
--
--  Hasil rapikan dari pg_dump database yang berjalan (skema final).
--  BAGIAN 1 = skema (enum, fungsi, tabel, constraint, index, trigger)
--  BAGIAN 2 = seed  (group, menu, izin, parameter default, user admin)
--
--  Cara pakai (database harus sudah ada & masih kosong):
--    psql -h HOST -p 5432 -U USER -d NAMA_DB -v ON_ERROR_STOP=1 -f komibank_portal_install.sql
--  Rebuild dari nol: aktifkan baris DROP SCHEMA di bawah (DATA HILANG).
--  Seluruh isi dijalankan dalam 1 transaksi: gagal di tengah = batal semua.
-- =====================================================================
-- DROP SCHEMA IF EXISTS portal CASCADE;

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- dipakai crypt() untuk user admin

BEGIN;

-- =====================================================================
--  BAGIAN 1 – SKEMA
-- =====================================================================
CREATE SCHEMA portal;

-- ---------------------------------------------------------------------
-- ENUM
-- ---------------------------------------------------------------------
CREATE TYPE portal.record_status   AS ENUM ('active', 'inactive');
CREATE TYPE portal.menu_type       AS ENUM ('folder', 'page');
CREATE TYPE portal.param_type      AS ENUM ('text', 'number', 'boolean', 'secret');
CREATE TYPE portal.approval_status AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE portal.approval_action AS ENUM ('approved', 'rejected');
CREATE TYPE portal.approval_role   AS ENUM ('approver', 'editor');

-- ---------------------------------------------------------------------
-- FUNGSI
-- ---------------------------------------------------------------------
-- Isi updated_at otomatis
CREATE FUNCTION portal.fn_set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- Group sistem (mis. ADMIN) tidak boleh dihapus / dikunci
CREATE FUNCTION portal.fn_groups_protect_system() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_system THEN
      RAISE EXCEPTION 'Group sistem (%) tidak boleh dihapus', OLD.code;
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.is_system AND (
       NEW.code      IS DISTINCT FROM OLD.code
    OR NEW.is_system IS DISTINCT FROM OLD.is_system
    OR NEW.status    <> 'active') THEN
    RAISE EXCEPTION 'Group sistem (%) tidak boleh diubah kode/status-nya', OLD.code;
  END IF;
  RETURN NEW;
END $$;

-- Hitung level menu otomatis, parent harus folder, menu beranak tidak boleh dipindah
CREATE FUNCTION portal.fn_menus_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_level smallint;
  v_type  portal.menu_type;
BEGIN
  IF NEW.parent_id IS NULL THEN
    NEW.level := 1;
  ELSE
    SELECT level, type INTO v_level, v_type
      FROM portal.menus WHERE id = NEW.parent_id;
    IF v_type IS DISTINCT FROM 'folder' THEN
      RAISE EXCEPTION 'Parent menu (id=%) harus ada dan bertipe folder', NEW.parent_id;
    END IF;
    NEW.level := v_level + 1;  -- level 4 ditolak oleh ck_menus_level
  END IF;

  IF TG_OP = 'UPDATE'
     AND (NEW.parent_id IS DISTINCT FROM OLD.parent_id
          OR NEW.type IS DISTINCT FROM OLD.type)
     AND EXISTS (SELECT 1 FROM portal.menus WHERE parent_id = OLD.id) THEN
    RAISE EXCEPTION 'Menu % masih punya anak; pindahkan/hapus anaknya dulu', OLD.code;
  END IF;

  RETURN NEW;
END $$;

-- Menu sistem tidak boleh dihapus / diubah kode, tipe, path, induk, status
CREATE FUNCTION portal.fn_menus_protect_system() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_system THEN
      RAISE EXCEPTION 'Menu sistem (%) tidak boleh dihapus', OLD.code;
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.is_system AND (
       NEW.is_system IS DISTINCT FROM OLD.is_system
    OR NEW.code      IS DISTINCT FROM OLD.code
    OR NEW.type      IS DISTINCT FROM OLD.type
    OR NEW.path      IS DISTINCT FROM OLD.path
    OR NEW.parent_id IS DISTINCT FROM OLD.parent_id
    OR NEW.status    <> 'active') THEN
    RAISE EXCEPTION 'Menu sistem (%): kode, tipe, path, induk, dan status tidak boleh diubah', OLD.code;
  END IF;
  RETURN NEW;
END $$;

-- Parameter sistem: hanya nilai dan deskripsi yang boleh diubah
CREATE FUNCTION portal.fn_parameters_protect_system() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_system THEN
      RAISE EXCEPTION 'Parameter sistem (%.%) tidak boleh dihapus', OLD.group_code, OLD.param_key;
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.is_system AND (
       NEW.group_code IS DISTINCT FROM OLD.group_code
    OR NEW.param_key  IS DISTINCT FROM OLD.param_key
    OR NEW.value_type IS DISTINCT FROM OLD.value_type
    OR NEW.options    IS DISTINCT FROM OLD.options
    OR NEW.num_min    IS DISTINCT FROM OLD.num_min
    OR NEW.num_max    IS DISTINCT FROM OLD.num_max
    OR NEW.is_system  IS DISTINCT FROM OLD.is_system) THEN
    RAISE EXCEPTION 'Parameter sistem (%.%): hanya nilai dan deskripsi yang boleh diubah', OLD.group_code, OLD.param_key;
  END IF;
  RETURN NEW;
END $$;

-- Anggota terakhir group sistem (ADMIN) tidak boleh dilepas/dihapus
CREATE FUNCTION portal.fn_ug_keep_last_member() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_system boolean;
BEGIN
  SELECT is_system INTO v_system FROM portal.groups WHERE id = OLD.group_id;
  IF v_system AND NOT EXISTS (
       SELECT 1 FROM portal.user_groups
       WHERE group_id = OLD.group_id AND user_id <> OLD.user_id) THEN
    RAISE EXCEPTION 'Anggota terakhir group sistem tidak boleh dilepas/dihapus';
  END IF;
  RETURN OLD;
END $$;

-- ---------------------------------------------------------------------
-- GROUPS
-- ---------------------------------------------------------------------
CREATE TABLE portal.groups (
  id          bigint GENERATED ALWAYS AS IDENTITY,
  code        varchar(30)  NOT NULL,
  name        varchar(100) NOT NULL,
  description varchar(255),
  is_system   boolean      NOT NULL DEFAULT false,
  status      portal.record_status NOT NULL DEFAULT 'active',
  created_at  timestamptz  NOT NULL DEFAULT now(),
  updated_at  timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT pk_groups      PRIMARY KEY (id),
  CONSTRAINT uq_groups_code UNIQUE (code),
  CONSTRAINT uq_groups_name UNIQUE (name),
  CONSTRAINT ck_groups_code CHECK (code ~ '^[A-Z][A-Z0-9_]{1,29}$'),
  CONSTRAINT ck_groups_name CHECK (btrim(name) <> '')
);

CREATE TRIGGER trg_groups_protect_system
  BEFORE UPDATE OR DELETE ON portal.groups
  FOR EACH ROW EXECUTE FUNCTION portal.fn_groups_protect_system();
CREATE TRIGGER trg_groups_updated_at
  BEFORE UPDATE ON portal.groups
  FOR EACH ROW EXECUTE FUNCTION portal.fn_set_updated_at();

-- ---------------------------------------------------------------------
-- USERS (keanggotaan group lewat user_groups)
-- ---------------------------------------------------------------------
CREATE TABLE portal.users (
  id            bigint GENERATED ALWAYS AS IDENTITY,
  username      varchar(50)  NOT NULL,
  email         varchar(150) NOT NULL,
  full_name     varchar(100) NOT NULL,
  password_hash varchar(255) NOT NULL,
  status        portal.record_status NOT NULL DEFAULT 'active',
  last_login_at timestamptz,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT pk_users          PRIMARY KEY (id),
  CONSTRAINT uq_users_username UNIQUE (username),
  CONSTRAINT uq_users_email    UNIQUE (email),
  CONSTRAINT ck_users_username CHECK (username ~ '^[a-z0-9_.]{3,50}$'),
  CONSTRAINT ck_users_email    CHECK (email = lower(email)
    AND email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  CONSTRAINT ck_users_fullname CHECK (btrim(full_name) <> ''),
  CONSTRAINT ck_users_pwdhash  CHECK (char_length(password_hash) >= 50)
);

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON portal.users
  FOR EACH ROW EXECUTE FUNCTION portal.fn_set_updated_at();

-- ---------------------------------------------------------------------
-- MENUS (pohon maksimal 3 level)
-- ---------------------------------------------------------------------
CREATE TABLE portal.menus (
  id         bigint GENERATED ALWAYS AS IDENTITY,
  parent_id  bigint,
  code       varchar(60)  NOT NULL,
  title      varchar(100) NOT NULL,
  type       portal.menu_type NOT NULL,
  path       varchar(150),
  icon       varchar(50),
  level      smallint     NOT NULL DEFAULT 1,
  sort_order integer      NOT NULL DEFAULT 0,
  status     portal.record_status NOT NULL DEFAULT 'active',
  created_at timestamptz  NOT NULL DEFAULT now(),
  updated_at timestamptz  NOT NULL DEFAULT now(),
  is_system  boolean      NOT NULL DEFAULT false,
  CONSTRAINT pk_menus            PRIMARY KEY (id),
  CONSTRAINT uq_menus_code       UNIQUE (code),
  CONSTRAINT uq_menus_path       UNIQUE (path),
  CONSTRAINT uq_menus_id_type    UNIQUE (id, type),
  CONSTRAINT fk_menus_parent     FOREIGN KEY (parent_id)
    REFERENCES portal.menus (id) ON DELETE RESTRICT,
  CONSTRAINT ck_menus_code       CHECK (code ~ '^[a-z][a-z0-9_.-]{1,59}$'),
  CONSTRAINT ck_menus_title      CHECK (btrim(title) <> ''),
  CONSTRAINT ck_menus_level      CHECK (level BETWEEN 1 AND 3),
  CONSTRAINT ck_menus_root       CHECK ((parent_id IS NULL) = (level = 1)),
  CONSTRAINT ck_menus_self       CHECK (parent_id IS DISTINCT FROM id),
  CONSTRAINT ck_menus_sort       CHECK (sort_order >= 0),
  CONSTRAINT ck_menus_folder_lvl CHECK (NOT (type = 'folder' AND level = 3)),
  CONSTRAINT ck_menus_path_type  CHECK (
       (type = 'page'   AND path IS NOT NULL AND path ~ '^/[a-z0-9/_-]*$')
    OR (type = 'folder' AND path IS NULL))
);
CREATE INDEX ix_menus_parent_id ON portal.menus (parent_id);

CREATE TRIGGER trg_menus_guard
  BEFORE INSERT OR UPDATE ON portal.menus
  FOR EACH ROW EXECUTE FUNCTION portal.fn_menus_guard();
CREATE TRIGGER trg_menus_protect_system
  BEFORE UPDATE OR DELETE ON portal.menus
  FOR EACH ROW EXECUTE FUNCTION portal.fn_menus_protect_system();
CREATE TRIGGER trg_menus_updated_at
  BEFORE UPDATE ON portal.menus
  FOR EACH ROW EXECUTE FUNCTION portal.fn_set_updated_at();

-- ---------------------------------------------------------------------
-- IZIN GROUP x MENU (CRUD per halaman + penanda perlu approval)
-- ---------------------------------------------------------------------
CREATE TABLE portal.group_menu_permissions (
  group_id       bigint NOT NULL,
  menu_id        bigint NOT NULL,
  menu_type      portal.menu_type NOT NULL DEFAULT 'page',
  can_create     boolean NOT NULL DEFAULT false,
  can_read       boolean NOT NULL DEFAULT false,
  can_update     boolean NOT NULL DEFAULT false,
  can_delete     boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  needs_approval boolean NOT NULL DEFAULT false,
  CONSTRAINT pk_group_menu_permissions PRIMARY KEY (group_id, menu_id),
  CONSTRAINT fk_gmp_group FOREIGN KEY (group_id)
    REFERENCES portal.groups (id) ON DELETE CASCADE,
  CONSTRAINT fk_gmp_menu  FOREIGN KEY (menu_id, menu_type)
    REFERENCES portal.menus (id, type) ON DELETE CASCADE,
  CONSTRAINT ck_gmp_only_page   CHECK (menu_type = 'page'),
  CONSTRAINT ck_gmp_read_needed CHECK (can_read OR NOT (can_create OR can_update OR can_delete))
);
CREATE INDEX ix_gmp_menu_id ON portal.group_menu_permissions (menu_id);

CREATE TRIGGER trg_gmp_updated_at
  BEFORE UPDATE ON portal.group_menu_permissions
  FOR EACH ROW EXECUTE FUNCTION portal.fn_set_updated_at();

-- ---------------------------------------------------------------------
-- USER_GROUPS (1 user = 1 group lewat uq_user_groups_user)
-- ---------------------------------------------------------------------
CREATE TABLE portal.user_groups (
  user_id     bigint      NOT NULL,
  group_id    bigint      NOT NULL,
  assigned_by bigint,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_user_groups       PRIMARY KEY (user_id, group_id),
  CONSTRAINT uq_user_groups_user  UNIQUE (user_id),
  CONSTRAINT fk_ug_user           FOREIGN KEY (user_id)
    REFERENCES portal.users (id)  ON DELETE CASCADE,
  CONSTRAINT fk_ug_group          FOREIGN KEY (group_id)
    REFERENCES portal.groups (id) ON DELETE RESTRICT,
  CONSTRAINT fk_ug_assigned_by    FOREIGN KEY (assigned_by)
    REFERENCES portal.users (id)  ON DELETE SET NULL
);
CREATE INDEX ix_ug_group_id ON portal.user_groups (group_id);

CREATE TRIGGER trg_ug_keep_last_member
  BEFORE DELETE ON portal.user_groups
  FOR EACH ROW EXECUTE FUNCTION portal.fn_ug_keep_last_member();

-- ---------------------------------------------------------------------
-- PARAMETERS (pengaturan portal: login, password, smtp, session, portal, themes)
-- ---------------------------------------------------------------------
CREATE TABLE portal.parameters (
  id          bigint GENERATED ALWAYS AS IDENTITY,
  group_code  varchar(30)  NOT NULL,
  param_key   varchar(60)  NOT NULL,
  value       text         NOT NULL DEFAULT '',
  value_type  portal.param_type NOT NULL DEFAULT 'text',
  options     text[],
  num_min     integer,
  num_max     integer,
  description varchar(255) NOT NULL DEFAULT '',
  is_system   boolean      NOT NULL DEFAULT false,
  updated_by  bigint,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  updated_at  timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT pk_parameters         PRIMARY KEY (id),
  CONSTRAINT uq_parameters_key     UNIQUE (group_code, param_key),
  CONSTRAINT fk_parameters_user    FOREIGN KEY (updated_by)
    REFERENCES portal.users (id) ON DELETE SET NULL,
  CONSTRAINT ck_parameters_group   CHECK (group_code ~ '^[a-z][a-z0-9_]{1,29}$'),
  CONSTRAINT ck_parameters_key     CHECK (param_key  ~ '^[a-z][a-z0-9_]{1,59}$'),
  CONSTRAINT ck_parameters_boolean CHECK (value_type <> 'boolean'
    OR value = ANY (ARRAY['true', 'false'])),
  CONSTRAINT ck_parameters_number  CHECK (value_type <> 'number' OR
    CASE
      WHEN value ~ '^-?[0-9]{1,9}$'
        THEN ((num_min IS NULL OR value::integer >= num_min)
          AND (num_max IS NULL OR value::integer <= num_max))
      ELSE false
    END),
  CONSTRAINT ck_parameters_options CHECK (options IS NULL OR value_type = 'text'),
  CONSTRAINT ck_parameters_range   CHECK (
       (value_type = 'number' AND (num_min IS NULL OR num_max IS NULL OR num_min <= num_max))
    OR (value_type <> 'number' AND num_min IS NULL AND num_max IS NULL)),
  CONSTRAINT ck_parameters_select  CHECK (options IS NULL OR value = ANY (options)),
  CONSTRAINT ck_parameters_theme_color CHECK (group_code <> 'themes'
    OR param_key NOT LIKE '%\_color'
    OR value ~ '^#[0-9a-fA-F]{6}$'
    OR (param_key = 'sidebar_color' AND value = ''))
);

CREATE TRIGGER trg_parameters_protect_system
  BEFORE UPDATE OR DELETE ON portal.parameters
  FOR EACH ROW EXECUTE FUNCTION portal.fn_parameters_protect_system();
CREATE TRIGGER trg_parameters_updated_at
  BEFORE UPDATE ON portal.parameters
  FOR EACH ROW EXECUTE FUNCTION portal.fn_set_updated_at();

-- ---------------------------------------------------------------------
-- THEME_ASSETS (logo, favicon, gambar login – diunggah dari halaman Themes)
-- ---------------------------------------------------------------------
CREATE TABLE portal.theme_assets (
  asset_key  varchar(20) NOT NULL,
  mime_type  varchar(30) NOT NULL,
  data       bytea       NOT NULL,
  updated_by bigint,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT theme_assets_pkey      PRIMARY KEY (asset_key),
  CONSTRAINT fk_theme_assets_user   FOREIGN KEY (updated_by)
    REFERENCES portal.users (id) ON DELETE SET NULL,
  CONSTRAINT ck_theme_assets_key    CHECK ((asset_key)::text = ANY
    ((ARRAY['logo'::varchar, 'favicon'::varchar, 'login_image'::varchar])::text[])),
  CONSTRAINT ck_theme_assets_mime   CHECK ((mime_type)::text = ANY
    ((ARRAY['image/png'::varchar, 'image/jpeg'::varchar, 'image/webp'::varchar,
            'image/x-icon'::varchar])::text[])),
  CONSTRAINT ck_theme_assets_size   CHECK (octet_length(data) <= 2097152)
);

-- ---------------------------------------------------------------------
-- LOGIN_ATTEMPTS (pembatasan percobaan login)
-- ---------------------------------------------------------------------
CREATE TABLE portal.login_attempts (
  id         bigint GENERATED ALWAYS AS IDENTITY,
  username   varchar(50) NOT NULL,
  ip         varchar(64) NOT NULL,
  success    boolean     NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_login_attempts PRIMARY KEY (id)
);
CREATE INDEX ix_login_attempts_ip   ON portal.login_attempts (ip, created_at DESC)
  WHERE (NOT success);
CREATE INDEX ix_login_attempts_user ON portal.login_attempts (username, created_at DESC);

-- ---------------------------------------------------------------------
-- APPROVAL: jenis, penugasan (approver/editor), permintaan, langkah
-- ---------------------------------------------------------------------
CREATE TABLE portal.approval_types (
  id          bigint GENERATED ALWAYS AS IDENTITY,
  code        varchar(50)  NOT NULL,
  name        varchar(100) NOT NULL,
  description varchar(255),
  is_public   boolean      NOT NULL DEFAULT false,
  status      portal.record_status NOT NULL DEFAULT 'active',
  created_at  timestamptz  NOT NULL DEFAULT now(),
  updated_at  timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT pk_approval_types      PRIMARY KEY (id),
  CONSTRAINT uq_approval_types_code UNIQUE (code),
  CONSTRAINT ck_approval_types_code CHECK (code ~ '^[A-Z][A-Z0-9_]{1,49}$'),
  CONSTRAINT ck_approval_types_name CHECK (btrim(name) <> '')
);

CREATE TABLE portal.approval_assignments (
  id         bigint GENERATED ALWAYS AS IDENTITY,
  type_id    bigint NOT NULL,
  role       portal.approval_role NOT NULL,
  level      smallint    NOT NULL DEFAULT 0,
  group_id   bigint,
  user_id    bigint,
  created_by bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_approval_assignments PRIMARY KEY (id),
  CONSTRAINT fk_aa_type       FOREIGN KEY (type_id)
    REFERENCES portal.approval_types (id) ON DELETE CASCADE,
  CONSTRAINT fk_aa_group      FOREIGN KEY (group_id)   REFERENCES portal.groups (id),
  CONSTRAINT fk_aa_user       FOREIGN KEY (user_id)    REFERENCES portal.users (id),
  CONSTRAINT fk_aa_created_by FOREIGN KEY (created_by) REFERENCES portal.users (id),
  CONSTRAINT ck_aa_level  CHECK (
       (role = 'editor'   AND level = 0)
    OR (role = 'approver' AND level BETWEEN 1 AND 5)),
  CONSTRAINT ck_aa_target CHECK ((group_id IS NOT NULL) <> (user_id IS NOT NULL))
);
CREATE INDEX ix_aa_group ON portal.approval_assignments (group_id) WHERE (group_id IS NOT NULL);
CREATE INDEX ix_aa_user  ON portal.approval_assignments (user_id)  WHERE (user_id  IS NOT NULL);
CREATE UNIQUE INDEX uq_aa_group ON portal.approval_assignments (type_id, role, level, group_id)
  WHERE (group_id IS NOT NULL);
CREATE UNIQUE INDEX uq_aa_user  ON portal.approval_assignments (type_id, role, level, user_id)
  WHERE (user_id IS NOT NULL);

CREATE TABLE portal.approval_requests (
  id            bigint GENERATED ALWAYS AS IDENTITY,
  type_id       bigint NOT NULL,
  status        portal.approval_status NOT NULL DEFAULT 'pending',
  subject       varchar(200) NOT NULL,
  unique_key    varchar(200),
  payload       jsonb        NOT NULL,
  decision      jsonb,
  requested_by  bigint,
  decided_by    bigint,
  decided_at    timestamptz,
  note          varchar(500),
  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now(),
  current_level smallint     NOT NULL DEFAULT 1,
  total_levels  smallint     NOT NULL DEFAULT 1,
  CONSTRAINT pk_approval_requests PRIMARY KEY (id),
  CONSTRAINT fk_ar_type         FOREIGN KEY (type_id)      REFERENCES portal.approval_types (id),
  CONSTRAINT fk_ar_requested_by FOREIGN KEY (requested_by) REFERENCES portal.users (id),
  CONSTRAINT fk_ar_decided_by   FOREIGN KEY (decided_by)   REFERENCES portal.users (id),
  CONSTRAINT ck_ar_subject     CHECK (btrim(subject) <> ''),
  CONSTRAINT ck_ar_payload     CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT ck_ar_levels      CHECK (((total_levels >= 1) AND (total_levels <= 5))
    AND ((current_level >= 1) AND (current_level <= total_levels))),
  CONSTRAINT ck_ar_decided     CHECK (
       (status = 'pending' AND decided_by IS NULL AND decided_at IS NULL)
    OR (status <> 'pending' AND decided_by IS NOT NULL AND decided_at IS NOT NULL)),
  CONSTRAINT ck_ar_reject_note CHECK (status <> 'rejected'
    OR btrim(COALESCE(note, '')) <> '')
);
CREATE INDEX ix_ar_inbox ON portal.approval_requests (type_id, status, created_at DESC);
CREATE UNIQUE INDEX uq_ar_pending_key ON portal.approval_requests (type_id, unique_key)
  WHERE (status = 'pending' AND unique_key IS NOT NULL);

CREATE TABLE portal.approval_steps (
  id          bigint GENERATED ALWAYS AS IDENTITY,
  request_id  bigint NOT NULL,
  level       smallint NOT NULL,
  action      portal.approval_action NOT NULL,
  acted_by    bigint NOT NULL,
  acted_at    timestamptz NOT NULL DEFAULT now(),
  note        varchar(500),
  data        jsonb,
  is_override boolean NOT NULL DEFAULT false,
  CONSTRAINT pk_approval_steps PRIMARY KEY (id),
  CONSTRAINT uq_as_actor       UNIQUE (request_id, acted_by),
  CONSTRAINT uq_as_level       UNIQUE (request_id, level),
  CONSTRAINT fk_as_request     FOREIGN KEY (request_id)
    REFERENCES portal.approval_requests (id) ON DELETE CASCADE,
  CONSTRAINT fk_as_user        FOREIGN KEY (acted_by) REFERENCES portal.users (id),
  CONSTRAINT ck_as_data        CHECK (data IS NULL OR jsonb_typeof(data) = 'object'),
  CONSTRAINT ck_as_reject_note CHECK (action = 'approved'
    OR btrim(COALESCE(note, '')) <> '')
);


-- =====================================================================
--  BAGIAN 2 – SEED
-- =====================================================================

-- ---------------------------------------------------------------------
-- GROUP
-- ---------------------------------------------------------------------
INSERT INTO portal.groups (id, code, name, description, is_system) OVERRIDING SYSTEM VALUE VALUES
  (1, 'ADMIN',      'Administrator', 'Akses penuh',                     true),
  (2, 'MANAGER',    'Manager',       'Akses operasional',               false),
  (3, 'STAFF',      'Staff',         'Akses terbatas',                  false),
  (5, 'SUPERVISOR', 'Supervisor',    'Group Spv harusnya untuk Approval', false),
  (6, 'APPROVER',   'Approver',      'Ini halaman Khusus Approver',     false);

SELECT setval(pg_get_serial_sequence('portal.groups', 'id'), (SELECT max(id) FROM portal.groups));

-- ---------------------------------------------------------------------
-- MENU (semua menu bawaan: is_system = true; induk dulu, lalu anak)
-- ---------------------------------------------------------------------
INSERT INTO portal.menus (id, parent_id, code, title, type, path, icon, sort_order, is_system) OVERRIDING SYSTEM VALUE VALUES
  (1,  NULL, 'dashboard',         'Dashboard',           'page',   '/dashboard',                'home',     1, true),
  (2,  NULL, 'master',            'Master Data',         'folder', NULL,                        'database', 2, true),
  (3,  2,    'master.akses',      'Akses',               'folder', NULL,                        'shield',   1, true),
  (4,  3,    'users',             'Pengguna',            'page',   '/master/akses/users',       'users',    1, true),
  (5,  3,    'groups',            'Group & Hak Akses',   'page',   '/master/akses/groups',      'lock',     2, true),
  (6,  3,    'menus',             'Menu',                'page',   '/master/akses/menus',       'list',     3, true),
  (9,  2,    'master.settings',   'Settings',            'folder', NULL,                        'settings', 2, true),
  (10, 9,    'portal',            'Portal',              'page',   '/master/settings/portal',   'portal',   1, true),
  (13, NULL, 'approvals',         'Persetujuan',         'page',   '/approvals',                'folder',   4, true),
  (14, 9,    'approval_settings', 'Pengaturan Approval', 'page',   '/master/settings/approval', 'lock',     2, true);

SELECT setval(pg_get_serial_sequence('portal.menus', 'id'), (SELECT max(id) FROM portal.menus));

-- ---------------------------------------------------------------------
-- IZIN: (group, halaman, create, read, update, delete, perlu_approval)
-- ---------------------------------------------------------------------
INSERT INTO portal.group_menu_permissions
  (group_id, menu_id, can_create, can_read, can_update, can_delete, needs_approval)
SELECT g.id, m.id, p.c, p.r, p.u, p.d, p.na
  FROM (VALUES
        ('ADMIN',      'dashboard',         false, true,  false, false, false),
        ('ADMIN',      'users',             true,  true,  true,  true,  false),
        ('ADMIN',      'groups',            true,  true,  true,  true,  false),
        ('ADMIN',      'menus',             true,  true,  true,  true,  false),
        ('ADMIN',      'portal',            true,  true,  true,  true,  false),
        ('ADMIN',      'approvals',         true,  true,  true,  true,  false),
        ('ADMIN',      'approval_settings', true,  true,  true,  true,  false),
        ('MANAGER',    'dashboard',         false, true,  false, false, false),
        ('MANAGER',    'users',             true,  true,  true,  true,  true),
        ('MANAGER',    'groups',            true,  true,  true,  true,  false),
        ('MANAGER',    'approvals',         false, true,  false, false, false),
        ('STAFF',      'dashboard',         false, true,  false, false, false),
        ('SUPERVISOR', 'dashboard',         false, true,  false, false, false),
        ('APPROVER',   'dashboard',         false, true,  false, false, false),
        ('APPROVER',   'approvals',         false, true,  false, false, false)
      ) AS p(group_code, menu_code, c, r, u, d, na)
  JOIN portal.groups g ON g.code = p.group_code
  JOIN portal.menus  m ON m.code = p.menu_code;

-- ---------------------------------------------------------------------
-- PARAMETER DEFAULT
-- (kredensial SMTP, email kontak, dan URL aset tema dikosongkan)
-- ---------------------------------------------------------------------
INSERT INTO portal.parameters
  (group_code, param_key, value, value_type, options, num_min, num_max, description, is_system)
VALUES
  -- login
  ('login', 'max_attempts',   '3',        'number', NULL, 1, 100,   'Jumlah percobaan login gagal sebelum diblokir sementara', true),
  ('login', 'window_minutes', '15',       'number', NULL, 1, 1440,  'Jendela waktu penghitungan percobaan gagal (menit)', true),
  ('login', 'block_minutes',  '1',        'number', NULL, 1, 10080, 'Lama pemblokiran setelah melewati batas (menit)', true),
  ('login', 'block_by',       'username', 'text',   ARRAY['ip','username','both'], NULL, NULL, 'Pemblokiran berdasarkan alamat IP, username, atau keduanya', true),
  -- password
  ('password', 'min_length',     '8',    'number',  NULL, 6, 128, 'Panjang password minimal', true),
  ('password', 'require_upper',  'true', 'boolean', NULL, NULL, NULL, 'Wajib memuat huruf besar', true),
  ('password', 'require_lower',  'true', 'boolean', NULL, NULL, NULL, 'Wajib memuat huruf kecil', true),
  ('password', 'require_number', 'true', 'boolean', NULL, NULL, NULL, 'Wajib memuat angka', true),
  ('password', 'require_symbol', 'true', 'boolean', NULL, NULL, NULL, 'Wajib memuat simbol (mis. ! @ # $)', true),
  -- smtp (nonaktif sampai diisi dari halaman Portal)
  ('smtp', 'enabled',    'false',           'boolean', NULL, NULL, NULL, 'Aktifkan pengiriman email dari portal', true),
  ('smtp', 'host',       'smtp.contoh.com', 'text',    NULL, NULL, NULL, 'Alamat server SMTP, contoh smtp.contoh.com', true),
  ('smtp', 'port',       '587',             'number',  NULL, 1, 65535,   'Port server SMTP', true),
  ('smtp', 'security',   'none',            'text',    ARRAY['none','starttls','ssl'], NULL, NULL, 'Enkripsi koneksi ke server SMTP', true),
  ('smtp', 'username',   '',                'text',    NULL, NULL, NULL, 'Username akun SMTP', true),
  ('smtp', 'password',   '',                'secret',  NULL, NULL, NULL, 'Password akun SMTP (disimpan terenkripsi)', true),
  ('smtp', 'from_email', '',                'text',    NULL, NULL, NULL, 'Alamat email pengirim', true),
  ('smtp', 'from_name',  'VX Portal',       'text',    NULL, NULL, NULL, 'Nama pengirim yang tampil di email', true),
  -- session
  ('session', 'duration_hours', '8', 'number', NULL, 1, 720, 'Masa berlaku sesi login (jam)', true),
  -- portal
  ('portal', 'name',             'Vue Express Portal', 'text',    NULL, NULL, NULL, 'Nama portal', true),
  ('portal', 'support_email',    '',                   'text',    NULL, NULL, NULL, 'Email bantuan yang ditampilkan ke pengguna', true),
  ('portal', 'maintenance_mode', 'false',              'boolean', NULL, NULL, NULL, 'Mode pemeliharaan: hanya admin yang dapat login', true),
  -- themes
  ('themes', 'primary_color',      '#166ca2', 'text',   NULL, NULL, NULL, 'Warna utama (tombol, menu aktif)', true),
  ('themes', 'sidebar_color',      '',        'text',   NULL, NULL, NULL, 'Warna sidebar. Kosong = ikut warna utama', true),
  ('themes', 'sidebar_text_color', '#ffffff', 'text',   NULL, NULL, NULL, 'Warna teks sidebar', true),
  ('themes', 'login_bg_color',     '#f3f4f6', 'text',   NULL, NULL, NULL, 'Warna latar halaman login', true),
  ('themes', 'border_radius',      '5',       'number', NULL, 0, 24,      'Kelengkungan sudut komponen (px)', true),
  ('themes', 'logo_url',           '',        'text',   NULL, NULL, NULL, 'Logo pojok kiri atas. Kosong = ikon bawaan', true),
  ('themes', 'favicon_url',        '',        'text',   NULL, NULL, NULL, 'Favicon tab browser. Kosong = bawaan', true),
  ('themes', 'login_image_url',    '',        'text',   NULL, NULL, NULL, 'Gambar di kiri form login. Kosong = tanpa gambar', true),
  ('themes', 'primary_text_color', '#ffffff', 'text',   NULL, NULL, NULL, 'Warna teks di atas warna utama (tombol, avatar)', true),
  ('themes', 'accent_color',       '#e5a823', 'text',   NULL, NULL, NULL, 'Warna aksen (penanda menu aktif, kotak inisial)', true),
  ('themes', 'background_color',   '#f2f5f4', 'text',   NULL, NULL, NULL, 'Warna latar halaman', true),
  ('themes', 'surface_color',      '#ffffff', 'text',   NULL, NULL, NULL, 'Warna kartu, topbar, kolom isian, dan dialog', true),
  ('themes', 'text_color',         '#14282c', 'text',   NULL, NULL, NULL, 'Warna teks utama', true),
  ('themes', 'text_muted_color',   '#55696d', 'text',   NULL, NULL, NULL, 'Warna teks sekunder', true),
  ('themes', 'border_color',       '#dde4e2', 'text',   NULL, NULL, NULL, 'Warna garis dan border', true),
  ('themes', 'success_color',      '#067647', 'text',   NULL, NULL, NULL, 'Warna status berhasil / aktif', true),
  ('themes', 'warning_color',      '#8a5a00', 'text',   NULL, NULL, NULL, 'Warna peringatan', true),
  ('themes', 'danger_color',       '#b42318', 'text',   NULL, NULL, NULL, 'Warna bahaya / hapus / galat', true);

-- ---------------------------------------------------------------------
-- USER ADMIN AWAL  (GANTI PASSWORD setelah login pertama)
-- ---------------------------------------------------------------------
WITH new_user AS (
  INSERT INTO portal.users (username, email, full_name, password_hash)
  VALUES (
    'admin',
    'admin@komibank.local',
    'Administrator',
    crypt('GantiPasswordIni#123', gen_salt('bf', 10))
  )
  RETURNING id
)
INSERT INTO portal.user_groups (user_id, group_id)
SELECT nu.id, g.id
  FROM new_user nu
  JOIN portal.groups g ON g.code = 'ADMIN';

COMMIT;
