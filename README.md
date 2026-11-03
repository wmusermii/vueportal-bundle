# Portal – Vue 3 + Express (Single Bundle)

Aplikasi web dengan **frontend Vue 3** dan **backend Express (TypeScript)** dalam **satu build dan satu proses Node**. Tidak perlu Nginx untuk frontend: Express menyajikan hasil build Vue langsung, dan **pm2** menjaga proses tetap hidup. Termasuk Socket.IO (berjalan di port yang sama).

## Fitur

- Login dengan JWT (cookie)
- **Group**: menentukan halaman/menu mana yang boleh dipakai tiap user
- **RBAC per halaman**: izin Create / Read / Update / Delete untuk setiap group
- Sidebar dinamis hingga **3 level**
- Halaman: Dashboard, Pengguna, Group & Hak Akses, Menu (Master Data), Profil + ganti password
- Satu user = satu group (pindah group dilakukan dari halaman Group)
- Proteksi sistem di database: group dan menu bawaan tidak bisa dihapus/diubah sembarangan, dan anggota terakhir ADMIN tidak bisa dilepas

## Teknologi

| Bagian   | Teknologi                              |
|----------|----------------------------------------|
| Frontend | Vue 3, Vue Router, Pinia, Vite         |
| Backend  | Node.js, Express, TypeScript, Socket.IO |
| Database | PostgreSQL (database `komibank`, schema dari `DB_SCHEMA` di `.env`, bawaan `portal`) |
| Produksi | Node + pm2 (tanpa Nginx)               |

## Struktur Folder  <!-- SESUAIKAN -->

```
.
├── db/
│   ├── 01_newinstallation.sql   # skema: enum, tabel, constraint, trigger
│   └── 02_newseeds.sql          # data awal: group, menu, izin, user admin
├── server/                      # backend Express (TypeScript)
├── client/                      # frontend Vue 3
├── dist/                        # hasil build (frontend + backend)
├── ecosystem.config.js          # konfigurasi pm2
├── .env                         # konfigurasi lokal (JANGAN di-commit)
├── .nvmrc                       # versi Node
└── package.json
```

## Cara Kerja Singkat

```
Browser ──► Node (Express, 1 port)
              ├── /api/*        → REST API (dilindungi JWT + requirePermission)
              ├── /socket.io/*  → Socket.IO
              └── lainnya       → file hasil build Vue (index.html untuk route SPA)
```

Alur akses: `user → user_groups → group → group_menu_permissions → menus`.
Sidebar diambil dari `/api/menus/mine`, dan setiap endpoint API dijaga `requirePermission(menu, aksi)`. Menyembunyikan menu di Vue **bukan** pengamanan, pengamanan sebenarnya ada di backend.

---

## 1. Prasyarat

- Node.js (versi sesuai `.nvmrc`), disarankan lewat **nvm**
- PostgreSQL
- pm2: `npm i -g pm2`

```bash
nvm install && nvm use      # membaca .nvmrc
node -v
```

> Gunakan **versi Node yang sama** di development dan server produksi. Selalu pakai `npm ci` (bukan `npm install`) di server agar versi paket sesuai `package-lock.json`.

## 2. Database (Migration + Seed)

Pastikan database sudah ada (mis. `komibank`) dan user Anda boleh `CREATE SCHEMA`.

| File | Isi |
|------|-----|
| `db/01_newinstallation.sql` | Schema `portal`, enum, tabel, constraint, trigger |
| `db/02_newseeds.sql` | Group ADMIN/MANAGER/STAFF, menu bawaan, izin, user `admin` |

**Nama schema dari `.env` (`DB_SCHEMA`)**

Nama schema tidak ditulis di kode. Atur di `.env`:

```env
DB_SCHEMA=portal      # ganti bila ingin schema lain, mis. DB_SCHEMA=erp_admin
```

- Server memasang `search_path` ke `DB_SCHEMA` pada setiap koneksi, jadi query hanya menulis nama tabel (`FROM users`).
- Saat start, server memeriksa schema itu ada. Jika belum, server berhenti dengan pesan yang jelas.
- File SQL di `db/` tetap ditulis dengan schema `portal`. Untuk schema lain, **jalankan lewat skrip** supaya namanya diganti otomatis:

```bash
npm run db:install                                   # db/portal_install.sql
npm run db:install -- db/temps/06_approval_change.sql   # file SQL lain
npm run db:install -- --print > hasil.sql            # hanya cetak SQL hasil ganti nama
```

- Jika memakai PgBouncer mode transaction, isi `ignore_startup_parameters = options` di PgBouncer, atau jalankan `ALTER ROLE <user> SET search_path = <DB_SCHEMA>;`.

**Pilihan menjalankan (pilih salah satu):**

**a. psql (1 baris)**

```bash
psql -h HOST -p 5432 -U USER -d NAMA_DB -v ON_ERROR_STOP=1 -f db/01_newinstallation.sql -f db/02_newseeds.sql
```

**b. DBeaver** – buka file, tekan **Alt+X** (Execute Script). Jalankan `01_` dulu, lalu `02_`.

**c. Docker (otomatis saat volume kosong)** – mount folder `db` ke `/docker-entrypoint-initdb.d`:

```yaml
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: ganti_ini
      POSTGRES_DB: komibank
    ports: ["5432:5432"]
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./db:/docker-entrypoint-initdb.d:ro
volumes:
  pgdata:
```

Ulang dari nol: `docker compose down -v && docker compose up -d`

**Catatan**
- File ini untuk **instalasi baru**. Menjalankan ulang di database yang sudah terisi akan gagal dan di-rollback (data aman).
- Seed memakai `pgcrypto` (`crypt()`). Kalau server menolak `CREATE EXTENSION`, buat hash bcrypt dari aplikasi lalu isi langsung di `password_hash`.
- **Login awal:** user `admin`, password `GantiPasswordIni#123`. **Ganti segera** setelah login pertama (menu Profil).

