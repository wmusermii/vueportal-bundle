-- =====================================================================
--  komibank / schema portal  –  MIGRASI TUNGGAL (instalasi baru)
--  Rebuild dari nol: aktifkan baris DROP SCHEMA di bawah.
-- =====================================================================
-- DROP SCHEMA IF EXISTS portal CASCADE;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

BEGIN;

CREATE SCHEMA portal;

-- ---------------------------------------------------------------------
-- ENUM
-- ---------------------------------------------------------------------
CREATE TYPE portal.record_status AS ENUM ('active', 'inactive');
CREATE TYPE portal.menu_type     AS ENUM ('folder', 'page');

-- ---------------------------------------------------------------------
-- FUNGSI UMUM
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION portal.fn_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
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

CREATE OR REPLACE FUNCTION portal.fn_groups_protect_system()
RETURNS trigger LANGUAGE plpgsql AS $$
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

CREATE TRIGGER trg_groups_protect_system
  BEFORE UPDATE OR DELETE ON portal.groups
  FOR EACH ROW EXECUTE FUNCTION portal.fn_groups_protect_system();
CREATE TRIGGER trg_groups_updated_at
  BEFORE UPDATE ON portal.groups
  FOR EACH ROW EXECUTE FUNCTION portal.fn_set_updated_at();

-- ---------------------------------------------------------------------
-- USERS (group lewat user_groups)
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
  is_system  boolean      NOT NULL DEFAULT false,
  status     portal.record_status NOT NULL DEFAULT 'active',
  created_at timestamptz  NOT NULL DEFAULT now(),
  updated_at timestamptz  NOT NULL DEFAULT now(),
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

-- Hitung level otomatis, parent harus folder, menu yang punya anak tidak boleh dipindah
CREATE OR REPLACE FUNCTION portal.fn_menus_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
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

