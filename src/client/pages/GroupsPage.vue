<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { api, ApiError } from '@/api'
import { useAuthStore } from '@/stores/auth'
import BaseModal from '@/components/BaseModal.vue'

interface GroupRow {
  id: string
  code: string
  name: string
  description: string | null
  isSystem: boolean
  status: 'active' | 'inactive'
  memberCount: number
}
interface PageRef { id: string; code: string; label: string }
interface PermRow { menuId: string; create: boolean; read: boolean; update: boolean; delete: boolean }
interface GroupDetail extends Omit<GroupRow, 'memberCount' | 'description'> {
  description: string
  permissions: PermRow[]
}
type ActionKey = 'read' | 'create' | 'update' | 'delete'
type Perm = Record<ActionKey, boolean>

const ACTIONS: { key: ActionKey; label: string }[] = [
  { key: 'read', label: 'Lihat' },
  { key: 'create', label: 'Tambah' },
  { key: 'update', label: 'Ubah' },
  { key: 'delete', label: 'Hapus' },
]

const auth = useAuthStore()
const groups = ref<GroupRow[]>([])
const pages = ref<PageRef[]>([])
const loading = ref(true)
const pageError = ref('')

const formOpen = ref(false)
const editing = ref<GroupRow | null>(null)
const saving = ref(false)
const formError = ref('')
const form = reactive({ code: '', name: '', description: '', status: 'active' as 'active' | 'inactive' })
const matrix = reactive<Record<string, Perm>>({})
interface MemberRow { id: string; username: string; fullName: string; status: string; isMember: boolean; otherGroup: string | null }
const members = ref<MemberRow[]>([])
const memberIds = ref<string[]>([])
const originalMemberIds = ref<string[]>([])
const memberQuery = ref('')

const filteredMembers = computed(() => {
  const q = memberQuery.value.trim().toLowerCase()
  if (!q) return members.value
  return members.value.filter((m) => m.fullName.toLowerCase().includes(q) || m.username.includes(q))
})

const membersChanged = computed(
  () =>
    memberIds.value.length !== originalMemberIds.value.length ||
    memberIds.value.some((id) => !originalMemberIds.value.includes(id)),
)
const deleting = ref<GroupRow | null>(null)
const deleteError = ref('')
const busy = ref(false)

const locked = computed(() => editing.value?.isSystem === true)

const msg = (e: unknown) => (e instanceof ApiError ? e.message : 'Tidak dapat terhubung ke server')

async function load() {
  loading.value = true
  pageError.value = ''
  try {
    const [g, p] = await Promise.all([
      api.get<GroupRow[]>('/api/groups'),
      api.get<PageRef[]>('/api/groups/pages'),
    ])
    groups.value = g
    pages.value = p
  } catch (e) {
    pageError.value = msg(e)
  } finally {
    loading.value = false
  }
}
onMounted(load)

function resetMatrix(perms: PermRow[] = []) {
  for (const k of Object.keys(matrix)) delete matrix[k]
  for (const p of pages.value) {
    matrix[p.id] = { read: false, create: false, update: false, delete: false }
  }
  for (const r of perms) {
    if (matrix[r.menuId]) {
      Object.assign(matrix[r.menuId], { read: r.read, create: r.create, update: r.update, delete: r.delete })
    }
  }
}

// Tambah/Ubah/Hapus mengharuskan Lihat
function setPerm(pageId: string, key: ActionKey, value: boolean) {
  const p = matrix[pageId]
  p[key] = value
  if (key === 'read' && !value) {
    p.create = false
    p.update = false
    p.delete = false
  }
  if (key !== 'read' && value) p.read = true
}

function openCreate() {
  editing.value = null
  Object.assign(form, { code: '', name: '', description: '', status: 'active' })
  resetMatrix()
  members.value = []
  memberIds.value = []
  originalMemberIds.value = []
  formError.value = ''
  formOpen.value = true
}

async function openEdit(g: GroupRow) {
  pageError.value = ''
  try {
    const [d, m] = await Promise.all([
      api.get<GroupDetail>(`/api/groups/${g.id}`),
      api.get<MemberRow[]>(`/api/groups/${g.id}/members`),
    ])
    editing.value = g
    Object.assign(form, { code: d.code, name: d.name, description: d.description, status: d.status })
    resetMatrix(d.permissions)
    members.value = m
    memberIds.value = m.filter((x) => x.isMember).map((x) => x.id)
    originalMemberIds.value = [...memberIds.value]
    memberQuery.value = ''
    formError.value = ''
    formOpen.value = true
  } catch (e) {
    pageError.value = msg(e)
  }
}

async function save() {
  saving.value = true
  formError.value = ''
  const body = {
    code: form.code,
    name: form.name,
    description: form.description,
    status: form.status,
    permissions: pages.value.map((p) => ({ menuId: p.id, ...matrix[p.id] })),
  }
  try {
    if (editing.value) {
      await api.put(`/api/groups/${editing.value.id}`, body)
      if (membersChanged.value) {
        await api.put(`/api/groups/${editing.value.id}/members`, { userIds: memberIds.value })
      }
    } else {
      await api.post('/api/groups', body)
    }
    formOpen.value = false
    await load()
  } catch (e) {
    formError.value = msg(e)
  } finally {
    saving.value = false
  }
}

function askDelete(g: GroupRow) {
  deleteError.value = ''
  deleting.value = g
}

