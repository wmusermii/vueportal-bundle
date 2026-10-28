import { ref } from 'vue'
import { defineStore } from 'pinia'
import { api } from '@/api'

export type Action = 'create' | 'read' | 'update' | 'delete'

export interface User { id: string; username: string; fullName: string }
export interface Permission { menu: string; create: boolean; read: boolean; update: boolean; delete: boolean }
export interface MenuNode {
  id: string; code: string; title: string
  type: 'folder' | 'page'; path: string | null; icon: string | null
  children: MenuNode[]
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null)
  const permissions = ref<Permission[]>([])
  const menus = ref<MenuNode[]>([])
  const loaded = ref(false)

  const can = (menu: string, action: Action) =>
    permissions.value.some((p) => p.menu === menu && p[action])

  function reset() {
    user.value = null
    permissions.value = []
    menus.value = []
  }

  async function fetchSession() {
    try {
      const [me, tree] = await Promise.all([
        api.get<{ user: User; permissions: Permission[] }>('/api/auth/me'),
        api.get<MenuNode[]>('/api/menus/mine'),
      ])
      user.value = me.user
      permissions.value = me.permissions
      menus.value = tree
    } catch {
      reset()
    } finally {
      loaded.value = true
    }
  }

  async function login(username: string, password: string) {
    await api.post('/api/auth/login', { username, password })
    await fetchSession()
  }

  async function logout() {
    await api.post('/api/auth/logout')
    reset()
  }

  return { user, permissions, menus, loaded, can, fetchSession, login, logout, reset }
})