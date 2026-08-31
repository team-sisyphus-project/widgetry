/**
 * Dumps every export target for every widget to disk. Used to verify that the
 * generated files really compile and really run, not just that they look right.
 *   npx esbuild scripts/emit.ts --bundle --format=esm --platform=node --outfile=.emit.mjs && node .emit.mjs <outdir>
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { WIDGETS } from '../src/widgets'
import { defaultProps } from '../src/lib/types'
import { buildTargets, readmeFor } from '../src/lib/export'

const out = process.argv[2] ?? '.emitted'
let count = 0

for (const spec of WIDGETS) {
  const props = defaultProps(spec)
  for (const target of buildTargets(spec, props)) {
    for (const file of target.files) {
      const path = join(out, spec.id, target.id, file.name)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, file.content)
      count++
    }
  }
  const readme = readmeFor(spec, props)
  writeFileSync(join(out, spec.id, readme.name), readme.content)
  count++
}

console.log(`wrote ${count} files for ${WIDGETS.length} widgets into ${out}`)
