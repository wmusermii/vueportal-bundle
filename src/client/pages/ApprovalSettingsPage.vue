<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { api, ApiError } from '@/api'
import { useAuthStore } from '@/stores/auth'
import BaseModal from '@/components/BaseModal.vue'

interface Assignment {
  id: string
  role: 'approver' | 'editor'
  level: number
  kind: 'group' | 'user'
  refId: string
  label: string
  sub: string
}
interface TypeRow {
  id: string
  code: string
  name: string
  description: string | null
  isPublic: boolean
  assignments: Assignment[]
}
interface Options {
  groups: { id: string; code: string; name: string }[]
  users: { id: string; username: string; fullName: string }[]
}

const MAX_LEVEL = 5
const auth = useAuthStore()
const types = ref<TypeRow[]>([])
const options = ref<Options>({ groups: [], users: [] })
const loading = ref(true)
const pageError = ref('')

const canCreate = computed(() => auth.can('approval_settings', 'create'))
const canDelete = computed(() => auth.can('approval_settings', 'delete'))
const msg = (e: unknown) => (e instanceof ApiError ? e.message : 'Tidak dapat terhubung ke server')

async function load() {
  loading.value = true
  pageError.value = ''
  try {
    const [t, o] = await Promise.all([
      api.get<TypeRow[]>('/api/approval-settings'),
      api.get<Options>('/api/approval-settings/options'),
    ])
    types.value = t
    options.value = o
  } catch (e) {
    pageError.value = msg(e)
  } finally {
    loading.value = false
  }
}
onMounted(load)

function approverLevels(t: TypeRow) {
  const list = t.assignments.filter((a) => a.role === 'approver')
  const max = list.reduce((m, a) => Math.max(m, a.level), 0)
  return Array.from({ length: max }, (_, i) => ({
    level: i + 1,
    items: list.filter((a) => a.level === i + 1),
  }))
}
const editorsOf = (t: TypeRow) => t.assignments.filter((a) => a.role === 'editor')

// ---- tambah penugasan
const adding = ref<{ type: TypeRow; role: 'approver' | 'editor'; level: number } | null>(null)
const kind = ref<'group' | 'user'>('group')
const pick = ref('')
const formError = ref('')
const saving = ref(false)

function openAdd(type: TypeRow, role: 'approver' | 'editor', level: number) {
  adding.value = { type, role, level }
  kind.value = 'group'
  pick.value = ''
  formError.value = ''
}
watch(kind, () => (pick.value = ''))

// sembunyikan penerima yang sudah ditugaskan pada slot yang sama
const taken = computed(() => {
  const a = adding.value
  if (!a) return new Set<string>()
  return new Set(
    a.type.assignments.filter((x) => x.role === a.role && x.level === a.level).map((x) => `${x.kind}:${x.refId}`),
  )
})
const groupChoices = computed(() => options.value.groups.filter((g) => !taken.value.has(`group:${g.id}`)))
const userChoices = computed(() => options.value.users.filter((u) => !taken.value.has(`user:${u.id}`)))

async function save() {
  const a = adding.value
  if (!a) return
  if (!pick.value) {
    formError.value = 'Pilih penerima'
    return
  }
  saving.value = true
  formError.value = ''
  try {
    await api.post('/api/approval-settings/assignments', {
      typeId: a.type.id,
      role: a.role,
      level: a.level,
      ...(kind.value === 'group' ? { groupId: pick.value } : { userId: pick.value }),
    })
    adding.value = null
    await load()
  } catch (e) {
    formError.value = msg(e)
  } finally {
    saving.value = false
  }
}

// ---- hapus penugasan
const removing = ref<Assignment | null>(null)
const removeError = ref('')
const busy = ref(false)

