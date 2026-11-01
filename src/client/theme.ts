import { reactive } from 'vue'

export type ImgKey = 'logo' | 'favicon' | 'login_image'
export type ThemeValues = Record<string, string | number | undefined>

// dipakai komponen: theme.logo_url, theme.login_image_url
export const theme = reactive({ logo_url: '', favicon_url: '', login_image_url: '' })

// parameter group themes -> variabel CSS (nilai bawaan ada di :root pada style.css)
const COLOR_VARS: Record<string, string> = {
  primary_color: '--primary',
  primary_text_color: '--primary-ink',
  accent_color: '--accent',
  sidebar_color: '--side-bg', // kosong = ikut --primary
  sidebar_text_color: '--side-text-strong',
  background_color: '--canvas',
  surface_color: '--surface',
  text_color: '--text',
  text_muted_color: '--text-2',
  border_color: '--line',
  login_bg_color: '--login-bg',
  success_color: '--ok',
  warning_color: '--warning',
  danger_color: '--danger',
}

const HEX = /^#[0-9a-fA-F]{6}$/

function setVar(name: string, value: string | null) {
  const st = document.documentElement.style
  if (value) st.setProperty(name, value)
  else st.removeProperty(name) // kembali ke nilai bawaan di style.css
}

export function applyColors(t: ThemeValues) {
  for (const [key, cssVar] of Object.entries(COLOR_VARS)) {
    const v = t[key]
    setVar(cssVar, typeof v === 'string' && HEX.test(v) ? v : null)
  }
  const r = t.border_radius === undefined || t.border_radius === '' ? NaN : Number(t.border_radius)
  setVar('--radius', Number.isInteger(r) && r >= 0 && r <= 24 ? `${r}px` : null)
}

function setFavicon(url: string) {
  if (!url) return
  let link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]')
  if (!link) {
    link = document.createElement('link')
    link.rel = 'icon'
    document.head.appendChild(link)
  }
  link.removeAttribute('type') // tipe bawaan (svg) bisa bentrok dengan png/ico
  link.href = url
}

export function setImage(key: ImgKey, url: string) {
  theme[`${key}_url`] = url
  if (key === 'favicon') setFavicon(url)
}

export function applyTheme(t: ThemeValues) {
  applyColors(t)
  setImage('logo', String(t.logo_url ?? ''))
  setImage('favicon', String(t.favicon_url ?? ''))
  setImage('login_image', String(t.login_image_url ?? ''))
}

// Dipanggil sekali sebelum aplikasi dipasang. Gagal = pakai tampilan bawaan.
export async function loadTheme() {
  try {
    const res = await fetch('/api/public/theme', { cache: 'no-store', signal: AbortSignal.timeout(2500) })
    if (res.ok) applyTheme(await res.json())
  } catch {
    /* tampilan bawaan */
  }
}