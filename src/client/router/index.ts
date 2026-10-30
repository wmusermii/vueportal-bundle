import { createRouter, createWebHistory } from "vue-router";
import { useAuthStore } from "@/stores/auth";

declare module "vue-router" {
  interface RouteMeta {
    public?: boolean;
    menu?: string; // kode menu yang harus punya izin read
  }
}

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/login",
      name: "login",
      component: () => import("@/pages/LoginPage.vue"),
      meta: { public: true },
    },
    {
      path: "/register",
      name: "register",
      component: () => import("@/pages/RegisterPage.vue"),
      meta: { public: true },
    },
    {
      path: "/",
      component: () => import("@/layouts/AppLayout.vue"),
      redirect: "/dashboard",
      children: [
        {
          path: "dashboard",
          name: "dashboard",
          component: () => import("@/pages/DashboardView.vue"),
          meta: { menu: "dashboard" },
        },
        {
          path: "master/akses/users",
          name: "users",
          component: () => import("@/pages/UsersPage.vue"),
          meta: { menu: "users" },
        },
        {
          path: "master/akses/groups",
          name: "groups",
          component: () => import("@/pages/GroupsPage.vue"),
          meta: { menu: "groups" },
        },
        {
          path: "master/akses/menus",
          name: "menus",
          component: () => import("@/pages/MenusPage.vue"),
          meta: { menu: "menus" },
        },
        {
          path: "master/settings/approval",
          name: "approval-settings",
          component: () => import("@/pages/ApprovalSettingsPage.vue"),
          meta: { menu: "approval_settings" },
        },
        {
          path: "master/settings/portal",
          name: "portal-settings",
          component: () => import("@/pages/PortalSettingsPage.vue"),
          meta: { menu: "portal" },
        },
        {
          path: "forbidden",
          name: "forbidden",
          component: () => import("@/pages/ForbiddenPage.vue"),
        },
        {
          path: "profile",
          name: "profile",
          component: () => import("@/pages/ProfilePage.vue"),
        },
        {
          path: "approvals",
          name: "approvals",
          component: () => import("@/pages/ApprovalsPage.vue"),
          meta: { menu: "approvals" },
        },
      ],
    },
    { path: "/:pathMatch(.*)*", redirect: "/dashboard" },
  ],
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();

  if (to.meta.public) {
    return auth.user && (to.name === "login" || to.name === "register")
      ? { name: "dashboard" }
      : true;
  }

  if (!auth.loaded) await auth.fetchSession();

  if (to.meta.public) {
    return auth.user && to.name === "login" ? { name: "dashboard" } : true;
  }
  if (!auth.user) return { name: "login", query: { redirect: to.fullPath } };

  const menu = to.meta.menu;
  if (menu && !auth.can(menu, "read")) return { name: "forbidden" };
  return true;
});

export default router;
