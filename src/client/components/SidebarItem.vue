<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import type { MenuNode } from '@/stores/auth'
import NavIcon from './NavIcon.vue'

const props = defineProps<{ node: MenuNode; level: number; collapsed?: boolean }>()
const emit = defineEmits<{ expand: [] }>()
const route = useRoute()

const isFolder = computed(() => props.node.type === 'folder')
const open = ref(true)

// saat ciut, folder yang berisi halaman aktif ikut disorot
const containsActive = (n: MenuNode): boolean =>
  n.path === route.path || n.children.some(containsActive)
const folderActive = computed(() => !!props.collapsed && containsActive(props.node))

function onFolderClick() {
  if (props.collapsed) {
    open.value = true
    emit('expand')
  } else {
    open.value = !open.value
  }
}
</script>

<template>
  <li class="nav-item" :class="`level-${level}`">
    <button
      v-if="isFolder"
      class="nav-link"
      :class="{ active: folderActive }"
      :aria-expanded="collapsed ? false : open"
      :title="collapsed ? node.title : undefined"
      :aria-label="collapsed ? node.title : undefined"
      @click="onFolderClick"
    >
      <NavIcon :name="node.icon" />
      <span class="nav-title">{{ node.title }}</span>
      <svg class="nav-chevron" :class="{ open }" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M5.5 3.5 10 8l-4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>
    <router-link
      v-else
      class="nav-link"
      :to="node.path!"
      active-class="active"
      :title="collapsed ? node.title : undefined"
      :aria-label="collapsed ? node.title : undefined"
    >
      <NavIcon :name="node.icon" />
      <span class="nav-title">{{ node.title }}</span>
    </router-link>

    <ul v-if="isFolder && open" class="nav-children">
      <SidebarItem v-for="c in node.children" :key="c.id" :node="c" :level="level + 1" />
    </ul>
  </li>
</template>