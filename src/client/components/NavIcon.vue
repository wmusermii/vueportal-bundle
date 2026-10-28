<script setup lang="ts">
import { iconPaths } from '@/lib/icons'

defineProps<{ name: string | null }>()
const fallback = '<circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/>'
</script>

<template>
  <svg
    class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
    v-html="iconPaths[name ?? ''] ?? fallback"
  />
</template>