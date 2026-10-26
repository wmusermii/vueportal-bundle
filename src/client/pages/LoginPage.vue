<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ApiError } from '@/api'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()

const username = ref('')
const password = ref('')
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
  <div style="max-width:320px;margin:80px auto">
    <h2>Masuk</h2>
    <form @submit.prevent="submit">
      <p><input v-model="username" placeholder="Username" autocomplete="username" style="width:100%" /></p>
      <p><input v-model="password" type="password" placeholder="Password" autocomplete="current-password" style="width:100%" /></p>
      <p v-if="error" style="color:#c00">{{ error }}</p>
      <button :disabled="loading">{{ loading ? 'Memproses...' : 'Masuk' }}</button>
    </form>
  </div>
</template>