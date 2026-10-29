export interface StatItem {
  key: string
  label: string
  value: number
  hint: string
  tone: 'green' | 'blue' | 'amber' | 'rose'
}
export interface TaskItem {
  id: number
  title: string
  due: string
  priority: 'Tinggi' | 'Sedang' | 'Rendah'
  status: 'Berjalan' | 'Menunggu' | 'Selesai'
}
export interface ActivityItem { id: number; text: string; time: string }
export interface AnnouncementItem { id: number; title: string; date: string; body: string }
export interface ShortcutItem { label: string; to: string }

export const stats: StatItem[] = [
  { key: 'open',    label: 'Tugas Aktif',        value: 8,  hint: '3 jatuh tempo minggu ini', tone: 'blue' },
  { key: 'pending', label: 'Menunggu Persetujuan', value: 4,  hint: '1 sudah lebih dari 2 hari', tone: 'amber' },
  { key: 'done',    label: 'Selesai Bulan Ini',  value: 27, hint: '+12% dari bulan lalu',     tone: 'green' },
  { key: 'notif',   label: 'Notifikasi Baru',    value: 5,  hint: '2 belum dibaca',           tone: 'rose' },
]

// jumlah aktivitas 7 hari terakhir
export const weekly = [
  { day: 'Sen', value: 5 }, { day: 'Sel', value: 8 }, { day: 'Rab', value: 6 },
  { day: 'Kam', value: 11 }, { day: 'Jum', value: 9 }, { day: 'Sab', value: 2 }, { day: 'Min', value: 1 },
]

export const tasks: TaskItem[] = [
  { id: 1, title: 'Verifikasi data pengajuan #1042', due: '30 Okt 2026', priority: 'Tinggi', status: 'Berjalan' },
  { id: 2, title: 'Rekap laporan mingguan',          due: '31 Okt 2026', priority: 'Sedang', status: 'Berjalan' },
  { id: 3, title: 'Review dokumen mitra baru',       due: '02 Nov 2026', priority: 'Sedang', status: 'Menunggu' },
  { id: 4, title: 'Update data kontak pelanggan',    due: '03 Nov 2026', priority: 'Rendah', status: 'Menunggu' },
  { id: 5, title: 'Input realisasi Oktober',         due: '27 Okt 2026', priority: 'Tinggi', status: 'Selesai' },
]

export const activities: ActivityItem[] = [
  { id: 1, text: 'Anda menyelesaikan "Input realisasi Oktober"', time: '10 menit lalu' },
  { id: 2, text: 'Pengajuan #1038 disetujui oleh Manager',        time: '1 jam lalu' },
  { id: 3, text: 'Anda mengubah data profil',                     time: 'Kemarin, 16:20' },
  { id: 4, text: 'Tugas baru ditugaskan: Verifikasi data #1042',  time: 'Kemarin, 09:05' },
]

export const announcements: AnnouncementItem[] = [
  { id: 1, title: 'Pemeliharaan sistem', date: '30 Okt 2026', body: 'Portal tidak dapat diakses 22:00–23:00 WIB.' },
  { id: 2, title: 'Kebijakan password baru', date: '25 Okt 2026', body: 'Gunakan minimal 8 karakter dengan kombinasi angka.' },
]

export const shortcuts: ShortcutItem[] = [
  { label: 'Profil Saya', to: '/profile' },          // sesuaikan path
  { label: 'Ganti Password', to: '/profile' },       // sesuaikan path
]