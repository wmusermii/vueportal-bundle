import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'

// pinia harus dipasang sebelum router, karena guard memakai store
createApp(App).use(createPinia()).use(router).mount('#app')