<script setup lang="ts">
import { computed } from 'vue'
import { stats, weekly, tasks, activities, announcements, shortcuts } from '@/data/dashboardUser'

defineProps<{ name: string; groupName: string }>()

const hour = new Date().getHours()
const greeting = hour < 11 ? 'Selamat pagi' : hour < 15 ? 'Selamat siang' : hour < 19 ? 'Selamat sore' : 'Selamat malam'
const today = new Intl.DateTimeFormat('id-ID', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
}).format(new Date())

const maxWeekly = computed(() => Math.max(...weekly.map(w => w.value)))
const barH = (v: number) => `${Math.round((v / maxWeekly.value) * 100)}%`
</script>

<template>
  <div class="du">
    <header class="du-head">
      <h1>{{ greeting }}, {{ name }}</h1>
      <p>{{ groupName }} · {{ today }}</p>
    </header>

    <section class="du-stats">
      <article v-for="s in stats" :key="s.key" class="du-card du-stat" :class="`tone-${s.tone}`">
        <span>{{ s.label }}</span>
        <strong>{{ s.value }}</strong>
        <small>{{ s.hint }}</small>
      </article>
    </section>

    <section class="du-grid">
      <article class="du-card du-span2">
        <h3>Tugas Saya</h3>
        <table class="du-table">
          <thead><tr><th>Tugas</th><th>Jatuh Tempo</th><th>Prioritas</th><th>Status</th></tr></thead>
          <tbody>
            <tr v-for="t in tasks" :key="t.id">
              <td>{{ t.title }}</td>
              <td>{{ t.due }}</td>
              <td><span class="pill" :class="`p-${t.priority.toLowerCase()}`">{{ t.priority }}</span></td>
              <td><span class="pill" :class="`s-${t.status.toLowerCase()}`">{{ t.status }}</span></td>
            </tr>
          </tbody>
        </table>
      </article>

      <article class="du-card">
        <h3>Aktivitas 7 Hari</h3>
        <div class="du-bars">
          <div v-for="w in weekly" :key="w.day" class="du-bar" :title="`${w.day}: ${w.value}`">
            <i :style="{ height: barH(w.value) }"></i>
            <span>{{ w.day }}</span>
          </div>
        </div>
      </article>

      <article class="du-card">
        <h3>Pengumuman</h3>
        <ul class="du-list">
          <li v-for="a in announcements" :key="a.id">
            <b>{{ a.title }}</b> <small>{{ a.date }}</small>
            <p>{{ a.body }}</p>
          </li>
        </ul>
      </article>

      <article class="du-card">
        <h3>Aktivitas Terbaru</h3>
        <ul class="du-list">
          <li v-for="a in activities" :key="a.id">
            <p>{{ a.text }}</p><small>{{ a.time }}</small>
          </li>
        </ul>
      </article>

      <article class="du-card">
        <h3>Pintasan</h3>
        <div class="du-short">
          <RouterLink v-for="s in shortcuts" :key="s.label" :to="s.to">{{ s.label }}</RouterLink>
        </div>
      </article>
    </section>
  </div>
</template>

<style scoped>
.du { display: flex; flex-direction: column; gap: 20px; }
.du-head h1 { margin: 0; font-size: 22px; }
.du-head p { margin: 4px 0 0; color: #6b7280; font-size: 13px; }

.du-card { background: #fff; border: 1px solid #e5e7eb; border-radius: 14px; padding: 18px; }
.du-card h3 { margin: 0 0 12px; font-size: 15px; }

.du-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 16px; }
.du-stat { display: flex; flex-direction: column; gap: 4px; border-left: 4px solid var(--c); }
.du-stat span { font-size: 13px; color: #6b7280; }
.du-stat strong { font-size: 28px; line-height: 1.1; }
.du-stat small { font-size: 12px; color: #9ca3af; }
.tone-green { --c: #16a34a; } .tone-blue { --c: #2563eb; }
.tone-amber { --c: #d97706; } .tone-rose { --c: #e11d48; }

.du-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
.du-span2 { grid-column: span 2; }
@media (max-width: 960px) { .du-grid { grid-template-columns: 1fr; } .du-span2 { grid-column: auto; } }

.du-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.du-table th { text-align: left; color: #6b7280; font-weight: 600; padding: 8px 6px; border-bottom: 1px solid #e5e7eb; }
.du-table td { padding: 10px 6px; border-bottom: 1px solid #f3f4f6; }

.pill { padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; }
.p-tinggi { background: #fee2e2; color: #b91c1c; }
.p-sedang { background: #fef3c7; color: #b45309; }
.p-rendah { background: #e5e7eb; color: #374151; }
.s-berjalan { background: #dbeafe; color: #1d4ed8; }
.s-menunggu { background: #fef3c7; color: #b45309; }
.s-selesai { background: #dcfce7; color: #15803d; }

.du-bars { display: flex; align-items: flex-end; gap: 10px; height: 150px; }
.du-bar { flex: 1; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; gap: 6px; }
.du-bar i { width: 100%; background: #16a34a; border-radius: 6px 6px 0 0; min-height: 4px; }
.du-bar span { font-size: 11px; color: #6b7280; }

.du-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
.du-list p { margin: 2px 0 0; font-size: 13px; }
.du-list small { color: #9ca3af; font-size: 12px; }

.du-short { display: flex; flex-wrap: wrap; gap: 8px; }
.du-short a { padding: 8px 14px; border: 1px solid #16a34a; color: #16a34a; border-radius: 8px; font-size: 13px; text-decoration: none; }
.du-short a:hover { background: #16a34a; color: #fff; }
</style>