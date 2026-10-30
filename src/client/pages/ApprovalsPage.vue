<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { api, ApiError } from '@/api'
import { useAuthStore } from '@/stores/auth'
import BaseModal from '@/components/BaseModal.vue'
import TablePager from '@/components/TablePager.vue'
import SortTh from '@/components/SortTh.vue'
import TableToolbar from '@/components/TableToolbar.vue'
import { useTable } from '@/lib/useTable'

interface Step {
  level: number
  action: 'approved' | 'rejected'
  by: string
  at: string
  note: string | null
  override: boolean
  data: Record<string, any> | null
}
interface Row {
  id: string
  typeCode: string
  typeName: string
  status: 'pending' | 'approved' | 'rejected'
  subject: string
  payload: Record<string, any>
  currentLevel: number
  totalLevels: number
  createdAt: string
  decidedAt: string | null
  note: string | null
  mine: boolean
  canDecide: boolean
  steps: Step[]
}
interface GroupOption { id: string; code: string; name: string }

const auth = useAuthStore()
const rows = ref<Row[]>([])
const loading = ref(true)
const pageError = ref('')
const notice = ref('')

// 'turn' = hanya yang menunggu keputusan saya
const statusFilter = ref<'' | 'pending' | 'approved' | 'rejected' | 'turn'>('pending')
const typeFilter = ref('')
const typeOptions = computed(() => [...new Set(rows.value.map((r) => r.typeName))].sort())

const { query, sortKey, sortDir, toggleSort, page, pageSize, total, paged } = useTable(rows, {
  searchText: (r) => [r.subject, r.typeName].join(' '),
  sorters: {
    subject: (r) => r.subject,
    type: (r) => r.typeName,
    level: (r) => r.currentLevel,
    status: (r) => r.status,
    created: (r) => Date.parse(r.createdAt),
  },
  extraFilter: (r) =>
    (!statusFilter.value ||
      (statusFilter.value === 'turn' ? r.canDecide : r.status === statusFilter.value)) &&
    (!typeFilter.value || r.typeName === typeFilter.value),
  resetOn: [statusFilter, typeFilter],
})

const filtering = computed(() => !!query.value || statusFilter.value !== 'pending' || !!typeFilter.value)
function resetFilters() {
  query.value = ''
  statusFilter.value = 'pending'
  typeFilter.value = ''
}

const msg = (e: unknown) => (e instanceof ApiError ? e.message : 'Tidak dapat terhubung ke server')
const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '-'
const statusLabel = { pending: 'Menunggu', approved: 'Disetujui', rejected: 'Ditolak' } as const
const fieldLabel: Record<string, string> = { username: 'Username', email: 'Email', fullName: 'Nama lengkap' }

async function load() {
  loading.value = true
  pageError.value = ''
  try {
    rows.value = await api.get<Row[]>('/api/approvals')
  } catch (e) {
    pageError.value = msg(e)
  } finally {
    loading.value = false
  }
}
onMounted(load)

// ---- detail & keputusan
const selected = ref<Row | null>(null)
const note = ref('')
const groupId = ref('')
const groups = ref<GroupOption[]>([])
const actionError = ref('')
const acting = ref(false)

// final = persetujuan ini langsung mengeksekusi (tahap terakhir, atau Administrator)
const willFinish = computed(
  () => !!selected.value && (auth.isAdmin || selected.value.currentLevel >= selected.value.totalLevels),
)
const needsGroup = computed(() => selected.value?.typeCode === 'USER_REGISTRATION')

async function openDetail(r: Row) {
  selected.value = r
  note.value = ''
  actionError.value = ''
  // pilihan group dari tahap sebelumnya dipakai sebagai isian awal
  const prev = [...r.steps].reverse().find((s) => s.data?.groupId)
  groupId.value = prev ? String(prev.data!.groupId) : ''
  if (r.canDecide && r.typeCode === 'USER_REGISTRATION' && groups.value.length === 0) {
    try {
      groups.value = await api.get<GroupOption[]>('/api/approvals/group-options')
    } catch (e) {
      actionError.value = msg(e)
    }
  }
}

