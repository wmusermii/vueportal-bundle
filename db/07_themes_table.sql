-- 1) Tabel penyimpan gambar tema
CREATE TABLE IF NOT EXISTS portal.theme_assets (
  asset_key   varchar(20) PRIMARY KEY,
  mime_type   varchar(30) NOT NULL,
  data        bytea       NOT NULL,
  updated_by  bigint,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_theme_assets_key  CHECK (asset_key IN ('logo','favicon','login_image')),
  CONSTRAINT ck_theme_assets_mime CHECK (mime_type IN ('image/png','image/jpeg','image/webp','image/x-icon')),
  CONSTRAINT ck_theme_assets_size CHECK (octet_length(data) <= 2097152),
  CONSTRAINT fk_theme_assets_user FOREIGN KEY (updated_by) REFERENCES portal.users(id) ON DELETE SET NULL
);

-- 2) Constraint format warna khusus group themes (sidebar_color boleh kosong = ikut primary)
ALTER TABLE portal.parameters
  ADD CONSTRAINT ck_parameters_theme_color CHECK (
    group_code <> 'themes'
    OR param_key NOT LIKE '%\_color'
    OR value ~ '^#[0-9a-fA-F]{6}$'
    OR (param_key = 'sidebar_color' AND value = '')
  );

-- 3) Seed parameter themes
INSERT INTO portal.parameters
  (group_code, param_key, value, value_type, num_min, num_max, description, is_system)
VALUES
 ('themes','primary_color',      '#16a34a', 'text',   NULL, NULL, 'Warna utama (tombol, menu aktif)',               true),
 ('themes','sidebar_color',      '',        'text',   NULL, NULL, 'Warna sidebar. Kosong = ikut warna utama',       true),
 ('themes','sidebar_text_color', '#ffffff', 'text',   NULL, NULL, 'Warna teks sidebar',                             true),
 ('themes','login_bg_color',     '#f3f4f6', 'text',   NULL, NULL, 'Warna latar halaman login',                      true),
 ('themes','border_radius',      '8',       'number', 0,    24,   'Kelengkungan sudut komponen (px)',               true),
 ('themes','logo_url',           '',        'text',   NULL, NULL, 'Logo pojok kiri atas. Kosong = ikon bawaan',     true),
 ('themes','favicon_url',        '',        'text',   NULL, NULL, 'Favicon tab browser. Kosong = bawaan',           true),
 ('themes','login_image_url',    '',        'text',   NULL, NULL, 'Gambar di kiri form login. Kosong = tanpa gambar', true)
ON CONFLICT (group_code, param_key) DO NOTHING;

-- kalau DBeaver mode manual commit:
COMMIT;

SELECT param_key, value, value_type FROM portal.parameters WHERE group_code = 'themes' ORDER BY id;