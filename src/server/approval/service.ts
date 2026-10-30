import type { PoolClient } from "pg";
import { pool } from "../connector/db"; // sesuaikan: file tempat Pool dibuat

export class ApprovalError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type Db = Pick<PoolClient, "query">;
export type Json = Record<string, any>;

export type ApprovalRow = {
  id: string;
  type_id: string;
  type_code: string;
  status: "pending" | "approved" | "rejected";
  subject: string;
  payload: Json;
  requested_by: string | null;
  current_level: number;
  total_levels: number;
};

export interface ApprovalHandler {
  code: string;
  /** Validasi input pengajuan dan bentuk datanya. Lempar ApprovalError kalau tidak valid. */
  prepare(
    input: unknown,
    db: Db,
  ): Promise<{ subject: string; uniqueKey?: string; payload: Json }>;
  /** (opsional) Validasi isian approver di tiap tahap, supaya salah isi ketahuan lebih awal. */
  validateStep?(ctx: {
    db: Db;
    request: ApprovalRow;
    data: Json;
    approverGroup: string;
  }): Promise<void>;
  /** Dijalankan DI DALAM transaksi saat tahap terakhir disetujui. Lempar error = batal semua. */
  onApprove(ctx: {
    db: Db;
    request: ApprovalRow;
    decision: Json; // gabungan isian semua tahap (tahap belakang menimpa)
    approverId: string;
    approverGroup: string;
  }): Promise<void>;
  /** Buang field rahasia sebelum payload dikirim ke browser. */
  redact?(payload: Json): Json;
}

const handlers = new Map<string, ApprovalHandler>();
export function registerHandler(h: ApprovalHandler) {
  handlers.set(h.code, h);
}

/** Group aktif milik user + apakah dia Administrator. */
export async function getActor(db: Db, userId: string) {
  const {
    rows: [g],
  } = await db.query<{ code: string }>(
    `SELECT g.code FROM portal.user_groups ug
       JOIN portal.groups g ON g.id = ug.group_id AND g.status = 'active'
      WHERE ug.user_id = $1`,
    [userId],
  );
  const groupCode = g?.code ?? "";
  return { id: userId, groupCode, isAdmin: groupCode === "ADMIN" };
}

// Penugasan `a` berlaku untuk user $1: ditugaskan langsung, atau lewat group aktifnya
const ASSIGNED = `(a.user_id = $1 OR a.group_id IN (
  SELECT ug.group_id FROM portal.user_groups ug
    JOIN portal.groups g ON g.id = ug.group_id AND g.status = 'active'
   WHERE ug.user_id = $1))`;

// Pengajuan `r` menunggu keputusan user $1 pada tahap sekarang ($2 = user adalah Administrator)
const DECIDABLE = `(r.status = 'pending'
  AND r.requested_by IS DISTINCT FROM $1
  AND NOT EXISTS (SELECT 1 FROM portal.approval_steps s WHERE s.request_id = r.id AND s.acted_by = $1)
  AND ($2::bool OR EXISTS (
        SELECT 1 FROM portal.approval_assignments a
         WHERE a.type_id = r.type_id AND a.role = 'approver' AND a.level = r.current_level AND ${ASSIGNED})))`;

/** Buat pengajuan. requestedBy = null untuk pengaju publik (belum login). */
export async function createRequest(
  code: string,
  input: unknown,
  requestedBy: string | null,
) {
  const h = handlers.get(code);
  if (!h) throw new ApprovalError(500, "Handler approval belum terdaftar");

  const {
    rows: [type],
  } = await pool.query<{ id: string; is_public: boolean }>(
    `SELECT id, is_public FROM portal.approval_types WHERE code = $1 AND status = 'active'`,
    [code],
  );
  if (!type) throw new ApprovalError(404, "Jenis approval tidak aktif");

  if (!requestedBy) {
    if (!type.is_public)
      throw new ApprovalError(401, "Silakan login terlebih dahulu");
  } else if (!type.is_public) {
    const actor = await getActor(pool, requestedBy);
    if (!actor.isAdmin) {
      const {
        rows: [ok],
      } = await pool.query(
        `SELECT 1 FROM portal.approval_assignments a
          WHERE a.type_id = $2 AND a.role = 'editor' AND ${ASSIGNED} LIMIT 1`,
        [requestedBy, type.id],
      );
      if (!ok)
        throw new ApprovalError(
          403,
          "Anda tidak ditugaskan sebagai Editor untuk jenis ini",
        );
    }
  }

  const {
    rows: [lv],
  } = await pool.query<{ n: number | null }>(
    `SELECT max(level)::int AS n FROM portal.approval_assignments WHERE type_id = $1 AND role = 'approver'`,
    [type.id],
  );
  if (!lv?.n)
    throw new ApprovalError(
      409,
      "Approver untuk jenis ini belum dikonfigurasi",
    );

  const p = await h.prepare(input, pool);
  try {
    const {
      rows: [row],
    } = await pool.query<{ id: string }>(
      `INSERT INTO portal.approval_requests (type_id, subject, unique_key, payload, requested_by, total_levels)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6) RETURNING id`,
      [
        type.id,
        p.subject,
        p.uniqueKey ?? null,
        JSON.stringify(p.payload),
        requestedBy,
        lv.n,
      ],
    );
    return row.id;
  } catch (e: any) {
    if (e?.code === "23505")
      throw new ApprovalError(
        409,
        "Pengajuan yang sama masih menunggu persetujuan",
      );
    throw e;
  }
}

