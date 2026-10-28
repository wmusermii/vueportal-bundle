<script setup lang="ts">
defineProps<{ label: string; active: boolean; dir: 'asc' | 'desc' }>()
defineEmits<{ sort: [] }>()
</script>

<template>
  <th :aria-sort="active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'">
    <button type="button" class="th-sort" @click="$emit('sort')">
      {{ label }}
      <svg class="sort-icon" :class="{ on: active }" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M5 6.5 8 3.5l3 3" :class="{ dim: active && dir === 'desc' }" />
        <path d="M5 9.5 8 12.5l3-3" :class="{ dim: active && dir === 'asc' }" />
      </svg>
    </button>
  </th>
</template>