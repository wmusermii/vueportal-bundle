<script setup lang="ts">
import { computed } from 'vue'
import { useAuthStore } from '@/stores/auth'        // sesuaikan
import DashboardAdmin from './DashboardAdmin.vue'
import DashboardUser from './DashboardUser.vue'

const auth = useAuthStore()
// sesuaikan nama field
</script>


<template>
  <DashboardAdmin v-if="auth.isAdmin" />
  <DashboardUser
    v-else
    :name="auth.user?.fullName ?? ''"
    :group-name="auth.group?.name ?? ''"
  />
</template>