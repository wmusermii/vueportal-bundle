BEGIN;
CREATE TYPE portal.approval_status AS ENUM ('pending', 'approved', 'rejected');

-- Jenis approval (USER_REGISTRATION, nanti: transaksi, dll)
CREATE TABLE portal.approval_types (
	id          int8 GENERATED ALWAYS AS IDENTITY NOT NULL,
	code        varchar(50)  NOT NULL,
	"name"      varchar(100) NOT NULL,
	description varchar(255) NULL,
	is_public   bool DEFAULT false NOT NULL,   -- true = boleh diajukan tanpa login
	status      portal.record_status DEFAULT 'active'::portal.record_status NOT NULL,
	created_at  timestamptz DEFAULT now() NOT NULL,
	updated_at  timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT pk_approval_types PRIMARY KEY (id),
	CONSTRAINT uq_approval_types_code UNIQUE (code),
	CONSTRAINT ck_approval_types_code CHECK (((code)::text ~ '^[A-Z][A-Z0-9_]{1,49}$'::text)),
	CONSTRAINT ck_approval_types_name CHECK ((btrim((name)::text) <> ''::text))
);

-- Group mana yang boleh memutuskan tiap jenis approval
CREATE TABLE portal.approval_type_approvers (
	type_id  int8 NOT NULL,
	group_id int8 NOT NULL,
	CONSTRAINT pk_approval_type_approvers PRIMARY KEY (type_id, group_id),
	CONSTRAINT fk_ata_type  FOREIGN KEY (type_id)  REFERENCES portal.approval_types(id) ON DELETE CASCADE,
	CONSTRAINT fk_ata_group FOREIGN KEY (group_id) REFERENCES portal.groups(id)
);

-- Pengajuan
CREATE TABLE portal.approval_requests (
	id           int8 GENERATED ALWAYS AS IDENTITY NOT NULL,
	type_id      int8 NOT NULL,
	status       portal.approval_status DEFAULT 'pending'::portal.approval_status NOT NULL,
	subject      varchar(200) NOT NULL,        -- ringkasan untuk daftar/inbox
	unique_key   varchar(200) NULL,            -- cegah pengajuan pending ganda (mis. username)
	payload      jsonb NOT NULL,               -- data yang diajukan
	decision     jsonb NULL,                   -- data tambahan dari approver (mis. group_id)
	requested_by int8 NULL,                    -- NULL = pengaju publik (belum punya akun)
	decided_by   int8 NULL,
	decided_at   timestamptz NULL,
	note         varchar(500) NULL,            -- catatan / alasan penolakan
	created_at   timestamptz DEFAULT now() NOT NULL,
	updated_at   timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT pk_approval_requests PRIMARY KEY (id),
	CONSTRAINT fk_ar_type         FOREIGN KEY (type_id)      REFERENCES portal.approval_types(id),
	CONSTRAINT fk_ar_requested_by FOREIGN KEY (requested_by) REFERENCES portal.users(id),
	CONSTRAINT fk_ar_decided_by   FOREIGN KEY (decided_by)   REFERENCES portal.users(id),
	CONSTRAINT ck_ar_subject CHECK ((btrim((subject)::text) <> ''::text)),
	CONSTRAINT ck_ar_payload CHECK ((jsonb_typeof(payload) = 'object'::text)),
	CONSTRAINT ck_ar_decided CHECK (
		(status = 'pending'  AND decided_by IS NULL AND decided_at IS NULL)
		OR (status <> 'pending' AND decided_by IS NOT NULL AND decided_at IS NOT NULL)
	),
	CONSTRAINT ck_ar_reject_note CHECK (status <> 'rejected' OR btrim(coalesce(note, '')) <> '')
);

-- hanya satu pengajuan pending untuk key yang sama
CREATE UNIQUE INDEX uq_ar_pending_key
	ON portal.approval_requests (type_id, unique_key)
	WHERE status = 'pending' AND unique_key IS NOT NULL;

CREATE INDEX ix_ar_inbox ON portal.approval_requests (type_id, status, created_at DESC);

-- Seed: jenis USER_REGISTRATION, diputuskan oleh ADMIN dan MANAGER
WITH t AS (
	INSERT INTO portal.approval_types (code, "name", description, is_public)
	VALUES ('USER_REGISTRATION', 'Registrasi Pengguna', 'Pendaftaran akun mandiri', true)
	RETURNING id
)
INSERT INTO portal.approval_type_approvers (type_id, group_id)
SELECT t.id, g.id FROM t, portal.groups g WHERE g.code IN ('ADMIN', 'MANAGER', 'APPROVER');

COMMIT;