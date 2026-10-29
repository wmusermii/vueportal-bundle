import '@fontsource-variable/plus-jakarta-sans'
import './style.css'
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { setUnauthorizedHandler } from './api'
import { useAuthStore } from './stores/auth'
import { usePortalStore } from './stores/portal'

import { disconnectSocket } from './lib/socket'
// pinia harus dipasang sebelum router, karena guard memakai store
const pinia = createPinia()
const app = createApp(App).use(pinia).use(router)

// sesi berakhir saat aplikasi dipakai: kembali ke halaman login
// setUnauthorizedHandler(() => {
//   const auth = useAuthStore()
//   if (!auth.user) return
//   auth.reset()
//   router.replace({ name: 'login', query: { redirect: router.currentRoute.value.fullPath, expired: '1' } })
// })
setUnauthorizedHandler(() => {
  const auth = useAuthStore()
  if (!auth.user) return
  disconnectSocket()
  auth.reset()
  router.replace({ name: 'login', query: { redirect: router.currentRoute.value.fullPath, expired: '1' } })
})

void usePortalStore().load()
app.mount('#app')