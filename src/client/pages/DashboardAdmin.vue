<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { connectSocket } from '@/lib/socket'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const online = ref<number | null>(null)
const connected = ref(false)

const socket = connectSocket()
const onPresence = (d: { online: number }) => (online.value = d.online)
const onConnect = () => {
  connected.value = true
  socket.emit('presence:get', (d: { online: number }) => (online.value = d.online))
}
const onDisconnect = () => (connected.value = false)

onMounted(() => {
  socket.on('presence', onPresence)
  socket.on('connect', onConnect)
  socket.on('disconnect', onDisconnect)
  if (socket.connected) onConnect()
})
onBeforeUnmount(() => {
  socket.off('presence', onPresence)
  socket.off('connect', onConnect)
  socket.off('disconnect', onDisconnect)
})
</script>

<template>
  <div class="page-head">
    <h1>Dashboard</h1>
    <p>Selamat datang, {{ auth.user?.fullName }}.</p>
  </div>

  <div class="stat-grid">
    <section class="panel stat">
      <div class="muted">User online</div>
      <div class="stat-value">{{ online ?? '-' }}</div>
      <div class="muted stat-foot">
        <span class="dot" :class="{ on: connected }"></span>
        {{ connected ? 'Terhubung realtime' : 'Menghubungkan...' }}
      </div>
    </section>
  </div>
</template>