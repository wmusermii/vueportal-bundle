<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import SidebarItem from '@/components/SidebarItem.vue'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()
const sidebarOpen = ref(false)
const menuOpen = ref(false)
const menuEl = ref<HTMLElement | null>(null)

const initials = computed(() =>
  (auth.user?.fullName ?? '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join(''),
)

watch(
  () => route.path,
  () => {
    sidebarOpen.value = false
    menuOpen.value = false
  },
)

// tutup dropdown saat klik di luar
function onDocClick(e: MouseEvent) {
  if (menuEl.value && !menuEl.value.contains(e.target as Node)) menuOpen.value = false
}
onMounted(() => document.addEventListener('click', onDocClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))

async function logout() {
  menuOpen.value = false
  await auth.logout()
  await router.replace({ name: 'login' })
}
</script>

<template>
  <div class="shell">
    <aside class="sidebar" :class="{ open: sidebarOpen }" aria-label="Menu utama">
      <div class="brand"><span class="brand-mark">K</span>Komibank Portal</div>
      <nav class="nav">
        <ul>
          <SidebarItem v-for="m in auth.menus" :key="m.id" :node="m" :level="1" />
        </ul>
      </nav>
    </aside>
    <div v-if="sidebarOpen" class="scrim" @click="sidebarOpen = false"></div>

    <div class="main">
      <header class="topbar">
        <button class="btn btn-ghost menu-btn" @click="sidebarOpen = true">Menu</button>
        <div class="topbar-right">
          <div ref="menuEl" class="user-menu" @keydown.esc="menuOpen = false">
            <button class="avatar-btn" aria-haspopup="menu" :aria-expanded="menuOpen" :title="auth.user?.fullName"
              :aria-label="`Menu akun ${auth.user?.fullName ?? ''}`" @click="menuOpen = !menuOpen">
              <span class="avatar">{{ initials }}</span>
            </button>
            <div v-if="menuOpen" class="dropdown" role="menu">
              <router-link to="/profile" class="dropdown-item" role="menuitem">
                <span>Profil</span>
                <span class="avatar avatar-sm">{{ initials }}</span>
              </router-link>
              <button class="dropdown-item" role="menuitem" @click="logout">
                <span>Keluar</span>
                <svg class="dropdown-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
                  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3" />
                  <path d="M16 8l4 4-4 4M20 12H10" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </header>
      <main class="content"><router-view /></main>
    </div>
  </div>
</template>