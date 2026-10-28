<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { api, ApiError } from '@/api'
import { useAuthStore } from '@/stores/auth'
import BaseModal from '@/components/BaseModal.vue'
import TablePager from '@/components/TablePager.vue'
import SortTh from '@/components/SortTh.vue'
import TableToolbar from '@/components/TableToolbar.vue'
import { useTable } from '@/lib/useTable'


interface UserRow {
  id: string
  username: string
  email: string
  fullName: string
  status: 'active' | 'inactive'
  lastLoginAt: string | null
  groups: { id: string; code: string; name: string }[]
}

const auth = useAuthStore()
const users = ref<UserRow[]>([])
const statusFilter = ref<'' | 'active' | 'inactive'>('')
const groupFilter = ref('') // '' = semua, '-' = belum ada group, selain itu nama group

const groupFilterOptions = computed(() =>
  [...new Set(users.value.flatMap((u) => u.groups.map((g) => g.name)))].sort(),
)

const { query, sortKey, sortDir, toggleSort, page, pageSize, total, paged } = useTable(users, {
  searchText: (u) => [u.fullName, u.username, u.email, ...u.groups.map((g) => g.name)].join(' '),
  sorters: {
    name: (u) => u.fullName,
    email: (u) => u.email,
    group: (u) => u.groups[0]?.name ?? null,
    status: (u) => u.status,
    lastLogin: (u) => (u.lastLoginAt ? Date.parse(u.lastLoginAt) : null),
  },
  extraFilter: (u) =>
    (!statusFilter.value || u.status === statusFilter.value) &&
    (!groupFilter.value ||
      (groupFilter.value === '-' ? u.groups.length === 0 : u.groups.some((g) => g.name === groupFilter.value))),
  resetOn: [statusFilter, groupFilter],
})

const filtering = computed(() => !!query.value || !!statusFilter.value || !!groupFilter.value)
function resetFilters() {
  query.value = ''
  statusFilter.value = ''
  groupFilter.value = ''
}
const loading = ref(true)
const pageError = ref('')

const formOpen = ref(false)
const editing = ref<UserRow | null>(null)
const saving = ref(false)
const formError = ref('')
const form = reactive({
  username: '',
  password: '',
  email: '',
  fullName: '',
  status: 'active' as 'active' | 'inactive',
})

const deleting = ref<UserRow | null>(null)
const deleteError = ref('')
const busy = ref(false)

const msg = (e: unknown) => (e instanceof ApiError ? e.message : 'Tidak dapat terhubung ke server')

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : 'Belum pernah'

async function load() {
  loading.value = true
  pageError.value = ''
  try {
    users.value = await api.get<UserRow[]>('/api/users')
  } catch (e) {
    pageError.value = msg(e)
  } finally {
    loading.value = false
  }
}
onMounted(load)

function openCreate() {
  editing.value = null
  Object.assign(form, { username: '', password: '', email: '', fullName: '', status: 'active' })
  formError.value = ''
  formOpen.value = true
}

function openEdit(u: UserRow) {
  editing.value = u
  Object.assign(form, { username: u.username, password: '', email: u.email, fullName: u.fullName, status: u.status })
  formError.value = ''
  formOpen.value = true
}

async function save() {
  saving.value = true
  formError.value = ''
  try {
    if (editing.value) {
      await api.put(`/api/users/${editing.value.id}`, {
        email: form.email,
        fullName: form.fullName,
        status: form.status,
        ...(form.password ? { password: form.password } : {}),
      })
    } else {
      await api.post('/api/users', { ...form })
    }
    formOpen.value = false
    await load()
  } catch (e) {
    formError.value = msg(e)
  } finally {
    saving.value = false
  }
}

function askDelete(u: UserRow) {
  deleteError.value = ''
  deleting.value = u
}

