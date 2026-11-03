import { pool } from "../connector/db";
import {
  ApprovalError,
  createRequest,
  getActor,
  type ApprovalHandler,
  type Db,
  type Json,
} from "./service";

/*
 * ============================================================================
 *  PANDUAN: halaman yang perubahannya (tambah / ubah / hapus) perlu approval
 * ============================================================================
 *  Alur: user NON-Administrator menekan Simpan/Hapus di halaman X.
 *    - Jika group-nya diberi centang "Butuh approval" untuk halaman X
 *        -> perubahan TIDAK dijalankan, hanya disimpan sebagai pengajuan (HTTP 202).
 *        -> setelah disetujui (semua level), handler menjalankan perubahannya.
 *    - Jika tidak dicentang, atau user adalah Administrator
 *        -> perubahan langsung dijalankan seperti biasa (kode lama tidak berubah).
 *
 *  Yang dibutuhkan untuk halaman baru "Foo" (kode menu 'foo'):
 *   1. DATABASE   Tambah jenis approval:
 *                   INSERT INTO approval_types (code, "name") VALUES ('FOO_CHANGE', 'Perubahan Foo');
 *                 dan minimal satu approver level 1 (atau lewat halaman Pengaturan Approval).
 *   2. HANDLER    approval/handlers/fooChange.ts:
 *                   export const fooChange = makeChangeHandler({ code: 'FOO_CHANGE', apply: ... })
 *                 lalu daftarkan di approval/handlers/index.ts: registerHandler(fooChange).
 *                 `apply` menjalankan insert/update/delete memakai `db` (client transaksi persetujuan),
 *                 BUKAN `pool`. Periksa ulang kondisi data (mungkin sudah berubah sejak diajukan) dan
 *                 ubah error database yang wajar menjadi ApprovalError agar pesannya jelas bagi approver:
 *                 23505 (duplikat) -> 409 "sudah dipakai", 23503 (masih dipakai data lain) -> 409.
 *                 Error apa pun membatalkan seluruh persetujuan; pengajuan tetap Menunggu
 *                 (approver bisa menolaknya dengan alasan).
 *   3. ROUTE      Setelah validasi input + requirePermission('foo', ...), bungkus penulisan dengan
 *                 changeOrQueue({ userId, menu: 'foo', type: 'FOO_CHANGE', action }, { runNow, describe }):
 *                   runNow   = kode penulisan yang SUDAH ADA (jalur langsung), tanpa diubah.
 *                   describe = dipanggil HANYA bila diantrekan; baca data lama, lakukan pemeriksaan
 *                              yang perlu (lempar HttpError bila tidak boleh), lalu kembalikan:
 *                              title, targetId, oldRecord (sebelum), newRecord (sesudah), secret, uniqueKey.
 *                 oldRecord/newRecord adalah JSON yang ditampilkan apa adanya di halaman Persetujuan.
 *                 Data rahasia (hash password, token) masuk ke `secret`, TIDAK pernah tampil.
 *   4. RESPONS    Bila hasilnya `queued: true`, jawab 202 { queued: true, message } -- bukan 200/201.
 *   5. FRONTEND   Tangani respons 202: tampilkan pesan "menunggu persetujuan"; data BELUM tersimpan.
 *   6. AKSES      Halaman Group -> centang "Butuh approval" untuk menu 'foo' (hanya Administrator yang
 *                 dapat mengubahnya). Tambahkan penugasan Approver di Pengaturan Approval.
 *  Pengajuan yang sedang menunggu untuk data yang sama ditolak (satu pengajuan pending per data).
 * ============================================================================
 */

export type ChangeAction = "create" | "update" | "delete";
const VERB: Record<ChangeAction, string> = {
  create: "Tambah",
  update: "Ubah",
  delete: "Hapus",
};