/**
 * Daftar pengajuan yang boleh dilihat user:
 * Administrator = semua; lainnya = pengajuan miliknya + jenis yang dia jadi approver (level mana pun).
 * can_decide = true kalau sekarang giliran dia memutuskan.
 */
export async function listRequests(userId: string, status?: string) {
  if (status && !["pending", "approved", "rejected"].includes(status)) {
    throw new ApprovalError(400, "Status tidak valid");
  }
  const actor = await getActor(pool, userId);
  const { rows } = await pool.query(
    `SELECT r.id, t.code AS type_code, t."name" AS type_name, r.status, r.subject, r.payload,
            r.current_level, r.total_levels, r.created_at, r.decided_at, r.note,
            COALESCE(r.requested_by = $1, false) AS mine,
            ${DECIDABLE} AS can_decide,
            COALESCE((SELECT json_agg(json_build_object(
                        'level', s.level, 'action', s.action, 'by', u.full_name,
                        'at', s.acted_at, 'note', s.note, 'override', s.is_override, 'data', s.data) ORDER BY s.level)
                        FROM portal.approval_steps s JOIN portal.users u ON u.id = s.acted_by
                       WHERE s.request_id = r.id), '[]'::json) AS steps
       FROM portal.approval_requests r
       JOIN portal.approval_types t ON t.id = r.type_id
      WHERE ($2::bool OR r.requested_by = $1 OR EXISTS (
              SELECT 1 FROM portal.approval_assignments a
               WHERE a.type_id = r.type_id AND a.role = 'approver' AND ${ASSIGNED}))
        AND ($3::text IS NULL OR r.status::text = $3)
      ORDER BY (r.status = 'pending') DESC, r.created_at DESC
      LIMIT 200`,
    [userId, actor.isAdmin, status ?? null],
  );
  return rows.map((r) => ({
    id: r.id,
    typeCode: r.type_code,
    typeName: r.type_name,
    status: r.status,
    subject: r.subject,
    payload: handlers.get(r.type_code)?.redact?.(r.payload) ?? r.payload,
    currentLevel: r.current_level,
    totalLevels: r.total_levels,
    createdAt: r.created_at,
    decidedAt: r.decided_at,
    note: r.note,
    mine: r.mine,
    canDecide: r.can_decide,
    steps: r.steps,
  }));
}

