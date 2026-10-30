import { registerHandler } from '../service'
import { userRegistration } from './userRegistration'
import { usersChange } from './usersChange'
import { groupsChange } from './groupsChange'

registerHandler(userRegistration)
registerHandler(usersChange)
registerHandler(groupsChange)
// jenis approval berikutnya: registerHandler(namaHandler)