## 3. Konfigurasi `.env`  <!-- SESUAIKAN nama variabel -->

```env
NODE_ENV=development
PORT=3000
DATABASE_URL=postgres://USER:PASSWORD@localhost:5432/komibank
JWT_SECRET=isi-string-acak-panjang
JWT_EXPIRES_IN=8h
COOKIE_SECURE=false      # true jika diakses lewat HTTPS
```

Buat `JWT_SECRET` yang acak, misalnya:
`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`

## 4. Development

```bash
npm ci
npm run dev        # SESUAIKAN: jalankan backend + Vite dev server
```

Buka `http://localhost:5173` (Vite) atau port yang tertulis di terminal. Login dengan user `admin`.

## 5. Build & Jalankan di Produksi (Node + pm2)

Satu perintah build menghasilkan frontend dan backend sekaligus:

```bash
npm ci
npm run build      # SESUAIKAN: build Vue → dist/public, compile TS → dist/server
npm start          # uji dulu: node dist/server/index.js
```

Jalankan dengan pm2 – `ecosystem.config.js`:

```js
module.exports = {
  apps: [{
    name: 'portal',
    script: 'dist/server/index.js',   // SESUAIKAN
    instances: 1,                      // 1 proses (Socket.IO butuh sticky session bila cluster)
    exec_mode: 'fork',
    env: { NODE_ENV: 'production' }
  }]
};
```

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup          # ikuti perintah yang ditampilkan agar jalan otomatis saat reboot
pm2 logs portal
pm2 status
```

**Update versi baru:**

```bash
git pull
npm ci
npm run build
pm2 reload portal
```

## 6. Modifikasi

### a. Menambah halaman baru

1. **Vue**: buat view, tambahkan route di router (path harus sama dengan `menus.path`).
2. **Backend**: buat endpoint dan lindungi dengan `requirePermission('kode_menu', 'read' | 'create' | 'update' | 'delete')`.
3. **Database**: daftarkan menu dan beri izin ADMIN. Izin ADMIN terkunci di UI, jadi **wajib lewat SQL** (contoh memakai schema `portal`; ganti dengan nilai `DB_SCHEMA` Anda):

```sql
INSERT INTO portal.menus (parent_id, code, title, type, path, icon, sort_order, is_system)
SELECT id, 'laporan', 'Laporan', 'page'::portal.menu_type, '/master/laporan', NULL, 4, true
  FROM portal.menus WHERE code = 'master';

INSERT INTO portal.group_menu_permissions (group_id, menu_id, can_create, can_read, can_update, can_delete)
SELECT g.id, m.id, true, true, true, true
  FROM portal.groups g, portal.menus m
 WHERE g.code = 'ADMIN' AND m.code = 'laporan';
```

4. Izin untuk group lain (MANAGER/STAFF) diatur dari halaman **Group & Hak Akses**.

Aturan menu: maksimal 3 level, parent harus bertipe `folder`, folder tidak boleh di level 3, halaman wajib punya `path` unik, dan menu `is_system = true` tidak bisa dihapus atau diubah kode/path/induknya.

### b. Mengubah struktur database

Jangan edit `01_newinstallation.sql` untuk database yang sudah berjalan. Buat file patch baru, misalnya `db/03_patch_nama.sql`, bungkus dengan `BEGIN; ... COMMIT;`, dan jalankan dengan psql/DBeaver. Perbarui juga `01_newinstallation.sql` supaya instalasi baru tetap sama dengan hasil patch.

### c. Mengatur user dan group

- User baru dibuat dari halaman **Pengguna**; keanggotaan group diatur dari halaman **Group**.
- Akun administrator tidak ditampilkan di halaman Pengguna, dan user mengubah dirinya sendiri lewat **Profil**.
- Group sistem (ADMIN) tidak bisa dihapus dan anggota terakhirnya tidak bisa dilepas.

## 7. Memakai sebagai Template Project Baru

1. Salin project, hapus riwayat Git lama (`rm -rf .git && git init`).
2. Ganti nama di `package.json`, `ecosystem.config.js` (nama app pm2), dan port.
3. Buat database baru, isi `.env` (`DATABASE_URL`, **`JWT_SECRET` baru**).
4. Ganti password admin di `db/02_newseeds.sql` (atau hash-nya), lalu jalankan kedua file SQL.
5. `nvm use` → `npm ci` → `npm run dev`.

## 8. Troubleshooting

| Masalah | Penyebab / solusi |
|---------|-------------------|
| `Schema "..." tidak ditemukan` saat start | `DB_SCHEMA` di `.env` tidak sama dengan schema di database; samakan, atau jalankan `npm run db:install` |
| `ECONNREFUSED` ke database | Cek host/port/`DATABASE_URL`, pastikan PostgreSQL jalan |
| `permission denied for database` | User belum punya hak `CREATE`; minta `GRANT CREATE ON DATABASE ...` |
| `permission denied to create extension "pgcrypto"` | Minta DBA, atau buat hash bcrypt dari aplikasi |
| `schema "portal" already exists` (atau nama `DB_SCHEMA` Anda) | Database sudah terpasang; gunakan file patch, atau rebuild dengan `DROP SCHEMA portal CASCADE;` (data hilang) |
| Login berhasil tapi langsung 401 | Cookie `secure` aktif di HTTP; set `COOKIE_SECURE=false` bila tidak pakai HTTPS |
| Refresh halaman → 404 | Pastikan Express punya fallback ke `index.html` untuk route non-`/api` |
| Setelah reboot aplikasi mati | Jalankan `pm2 save` dan `pm2 startup` |