import { computed, ref, watch, type Ref, type WatchSource } from 'vue'

type SortDir = 'asc' | 'desc'
type SortVal = string | number | null | undefined

export interface TableOptions<T> {
  searchText: (row: T) => string
  sorters: Record<string, (row: T) => SortVal>
  defaultSort?: { key: string; dir: SortDir }
  extraFilter?: (row: T) => boolean
  resetOn?: WatchSource[]
  defaultSize?: number
}

export function useTable<T>(items: Ref<T[]>, opts: TableOptions<T>) {
  const query = ref('')
  const sortKey = ref(opts.defaultSort?.key ?? '')
  const sortDir = ref<SortDir>(opts.defaultSort?.dir ?? 'asc')
  const page = ref(1)
  const pageSize = ref(opts.defaultSize ?? 10)

  const filtered = computed(() => {
    const q = query.value.trim().toLowerCase()
    return items.value.filter(
      (r) => (!q || opts.searchText(r).toLowerCase().includes(q)) && (opts.extraFilter?.(r) ?? true),
    )
  })

  const collator = new Intl.Collator('id', { numeric: true, sensitivity: 'base' })
  const sorted = computed(() => {
    const get = opts.sorters[sortKey.value]
    if (!get) return filtered.value
    const dir = sortDir.value === 'asc' ? 1 : -1
    return [...filtered.value].sort((a, b) => {
      const x = get(a)
      const y = get(b)
      if (x === y) return 0
      if (x === null || x === undefined) return 1 // data kosong selalu di bawah
      if (y === null || y === undefined) return -1
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir
      return collator.compare(String(x), String(y)) * dir
    })
  })

  const total = computed(() => sorted.value.length)
  const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))
  const paged = computed(() => sorted.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))

  function toggleSort(key: string) {
    if (sortKey.value === key) sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
    else {
      sortKey.value = key
      sortDir.value = 'asc'
    }
  }

  // cari, filter, urutan, atau jumlah baris berubah: kembali ke halaman 1
  watch([query, sortKey, sortDir, pageSize, ...(opts.resetOn ?? [])], () => (page.value = 1))
  // setelah hapus data, jangan tertinggal di halaman yang sudah kosong
  watch(totalPages, (n) => {
    if (page.value > n) page.value = n
  })

  return { query, sortKey, sortDir, toggleSort, page, pageSize, total, paged }
}