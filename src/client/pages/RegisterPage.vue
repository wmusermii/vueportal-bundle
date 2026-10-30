<script setup lang="ts">
import { ref } from 'vue'
import { api, ApiError } from '@/api'
import { usePortalStore } from '@/stores/portal'

const portal = usePortalStore()

const fullName = ref('')
const username = ref('')
const email = ref('')
const password = ref('')
const confirm = ref('')
const showPassword = ref(false)
const error = ref('')
const loading = ref(false)
const done = ref('')

async function submit() {
  error.value = ''
  if (password.value !== confirm.value) {
    error.value = 'Konfirmasi password tidak sama'
    return
  }
  loading.value = true
  try {
    const res = await api.post<{ message: string }>('/api/register', {
      fullName: fullName.value,
      username: username.value,
      email: email.value,
      password: password.value,
    })
    password.value = ''
    confirm.value = ''
    done.value = res.message
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'Tidak dapat terhubung ke server'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login">
    <aside class="login-aside">
      <div class="brand"><span class="brand-mark">{{ portal.initial }}</span>{{ portal.name }}</div>
      <p class="login-tagline">Daftar akun baru. Akun aktif setelah disetujui administrator atau manager.</p>
    </aside>
    <section class="login-main">
  <RouterLink class="back-link" :to="{ name: 'login' }">
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M15 18l-6-6 6-6" />
    </svg>
    Kembali
  </RouterLink>

  <div v-if="done" class="login-form">
        <h1>Pendaftaran terkirim</h1>
        <p class="alert alert-info" role="status">{{ done }}</p>
        <RouterLink class="btn btn-primary btn-block" :to="{ name: 'login' }">Kembali ke halaman masuk</RouterLink>
      </div>

      <form v-else class="login-form" @submit.prevent="submit">
        <h1>Daftar</h1>
        <p class="muted">Isi data berikut untuk mengajukan akun.</p>

        <div class="field">
          <label for="fullName">Nama lengkap</label>
          <input id="fullName" v-model.trim="fullName" class="input" autocomplete="name" maxlength="100" required />
        </div>
        <div class="field">
          <label for="username">Username</label>
          <input id="username" v-model.trim="username" class="input" autocomplete="username" maxlength="50" required />
          <small class="muted">Huruf kecil, angka, titik, atau underscore (3-50 karakter).</small>
        </div>
        <div class="field">
          <label for="email">Email</label>
          <input id="email" v-model.trim="email" class="input" type="email" autocomplete="email" maxlength="150" required />
        </div>
        <div class="field">
          <label for="password">Password</label>
          <div class="input-wrap">
            <input id="password" v-model="password" class="input" :type="showPassword ? 'text' : 'password'"
              autocomplete="new-password" required />
            <button type="button" class="input-toggle"
              :aria-label="showPassword ? 'Sembunyikan password' : 'Tampilkan password'" :aria-pressed="showPassword"
              @click="showPassword = !showPassword">
              <svg v-if="!showPassword" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
                stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
                stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M3 3l18 18" />
                <path
                  d="M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6A16.5 16.5 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 4.3-1M9.9 9.9a3 3 0 0 0 4.2 4.2" />
              </svg>
            </button>
          </div>
        </div>
        <div class="field">
          <label for="confirm">Ulangi password</label>
          <input id="confirm" v-model="confirm" class="input" :type="showPassword ? 'text' : 'password'"
            autocomplete="new-password" required />
        </div>

        <p v-if="error" class="alert" role="alert">{{ error }}</p>
        <button class="btn btn-primary btn-block" :disabled="loading">
          {{ loading ? 'Memproses...' : 'Kirim pendaftaran' }}
        </button>
        <p class="muted hint">
          Sudah punya akun? <RouterLink :to="{ name: 'login' }">Masuk</RouterLink>
        </p>
      </form>
    </section>
  </div>
</template>
<style scoped>
.login-main { position: relative; }
.back-link {
  position: absolute;
  top: 20px;
  left: 20px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 14px;
  color: #4b5563;
  text-decoration: none;
}
.back-link:hover { color: #16a34a; }
</style>