import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

declare module 'vue-router' {
  interface RouteMeta {
    public?: boolean
    menu?: string // kode menu yang harus punya izin read
  }
}

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: () => import('@/pages/LoginPage.vue'), meta: { public: true } },
    {
      path: '/',
      component: () => import('@/layouts/AppLayout.vue'),
      redirect: '/dashboard',
      children: [
        { path: 'dashboard', name: 'dashboard', component: () => import('@/pages/DashboardPage.vue'), meta: { menu: 'dashboard' } },
        { path: 'master/akses/users', name: 'users', component: () => import('@/pages/UsersPage.vue'), meta: { menu: 'users' } },
        { path: 'master/akses/groups', name: 'groups', component: () => import('@/pages/GroupsPage.vue'), meta: { menu: 'groups' } },
        { path: 'master/akses/menus', name: 'menus', component: () => import('@/pages/MenusPage.vue'), meta: { menu: 'menus' } },
        { path: 'forbidden', name: 'forbidden', component: () => import('@/pages/ForbiddenPage.vue') },
        { path: 'profile', name: 'profile', component: () => import('@/pages/ProfilePage.vue') },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/dashboard' },
  ],
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  if (!auth.loaded) await auth.fetchSession()

  if (to.meta.public) {
    return auth.user && to.name === 'login' ? { name: 'dashboard' } : true
  }
  if (!auth.user) return { name: 'login', query: { redirect: to.fullPath } }

  const menu = to.meta.menu
  if (menu && !auth.can(menu, 'read')) return { name: 'forbidden' }
  return true
})

export default router