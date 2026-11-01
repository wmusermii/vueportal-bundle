<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { api, ApiError } from '@/api'
import { useAuthStore } from '@/stores/auth'
import { applyColors, setImage, type ImgKey } from '@/theme'

const auth = useAuthStore()
const canEdit = computed(() => auth.can('portal', 'update'))

type ColorKey =
  | 'primary_color' | 'primary_text_color' | 'accent_color' | 'sidebar_text_color'
  | 'background_color' | 'surface_color' | 'text_color' | 'text_muted_color'
  | 'border_color' | 'login_bg_color' | 'success_color' | 'warning_color' | 'danger_color'

// nilai bawaan = nilai :root di style.css
const DEFAULTS = {
  primary_color: '#0d807a', primary_text_color: '#ffffff', accent_color: '#e5a823',
  sidebar_color: '', sidebar_text_color: '#ffffff',
  background_color: '#f2f5f4', surface_color: '#ffffff', text_color: '#14282c',
  text_muted_color: '#55696d', border_color: '#dde4e2', login_bg_color: '#f2f5f4',
  success_color: '#067647', warning_color: '#8a5a00', danger_color: '#b42318',
  border_radius: 8,
}

const SECTIONS: { id: string; title: string; items: { key: ColorKey; label: string; hint: string }[] }[] = [
  { id: 'main', title: 'Warna utama', items: [
    { key: 'primary_color', label: 'Warna utama', hint: 'Tombol, tab dan link aktif, avatar' },
    { key: 'primary_text_color', label: 'Teks di atas warna utama', hint: 'Tulisan pada tombol dan avatar' },
    { key: 'accent_color', label: 'Warna aksen', hint: 'Penanda menu aktif dan kotak inisial' },
  ] },
  { id: 'sidebar', title: 'Sidebar', items: [
    { key: 'sidebar_text_color', label: 'Teks sidebar', hint: 'Menu, ikon, dan garis ikut dihitung dari warna ini' },
  ] },
  { id: 'page', title: 'Halaman', items: [
    { key: 'background_color', label: 'Latar halaman', hint: '' },
    { key: 'surface_color', label: 'Kartu, topbar, dan kolom isian', hint: '' },
    { key: 'text_color', label: 'Teks utama', hint: '' },
    { key: 'text_muted_color', label: 'Teks sekunder', hint: 'Deskripsi dan keterangan' },
    { key: 'border_color', label: 'Garis dan border', hint: '' },
    { key: 'login_bg_color', label: 'Latar halaman login', hint: 'Sisi kanan, tempat form' },
  ] },
  { id: 'status', title: 'Status', items: [
    { key: 'success_color', label: 'Berhasil / aktif', hint: '' },
    { key: 'warning_color', label: 'Peringatan', hint: '' },
    { key: 'danger_color', label: 'Bahaya / hapus / galat', hint: '' },
  ] },
]
const COLOR_KEYS = SECTIONS.flatMap((s) => s.items.map((i) => i.key))

const IMAGES: { key: ImgKey; label: string; hint: string; max: number; accept: string }[] = [
  { key: 'logo', label: 'Logo (pojok kiri atas)', hint: 'PNG/JPG/WebP, maks 512 KB. Disarankan persegi.', max: 512 * 1024, accept: 'image/png,image/jpeg,image/webp' },
  { key: 'favicon', label: 'Favicon (tab browser)', hint: 'PNG atau ICO, maks 256 KB.', max: 256 * 1024, accept: 'image/png,.ico' },
  { key: 'login_image', label: 'Gambar halaman login (kiri form)', hint: 'PNG/JPG/WebP, maks 2 MB.', max: 2 * 1024 * 1024, accept: 'image/png,image/jpeg,image/webp' },
]

const loading = ref(true)
const saving = ref(false)
const err = ref('')
const okMsg = ref('')

const form = reactive<Record<ColorKey | 'sidebar_color', string> & { border_radius: number }>({ ...DEFAULTS })
const sidebarFollow = ref(true)
const images = reactive<Record<ImgKey, string>>({ logo: '', favicon: '', login_image: '' })

