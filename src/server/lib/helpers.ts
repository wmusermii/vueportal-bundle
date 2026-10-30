import type { Response } from "express";
import type { PoolClient } from "pg";
import type { ZodError } from "zod";
import { pool } from "../connector/db";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function idParam(v: string) {
  if (!/^\d+$/.test(v)) throw new HttpError(400, "ID tidak valid");
  return v;
}

export function badRequest(res: Response, error: ZodError) {
  const i = error.issues[0];
  res
    .status(400)
    .json({ message: `${i.path.join(".") || "data"}: ${i.message}` });
}

export function sendError(res: Response, e: unknown) {
  if (e instanceof HttpError) {
    res.status(e.status).json({ message: e.message });
    return;
  }
  const err = e as { code?: string; message?: string; constraint?: string };
  const c = err.constraint ?? "";

  if (err.code === "23505") {
    const message = c.startsWith("uq_groups")
      ? "Kode atau nama group sudah dipakai"
      : c === "uq_menus_code"
        ? "Kode menu sudah dipakai"
        : c === "uq_menus_path"
          ? "Path sudah dipakai menu lain"
          : "Username atau email sudah dipakai";
    res.status(409).json({ message });
    return;
  }
  if (err.code === "23503") {
    if (c === "fk_ug_group") {
      res
        .status(409)
        .json({
          message:
            "Group masih memiliki anggota. Pindahkan atau hapus anggotanya dulu",
        });
    } else if (c === "fk_aa_group") {
      res
        .status(409)
        .json({
          message:
            "Group masih ditugaskan di Pengaturan Approval. Hapus penugasannya dulu",
        });
    } else if (c === "fk_menus_parent") {
      res
        .status(409)
        .json({
          message:
            "Menu masih memiliki submenu. Hapus atau pindahkan submenu dulu",
        });
    } else if (c === "fk_gmp_menu") {
      res.status(400).json({ message: "Hanya halaman yang boleh diberi izin" });
    } else {
      res.status(400).json({ message: "Data merujuk ke data yang tidak ada" });
    }
    return;
  }
  if (err.code === "P0001") {
    // pesan dari trigger database
    res.status(400).json({ message: err.message });
    return;
  }
  if (err.code === "23514") {
    const map: Record<string, string> = {
      ck_menus_level: "Menu maksimal 3 level",
      ck_menus_folder_lvl: "Folder tidak boleh berada di level 3",
      ck_menus_path_type: "Halaman wajib memiliki path, folder tidak boleh",
      ck_menus_self: "Menu tidak boleh menjadi induk dirinya sendiri",
    };
    res
      .status(400)
      .json({ message: map[c] ?? "Data melanggar aturan database" });
    return;
  }
  throw e; // sisanya jadi 500 lewat error handler global
}

export async function withTx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function isSystemMember(c: PoolClient, userId: string) {
  const { rows } = await c.query(
    `SELECT EXISTS (
       SELECT 1 FROM portal.user_groups ug
         JOIN portal.groups g ON g.id = ug.group_id
        WHERE ug.user_id = $1 AND g.is_system
     ) AS yes`,
    [userId],
  );
  return rows[0].yes as boolean;
}

export async function isSystemUser(userId: string) {
  const { rows } = await pool.query(
    `SELECT EXISTS (
       SELECT 1 FROM portal.user_groups ug
         JOIN portal.groups g ON g.id = ug.group_id
        WHERE ug.user_id = $1 AND g.is_system
     ) AS yes`,
    [userId],
  );
  return rows[0].yes as boolean;
}
