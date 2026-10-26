<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const router = useRouter()

async function logout() {
  await auth.logout()
  await router.replace({ name: 'login' })
}
</script>

<template>
  <header style="display:flex;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #ddd">
    <strong>Komibank Portal</strong>
    <span>
      {{ auth.user?.fullName }}
      <button @click="logout">Keluar</button>
    </span>
  </header>
  <main style="padding:16px">
    <router-view />
  </main>
</template>