const HEX = /^#[0-9a-fA-F]{6}$/
const valid = computed(
  () => COLOR_KEYS.every((k) => HEX.test(form[k])) && (sidebarFollow.value || HEX.test(form.sidebar_color)),
)

const current = () => ({
  ...Object.fromEntries(COLOR_KEYS.map((k) => [k, form[k]])),
  sidebar_color: sidebarFollow.value ? '' : form.sidebar_color,
  border_radius: Number(form.border_radius),
})

const msg = (e: unknown) =>
  e instanceof ApiError || e instanceof Error ? e.message : 'Tidak dapat terhubung ke server'

async function load() {
  loading.value = true
  err.value = ''
  try {
    const t = await api.get<Record<string, string>>('/api/public/theme')
    for (const k of COLOR_KEYS) form[k] = t[k] || DEFAULTS[k]
    sidebarFollow.value = !t.sidebar_color
    form.sidebar_color = t.sidebar_color || form.primary_color
    form.border_radius = Number(t.border_radius ?? DEFAULTS.border_radius)
    images.logo = t.logo_url ?? ''
    images.favicon = t.favicon_url ?? ''
    images.login_image = t.login_image_url ?? ''
  } catch (e) {
    err.value = msg(e)
  } finally {
    loading.value = false
  }
}
onMounted(load)

// pratinjau langsung di halaman ini (belum tersimpan sebelum klik Simpan)
watch([form, sidebarFollow], () => applyColors(current()), { deep: true })
watch(sidebarFollow, (follow) => {
  if (!follow && !HEX.test(form.sidebar_color)) form.sidebar_color = form.primary_color
})

function resetDefaults() {
  Object.assign(form, DEFAULTS, { sidebar_color: DEFAULTS.primary_color })
  sidebarFollow.value = true
  okMsg.value = 'Nilai bawaan dimuat sebagai pratinjau. Klik Simpan untuk menerapkan.'
}

async function save() {
  saving.value = true
  err.value = ''
  okMsg.value = ''
  try {
    await api.put('/api/theme', current())
    okMsg.value = 'Tersimpan. Pengguna lain melihat perubahan setelah memuat ulang halaman.'
  } catch (e) {
    err.value = msg(e)
  } finally {
    saving.value = false
  }
}

// ---- gambar: tersimpan langsung saat dipilih ----
const uploading = ref<ImgKey | ''>('')

