import { io, type Socket } from 'socket.io-client'
import { notifyUnauthorized } from '@/api'

let socket: Socket | null = null

export function connectSocket(): Socket {
  if (!socket) {
    socket = io({ autoConnect: false }) // satu origin: cookie login ikut terkirim otomatis
    socket.on('connect_error', (e) => {
      if (e.message === 'unauthorized') notifyUnauthorized()
    })
    socket.on('session:ended', () => notifyUnauthorized())
  }
  if (!socket.connected) socket.connect()
  return socket
}

export function disconnectSocket() {
  socket?.disconnect()
  socket = null
}