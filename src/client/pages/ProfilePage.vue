<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { api, ApiError } from '@/api'
import { useAuthStore } from '@/stores/auth'
import { loadPasswordPolicy, passwordHint } from '@/lib/usePasswordPolicy'
interface Profile {
  id: string
  username: string
  email: string
  fullName: string
  status: string
  lastLoginAt: string | null
  groups: { id: string; code: string; name: string }[]
}

const auth = useAuthStore()
const profile = ref<Profile | null>(null)
const loadError = ref('')

const info = reactive({ fullName: '', email: '' })
const infoSaving = ref(false)
const infoError = ref('')
const infoOk = ref('')

const pw = reactive({ current: '', next: '', confirm: '' })
const pwSaving = ref(false)
const pwError = ref('')
const pwOk = ref('')
const showPw = ref(false)

const msg = (e: unknown) => (e instanceof ApiError ? e.message : 'Tidak dapat terhubung ke server')

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : 'Belum pernah'

async function load() {
  try {
    const p = await api.get<Profile>('/api/profile')
    profile.value = p
    info.fullName = p.fullName
    info.email = p.email
  } catch (e) {
    loadError.value = msg(e)
  }
}
onMounted(() => {
  load()
  loadPasswordPolicy(true)
})

async function saveInfo() {
  infoError.value = ''
  infoOk.value = ''
  infoSaving.value = true
  try {
    await api.put('/api/profile', { fullName: info.fullName, email: info.email })
    await Promise.all([load(), auth.fetchSession()]) // nama di pojok kanan atas ikut diperbarui
    infoOk.value = 'Profil berhasil disimpan'
  } catch (e) {
    infoError.value = msg(e)
  } finally {
    infoSaving.value = false
  }
}

async function savePassword() {
  pwError.value = ''
  pwOk.value = ''
  
  if (pw.next !== pw.confirm) {
    pwError.value = 'Konfirmasi password tidak sama'
    return
  }
  pwSaving.value = true
  try {
    await api.put('/api/profile/password', { currentPassword: pw.current, newPassword: pw.next })
    Object.assign(pw, { current: '', next: '', confirm: '' })
    pwOk.value = 'Password berhasil diganti'
  } catch (e) {
    pwError.value = msg(e)
  } finally {
    pwSaving.value = false
  }
}
</script>

<template>
  <div class="page-head">
    <h1>Profil</h1>
    <p>Kelola data akun dan password Anda.</p>
  </div>

  <p v-if="loadError" class="alert" role="alert">{{ loadError }}</p>

  <div class="profile-grid">
    <section class="panel">
      <h2>Data akun</h2>
      <form @submit.prevent="saveInfo">
        <p v-if="infoError" class="alert" role="alert">{{ infoError }}</p>
        <p v-if="infoOk" class="alert alert-ok" role="status">{{ infoOk }}</p>

        <div class="field">
          <label for="p-username">Username</label>
          <input id="p-username" class="input" :value="profile?.username" disabled />
        </div>
        <div class="field">
          <label for="p-name">Nama lengkap</label>
          <input id="p-name" v-model="info.fullName" class="input" />
        </div>
        <div class="field">
          <label for="p-email">Email</label>
          <input id="p-email" v-model="info.email" type="email" class="input" />
        </div>
        <div class="field">
          <span class="label">Group</span>
          <div>
            <span v-for="g in profile?.groups" :key="g.id" class="chip">{{ g.name }}</span>
            <span v-if="profile && profile.groups.length === 0" class="muted">Belum ada group</span>
          </div>
          <p class="muted hint">Group hanya dapat diubah oleh administrator.</p>
        </div>
        <div class="field">
          <span class="label">Login terakhir</span>
          <div>{{ fmtDate(profile?.lastLoginAt ?? null) }}</div>
        </div>
        <button class="btn btn-primary" :disabled="infoSaving">
          {{ infoSaving ? 'Menyimpan...' : 'Simpan profil' }}
        </button>
      </form>
    </section>

    <section class="panel">
      <h2>Ganti password</h2>
      <form @submit.prevent="savePassword">
        <p v-if="pwError" class="alert" role="alert">{{ pwError }}</p>
        <p v-if="pwOk" class="alert alert-ok" role="status">{{ pwOk }}</p>

        <div class="field">
          <label for="pw-current">Password saat ini</label>
          <input id="pw-current" v-model="pw.current" :type="showPw ? 'text' : 'password'" class="input" autocomplete="current-password" />
        </div>
        <div class="field">
          <label for="pw-new">Password baru</label>
          <input id="pw-new" v-model="pw.next" :type="showPw ? 'text' : 'password'" class="input" autocomplete="new-password" placeholder="Minimal 8 karakter" />
          <p v-if="passwordHint" class="muted hint">{{ passwordHint }}</p>
        </div>
        <div class="field">
          <label for="pw-confirm">Ulangi password baru</label>
          <input id="pw-confirm" v-model="pw.confirm" :type="showPw ? 'text' : 'password'" class="input" autocomplete="new-password" />
        </div>
        <label class="check"><input v-model="showPw" type="checkbox" /> <span>Tampilkan password</span></label>
        <button class="btn btn-primary" :disabled="pwSaving">
          {{ pwSaving ? 'Menyimpan...' : 'Ganti password' }}
        </button>
      </form>
    </section>
  </div>
</template>