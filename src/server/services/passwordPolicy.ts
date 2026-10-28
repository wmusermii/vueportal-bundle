import { HttpError } from '../lib/helpers'
import { getBool, getNumber } from './params'

export interface PasswordPolicy {
  minLength: number
  requireUpper: boolean
  requireLower: boolean
  requireNumber: boolean
  requireSymbol: boolean
}

export async function getPasswordPolicy(): Promise<PasswordPolicy> {
  const [minLength, requireUpper, requireLower, requireNumber, requireSymbol] = await Promise.all([
    getNumber('password', 'min_length', 8),
    getBool('password', 'require_upper', true),
    getBool('password', 'require_lower', true),
    getBool('password', 'require_number', true),
    getBool('password', 'require_symbol', false),
  ])
  return { minLength, requireUpper, requireLower, requireNumber, requireSymbol }
}

export function passwordProblems(pw: string, p: PasswordPolicy): string[] {
  const out: string[] = []
  if (pw.length < p.minLength) out.push(`minimal ${p.minLength} karakter`)
  const need: string[] = []
  if (p.requireUpper && !/\p{Lu}/u.test(pw)) need.push('huruf besar')
  if (p.requireLower && !/\p{Ll}/u.test(pw)) need.push('huruf kecil')
  if (p.requireNumber && !/\p{N}/u.test(pw)) need.push('angka')
  if (p.requireSymbol && !/[^\p{L}\p{N}\s]/u.test(pw)) need.push('simbol')
  if (need.length) out.push(`memuat ${need.join(', ')}`)
  return out
}

export async function assertPasswordPolicy(pw: string) {
  const problems = passwordProblems(pw, await getPasswordPolicy())
  if (problems.length) throw new HttpError(400, `Password harus ${problems.join(', ')}`)
}