async function decide(kind: 'approve' | 'reject') {
  const r = selected.value
  if (!r) return
  actionError.value = ''
  if (kind === 'reject' && !note.value.trim()) {
    actionError.value = 'Isi alasan penolakan'
    return
  }
  if (kind === 'approve' && needsGroup.value && willFinish.value && !groupId.value) {
    actionError.value = 'Pilih group untuk pengguna baru'
    return
  }
  acting.value = true
  try {
    const body =
      kind === 'approve'
        ? { note: note.value, data: groupId.value ? { groupId: groupId.value } : {} }
        : { note: note.value }
    const res = await api.post<{ message: string }>(`/api/approvals/${r.id}/${kind}`, body)
    notice.value = res.message
    selected.value = null
    await load()
  } catch (e) {
    actionError.value = msg(e)
  } finally {
    acting.value = false
  }
}
</script>

<template>
  <div class="page-head page-head-row">
    <div>
      <h1>Persetujuan</h1>
      <p>Tinjau dan putuskan pengajuan yang menjadi tanggung jawab Anda.</p>
    </div>
  </div>

  <p v-if="pageError" class="alert" role="alert">{{ pageError }}</p>
  <p v-if="notice" class="alert alert-info" role="status">{{ notice }}</p>

  <section class="panel panel-flush">
    <TableToolbar v-model="query" placeholder="Cari pengajuan">
      <select v-model="statusFilter" class="input" aria-label="Filter status">
        <option value="pending">Menunggu</option>
        <option value="turn">Giliran saya</option>
        <option value="approved">Disetujui</option>
        <option value="rejected">Ditolak</option>
        <option value="">Semua status</option>
      </select>
      <select v-model="typeFilter" class="input" aria-label="Filter jenis">
        <option value="">Semua jenis</option>
        <option v-for="t in typeOptions" :key="t" :value="t">{{ t }}</option>
      </select>
      <button v-if="filtering" type="button" class="btn btn-ghost btn-sm" @click="resetFilters">Reset</button>
    </TableToolbar>
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <SortTh label="Pengajuan" :active="sortKey === 'subject'" :dir="sortDir" @sort="toggleSort('subject')" />
            <SortTh label="Tahap" :active="sortKey === 'level'" :dir="sortDir" @sort="toggleSort('level')" />
            <SortTh label="Status" :active="sortKey === 'status'" :dir="sortDir" @sort="toggleSort('status')" />
            <SortTh label="Diajukan" :active="sortKey === 'created'" :dir="sortDir" @sort="toggleSort('created')" />
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading">
            <td colspan="5" class="muted">Memuat...</td>
          </tr>
          <tr v-else-if="rows.length === 0">
            <td colspan="5" class="muted">Belum ada pengajuan.</td>
          </tr>
          <tr v-else-if="total === 0">
            <td colspan="5" class="muted">Tidak ada pengajuan yang cocok dengan pencarian atau filter.</td>
          </tr>
          <tr v-for="r in paged" :key="r.id">
            <td>
              <div class="cell-title">{{ r.subject }}</div>
              <div class="muted cell-sub">{{ r.typeName }}<span v-if="r.mine"> · pengajuan Anda</span></div>
            </td>
            <td>{{ r.status === 'pending' ? `${r.currentLevel} dari ${r.totalLevels}` : '-' }}</td>
            <td>
              <span class="badge" :class="{
                'badge-ok': r.status === 'approved',
                'badge-off': r.status === 'rejected',
                'badge-pending': r.status === 'pending',
              }">{{ statusLabel[r.status] }}</span>
            </td>
            <td>{{ fmtDate(r.createdAt) }}</td>
            <td class="cell-actions">
              <button class="btn btn-sm" :class="r.canDecide ? 'btn-primary' : 'btn-ghost'" @click="openDetail(r)">
                {{ r.canDecide ? 'Putuskan' : 'Lihat' }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <TablePager v-if="total > 0" v-model:page="page" v-model:pageSize="pageSize" :total="total" />
  </section>

  <!-- Detail & keputusan -->
  <BaseModal :open="selected !== null" :title="selected?.typeName ?? 'Pengajuan'" @close="selected = null">
    <template v-if="selected">
      <p v-if="actionError" class="alert" role="alert">{{ actionError }}</p>

      <h3 class="sec">Data pengajuan</h3>
      <dl class="kv">
        <template v-for="(v, k) in selected.payload" :key="k">
          <dt>{{ fieldLabel[k] ?? k }}</dt>
          <dd>{{ v }}</dd>
        </template>
      </dl>

      <h3 class="sec">Riwayat persetujuan</h3>
      <ul class="steps">
        <li v-for="s in selected.steps" :key="s.level">
          <strong>Tahap {{ s.level }}</strong> · {{ s.by }} ·
          <span :class="s.action === 'approved' ? 'ok' : 'bad'">{{ s.action === 'approved' ? 'Disetujui' : 'Ditolak' }}</span>
          <span v-if="s.override"> (langsung final oleh Administrator)</span>
          <div class="muted cell-sub">{{ fmtDate(s.at) }}<span v-if="s.note"> · {{ s.note }}</span></div>
        </li>
        <li v-if="selected.status === 'pending'" class="muted">
          Menunggu tahap {{ selected.currentLevel }} dari {{ selected.totalLevels }}
        </li>
      </ul>

      <!-- Form keputusan: hanya kalau sekarang giliran user ini -->
      <template v-if="selected.canDecide">
        <h3 class="sec">Keputusan Anda</h3>
        <div v-if="needsGroup" class="field">
          <label for="a-group">Group untuk pengguna baru</label>
          <select id="a-group" v-model="groupId" class="input">
            <option value="">{{ willFinish ? 'Pilih group...' : 'Belum dipilih (boleh diisi di tahap berikutnya)' }}</option>
            <option v-for="g in groups" :key="g.id" :value="g.id">{{ g.name }}</option>
          </select>
        </div>
        <div class="field">
          <label for="a-note">Catatan</label>
          <textarea id="a-note" v-model="note" class="input" rows="3" maxlength="500"
            placeholder="Wajib diisi jika menolak"></textarea>
        </div>
        <p v-if="!willFinish" class="muted hint">
          Setelah disetujui, pengajuan diteruskan ke tahap {{ selected.currentLevel + 1 }}.
        </p>
      </template>
      <p v-else-if="selected.status === 'pending'" class="muted hint">
        Pengajuan ini bukan giliran Anda untuk diputuskan.
      </p>
    </template>

    <template #footer>
      <button type="button" class="btn btn-ghost" @click="selected = null">Tutup</button>
      <template v-if="selected?.canDecide">
        <button type="button" class="btn btn-danger" :disabled="acting" @click="decide('reject')">Tolak</button>
        <button type="button" class="btn btn-primary" :disabled="acting" @click="decide('approve')">
          {{ acting ? 'Memproses...' : 'Setujui' }}
        </button>
      </template>
    </template>
  </BaseModal>
</template>

<style scoped>
.badge-pending { background: #fef3c7; color: #b45309; }
.sec { margin: 16px 0 8px; font-size: 14px; }
.kv { display: grid; grid-template-columns: 140px 1fr; gap: 6px 12px; margin: 0; font-size: 14px; }
.kv dt { color: #6b7280; }
.kv dd { margin: 0; word-break: break-word; }
.steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; font-size: 14px; }
.ok { color: #15803d; }
.bad { color: #b91c1c; }
</style>