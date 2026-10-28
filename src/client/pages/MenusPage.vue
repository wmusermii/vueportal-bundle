<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { api, ApiError } from '@/api'
import { iconNames } from '@/lib/icons'
import { useAuthStore } from '@/stores/auth'
import BaseModal from '@/components/BaseModal.vue'

interface MenuRow {
  id: string
  parentId: string | null
  code: string
  title: string
  type: 'folder' | 'page'
  path: string | null
  icon: string | null
  level: number
  sortOrder: number
  status: 'active' | 'inactive'
  isSystem: boolean
}

const auth = useAuthStore()
const menus = ref<MenuRow[]>([])
const loading = ref(true)
const pageError = ref('')

const formOpen = ref(false)
const editing = ref<MenuRow | null>(null)
const saving = ref(false)
const formError = ref('')
const form = reactive({
  parentId: '',
  code: '',
  title: '',
  type: 'page' as 'folder' | 'page',
  path: '',
  icon: '',
  sortOrder: 0,
  status: 'active' as 'active' | 'inactive',
})

const deleting = ref<MenuRow | null>(null)
const deleteError = ref('')
const busy = ref(false)

const msg = (e: unknown) => (e instanceof ApiError ? e.message : 'Tidak dapat terhubung ke server')

const byId = computed(() => new Map(menus.value.map((m) => [m.id, m])))
function labelOf(m: MenuRow): string {
  const parent = m.parentId ? byId.value.get(m.parentId) : undefined
  return parent ? `${labelOf(parent)} / ${m.title}` : m.title
}

const hasChildren = computed(
  () => !!editing.value && menus.value.some((m) => m.parentId === editing.value!.id),
)
// induk dan tipe tidak bisa diubah untuk menu sistem atau menu yang punya submenu
const lockStructure = computed(() => !!editing.value && (editing.value.isSystem || hasChildren.value))

// folder maksimal di level 2, halaman maksimal di level 3
const parentOptions = computed(() =>
  menus.value.filter(
    (m) => m.type === 'folder' && m.id !== editing.value?.id && m.level < (form.type === 'folder' ? 2 : 3),
  ),
)
watch(
  () => form.type,
  () => {
    if (form.parentId && !parentOptions.value.some((m) => m.id === form.parentId)) form.parentId = ''
  },
)

async function load() {
  loading.value = true
  pageError.value = ''
  try {
    menus.value = await api.get<MenuRow[]>('/api/menus')
  } catch (e) {
    pageError.value = msg(e)
  } finally {
    loading.value = false
  }
}
onMounted(load)

function openCreate() {
  editing.value = null
  Object.assign(form, { parentId: '', code: '', title: '', type: 'page', path: '', icon: '', sortOrder: 0, status: 'active' })
  formError.value = ''
  formOpen.value = true
}

function openEdit(m: MenuRow) {
  editing.value = m
  Object.assign(form, {
    parentId: m.parentId ?? '',
    code: m.code,
    title: m.title,
    type: m.type,
    path: m.path ?? '',
    icon: m.icon ?? '',
    sortOrder: m.sortOrder,
    status: m.status,
  })
  formError.value = ''
  formOpen.value = true
}

async function save() {
  saving.value = true
  formError.value = ''
  const body = {
    parentId: form.parentId || null,
    code: form.code,
    title: form.title,
    type: form.type,
    path: form.type === 'page' ? form.path : null,
    icon: form.icon || null,
    sortOrder: Number(form.sortOrder),
    status: form.status,
  }
  try {
    if (editing.value) await api.put(`/api/menus/${editing.value.id}`, body)
    else await api.post('/api/menus', body)
    formOpen.value = false
    await Promise.all([load(), auth.fetchSession()]) // sidebar sendiri ikut diperbarui
  } catch (e) {
    formError.value = msg(e)
  } finally {
    saving.value = false
  }
}

function askDelete(m: MenuRow) {
  deleteError.value = ''
  deleting.value = m
}

