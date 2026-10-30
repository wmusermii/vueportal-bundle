import bcrypt from 'bcryptjs' // samakan dengan baris import bcrypt di routes/users.ts (bcrypt atau bcryptjs)

const ROUNDS = 10 // samakan dengan angka di routes/users.ts baris 72

export const hashPassword = (pw: string) => bcrypt.hash(pw, ROUNDS)