function askRemove(a: Assignment) {
  removeError.value = ''
  removing.value = a
}
async function confirmRemove() {
  if (!removing.value) return
  busy.value = true
  removeError.value = ''
  try {
    await api.delete(`/api/approval-settings/assignments/${removing.value.id}`)
    removing.value = null
    await load()
  } catch (e) {
    removeError.value = msg(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="page-head">
    <h1>Pengaturan Approval</h1>
    <p>Tentukan siapa yang mengajukan (Editor) dan siapa yang memutuskan (Approver), bertingkat per level.</p>
  </div>

  <p v-if="pageError" class="alert" role="alert">{{ pageError }}</p>
  <p class="alert alert-info" role="status">
    Administrator selalu boleh memutuskan di semua tahap dan tidak perlu ditugaskan.
  </p>
  <p v-if="loading" class="muted">Memuat...</p>

  <section v-for="t in types" :key="t.id" class="panel ty">
    <header class="ty-head">
      <div>
        <h2>{{ t.name }}</h2>
        <p class="muted">{{ t.description || t.code }}</p>
      </div>
      <span class="badge" :class="t.isPublic ? 'badge-ok' : 'badge-off'">
        {{ t.isPublic ? 'Pengajuan publik' : 'Perlu login' }}
      </span>
    </header>

    <h3 class="sec">Approver</h3>
    <p v-if="approverLevels(t).length === 0" class="alert alert-warn">
      Belum ada approver. Pengajuan jenis ini belum bisa dibuat.
    </p>
    <div v-for="lv in approverLevels(t)" :key="lv.level" class="lv">
      <div class="lv-title">Level {{ lv.level }}</div>
      <div class="lv-items">
        <span v-for="a in lv.items" :key="a.id" class="pill">
          <small class="kind">{{ a.kind === 'group' ? 'Group' : 'User' }}</small>
          {{ a.label }}
          <button v-if="canDelete" type="button" class="x" :aria-label="`Hapus ${a.label}`" @click="askRemove(a)">×</button>
        </span>
        <button v-if="canCreate" type="button" class="btn btn-ghost btn-sm" @click="openAdd(t, 'approver', lv.level)">
          + Tambah
        </button>
      </div>
    </div>
    <button v-if="canCreate && approverLevels(t).length < MAX_LEVEL" type="button" class="btn btn-ghost btn-sm"
      @click="openAdd(t, 'approver', approverLevels(t).length + 1)">
      {{ approverLevels(t).length === 0 ? '+ Tambah approver' : `+ Tambah level ${approverLevels(t).length + 1}` }}
    </button>
    <p class="muted hint">
      Satu orang di level yang sedang berjalan cukup untuk meneruskan ke level berikutnya; setelah level terakhir
      disetujui, pengajuan dijalankan. Jumlah level suatu pengajuan ditetapkan saat diajukan, jadi mengubah
      pengaturan ini tidak mengubah jumlah tahap pengajuan yang sedang berjalan.
    </p>

    <h3 class="sec">Editor (yang boleh mengajukan)</h3>
    <p v-if="t.isPublic" class="muted">Tidak diperlukan. Pengajuan jenis ini terbuka untuk publik.</p>
    <div v-else class="lv-items">
      <span v-for="a in editorsOf(t)" :key="a.id" class="pill">
        <small class="kind">{{ a.kind === 'group' ? 'Group' : 'User' }}</small>
        {{ a.label }}
        <button v-if="canDelete" type="button" class="x" :aria-label="`Hapus ${a.label}`" @click="askRemove(a)">×</button>
      </span>
      <span v-if="editorsOf(t).length === 0" class="muted">Belum ada editor (selain Administrator).</span>
      <button v-if="canCreate" type="button" class="btn btn-ghost btn-sm" @click="openAdd(t, 'editor', 0)">
        + Tambah
      </button>
    </div>
  </section>

  <!-- Tambah penugasan -->
  <BaseModal :open="adding !== null"
    :title="adding ? (adding.role === 'approver' ? `Tambah approver level ${adding.level}` : 'Tambah editor') : ''"
    @close="adding = null">
    <form id="assign-form" @submit.prevent="save">
      <p v-if="formError" class="alert" role="alert">{{ formError }}</p>
      <p class="muted">{{ adding?.type.name }}</p>
      <div class="field">
        <label for="as-kind">Berikan kepada</label>
        <select id="as-kind" v-model="kind" class="input">
          <option value="group">Group (semua anggotanya)</option>
          <option value="user">User tertentu</option>
        </select>
      </div>
      <div class="field">
        <label for="as-pick">{{ kind === 'group' ? 'Group' : 'User' }}</label>
        <select id="as-pick" v-model="pick" class="input">
          <option value="">Pilih...</option>
          <template v-if="kind === 'group'">
            <option v-for="g in groupChoices" :key="g.id" :value="g.id">{{ g.name }}</option>
          </template>
          <template v-else>
            <option v-for="u in userChoices" :key="u.id" :value="u.id">{{ u.fullName }} ({{ u.username }})</option>
          </template>
        </select>
      </div>
      <p class="muted hint">
        Disarankan memakai Group: pindahkan orang ke group itu dan haknya ikut, tanpa mengubah pengaturan ini.
        Pakai User untuk pengecualian.
      </p>
    </form>
    <template #footer>
      <button type="button" class="btn btn-ghost" @click="adding = null">Batal</button>
      <button type="submit" form="assign-form" class="btn btn-primary" :disabled="saving">
        {{ saving ? 'Menyimpan...' : 'Simpan' }}
      </button>
    </template>
  </BaseModal>

  <!-- Konfirmasi hapus -->
  <BaseModal :open="removing !== null" title="Hapus penugasan" @close="removing = null">
    <p v-if="removeError" class="alert" role="alert">{{ removeError }}</p>
    <p>
      Hapus <strong>{{ removing?.label }}</strong> dari
      {{ removing?.role === 'approver' ? `approver level ${removing?.level}` : 'editor' }}?
    </p>
    <template #footer>
      <button type="button" class="btn btn-ghost" @click="removing = null">Batal</button>
      <button type="button" class="btn btn-danger" :disabled="busy" @click="confirmRemove">
        {{ busy ? 'Menghapus...' : 'Hapus' }}
      </button>
    </template>
  </BaseModal>
</template>

<style scoped>
.ty { margin-bottom: 16px; padding: 20px; }
.ty-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
.ty-head h2 { margin: 0; font-size: 17px; }
.ty-head p { margin: 4px 0 0; }
.sec { margin: 18px 0 8px; font-size: 14px; }
.lv { display: flex; gap: 12px; align-items: flex-start; padding: 8px 0; border-top: 1px dashed #e5e7eb; }
.lv-title { width: 70px; flex: none; font-size: 13px; font-weight: 600; color: #374151; padding-top: 6px; }
.lv-items { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.pill { display: inline-flex; align-items: center; gap: 6px; padding: 4px 6px 4px 10px; border: 1px solid #d1d5db; border-radius: 999px; font-size: 13px; background: #f9fafb; }
.kind { color: #6b7280; font-size: 11px; text-transform: uppercase; }
.x { border: 0; background: transparent; cursor: pointer; font-size: 16px; line-height: 1; color: #9ca3af; padding: 0 4px; }
.x:hover { color: #b91c1c; }
</style>