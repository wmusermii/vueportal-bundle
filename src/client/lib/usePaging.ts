import { computed, ref, watch, type Ref } from 'vue'

export function usePaging<T>(items: Ref<T[]>, defaultSize = 10) {
  const page = ref(1)
  const pageSize = ref(defaultSize)
  const total = computed(() => items.value.length)
  const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))
  const paged = computed(() => items.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))

  // ganti jumlah baris: kembali ke halaman 1
  watch(pageSize, () => (page.value = 1))
  // setelah hapus data, jangan tertinggal di halaman yang sudah kosong
  watch(totalPages, (n) => {
    if (page.value > n) page.value = n
  })

  return { page, pageSize, total, paged }
}