async function confirmDelete() {
  if (!deleting.value) return
  busy.value = true
  deleteError.value = ''
  try {
    await api.delete(`/api/menus/${deleting.value.id}`)
    deleting.value = null
    await Promise.all([load(), auth.fetchSession()])
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
      <h1>Menu</h1>
      <p>Atur struktur menu sidebar, maksimal 3 level.</p>
    </div>
    <button v-if="auth.can('menus', 'create')" class="btn btn-primary" @click="openCreate">
      Tambah menu
    </button>
  </div>

  <p v-if="pageError" class="alert" role="alert">{{ pageError }}</p>

  <section class="panel panel-flush">
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>Menu</th>
            <th>Tipe</th>
            <th>Path</th>
            <th>Urutan</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading"><td colspan="6" class="muted">Memuat...</td></tr>
          <tr v-for="m in menus" :key="m.id">
            <td :style="{ paddingLeft: `${14 + (m.level - 1) * 24}px` }">
              <div class="cell-title">
                {{ m.title }}
                <span v-if="m.isSystem" class="chip">Sistem</span>
              </div>
              <div class="muted cell-sub">{{ m.code }}</div>
            </td>
            <td>{{ m.type === 'folder' ? 'Folder' : 'Halaman' }}</td>
            <td>{{ m.path ?? '-' }}</td>
            <td>{{ m.sortOrder }}</td>
            <td>
              <span class="badge" :class="m.status === 'active' ? 'badge-ok' : 'badge-off'">
                {{ m.status === 'active' ? 'Aktif' : 'Nonaktif' }}
              </span>
            </td>
            <td class="cell-actions">
              <button v-if="auth.can('menus', 'update')" class="btn btn-ghost btn-sm" @click="openEdit(m)">
                Ubah
              </button>
              <button
                v-if="auth.can('menus', 'delete') && !m.isSystem"
                class="btn btn-ghost btn-sm btn-text-danger"
                @click="askDelete(m)"
              >
                Hapus
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>

  <!-- Form tambah / ubah -->
  <BaseModal :open="formOpen" :title="editing ? 'Ubah menu' : 'Tambah menu'" @close="formOpen = false">
    <form id="menu-form" @submit.prevent="save">
      <p v-if="formError" class="alert" role="alert">{{ formError }}</p>

      <div class="field">
        <label for="m-type">Tipe</label>
        <select id="m-type" v-model="form.type" class="input" :disabled="lockStructure">
          <option value="page">Halaman</option>
          <option value="folder">Folder (pengelompok menu)</option>
        </select>
      </div>
      <div class="field">
        <label for="m-parent">Induk</label>
        <select id="m-parent" v-model="form.parentId" class="input" :disabled="lockStructure">
          <option value="">Tanpa induk (level 1)</option>
          <option v-for="p in parentOptions" :key="p.id" :value="p.id">{{ labelOf(p) }}</option>
        </select>
      </div>
      <div class="form-grid">
        <div class="field">
          <label for="m-title">Judul</label>
          <input id="m-title" v-model="form.title" class="input" />
        </div>
        <div class="field">
          <label for="m-code">Kode</label>
          <input id="m-code" v-model="form.code" class="input" :disabled="!!editing" autocomplete="off" placeholder="laporan.harian" />
        </div>
      </div>
      <div v-if="form.type === 'page'" class="field">
        <label for="m-path">Path</label>
        <input id="m-path" v-model="form.path" class="input" :disabled="!!editing?.isSystem" placeholder="/laporan/harian" />
      </div>
      <div class="form-grid">
        <div class="field">
          <!-- <label for="m-icon">Ikon (tampil di level 1)</label> -->
          <label for="m-icon">Ikon</label>
          <select id="m-icon" v-model="form.icon" class="input">
            <option value="">Standar</option>
            <option v-for="n in iconNames" :key="n" :value="n">{{ n }}</option>
          </select>
        </div>
        <div class="field">
          <label for="m-sort">Urutan</label>
          <input id="m-sort" v-model.number="form.sortOrder" type="number" min="0" class="input" />
        </div>
      </div>
      <div class="field">
        <label for="m-status">Status</label>
        <select id="m-status" v-model="form.status" class="input" :disabled="!!editing?.isSystem">
          <option value="active">Aktif</option>
          <option value="inactive">Nonaktif</option>
        </select>
      </div>
      <p v-if="lockStructure" class="muted hint">
        {{ editing?.isSystem ? 'Menu sistem: kode, tipe, path, induk, dan status terkunci.' : 'Menu ini punya submenu, jadi tipe dan induknya tidak bisa diubah.' }}
      </p>
    </form>
    <template #footer>
      <button type="button" class="btn btn-ghost" @click="formOpen = false">Batal</button>
      <button type="submit" form="menu-form" class="btn btn-primary" :disabled="saving">
        {{ saving ? 'Menyimpan...' : 'Simpan' }}
      </button>
    </template>
  </BaseModal>

  <!-- Konfirmasi hapus -->
  <BaseModal :open="deleting !== null" title="Hapus menu" @close="deleting = null">
    <p v-if="deleteError" class="alert" role="alert">{{ deleteError }}</p>
    <p>
      Hapus menu <strong>{{ deleting?.title }}</strong>? Izin menu ini di semua group ikut terhapus.
    </p>
    <template #footer>
      <button type="button" class="btn btn-ghost" @click="deleting = null">Batal</button>
      <button type="button" class="btn btn-danger" :disabled="busy" @click="confirmDelete">
        {{ busy ? 'Menghapus...' : 'Hapus' }}
      </button>
    </template>
  </BaseModal>
</template>