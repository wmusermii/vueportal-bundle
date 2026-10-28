import { computed, ref } from 'vue'
import { api } from '@/api'

interface Policy {
  minLength: number
  requireUpper: boolean
  requireLower: boolean
  requireNumber: boolean
  requireSymbol: boolean
}

const policy = ref<Policy | null>(null)

export async function loadPasswordPolicy(force = false) {
  if (policy.value && !force) return
  try {
    policy.value = await api.get<Policy>('/api/auth/password-policy')
  } catch {
    /* abaikan: server tetap memeriksa */
  }
}

export const passwordHint = computed(() => {
  const p = policy.value
  if (!p) return ''
  const parts = [`minimal ${p.minLength} karakter`]
  const need: string[] = []
  if (p.requireUpper) need.push('huruf besar')
  if (p.requireLower) need.push('huruf kecil')
  if (p.requireNumber) need.push('angka')
  if (p.requireSymbol) need.push('simbol')
  if (need.length) parts.push(`memuat ${need.join(', ')}`)
  return `Password ${parts.join(', ')}.`
})