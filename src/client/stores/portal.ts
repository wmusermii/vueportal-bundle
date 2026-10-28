import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { api } from '@/api'

export const usePortalStore = defineStore('portal', () => {
  const name = ref('Portal')
  const supportEmail = ref('')
  const maintenance = ref(false)
  const initial = computed(() => name.value.trim().charAt(0).toUpperCase() || 'P')

  async function load() {
    try {
      const d = await api.get<{ name: string; supportEmail: string; maintenance: boolean }>('/api/public/portal')
      name.value = d.name
      supportEmail.value = d.supportEmail
      maintenance.value = d.maintenance
      document.title = d.name
    } catch {
      /* pakai nilai bawaan */
    }
  }

  return { name, supportEmail, maintenance, initial, load }
})