/** Apakah perubahan oleh user ini pada halaman `menuCode` harus melalui approval? */
export async function needsApproval(
  userId: string,
  menuCode: string,
): Promise<boolean> {
  const actor = await getActor(pool, userId);
  if (actor.isAdmin) return false; // Administrator selalu langsung
  const {
    rows: [r],
  } = await pool.query<{ needs_approval: boolean }>(
    `SELECT p.needs_approval
       FROM user_groups ug
       JOIN groups g ON g.id = ug.group_id AND g.status = 'active'
       JOIN group_menu_permissions p ON p.group_id = g.id
       JOIN menus m ON m.id = p.menu_id AND m.status = 'active'
      WHERE ug.user_id = $1 AND m.code = $2`,
    [userId, menuCode],
  );
  return r?.needs_approval === true;
}

export type ChangeBase = {
  userId: string; // pelaku (req.user.id)
  menu: string; // kode menu / izin halaman, mis. 'users'
  type: string; // kode jenis approval, mis. 'USERS_CHANGE'
  action: ChangeAction;
};

export type ChangeDescription = {
  title: string; // label singkat untuk daftar, mis. 'budi (Budi Santoso)'
  targetId?: string | null; // id data yang diubah/dihapus; kosong untuk tambah
  oldRecord?: Json | null; // data SEBELUM perubahan (ubah/hapus)
  newRecord?: Json | null; // data SESUDAH perubahan (tambah/ubah)
  secret?: Json; // data rahasia untuk eksekusi (mis. passwordHash); tidak pernah ditampilkan
  uniqueKey?: string; // cegah pengajuan ganda; default `${action}:${targetId}`
};

export async function changeOrQueue<T>(
  base: ChangeBase,
  fns: { runNow: () => Promise<T>; describe: () => Promise<ChangeDescription> },
): Promise<{ queued: false; result: T } | { queued: true; requestId: string }> {
  if (!(await needsApproval(base.userId, base.menu))) {
    return { queued: false, result: await fns.runNow() };
  }
  const d = await fns.describe();
  const uniqueKey =
    d.uniqueKey ?? (d.targetId ? `${base.action}:${d.targetId}` : undefined);
  const requestId = await createRequest(
    base.type,
    {
      subject: `${VERB[base.action]}: ${d.title}`.slice(0, 190),
      uniqueKey: uniqueKey?.slice(0, 190),
      payload: {
        action: base.action,
        targetId: d.targetId ?? null,
        title: d.title,
        old: d.oldRecord ?? null,
        new: d.newRecord ?? null,
        secret: d.secret ?? {},
      },
    },
    base.userId,
    { trusted: true }, // izin sudah diperiksa requirePermission di route; peran Editor tidak dipakai di sini
  );
  return { queued: true, requestId };
}

export function makeChangeHandler(cfg: {
  code: string;
  apply(ctx: {
    db: Db;
    action: ChangeAction;
    targetId: string | null;
    record: Json; // newRecord digabung secret
    requestedBy: string | null; // pengaju
    approverId: string;
  }): Promise<void>;
}): ApprovalHandler {
  return {
    code: cfg.code,
    async prepare(input) {
      const i = input as {
        subject?: string;
        uniqueKey?: string;
        payload?: Json;
      };
      if (
        !i?.subject ||
        !i.payload ||
        !["create", "update", "delete"].includes(i.payload.action)
      ) {
        throw new ApprovalError(500, "Pengajuan perubahan tidak valid");
      }
      return { subject: i.subject, uniqueKey: i.uniqueKey, payload: i.payload };
    },
    async onApprove({ db, request, approverId }) {
      const p = request.payload;
      await cfg.apply({
        db,
        action: p.action,
        targetId: p.targetId ?? null,
        record: { ...(p.new ?? {}), ...(p.secret ?? {}) },
        requestedBy: request.requested_by,
        approverId,
      });
    },
    redact({ secret: _secret, ...rest }) {
      return rest;
    },
  };
}
