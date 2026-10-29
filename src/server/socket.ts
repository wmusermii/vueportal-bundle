import type { Server as HttpServer } from 'node:http'
import { Server } from 'socket.io'
import { COOKIE_NAME } from './middleware/auth'
import { resolveSession, type SessionUser } from './services/session'

let ioRef: Server | null = null

// dipakai langkah berikutnya untuk mengirim event dari route
export function getIo(): Server {
  if (!ioRef) throw new Error('Socket belum dimulai')
  return ioRef
}

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const i = part.indexOf('=')
    if (i > -1 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim())
  }
  return null
}

export function setupSocket(server: HttpServer): Server {
  const io = new Server(server, {
    // tolak koneksi browser dari origin lain (mencegah pembajakan WebSocket lintas situs)
    allowRequest: (req, cb) => {
      const origin = req.headers.origin
      if (!origin) return cb(null, true) // klien non-browser tetap wajib lolos autentikasi di bawah
      try {
        cb(null, new URL(origin).host === req.headers.host)
      } catch {
        cb(null, false)
      }
    },
  })
  ioRef = io

  // wajib login: cookie yang sama dengan API
  io.use(async (socket, next) => {
    try {
      const token = readCookie(socket.handshake.headers.cookie, COOKIE_NAME)
      const r = await resolveSession(token)
      if (!r.ok) return next(new Error('unauthorized'))
      socket.data.user = r.user
      socket.data.token = token
      next()
    } catch {
      next(new Error('unauthorized'))
    }
  })

  // user online: satu user dengan banyak tab dihitung satu
  const online = new Map<string, Set<string>>()
  const broadcast = () => io.emit('presence', { online: online.size })

  io.on('connection', (socket) => {
    const user = socket.data.user as SessionUser
    const ids = online.get(user.id) ?? new Set<string>()
    ids.add(socket.id)
    online.set(user.id, ids)

    socket.join(`user:${user.id}`) // ruang per user, untuk event yang ditujukan ke satu orang
    broadcast()

    socket.on('presence:get', (ack?: (d: { online: number }) => void) => ack?.({ online: online.size }))

    socket.on('disconnect', () => {
      ids.delete(socket.id)
      if (ids.size === 0) online.delete(user.id)
      broadcast()
    })
  })

  // periksa ulang sesi tiap menit: user dinonaktifkan, sesi habis, atau mode pemeliharaan menyala
  setInterval(async () => {
    try {
      for (const s of await io.fetchSockets()) {
        const r = await resolveSession(s.data.token)
        if (!r.ok) {
          s.emit('session:ended', { message: r.message })
          s.disconnect(true)
        }
      }
    } catch (e) {
      console.error('Pemeriksaan sesi socket gagal:', (e as Error).message)
    }
  }, 60_000).unref()

  return io
}