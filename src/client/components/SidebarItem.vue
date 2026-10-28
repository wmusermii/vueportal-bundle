<script setup lang="ts">
import { computed, ref } from 'vue'
import type { MenuNode } from '@/stores/auth'
import NavIcon from './NavIcon.vue'

const props = defineProps<{ node: MenuNode; level: number }>()
const isFolder = computed(() => props.node.type === 'folder')
const open = ref(true)
</script>

<template>
  <li class="nav-item" :class="`level-${level}`">
    <button v-if="isFolder" class="nav-link" :aria-expanded="open" @click="open = !open">
      <NavIcon :name="node.icon" />
      <span class="nav-title">{{ node.title }}</span>
      <svg class="nav-chevron" :class="{ open }" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M5.5 3.5 10 8l-4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>
    <router-link v-else class="nav-link" :to="node.path!" active-class="active">
      <NavIcon :name="node.icon" />
      <span class="nav-title">{{ node.title }}</span>
    </router-link>

    <ul v-if="isFolder && open" class="nav-children">
      <SidebarItem v-for="c in node.children" :key="c.id" :node="c" :level="level + 1" />
    </ul>
  </li>
</template>