import { writeFileSync } from 'node:fs'
import { WIDGETS } from '../src/widgets'
import { defaultProps } from '../src/lib/types'
import { buildTargets, readmeFor } from '../src/lib/export'
import { zipSync } from '../src/lib/export/zip'

const spec = WIDGETS[0]
const props = defaultProps(spec)
const files = [
  ...buildTargets(spec, props).flatMap((t) => t.files.map((f) => ({ name: `${spec.id}/${t.id}/${f.name}`, content: f.content }))),
  { name: `${spec.id}/README.md`, content: readmeFor(spec, props).content },
]
const blob = zipSync(files)
const buf = Buffer.from(await blob.arrayBuffer())
writeFileSync(process.argv[2], buf)
console.log(`zip ${buf.length} bytes, ${files.length} entries`)