async function upload(im: (typeof IMAGES)[number], e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  err.value = ''
  okMsg.value = ''
  if (file.size > im.max) {
    err.value = `Ukuran file maksimal ${im.max / 1024} KB`
    return
  }
  const mime = file.name.toLowerCase().endsWith('.ico') ? 'image/x-icon' : file.type
  uploading.value = im.key
  try {
    const res = await fetch(`/api/theme/asset/${im.key}`, {
      method: 'PUT',
      headers: { 'Content-Type': mime },
      body: file,
      credentials: 'same-origin',
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.message ?? 'Gagal mengunggah gambar')
    images[im.key] = data.url
    setImage(im.key, data.url)
    okMsg.value = `${im.label} tersimpan.`
  } catch (e2) {
    err.value = msg(e2)
  } finally {
    uploading.value = ''
  }
}

async function removeImage(im: (typeof IMAGES)[number]) {
  err.value = ''
  okMsg.value = ''
  try {
    await api.delete(`/api/theme/asset/${im.key}`)
    images[im.key] = ''
    setImage(im.key, '')
    okMsg.value = `${im.label} dikembalikan ke bawaan.`
  } catch (e) {
    err.value = msg(e)
  }
}
</script>

<template>
  <div role="tabpanel" aria-labelledby="tab-themes">
    <p class="muted tab-hint">
      Tampilan portal untuk semua pengguna. Warna tampil sebagai pratinjau dan baru tersimpan setelah klik Simpan.
      Gambar tersimpan langsung saat dipilih.
    </p>

    <div class="pad">
      <p v-if="err" class="alert" role="alert">{{ err }}</p>
      <p v-if="okMsg" class="alert alert-ok" role="status">{{ okMsg }}</p>
      <p v-if="loading" class="muted">Memuat...</p>

      <template v-else>
        <form @submit.prevent="save">
          <section v-for="s in SECTIONS" :key="s.id">
            <h2 class="sect">{{ s.title }}</h2>
            <div class="theme-grid">
              <div v-if="s.id === 'sidebar'" class="field">
                <label for="th-sidebar_color">Warna sidebar</label>
                <label class="check">
                  <input v-model="sidebarFollow" type="checkbox" :disabled="!canEdit" />
                  <span>Ikuti warna utama</span>
                </label>
                <div v-if="!sidebarFollow" class="color-row">
                  <input id="th-sidebar_color" v-model="form.sidebar_color" type="color" class="color-pick" :disabled="!canEdit" />
                  <input v-model="form.sidebar_color" class="input" maxlength="7" autocomplete="off" aria-label="Kode warna sidebar" :disabled="!canEdit" />
                </div>
              </div>

              <div v-for="it in s.items" :key="it.key" class="field">
                <label :for="`th-${it.key}`">{{ it.label }}</label>
                <div class="color-row">
                  <input :id="`th-${it.key}`" v-model="form[it.key]" type="color" class="color-pick" :disabled="!canEdit" />
                  <input v-model="form[it.key]" class="input" maxlength="7" autocomplete="off" :aria-label="`Kode warna ${it.label}`" :disabled="!canEdit" />
                </div>
                <div v-if="it.hint" class="muted cell-sub">{{ it.hint }}</div>
              </div>
            </div>
          </section>

          <h2 class="sect">Bentuk</h2>
          <div class="field">
            <label for="th-radius">Kelengkungan sudut: {{ form.border_radius }}px</label>
            <input id="th-radius" v-model.number="form.border_radius" type="range" min="0" max="24" step="1" :disabled="!canEdit" />
          </div>

          <div v-if="canEdit" class="form-actions">
            <button type="submit" class="btn btn-primary" :disabled="saving || !valid">
              {{ saving ? 'Menyimpan...' : 'Simpan' }}
            </button>
            <button type="button" class="btn btn-ghost" :disabled="saving" @click="load">Batal</button>
            <button type="button" class="btn btn-ghost" :disabled="saving" @click="resetDefaults">Reset ke bawaan</button>
          </div>
        </form>

        <h2 class="sect">Gambar</h2>
        <div class="img-list">
          <div v-for="im in IMAGES" :key="im.key" class="img-card">
            <div class="img-box">
              <img v-if="images[im.key]" :src="images[im.key]" alt="" />
              <span v-else class="muted cell-sub">Bawaan</span>
            </div>
            <div>
              <strong>{{ im.label }}</strong>
              <div class="muted cell-sub">{{ im.hint }}</div>
              <div v-if="canEdit" class="img-actions">
                <label class="btn btn-ghost btn-sm">
                  {{ uploading === im.key ? 'Mengunggah...' : 'Pilih gambar' }}
                  <input type="file" class="sr-only" :accept="im.accept" :disabled="uploading !== ''" @change="upload(im, $event)" />
                </label>
                <button v-if="images[im.key]" type="button" class="btn btn-ghost btn-sm btn-text-danger" @click="removeImage(im)">
                  Hapus
                </button>
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.pad { padding: 16px 20px 20px; }
.sect { margin: 22px 0 10px; }
.pad > form > section:first-child .sect { margin-top: 4px; }
.theme-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 0 24px; }
.color-row { display: flex; align-items: center; gap: 8px; }
.color-row .input { max-width: 130px; }
.color-pick {
  width: 44px; height: 38px; padding: 2px; cursor: pointer;
  background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius);
}
.form-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.img-list { display: grid; gap: 12px; }
.img-card {
  display: flex; align-items: center; gap: 16px; padding: 12px;
  border: 1px solid var(--line); border-radius: var(--radius-lg);
}
.img-box {
  display: grid; place-items: center; flex: none; width: 120px; height: 80px; overflow: hidden;
  background: var(--surface-2); border-radius: var(--radius);
}
.img-box img { max-width: 100%; max-height: 100%; object-fit: contain; }
.img-actions { display: flex; gap: 8px; margin-top: 8px; }
.img-actions label { position: relative; }
.img-actions label:focus-within { outline: 2px solid var(--focus); outline-offset: 2px; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>