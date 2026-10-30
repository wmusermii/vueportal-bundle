<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ApiError } from '@/api'
import { useAuthStore } from '@/stores/auth'
import { usePortalStore } from '@/stores/portal'
const portal = usePortalStore()
const auth = useAuthStore()
const router = useRouter()
const route = useRoute()

const username = ref('')
const password = ref('')
const showPassword = ref(false)
const error = ref('')
const loading = ref(false)

async function submit() {
  error.value = ''
  loading.value = true
  try {
    await auth.login(username.value, password.value)
    const r = route.query.redirect
    // hanya terima path internal, tolak URL ke situs lain
    const target = typeof r === 'string' && r.startsWith('/') && !r.startsWith('//') ? r : '/dashboard'
    await router.replace(target)
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
      <p class="login-tagline">Simple Administrator Themes By Vue 3.5 & Express.</p>
    </aside>
    <section class="login-main">
      <form class="login-form" @submit.prevent="submit">
        <h1>Masuk</h1>
        <p class="muted">Gunakan akun dari administrator.</p>
        <p v-if="route.query.expired" class="alert alert-info" role="status">
          Sesi Anda telah berakhir. Silakan masuk lagi.
        </p>
        <p v-if="portal.maintenance" class="alert alert-warn" role="status">
          Portal sedang dalam pemeliharaan. Hanya administrator yang dapat masuk.
        </p>
        <div class="field">
          <label for="username">Username</label>
          <input id="username" v-model="username" class="input" autocomplete="username" autofocus />
        </div>
        <div class="field">
          <label for="password">Password</label>
          <div class="input-wrap">
            <input id="password" v-model="password" class="input" :type="showPassword ? 'text' : 'password'"
              autocomplete="current-password" />
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
        <p v-if="error" class="alert" role="alert">{{ error }}</p>
        <button class="btn btn-primary btn-block" :disabled="loading">
          {{ loading ? 'Memproses...' : 'Masuk' }}
       </button>
        <!-- <p v-if="portal.supportEmail" class="muted hint">
          Butuh bantuan? Hubungi <a :href="`mailto:${portal.supportEmail}`">{{ portal.supportEmail }}</a>.
        </p> -->
        <p class="muted hint">
          Belum punya akun? <RouterLink :to="{ name: 'register' }">Daftar</RouterLink>
        </p>
      </form>
    </section>
  </div>
</template>