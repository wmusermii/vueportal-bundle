-- 1. Konfigurasi di Group: halaman ini butuh approval untuk anggota group tsb
ALTER TABLE portal.group_menu_permissions
	ADD COLUMN needs_approval bool DEFAULT false NOT NULL;

-- 2. Jenis approval per halaman (aksi create/update/delete ada di payload)
INSERT INTO portal.approval_types (code, "name", description) VALUES
	('USERS_CHANGE',  'Perubahan Pengguna',          'Tambah / ubah / hapus pengguna oleh non-Administrator'),
	('GROUPS_CHANGE', 'Perubahan Group & Hak Akses', 'Tambah / ubah / hapus group, anggota, dan hak akses oleh non-Administrator');

-- 3. Approver awal: level 1 = group ADMIN (Administrator memang selalu boleh).
--    Tambah approver lain lewat halaman Pengaturan Approval.
INSERT INTO portal.approval_assignments (type_id, role, level, group_id)
SELECT t.id, 'approver', 1, g.id
  FROM portal.approval_types t, portal.groups g
 WHERE t.code IN ('USERS_CHANGE', 'GROUPS_CHANGE') AND g.code = 'ADMIN';