async function confirmDelete() {
  if (!deleting.value) return
  busy.value = true
  deleteError.value = ''
  try {
    await api.delete(`/api/users/${deleting.value.id}`)
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
      <h1>Pengguna</h1>
      <p>Kelola akun pengguna. Group diatur dari halaman Group &amp; Hak Akses.</p>
    </div>
    <button v-if="auth.can('users', 'create')" class="btn btn-primary" @click="openCreate">
      Tambah pengguna
    </button>
  </div>

  <p v-if="pageError" class="alert" role="alert">{{ pageError }}</p>

  <section class="panel panel-flush">
    <TableToolbar v-model="query" placeholder="Cari nama, username, email, atau group">
      <select v-model="statusFilter" class="input" aria-label="Filter status">
        <option value="">Semua status</option>
        <option value="active">Aktif</option>
        <option value="inactive">Nonaktif</option>
      </select>
      <select v-model="groupFilter" class="input" aria-label="Filter group">
        <option value="">Semua group</option>
        <option value="-">Belum ada group</option>
        <option v-for="g in groupFilterOptions" :key="g" :value="g">{{ g }}</option>
      </select>
      <button v-if="filtering" type="button" class="btn btn-ghost btn-sm" @click="resetFilters">Reset</button>
    </TableToolbar>
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <SortTh label="Nama" :active="sortKey === 'name'" :dir="sortDir" @sort="toggleSort('name')" />
            <SortTh label="Email" :active="sortKey === 'email'" :dir="sortDir" @sort="toggleSort('email')" />
            <SortTh label="Group" :active="sortKey === 'group'" :dir="sortDir" @sort="toggleSort('group')" />
            <SortTh label="Status" :active="sortKey === 'status'" :dir="sortDir" @sort="toggleSort('status')" />
            <SortTh label="Login terakhir" :active="sortKey === 'lastLogin'" :dir="sortDir" @sort="toggleSort('lastLogin')" />
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading">
            <td colspan="6" class="muted">Memuat...</td>
          </tr>
          <tr v-else-if="users.length === 0">
            <td colspan="6" class="muted">Belum ada pengguna. Klik "Tambah pengguna" untuk membuat yang pertama.</td>
          </tr>
          <tr v-else-if="total === 0">
            <td colspan="6" class="muted">Tidak ada pengguna yang cocok dengan pencarian atau filter.</td>
          </tr>
          <tr v-for="u in paged" :key="u.id">
            <td>
              <div class="cell-title">{{ u.fullName }}</div>
              <div class="muted cell-sub">{{ u.username }}</div>
            </td>
            <td>{{ u.email }}</td>
            <td>
              <span v-for="g in u.groups" :key="g.id" class="chip">{{ g.name }}</span>
              <span v-if="u.groups.length === 0" class="muted">Belum ada group</span>
            </td>
            <td>
              <span class="badge" :class="u.status === 'active' ? 'badge-ok' : 'badge-off'">
                {{ u.status === 'active' ? 'Aktif' : 'Nonaktif' }}
              </span>
            </td>
            <td>{{ fmtDate(u.lastLoginAt) }}</td>
            <td class="cell-actions">
              <button v-if="auth.can('users', 'update')" class="btn btn-ghost btn-sm" @click="openEdit(u)">
                Ubah
              </button>
              <button v-if="auth.can('users', 'delete')" class="btn btn-ghost btn-sm btn-text-danger"
                @click="askDelete(u)">
                Hapus
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <TablePager v-if="total > 0" v-model:page="page" v-model:pageSize="pageSize" :total="total" />
  </section>

  <!-- Form tambah / ubah -->
  <BaseModal :open="formOpen" :title="editing ? 'Ubah pengguna' : 'Tambah pengguna'" @close="formOpen = false">
    <form id="user-form" @submit.prevent="save">
      <p v-if="formError" class="alert" role="alert">{{ formError }}</p>
      <div class="field">
        <label for="f-username">Username</label>
        <input id="f-username" v-model="form.username" class="input" :disabled="!!editing" autocomplete="off" />
      </div>
      <div class="field">
        <label for="f-name">Nama lengkap</label>
        <input id="f-name" v-model="form.fullName" class="input" />
      </div>
      <div class="field">
        <label for="f-email">Email</label>
        <input id="f-email" v-model="form.email" type="email" class="input" />
      </div>
      <div class="field">
        <label for="f-pass">{{ editing ? 'Password baru' : 'Password' }}</label>
        <input id="f-pass" v-model="form.password" type="password" class="input" autocomplete="new-password"
          :placeholder="editing ? 'Kosongkan jika tidak diganti' : 'Minimal 8 karakter'" />
      </div>
      <div class="field">
        <label for="f-status">Status</label>
        <select id="f-status" v-model="form.status" class="input">
          <option value="active">Aktif</option>
          <option value="inactive">Nonaktif</option>
        </select>
      </div>
    </form>
    <template #footer>
      <button type="button" class="btn btn-ghost" @click="formOpen = false">Batal</button>
      <button type="submit" form="user-form" class="btn btn-primary" :disabled="saving">
        {{ saving ? 'Menyimpan...' : 'Simpan' }}
      </button>
    </template>
  </BaseModal>

  <!-- Konfirmasi hapus -->
  <BaseModal :open="deleting !== null" title="Hapus pengguna" @close="deleting = null">
    <p v-if="deleteError" class="alert" role="alert">{{ deleteError }}</p>
    <p>
      Hapus <strong>{{ deleting?.fullName }}</strong> ({{ deleting?.username }})?
      Akun yang dihapus tidak dapat dikembalikan.
    </p>
    <template #footer>
      <button type="button" class="btn btn-ghost" @click="deleting = null">Batal</button>
      <button type="button" class="btn btn-danger" :disabled="busy" @click="confirmDelete">
        {{ busy ? 'Menghapus...' : 'Hapus' }}
      </button>
    </template>
  </BaseModal>
</template>