CREATE TYPE portal.approval_role   AS ENUM ('approver', 'editor');
CREATE TYPE portal.approval_action AS ENUM ('approved', 'rejected');

-- Siapa berperan apa pada tiap jenis approval.
-- approver: level 1..5 | editor: level 0 (boleh mengajukan)
-- Penerima: SATU dari group_id atau user_id.
CREATE TABLE portal.approval_assignments (
	id         int8 GENERATED ALWAYS AS IDENTITY NOT NULL,
	type_id    int8 NOT NULL,
	role       portal.approval_role NOT NULL,
	level      smallint DEFAULT 0 NOT NULL,
	group_id   int8 NULL,
	user_id    int8 NULL,
	created_by int8 NULL,
	created_at timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT pk_approval_assignments PRIMARY KEY (id),
	CONSTRAINT fk_aa_type       FOREIGN KEY (type_id)    REFERENCES portal.approval_types(id) ON DELETE CASCADE,
	CONSTRAINT fk_aa_group      FOREIGN KEY (group_id)   REFERENCES portal.groups(id),
	CONSTRAINT fk_aa_user       FOREIGN KEY (user_id)    REFERENCES portal.users(id),
	CONSTRAINT fk_aa_created_by FOREIGN KEY (created_by) REFERENCES portal.users(id),
	CONSTRAINT ck_aa_target CHECK ((group_id IS NOT NULL) <> (user_id IS NOT NULL)),
	CONSTRAINT ck_aa_level  CHECK ((role = 'editor' AND level = 0) OR (role = 'approver' AND level BETWEEN 1 AND 5))
);
CREATE UNIQUE INDEX uq_aa_group ON portal.approval_assignments (type_id, role, level, group_id) WHERE group_id IS NOT NULL;
CREATE UNIQUE INDEX uq_aa_user  ON portal.approval_assignments (type_id, role, level, user_id)  WHERE user_id  IS NOT NULL;
CREATE INDEX ix_aa_group ON portal.approval_assignments (group_id) WHERE group_id IS NOT NULL;
CREATE INDEX ix_aa_user  ON portal.approval_assignments (user_id)  WHERE user_id  IS NOT NULL;

-- salin approver lama menjadi approver level 1
-- (tabel lama approval_type_approvers SENGAJA belum dihapus, dihapus di langkah berikutnya)
INSERT INTO portal.approval_assignments (type_id, role, level, group_id)
SELECT type_id, 'approver', 1, group_id FROM portal.approval_type_approvers;

-- pengajuan: posisi tahap saat ini
ALTER TABLE portal.approval_requests
	ADD COLUMN current_level smallint DEFAULT 1 NOT NULL,
	ADD COLUMN total_levels  smallint DEFAULT 1 NOT NULL,
	ADD CONSTRAINT ck_ar_levels CHECK (total_levels BETWEEN 1 AND 5 AND current_level BETWEEN 1 AND total_levels);

-- riwayat keputusan per tahap
CREATE TABLE portal.approval_steps (
	id          int8 GENERATED ALWAYS AS IDENTITY NOT NULL,
	request_id  int8 NOT NULL,
	level       smallint NOT NULL,
	action      portal.approval_action NOT NULL,
	acted_by    int8 NOT NULL,
	acted_at    timestamptz DEFAULT now() NOT NULL,
	note        varchar(500) NULL,
	data        jsonb NULL,                       -- isian approver (mis. groupId)
	is_override bool DEFAULT false NOT NULL,      -- true = diputuskan Administrator (langsung final)
	CONSTRAINT pk_approval_steps PRIMARY KEY (id),
	CONSTRAINT fk_as_request FOREIGN KEY (request_id) REFERENCES portal.approval_requests(id) ON DELETE CASCADE,
	CONSTRAINT fk_as_user    FOREIGN KEY (acted_by)   REFERENCES portal.users(id),
	CONSTRAINT uq_as_level   UNIQUE (request_id, level),
	CONSTRAINT uq_as_actor   UNIQUE (request_id, acted_by),
	CONSTRAINT ck_as_data    CHECK (data IS NULL OR jsonb_typeof(data) = 'object'),
	CONSTRAINT ck_as_reject_note CHECK (action = 'approved' OR btrim(coalesce(note, '')) <> '')
);

-- isi riwayat dari pengajuan yang sudah diputuskan sebelumnya
INSERT INTO portal.approval_steps (request_id, level, action, acted_by, acted_at, note, data)
SELECT id, 1,
       (CASE status WHEN 'approved' THEN 'approved' ELSE 'rejected' END)::portal.approval_action,
       decided_by, decided_at, note, decision
  FROM portal.approval_requests WHERE status <> 'pending';