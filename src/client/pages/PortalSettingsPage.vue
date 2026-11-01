<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { api, ApiError } from '@/api'
import { useAuthStore } from '@/stores/auth'
import BaseModal from '@/components/BaseModal.vue'
import { usePortalStore } from '@/stores/portal'
import ThemeTab from '@/pages/ThemeTab.vue'
const portal = usePortalStore()

type ValueType = 'text' | 'number' | 'boolean' | 'secret'
interface ParamRow {
  id: string
  groupCode: string
  key: string
  value: string | null
  hasValue: boolean
  valueType: ValueType
  options: string[] | null
  numMin: number | null
  numMax: number | null
  description: string
  isSystem: boolean
}

const GROUPS: Record<string, { label: string; hint: string }> = {
  login: { label: 'Keamanan Login', hint: 'Pembatasan percobaan login dan pemblokiran sementara.' },
  password: { label: 'Kebijakan Password', hint: 'Aturan penulisan password saat membuat atau mengganti password pengguna.' },
  smtp: { label: 'Email (SMTP)', hint: 'Pengirim email portal. Password disimpan terenkripsi.' },
  session: { label: 'Sesi', hint: 'Masa berlaku sesi login.' },
  portal: { label: 'Umum', hint: 'Identitas dan status portal.' },
  themes: { label: 'Themes', hint: 'Warna, logo, dan gambar halaman login.' },
}
const GROUP_ORDER = Object.keys(GROUPS)
const TYPE_LABEL: Record<ValueType, string> = { text: 'Teks', number: 'Angka', boolean: 'Boolean', secret: 'Rahasia' }
const labelOf = (code: string) => GROUPS[code]?.label ?? code

const auth = useAuthStore()
const params = ref<ParamRow[]>([])
const loading = ref(true)
const pageError = ref('')
const active = ref('')

const tabs = computed(() => {
  const codes = [...new Set(params.value.map((p) => p.groupCode))]
  const rank = (c: string) => (GROUP_ORDER.includes(c) ? GROUP_ORDER.indexOf(c) : 99)
  return codes.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
})
watch(
  tabs,
  (t) => {
    if (!t.includes(active.value)) active.value = t[0] ?? ''
  },
  { immediate: true },
)
const rows = computed(() => params.value.filter((p) => p.groupCode === active.value))

async function onTabKey(e: KeyboardEvent) {
  const n = tabs.value.length
  const i = tabs.value.indexOf(active.value)
  if (e.key === 'ArrowRight') active.value = tabs.value[(i + 1) % n]
  else if (e.key === 'ArrowLeft') active.value = tabs.value[(i - 1 + n) % n]
  else return
  e.preventDefault()
  await nextTick()
  document.getElementById(`tab-${active.value}`)?.focus()
}

const msg = (e: unknown) => (e instanceof ApiError ? e.message : 'Tidak dapat terhubung ke server')

async function load() {
  loading.value = true
  pageError.value = ''
  try {
    params.value = await api.get<ParamRow[]>('/api/parameters')
  } catch (e) {
    pageError.value = msg(e)
  } finally {
    loading.value = false
  }
}
onMounted(load)

// ---------- form ----------
const formOpen = ref(false)
const editing = ref<ParamRow | null>(null)
const saving = ref(false)
const formError = ref('')
const form = reactive({
  groupCode: '',
  key: '',
  valueType: 'text' as ValueType,
  value: '',
  optionsText: '',
  numMin: '',
  numMax: '',
  description: '',
  clearSecret: false,
})

const parsedOptions = computed(() =>
  form.optionsText.split(',').map((s) => s.trim()).filter(Boolean),
)
// daftar pilihan untuk kolom nilai (null = input bebas)
const optionList = computed(() => {
  if (editing.value?.isSystem) return editing.value.options
  if (form.valueType !== 'text') return null
  return parsedOptions.value.length ? parsedOptions.value : null
})

// parameter baru: nilai awal mengikuti tipe
watch(
  () => form.valueType,
  (t) => {
    if (editing.value) return
    form.value = t === 'boolean' ? 'false' : t === 'number' ? '0' : ''
    form.clearSecret = false
  },
)

function openCreate() {
  editing.value = null
  Object.assign(form, {
    groupCode: active.value,
    key: '',
    valueType: 'text',
    value: '',
    optionsText: '',
    numMin: '',
    numMax: '',
    description: '',
    clearSecret: false,
  })
  formError.value = ''
  formOpen.value = true
}

function openEdit(p: ParamRow) {
  editing.value = p
  Object.assign(form, {
    groupCode: p.groupCode,
    key: p.key,
    valueType: p.valueType,
    value: p.valueType === 'secret' ? '' : (p.value ?? ''),
    optionsText: p.options?.join(', ') ?? '',
    numMin: String(p.numMin ?? ''),
    numMax: String(p.numMax ?? ''),
    description: p.description,
    clearSecret: false,
  })
  formError.value = ''
  formOpen.value = true
}