async function confirmDelete() {
  if (!deleting.value) return
  busy.value = true
  deleteError.value = ''
  try {
    await api.delete(`/api/groups/${deleting.value.id}`)
    deleting.value = null
    await load()
  } catch (e) {
    deleteError.value = msg(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="page-head page-head-row">
    <div>
      <h1>Group &amp; Hak Akses</h1>
      <p>Atur halaman dan aksi yang boleh dilakukan setiap group.</p>
    </div>
    <button v-if="auth.can('groups', 'create')" class="btn btn-primary" @click="openCreate">
      Tambah group
    </button>
  </div>

  <p v-if="pageError" class="alert" role="alert">{{ pageError }}</p>

  <section class="panel panel-flush">
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>Group</th>
            <th>Deskripsi</th>
            <th>Anggota</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading">
            <td colspan="5" class="muted">Memuat...</td>
          </tr>
          <tr v-else-if="groups.length === 0">
            <td colspan="5" class="muted">Belum ada group. Klik "Tambah group" untuk membuat yang pertama.</td>
          </tr>
          <tr v-for="g in groups" :key="g.id">
            <td>
              <div class="cell-title">
                {{ g.name }}
                <span v-if="g.isSystem" class="chip">Sistem</span>
              </div>
              <div class="muted cell-sub">{{ g.code }}</div>
            </td>
            <td>{{ g.description || '-' }}</td>
            <td>{{ g.memberCount }}</td>
            <td>
              <span class="badge" :class="g.status === 'active' ? 'badge-ok' : 'badge-off'">
                {{ g.status === 'active' ? 'Aktif' : 'Nonaktif' }}
              </span>
            </td>
            <td class="cell-actions">
              <button v-if="auth.can('groups', 'update')" class="btn btn-ghost btn-sm" @click="openEdit(g)">
                Ubah
              </button>
              <button v-if="auth.can('groups', 'delete') && !g.isSystem" class="btn btn-ghost btn-sm btn-text-danger"
                @click="askDelete(g)">
                Hapus
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>

  <!-- Form tambah / ubah -->
  <BaseModal wide :open="formOpen" :title="editing ? 'Ubah group' : 'Tambah group'" @close="formOpen = false">
    <form id="group-form" @submit.prevent="save">
      <p v-if="formError" class="alert" role="alert">{{ formError }}</p>

      <div class="form-grid">
        <div class="field">
          <label for="g-name">Nama group</label>
          <input id="g-name" v-model="form.name" class="input" />
        </div>
        <div class="field">
          <label for="g-code">Kode</label>
          <input id="g-code" v-model="form.code" class="input" :disabled="locked" autocomplete="off"
            placeholder="SUPERVISOR" />
        </div>
      </div>
      <div class="field">
        <label for="g-desc">Deskripsi</label>
        <input id="g-desc" v-model="form.description" class="input" />
      </div>
      <div class="field">
        <label for="g-status">Status</label>
        <select id="g-status" v-model="form.status" class="input" :disabled="locked">
          <option value="active">Aktif</option>
          <option value="inactive">Nonaktif</option>
        </select>
      </div>

      <fieldset class="fieldset" :disabled="locked">
        <legend>Hak akses per halaman</legend>
        <div class="table-wrap">
          <table class="matrix">
            <thead>
              <tr>
                <th>Halaman</th>
                <th v-for="a in ACTIONS" :key="a.key">{{ a.label }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in pages" :key="p.id">
                <td>{{ p.label }}</td>
                <td v-for="a in ACTIONS" :key="a.key">
                  <input type="checkbox" :checked="matrix[p.id]?.[a.key]" :aria-label="`${a.label} ${p.label}`"
                    @change="setPerm(p.id, a.key, ($event.target as HTMLInputElement).checked)" />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-if="locked" class="muted hint">Izin, kode, dan status group sistem terkunci.</p>
      </fieldset>
      <fieldset v-if="editing" class="fieldset">
        <legend>Anggota ({{ memberIds.length }})</legend>
        <p class="muted hint">Satu user hanya bisa berada di satu group. Mencentang user dari group lain akan
          memindahkannya ke sini.</p>
        <input v-model="memberQuery" class="input" placeholder="Cari nama atau username" aria-label="Cari anggota" />
        <div class="member-list">
          <label v-for="m in filteredMembers" :key="m.id" class="check">
            <input v-model="memberIds" type="checkbox" :value="m.id" :disabled="m.id === auth.user?.id" />
            <span>{{ m.fullName }} <span class="muted">{{ m.username }}</span></span>
            <span v-if="m.otherGroup" class="muted member-other">
              {{ memberIds.includes(m.id) ? 'pindah dari ' : 'di ' }}{{ m.otherGroup }}
            </span>
            <span v-if="m.status !== 'active'" class="badge badge-off">Nonaktif</span>
          </label>
          <p v-if="filteredMembers.length === 0" class="muted hint">Tidak ada user yang cocok.</p>
        </div>
      </fieldset>
      <p v-else class="muted hint">Simpan group dulu, lalu tambahkan anggotanya lewat tombol Ubah.</p>
    </form>
    <template #footer>
      <button type="button" class="btn btn-ghost" @click="formOpen = false">Batal</button>
      <button type="submit" form="group-form" class="btn btn-primary" :disabled="saving">
        {{ saving ? 'Menyimpan...' : 'Simpan' }}
      </button>
    </template>
  </BaseModal>

  <!-- Konfirmasi hapus -->
  <BaseModal :open="deleting !== null" title="Hapus group" @close="deleting = null">
    <p v-if="deleteError" class="alert" role="alert">{{ deleteError }}</p>
    <p>
      Hapus group <strong>{{ deleting?.name }}</strong>? Group yang masih punya anggota tidak bisa dihapus.
    </p>
    <template #footer>
      <button type="button" class="btn btn-ghost" @click="deleting = null">Batal</button>
      <button type="button" class="btn btn-danger" :disabled="busy" @click="confirmDelete">
        {{ busy ? 'Menghapus...' : 'Hapus' }}
      </button>
    </template>
  </BaseModal>
</template>