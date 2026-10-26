import { randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
const file = new URL('../deploy/.env', import.meta.url)
const random = () => randomBytes(36).toString('base64url')
await writeFile(file, `DOMAIN=diagram.example.com\nDB_PASSWORD=${random()}\nMYSQL_ROOT_PASSWORD=${random()}\nWORKER_KEY=${random()}\nSECURE_COOKIE=false\n`, { flag: 'wx', mode: 0o600 })
process.stdout.write('Created deploy/.env with new secrets. Set DOMAIN before deployment. Existing files are never overwritten.\n')