-- Proteksi menu sistem
CREATE OR REPLACE FUNCTION portal.fn_menus_protect_system()
RETURNS trigger LANGUAGE plpgsql AS $$
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
-- IZIN GROUP x MENU (CRUD per halaman)
-- ---------------------------------------------------------------------
CREATE TABLE portal.group_menu_permissions (
  group_id   bigint NOT NULL,
  menu_id    bigint NOT NULL,
  menu_type  portal.menu_type NOT NULL DEFAULT 'page',
  can_create boolean NOT NULL DEFAULT false,
  can_read   boolean NOT NULL DEFAULT false,
  can_update boolean NOT NULL DEFAULT false,
  can_delete boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
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
-- USER_GROUPS (1 user = 1 group; pindah group = UPDATE / UPSERT)
-- ---------------------------------------------------------------------
CREATE TABLE portal.user_groups (
  user_id     bigint      NOT NULL,
  group_id    bigint      NOT NULL,
  assigned_by bigint,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_user_groups    PRIMARY KEY (user_id),
  CONSTRAINT fk_ug_user        FOREIGN KEY (user_id)
    REFERENCES portal.users (id)  ON DELETE CASCADE,
  CONSTRAINT fk_ug_group       FOREIGN KEY (group_id)
    REFERENCES portal.groups (id) ON DELETE RESTRICT,
  CONSTRAINT fk_ug_assigned_by FOREIGN KEY (assigned_by)
    REFERENCES portal.users (id)  ON DELETE SET NULL
);
CREATE INDEX ix_ug_group_id ON portal.user_groups (group_id);

-- Anggota terakhir group sistem tidak boleh dilepas / dipindah / dihapus
CREATE OR REPLACE FUNCTION portal.fn_ug_keep_last_member()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_system boolean;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.group_id = OLD.group_id THEN
    RETURN NEW;
  END IF;

  SELECT is_system INTO v_system FROM portal.groups WHERE id = OLD.group_id;
  IF v_system AND NOT EXISTS (
       SELECT 1 FROM portal.user_groups
       WHERE group_id = OLD.group_id AND user_id <> OLD.user_id) THEN
    RAISE EXCEPTION 'Anggota terakhir group sistem tidak boleh dilepas/dipindah/dihapus';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

-- assigned_at ikut diperbarui saat user dipindah group
CREATE OR REPLACE FUNCTION portal.fn_ug_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.group_id IS DISTINCT FROM OLD.group_id THEN
    NEW.assigned_at := now();
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_ug_keep_last_member
  BEFORE DELETE OR UPDATE OF group_id ON portal.user_groups
  FOR EACH ROW EXECUTE FUNCTION portal.fn_ug_keep_last_member();
CREATE TRIGGER trg_ug_touch
  BEFORE UPDATE ON portal.user_groups
  FOR EACH ROW EXECUTE FUNCTION portal.fn_ug_touch();

-- =====================================================================
--  SEED
-- =====================================================================

-- Group
INSERT INTO portal.groups (code, name, description, is_system) VALUES
  ('ADMIN', 'Administrator', 'Akses penuh sistem', true),
  ('STAFF', 'Staff',         'Pengguna biasa',     false);

-- Menu: Dashboard (level 1, page)
INSERT INTO portal.menus (parent_id, code, title, type, path, sort_order, is_system)
VALUES (NULL, 'dashboard', 'Dashboard', 'page', '/dashboard', 1, true);

-- Menu: Master Data (level 1, folder)
INSERT INTO portal.menus (parent_id, code, title, type, path, sort_order, is_system)
VALUES (NULL, 'master', 'Master Data', 'folder', NULL, 2, true);

-- Menu: Master Data > Akses (level 2, folder)
INSERT INTO portal.menus (parent_id, code, title, type, path, sort_order, is_system)
SELECT id, 'master.akses', 'Akses', 'folder'::portal.menu_type, NULL::varchar, 1, true
  FROM portal.menus WHERE code = 'master';

-- Menu: Master Data > Akses > Pengguna / Group / Menu (level 3, page)
INSERT INTO portal.menus (parent_id, code, title, type, path, sort_order, is_system)
SELECT p.id, v.code, v.title, 'page'::portal.menu_type, v.path, v.sort_order, true
  FROM portal.menus p
 CROSS JOIN (VALUES
        ('users',  'Pengguna', '/master/akses/users',  1),
        ('groups', 'Group',    '/master/akses/groups', 2),
        ('menus',  'Menu',     '/master/akses/menus',  3)
      ) AS v(code, title, path, sort_order)
 WHERE p.code = 'master.akses';

-- ADMIN: akses penuh ke semua halaman
INSERT INTO portal.group_menu_permissions (group_id, menu_id, can_create, can_read, can_update, can_delete)
SELECT g.id, m.id, true, true, true, true
  FROM portal.groups g
 CROSS JOIN portal.menus m
 WHERE g.code = 'ADMIN' AND m.type = 'page';

-- STAFF: hanya lihat Dashboard
INSERT INTO portal.group_menu_permissions (group_id, menu_id, can_read)
SELECT g.id, m.id, true
  FROM portal.groups g
 CROSS JOIN portal.menus m
 WHERE g.code = 'STAFF' AND m.code = 'dashboard';

-- User admin awal (GANTI PASSWORD setelah login pertama)
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

-- =====================================================================
--  OPSIONAL – DATA UJI (hapus tanda komentar bila perlu)
-- =====================================================================
-- WITH nu AS (
--   INSERT INTO portal.users (username, email, full_name, password_hash)
--   VALUES ('staff1', 'staff1@komibank.local', 'Staff Satu',
--           crypt('Staff#12345', gen_salt('bf', 10)))
--   RETURNING id
-- )
-- INSERT INTO portal.user_groups (user_id, group_id, assigned_by)
-- SELECT nu.id, g.id, (SELECT id FROM portal.users WHERE username = 'admin')
--   FROM nu
--   JOIN portal.groups g ON g.code = 'STAFF';

-- =====================================================================
--  TEMPLATE – HALAMAN BARU (izin ADMIN terkunci di UI, jadi wajib lewat SQL)
-- =====================================================================
-- INSERT INTO portal.menus (parent_id, code, title, type, path, sort_order, is_system)
-- SELECT id, 'kode_baru', 'Judul', 'page'::portal.menu_type, '/path/baru', 1, true
--   FROM portal.menus WHERE code = 'kode_induk_folder';
--
-- INSERT INTO portal.group_menu_permissions (group_id, menu_id, can_create, can_read, can_update, can_delete)
-- SELECT g.id, m.id, true, true, true, true
--   FROM portal.groups g, portal.menus m
--  WHERE g.code = 'ADMIN' AND m.code = 'kode_baru';

-- =====================================================================
--  QUERY BANTU (pengecekan)
-- =====================================================================
-- Kolom tabel users:
-- SELECT column_name FROM information_schema.columns
--  WHERE table_schema = 'portal' AND table_name = 'users'
--  ORDER BY ordinal_position;
--
-- Constraint user_groups:
-- SELECT conname, contype FROM pg_constraint
--  WHERE conrelid = 'portal.user_groups'::regclass;
--
-- Izin efektif satu user (ganti 1 dengan parameter dari JWT):
-- SELECT m.code,
--        bool_or(p.can_create) AS can_create,
--        bool_or(p.can_read)   AS can_read,
--        bool_or(p.can_update) AS can_update,
--        bool_or(p.can_delete) AS can_delete
--   FROM portal.user_groups ug
--   JOIN portal.groups g ON g.id = ug.group_id AND g.status = 'active'
--   JOIN portal.group_menu_permissions p ON p.group_id = g.id
--   JOIN portal.menus m ON m.id = p.menu_id AND m.status = 'active'
--  WHERE ug.user_id = 1
--  GROUP BY m.id, m.code;
--
-- Daftar user + group:
-- SELECT u.username, g.code AS group_code, ug.assigned_by
--   FROM portal.users u
--   JOIN portal.user_groups ug ON ug.user_id = u.id
--   JOIN portal.groups g ON g.id = ug.group_id;