const num = (s: string) => (s.trim() === '' ? null : Number(s))

async function save() {
  saving.value = true
  formError.value = ''
  try {
    const p = editing.value
    if (p) {
      await api.put(`/api/parameters/${p.id}`, {
        value: p.valueType === 'secret' ? form.value || null : form.value,
        clearSecret: p.valueType === 'secret' ? form.clearSecret : undefined,
        description: form.description,
        ...(p.isSystem
          ? {}
          : {
            options: p.valueType === 'text' && parsedOptions.value.length ? parsedOptions.value : null,
            numMin: p.valueType === 'number' ? num(form.numMin) : null,
            numMax: p.valueType === 'number' ? num(form.numMax) : null,
          }),
      })
    } else {
      await api.post('/api/parameters', {
        groupCode: form.groupCode.trim(),
        key: form.key.trim(),
        valueType: form.valueType,
        value: form.value,
        options: form.valueType === 'text' && parsedOptions.value.length ? parsedOptions.value : null,
        numMin: form.valueType === 'number' ? num(form.numMin) : null,
        numMax: form.valueType === 'number' ? num(form.numMax) : null,
        description: form.description,
      })
      active.value = form.groupCode.trim()
    }
    formOpen.value = false
    await load()
    void portal.load()
  } catch (e) {
    formError.value = msg(e)
  } finally {
    saving.value = false
  }
}

// ---------- hapus ----------
const deleting = ref<ParamRow | null>(null)
const deleteError = ref('')
const busy = ref(false)

function askDelete(p: ParamRow) {
  deleteError.value = ''
  deleting.value = p
}