/** Jumlah pengajuan yang menunggu keputusan user ini (untuk badge). */
export async function countPending(userId: string) {
  const actor = await getActor(pool, userId);
  const {
    rows: [row],
  } = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM portal.approval_requests r WHERE ${DECIDABLE}`,
    [userId, actor.isAdmin],
  );
  return row.n;
}

/** Pilihan group untuk user baru. Group ADMIN hanya untuk Administrator; non-approver tidak dapat apa-apa. */
export async function groupOptions(userId: string) {
  const actor = await getActor(pool, userId);
  const { rows } = await pool.query<{ id: string; code: string; name: string }>(
    `SELECT g.id, g.code, g."name" FROM portal.groups g
      WHERE g.status = 'active'
        AND ($2::bool OR g.code <> 'ADMIN')
        AND ($2::bool OR EXISTS (
              SELECT 1 FROM portal.approval_assignments a WHERE a.role = 'approver' AND ${ASSIGNED}))
      ORDER BY g."name"`,
    [userId, actor.isAdmin],
  );
  return rows;
}

export async function decide(
  id: string,
  userId: string,
  action: "approve" | "reject",
  body: { data?: Json; note?: string },
): Promise<{ status: "pending" | "approved" | "rejected"; level: number }> {
  if (!/^\d+$/.test(id)) throw new ApprovalError(400, "ID tidak valid");
  const note = (body.note ?? "").trim();
  if (action === "reject" && !note)
    throw new ApprovalError(400, "Alasan penolakan wajib diisi");
  if (note.length > 500)
    throw new ApprovalError(400, "Catatan maksimal 500 karakter");
  const data = body.data ?? {};

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const {
      rows: [r],
    } = await client.query<ApprovalRow>(
      `SELECT r.id, r.type_id, r.status, r.subject, r.payload, r.requested_by,
              r.current_level, r.total_levels, t.code AS type_code
         FROM portal.approval_requests r
         JOIN portal.approval_types t ON t.id = r.type_id
        WHERE r.id = $1
          FOR UPDATE OF r`,
      [id],
    );
    if (!r) throw new ApprovalError(404, "Pengajuan tidak ditemukan");
    if (r.status !== "pending")
      throw new ApprovalError(409, "Pengajuan sudah diputuskan");

    const actor = await getActor(client, userId);
    if (r.requested_by !== null && r.requested_by === userId) {
      throw new ApprovalError(403, "Tidak boleh memutuskan pengajuan sendiri");
    }
    const {
      rows: [acted],
    } = await client.query(
      `SELECT 1 FROM portal.approval_steps WHERE request_id = $1 AND acted_by = $2`,
      [id, userId],
    );
    if (acted)
      throw new ApprovalError(
        403,
        "Anda sudah memutuskan pada tahap sebelumnya",
      );

    if (!actor.isAdmin) {
      const {
        rows: [ok],
      } = await client.query(
        `SELECT 1 FROM portal.approval_assignments a
          WHERE a.type_id = $2 AND a.role = 'approver' AND a.level = $3 AND ${ASSIGNED} LIMIT 1`,
        [userId, r.type_id, r.current_level],
      );
      if (!ok)
        throw new ApprovalError(403, "Anda bukan approver pada tahap ini");
    }

    const h = handlers.get(r.type_code);
    if (!h) throw new ApprovalError(500, "Handler approval belum terdaftar");

    // ---- tolak: langsung berakhir di tahap mana pun
    if (action === "reject") {
      await client.query(
        `INSERT INTO portal.approval_steps (request_id, level, action, acted_by, note)
         VALUES ($1, $2, 'rejected', $3, $4)`,
        [id, r.current_level, userId, note],
      );
      await client.query(
        `UPDATE portal.approval_requests
            SET status = 'rejected', decided_by = $2, decided_at = now(), note = $3, updated_at = now()
          WHERE id = $1`,
        [id, userId, note],
      );
      await client.query("COMMIT");
      return { status: "rejected", level: r.current_level };
    }

    // ---- setuju
    await h.validateStep?.({
      db: client,
      request: r,
      data,
      approverGroup: actor.groupCode,
    });

    // Administrator langsung final (melewati sisa tahap); selain itu final hanya di tahap terakhir
    const final = actor.isAdmin || r.current_level >= r.total_levels;
    await client.query(
      `INSERT INTO portal.approval_steps (request_id, level, action, acted_by, note, data, is_override)
       VALUES ($1, $2, 'approved', $3, $4, $5::jsonb, $6)`,
      [
        id,
        r.current_level,
        userId,
        note || null,
        Object.keys(data).length ? JSON.stringify(data) : null,
        actor.isAdmin && r.current_level < r.total_levels,
      ],
    );

    if (!final) {
      await client.query(
        `UPDATE portal.approval_requests SET current_level = current_level + 1, updated_at = now() WHERE id = $1`,
        [id],
      );
      await client.query("COMMIT");
      return { status: "pending", level: r.current_level + 1 };
    }

    const { rows: steps } = await client.query<{ data: Json | null }>(
      `SELECT data FROM portal.approval_steps WHERE request_id = $1 ORDER BY level`,
      [id],
    );
    const decision: Json = Object.assign({}, ...steps.map((s) => s.data ?? {}));

    await h.onApprove({
      db: client,
      request: r,
      decision,
      approverId: userId,
      approverGroup: actor.groupCode,
    });

    await client.query(
      `UPDATE portal.approval_requests
          SET status = 'approved', decision = $3::jsonb, decided_by = $2, decided_at = now(),
              note = $4, updated_at = now()
        WHERE id = $1`,
      [id, userId, JSON.stringify(decision), note || null],
    );
    await client.query("COMMIT");
    return { status: "approved", level: r.current_level };
  } catch (e: any) {
    await client.query("ROLLBACK").catch(() => {});
    if (e?.code === "23505")
      throw new ApprovalError(
        409,
        "Tahap ini sudah diputuskan oleh orang lain",
      );
    throw e;
  } finally {
    client.release();
  }
}
