import { registerHandler } from '../service'
import { userRegistration } from './userRegistration'

registerHandler(userRegistration)
// jenis approval berikutnya: registerHandler(namaHandler)