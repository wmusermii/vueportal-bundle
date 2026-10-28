<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ total: number }>()
const page = defineModel<number>('page', { required: true })
const pageSize = defineModel<number>('pageSize', { required: true })

const SIZES = [10, 50, 100]

const totalPages = computed(() => Math.max(1, Math.ceil(props.total / pageSize.value)))
const from = computed(() => (props.total === 0 ? 0 : (page.value - 1) * pageSize.value + 1))
const to = computed(() => Math.min(page.value * pageSize.value, props.total))

// 1 ... 4 5 6 ... 20
const pages = computed(() => {
  const last = totalPages.value
  const cur = page.value
  const nums = [...new Set([1, last, cur - 1, cur, cur + 1])]
    .filter((n) => n >= 1 && n <= last)
    .sort((a, b) => a - b)
  const out: (number | '...')[] = []
  nums.forEach((n, i) => {
    if (i > 0 && n - nums[i - 1] > 1) out.push('...')
    out.push(n)
  })
  return out
})
</script>

<template>
  <div class="pager">
    <div class="pager-info">
      <span>Tampilkan</span>
      <select v-model.number="pageSize" class="input input-sm" aria-label="Jumlah baris per halaman">
        <option v-for="s in SIZES" :key="s" :value="s">{{ s }}</option>
      </select>
      <span>baris. {{ from }}-{{ to }} dari {{ total }}</span>
    </div>

    <nav class="pager-nav" aria-label="Halaman">
      <button type="button" class="btn btn-ghost btn-sm" :disabled="page <= 1" @click="page--">
        Sebelumnya
      </button>
      <template v-for="(p, i) in pages" :key="i">
        <span v-if="p === '...'" class="pager-gap">...</span>
        <button
          v-else
          type="button"
          class="btn btn-sm"
          :class="p === page ? 'btn-primary' : 'btn-ghost'"
          :aria-current="p === page ? 'page' : undefined"
          @click="page = p"
        >
          {{ p }}
        </button>
      </template>
      <button type="button" class="btn btn-ghost btn-sm" :disabled="page >= totalPages" @click="page++">
        Berikutnya
      </button>
    </nav>
  </div>
</template>