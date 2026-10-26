<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { io } from 'socket.io-client'

const api = ref('memuat...')
const socket = ref('menghubungkan...')

onMounted(async () => {
  const res = await fetch('/api/health')
  api.value = JSON.stringify(await res.json())

  const s = io()
  s.on('connect', () => (socket.value = 'terhubung, id: ' + s.id))
  s.on('disconnect', () => (socket.value = 'terputus'))
})
</script>

<template>
  <h1>Komibank Portal</h1>
  <p>API: {{ api }}</p>
  <p>Socket: {{ socket }}</p>
</template>