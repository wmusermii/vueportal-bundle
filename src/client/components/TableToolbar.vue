<script setup lang="ts">
const query = defineModel<string>({ required: true })
defineProps<{ placeholder?: string }>()
</script>

<template>
  <div class="toolbar">
    <div class="search">
      <svg class="search-icon" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="11" cy="11" r="6.5" />
        <path d="m16 16 4 4" />
      </svg>
      <input
        v-model="query"
        class="input search-input"
        :placeholder="placeholder ?? 'Cari...'"
        aria-label="Cari"
        @keydown.esc="query = ''"
      />
    </div>
    <slot />
  </div>
</template>