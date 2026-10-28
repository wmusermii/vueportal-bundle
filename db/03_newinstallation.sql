BEGIN;

CREATE TYPE portal.param_type AS ENUM ('text', 'number', 'boolean', 'secret');

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
  CONSTRAINT pk_parameters      PRIMARY KEY (id),
  CONSTRAINT uq_parameters_key  UNIQUE (group_code, param_key),
  CONSTRAINT fk_parameters_user FOREIGN KEY (updated_by)
    REFERENCES portal.users (id) ON DELETE SET NULL,
  CONSTRAINT ck_parameters_group CHECK (group_code ~ '^[a-z][a-z0-9_]{1,29}$'),
  CONSTRAINT ck_parameters_key   CHECK (param_key ~ '^[a-z][a-z0-9_]{1,59}$'),
  CONSTRAINT ck_parameters_boolean CHECK (value_type <> 'boolean' OR value IN ('true', 'false')),
  CONSTRAINT ck_parameters_number CHECK (
    value_type <> 'number'
    OR (CASE WHEN value ~ '^-?[0-9]{1,9}$'
             THEN (num_min IS NULL OR value::integer >= num_min)
              AND (num_max IS NULL OR value::integer <= num_max)
             ELSE false END)),
  CONSTRAINT ck_parameters_range CHECK (
    (value_type = 'number' AND (num_min IS NULL OR num_max IS NULL OR num_min <= num_max))
    OR (value_type <> 'number' AND num_min IS NULL AND num_max IS NULL)),
  CONSTRAINT ck_parameters_options CHECK (options IS NULL OR value_type = 'text'),
  CONSTRAINT ck_parameters_select  CHECK (options IS NULL OR value = ANY (options))
);

-- parameter sistem: tidak bisa dihapus, hanya nilai dan deskripsi yang boleh diubah
CREATE OR REPLACE FUNCTION portal.fn_parameters_protect_system()
RETURNS trigger LANGUAGE plpgsql AS $$
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

CREATE TRIGGER trg_parameters_protect_system
  BEFORE UPDATE OR DELETE ON portal.parameters
  FOR EACH ROW EXECUTE FUNCTION portal.fn_parameters_protect_system();
CREATE TRIGGER trg_parameters_updated_at
  BEFORE UPDATE ON portal.parameters
  FOR EACH ROW EXECUTE FUNCTION portal.fn_set_updated_at();

-- seed parameter
INSERT INTO portal.parameters
  (group_code, param_key, value, value_type, options, num_min, num_max, description, is_system)
VALUES
  ('login', 'max_attempts',   '5',  'number', NULL, 1, 100,   'Jumlah percobaan login gagal sebelum diblokir sementara', true),
  ('login', 'window_minutes', '15', 'number', NULL, 1, 1440,  'Jendela waktu penghitungan percobaan gagal (menit)', true),
  ('login', 'block_minutes',  '15', 'number', NULL, 1, 10080, 'Lama pemblokiran setelah melewati batas (menit)', true),
  ('login', 'block_by',       'ip', 'text', ARRAY['ip', 'username', 'both'], NULL, NULL, 'Pemblokiran berdasarkan alamat IP, username, atau keduanya', true),

  ('password', 'min_length',     '8',     'number',  NULL, 6, 128, 'Panjang password minimal', true),
  ('password', 'require_upper',  'true',  'boolean', NULL, NULL, NULL, 'Wajib memuat huruf besar', true),
  ('password', 'require_lower',  'true',  'boolean', NULL, NULL, NULL, 'Wajib memuat huruf kecil', true),
  ('password', 'require_number', 'true',  'boolean', NULL, NULL, NULL, 'Wajib memuat angka', true),
  ('password', 'require_symbol', 'false', 'boolean', NULL, NULL, NULL, 'Wajib memuat simbol (mis. ! @ # $)', true),

  ('smtp', 'enabled',    'false', 'boolean', NULL, NULL, NULL, 'Aktifkan pengiriman email dari portal', true),
  ('smtp', 'host',       '',      'text',    NULL, NULL, NULL, 'Alamat server SMTP, contoh smtp.contoh.com', true),
  ('smtp', 'port',       '587',   'number',  NULL, 1, 65535,   'Port server SMTP', true),
  ('smtp', 'security',   'starttls', 'text', ARRAY['none', 'starttls', 'ssl'], NULL, NULL, 'Enkripsi koneksi ke server SMTP', true),
  ('smtp', 'username',   '',      'text',    NULL, NULL, NULL, 'Username akun SMTP', true),
  ('smtp', 'password',   '',      'secret',  NULL, NULL, NULL, 'Password akun SMTP (disimpan terenkripsi)', true),
  ('smtp', 'from_email', '',      'text',    NULL, NULL, NULL, 'Alamat email pengirim', true),
  ('smtp', 'from_name',  'Komibank Portal', 'text', NULL, NULL, NULL, 'Nama pengirim yang tampil di email', true),

  ('session', 'duration_hours', '8', 'number', NULL, 1, 720, 'Masa berlaku sesi login (jam)', true),

  ('portal', 'name',             'Komibank Portal', 'text', NULL, NULL, NULL, 'Nama portal', true),
  ('portal', 'support_email',    '',      'text',    NULL, NULL, NULL, 'Email bantuan yang ditampilkan ke pengguna', true),
  ('portal', 'maintenance_mode', 'false', 'boolean', NULL, NULL, NULL, 'Mode pemeliharaan: hanya admin yang dapat login', true);

-- menu: Master Data > Pengaturan > Portal
INSERT INTO portal.menus (parent_id, code, title, type, path, icon, sort_order, is_system)
SELECT id, 'master.settings', 'Pengaturan', 'folder', NULL, 'settings', 2, true
  FROM portal.menus WHERE code = 'master'
ON CONFLICT (code) DO NOTHING;

INSERT INTO portal.menus (parent_id, code, title, type, path, icon, sort_order, is_system)
SELECT id, 'portal', 'Portal', 'page', '/master/settings/portal', 'portal', 1, true
  FROM portal.menus WHERE code = 'master.settings'
ON CONFLICT (code) DO NOTHING;

INSERT INTO portal.group_menu_permissions (group_id, menu_id, can_create, can_read, can_update, can_delete)
SELECT g.id, m.id, true, true, true, true
  FROM portal.groups g, portal.menus m
 WHERE g.code = 'ADMIN' AND m.code = 'portal'
ON CONFLICT (group_id, menu_id) DO NOTHING;

COMMIT;