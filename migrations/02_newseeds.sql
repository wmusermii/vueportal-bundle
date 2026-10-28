-- =====================================================================
--  komibank / schema portal  –  SEEDS (jalankan SETELAH skema)
--  Sekali jalan: kalau data sudah ada, transaksi gagal dan di-rollback.
-- =====================================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;

BEGIN;

-- ---------------------------------------------------------------------
-- GROUPS
-- ---------------------------------------------------------------------
INSERT INTO portal.groups (code, name, description, is_system) VALUES
  ('ADMIN',   'Administrator', 'Akses penuh',       true),
  ('MANAGER', 'Manager',       'Akses operasional', false),
  ('STAFF',   'Staff',         'Akses terbatas',    false);

-- ---------------------------------------------------------------------
-- MENUS
-- ---------------------------------------------------------------------
-- Level 1
INSERT INTO portal.menus (parent_id, code, title, type, path, icon, sort_order, is_system) VALUES
  (NULL, 'dashboard', 'Dashboard',   'page',   '/dashboard', 'home',     1, true),
  (NULL, 'master',    'Master Data', 'folder', NULL,         'database', 2, true);

-- Level 2
INSERT INTO portal.menus (parent_id, code, title, type, path, icon, sort_order, is_system)
SELECT id, 'master.akses', 'Akses', 'folder'::portal.menu_type, NULL::varchar, 'shield', 1, true
  FROM portal.menus WHERE code = 'master';

-- Level 3
INSERT INTO portal.menus (parent_id, code, title, type, path, icon, sort_order, is_system)
SELECT m.id, v.code, v.title, 'page'::portal.menu_type, v.path, v.icon, v.sort, true
  FROM portal.menus m
 CROSS JOIN (VALUES
        ('users',  'Pengguna',          '/master/akses/users',  'users', 1),
        ('groups', 'Group & Hak Akses', '/master/akses/groups', 'lock',  2),
        ('menus',  'Menu',              '/master/akses/menus',  NULL,    3)
      ) AS v(code, title, path, icon, sort)
 WHERE m.code = 'master.akses';

-- ---------------------------------------------------------------------
-- IZIN: (group, halaman, create, read, update, delete)
-- ---------------------------------------------------------------------
INSERT INTO portal.group_menu_permissions
  (group_id, menu_id, can_create, can_read, can_update, can_delete)
SELECT g.id, m.id, p.c, p.r, p.u, p.d
  FROM (VALUES
        ('ADMIN',   'dashboard', false, true,  false, false),
        ('ADMIN',   'users',     true,  true,  true,  true),
        ('ADMIN',   'groups',    true,  true,  true,  true),
        ('ADMIN',   'menus',     true,  true,  true,  true),
        ('MANAGER', 'dashboard', false, true,  false, false),
        ('MANAGER', 'users',     true,  true,  true,  false),
        ('MANAGER', 'groups',    false, true,  false, false),
        ('STAFF',   'dashboard', false, true,  false, false)
      ) AS p(group_code, menu_code, c, r, u, d)
  JOIN portal.groups g ON g.code = p.group_code
  JOIN portal.menus  m ON m.code = p.menu_code;

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
-- INSERT INTO portal.menus (parent_id, code, title, type, path, icon, sort_order, is_system)
-- SELECT id, 'kode_baru', 'Judul', 'page'::portal.menu_type, '/path/baru', NULL, 1, true
--   FROM portal.menus WHERE code = 'kode_induk_folder';
--
-- INSERT INTO portal.group_menu_permissions (group_id, menu_id, can_create, can_read, can_update, can_delete)
-- SELECT g.id, m.id, true, true, true, true
--   FROM portal.groups g, portal.menus m
--  WHERE g.code = 'ADMIN' AND m.code = 'kode_baru';