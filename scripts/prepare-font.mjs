import { compress } from 'wawoff2'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
const source = new URL('../.runtime/downloads/NotoSerifCJKsc-Regular.otf', import.meta.url)
await mkdir(new URL('../.runtime/downloads/', import.meta.url), { recursive: true })
let bytes
try { bytes = await readFile(source) } catch {
  const response = await fetch('https://raw.githubusercontent.com/notofonts/noto-cjk/main/Serif/OTF/SimplifiedChinese/NotoSerifCJKsc-Regular.otf')
  if (!response.ok) throw new Error('Could not download official Noto font')
  bytes = Buffer.from(await response.arrayBuffer()); await writeFile(source, bytes)
}
await writeFile(new URL('../public/fonts/diagram-serif.woff2', import.meta.url), await compress(bytes))
process.stdout.write('Compressed the official Noto font for offline rendering. Keep public/fonts/LICENSE.txt.\n')
