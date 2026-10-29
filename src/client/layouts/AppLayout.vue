<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import SidebarItem from '@/components/SidebarItem.vue'
import { usePortalStore } from '@/stores/portal'

import { connectSocket, disconnectSocket } from '@/lib/socket'

const portal = usePortalStore()
const auth = useAuthStore()
const router = useRouter()
const route = useRoute()

const sidebarOpen = ref(false) // laci di layar kecil
const menuOpen = ref(false)
const menuEl = ref<HTMLElement | null>(null)

// ciutkan sidebar (desktop), pilihan diingat di browser
function readCollapsed() {
  try {
    return localStorage.getItem('sidebar-collapsed') === '1'
  } catch {
    return false
  }
}
const collapsed = ref(readCollapsed())
watch(collapsed, (v) => {
  try {
    localStorage.setItem('sidebar-collapsed', v ? '1' : '0')
  } catch {
    /* penyimpanan tidak tersedia: abaikan */
  }
})

const mq = window.matchMedia('(min-width: 901px)')
const isDesktop = ref(mq.matches)
const onMq = (e: MediaQueryListEvent) => (isDesktop.value = e.matches)
const rail = computed(() => collapsed.value && isDesktop.value)

function toggleSidebar() {
  if (isDesktop.value) collapsed.value = !collapsed.value
  else sidebarOpen.value = true
}

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
onMounted(() => {
  mq.addEventListener('change', onMq)
  document.addEventListener('click', onDocClick)
  connectSocket()
})
onBeforeUnmount(() => {
  mq.removeEventListener('change', onMq)
  document.removeEventListener('click', onDocClick)
})

async function logout() {
  disconnectSocket()
  menuOpen.value = false
  await auth.logout()
  await router.replace({ name: 'login' })
}
</script>

<template>
  <div class="shell" :class="{ collapsed: rail }">
    <aside class="sidebar" :class="{ open: sidebarOpen }" aria-label="Menu utama">
      <div class="brand">
         <span class="brand-mark">{{ portal.initial }}</span>
         <span class="brand-text">{{ portal.name }}</span>
      </div>
      <nav class="nav">
        <ul>
          <SidebarItem
            v-for="m in auth.menus"
            :key="m.id"
            :node="m"
            :level="1"
            :collapsed="rail"
            @expand="collapsed = false"
          />
        </ul>
      </nav>
    </aside>
    <div v-if="sidebarOpen" class="scrim" @click="sidebarOpen = false"></div>
    <div class="main">
      <header class="topbar">
        <button
          class="btn btn-ghost icon-btn"
          :aria-label="isDesktop ? (rail ? 'Perluas sidebar' : 'Ciutkan sidebar') : 'Buka menu'"
          :aria-expanded="isDesktop ? !rail : sidebarOpen"
          @click="toggleSidebar"
        >
          <!-- <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M9 4v16" />
          </svg> -->
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M4 6h16M4 12h16M4 18h16" />
</svg>
        </button>

        <div class="topbar-right">
          <div ref="menuEl" class="user-menu" @keydown.esc="menuOpen = false">
            <button
              class="avatar-btn"
              aria-haspopup="menu"
              :aria-expanded="menuOpen"
              :title="auth.user?.fullName"
              :aria-label="`Menu akun ${auth.user?.fullName ?? ''}`"
              @click="menuOpen = !menuOpen"
            >
              <span class="avatar">{{ initials }}</span>
            </button>
            <div v-if="menuOpen" class="dropdown" role="menu">
              <router-link to="/profile" class="dropdown-item" role="menuitem">
                <span>Profil</span>
                <span class="avatar avatar-sm">{{ initials }}</span>
              </router-link>
              <button class="dropdown-item" role="menuitem" @click="logout">
                <span>Keluar</span>
                <svg class="dropdown-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
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