async function confirmDelete() {
  if (!deleting.value) return
  busy.value = true
  deleteError.value = ''
  try {
    await api.delete(`/api/parameters/${deleting.value.id}`)
    deleting.value = null
    await load()
    void portal.load()
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
      <h1>Pengaturan Portal</h1>
      <p>Atur ketentuan portal. Nilai disimpan di tabel parameter.</p>
    </div>
    <!-- <button v-if="auth.can('portal', 'create')" class="btn btn-primary" @click="openCreate"> -->
    <button v-if="auth.can('portal', 'create') && active !== 'themes'" class="btn btn-primary" @click="openCreate">
      Tambah parameter
    </button>
  </div>

  <p v-if="pageError" class="alert" role="alert">{{ pageError }}</p>

  <section class="panel panel-flush">
    <div class="tabs" role="tablist" aria-label="Kelompok pengaturan" @keydown="onTabKey">
      <button v-for="t in tabs" :id="`tab-${t}`" :key="t" type="button" role="tab" class="tab"
        :aria-selected="t === active" :tabindex="t === active ? 0 : -1" @click="active = t">
        {{ labelOf(t) }}
      </button>
    </div>
    <ThemeTab v-if="active === 'themes'" />
    <template v-else>
      <p v-if="GROUPS[active]" class="muted tab-hint">{{ GROUPS[active].hint }}</p>

      <div class="table-wrap" role="tabpanel" :aria-labelledby="`tab-${active}`">
        <table class="table">
          <thead>
            <tr>
              <th>Parameter</th>
              <th>Nilai</th>
              <th>Deskripsi</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading">
              <td colspan="4" class="muted">Memuat...</td>
            </tr>
            <tr v-else-if="rows.length === 0">
              <td colspan="4" class="muted">Belum ada parameter.</td>
            </tr>
            <tr v-for="p in rows" :key="p.id">
              <td>
                <div class="cell-title">
                  {{ p.key }}
                  <span v-if="p.isSystem" class="chip">Sistem</span>
                </div>
                <div class="muted cell-sub">{{ TYPE_LABEL[p.valueType] }}</div>
              </td>
              <td>
                <template v-if="p.valueType === 'secret'">
                  <span v-if="p.hasValue">••••••••</span>
                  <span v-else class="muted">Belum diisi</span>
                </template>
                <span v-else-if="p.valueType === 'boolean'" class="badge"
                  :class="p.value === 'true' ? 'badge-ok' : 'badge-off'">
                  {{ p.value === 'true' ? 'Ya' : 'Tidak' }}
                </span>
                <template v-else>
                  <span v-if="p.value !== ''">{{ p.value }}</span>
                  <span v-else class="muted">Kosong</span>
                </template>
              </td>
              <td>{{ p.description || '-' }}</td>
              <td class="cell-actions">
                <button v-if="auth.can('portal', 'update')" class="btn btn-ghost btn-sm"
                  @click="openEdit(p)">Ubah</button>
                <button v-if="auth.can('portal', 'delete') && !p.isSystem" class="btn btn-ghost btn-sm btn-text-danger"
                  @click="askDelete(p)">
                  Hapus
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </section>

  <!-- Form tambah / ubah -->
  <BaseModal :open="formOpen" :title="editing ? 'Ubah parameter' : 'Tambah parameter'" @close="formOpen = false">
    <form id="param-form" @submit.prevent="save">
      <p v-if="formError" class="alert" role="alert">{{ formError }}</p>

      <div class="form-grid">
        <div class="field">
          <label for="pa-group">Group</label>
          <input id="pa-group" v-model="form.groupCode" class="input" list="param-groups" :disabled="!!editing"
            autocomplete="off" placeholder="smtp" />
          <datalist id="param-groups">
            <option v-for="t in tabs" :key="t" :value="t" />
          </datalist>
        </div>
        <div class="field">
          <label for="pa-key">Key</label>
          <input id="pa-key" v-model="form.key" class="input" :disabled="!!editing" autocomplete="off"
            placeholder="nama_parameter" />
        </div>
      </div>

      <div class="field">
        <label for="pa-type">Tipe</label>
        <select id="pa-type" v-model="form.valueType" class="input" :disabled="!!editing">
          <option value="text">Teks</option>
          <option value="number">Angka</option>
          <option value="boolean">Boolean (Ya/Tidak)</option>
          <option value="secret">Rahasia (terenkripsi)</option>
        </select>
      </div>

      <div v-if="!editing?.isSystem && form.valueType === 'text'" class="field">
        <label for="pa-options">Pilihan (opsional, pisahkan dengan koma)</label>
        <input id="pa-options" v-model="form.optionsText" class="input" placeholder="ip, username, both" />
      </div>
      <div v-if="!editing?.isSystem && form.valueType === 'number'" class="form-grid">
        <div class="field">
          <label for="pa-min">Nilai minimum</label>
          <input id="pa-min" v-model="form.numMin" class="input" inputmode="numeric" />
        </div>
        <div class="field">
          <label for="pa-max">Nilai maksimum</label>
          <input id="pa-max" v-model="form.numMax" class="input" inputmode="numeric" />
        </div>
      </div>

      <div class="field">
        <label for="pa-value">Nilai</label>
        <select v-if="form.valueType === 'boolean'" id="pa-value" v-model="form.value" class="input">
          <option value="true">Ya (true)</option>
          <option value="false">Tidak (false)</option>
        </select>
        <select v-else-if="optionList" id="pa-value" v-model="form.value" class="input">
          <option v-for="o in optionList" :key="o" :value="o">{{ o }}</option>
        </select>
        <input v-else-if="form.valueType === 'secret'" id="pa-value" v-model="form.value" type="password" class="input"
          autocomplete="new-password" :placeholder="editing?.hasValue ? 'Kosongkan jika tidak diganti' : ''" />
        <input v-else id="pa-value" v-model="form.value" class="input" autocomplete="off"
          :inputmode="form.valueType === 'number' ? 'numeric' : undefined" />
      </div>
      <label v-if="editing?.valueType === 'secret' && editing.hasValue" class="check">
        <input v-model="form.clearSecret" type="checkbox" />
        <span>Hapus nilai yang tersimpan</span>
      </label>

      <div class="field">
        <label for="pa-desc">Deskripsi</label>
        <input id="pa-desc" v-model="form.description" class="input" />
      </div>
      <p v-if="editing?.isSystem" class="muted hint">
        Parameter sistem: group, key, tipe, dan batas terkunci. Nilai dan deskripsi boleh diubah.
      </p>
    </form>
    <template #footer>
      <button type="button" class="btn btn-ghost" @click="formOpen = false">Batal</button>
      <button type="submit" form="param-form" class="btn btn-primary" :disabled="saving">
        {{ saving ? 'Menyimpan...' : 'Simpan' }}
      </button>
    </template>
  </BaseModal>

  <!-- Konfirmasi hapus -->
  <BaseModal :open="deleting !== null" title="Hapus parameter" @close="deleting = null">
    <p v-if="deleteError" class="alert" role="alert">{{ deleteError }}</p>
    <p>Hapus parameter <strong>{{ deleting?.groupCode }}.{{ deleting?.key }}</strong>?</p>
    <template #footer>
      <button type="button" class="btn btn-ghost" @click="deleting = null">Batal</button>
      <button type="button" class="btn btn-danger" :disabled="busy" @click="confirmDelete">
        {{ busy ? 'Menghapus...' : 'Hapus' }}
      </button>
    </template>
  </BaseModal>
</template>