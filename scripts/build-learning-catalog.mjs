/** Regenerate the local teaching catalogue from the credited Atlas metadata. */
import { readFile, writeFile } from 'node:fs/promises'
import ts from 'typescript'

function exported(source) {
  const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const result = {}
  new Function('exports', javascript)(result)
  return result
}
const { species } = exported(await readFile(new URL('../src/data/species.ts', import.meta.url), 'utf8'))
const { atlasPhotos } = exported(await readFile(new URL('../src/data/atlasPhotos.ts', import.meta.url), 'utf8'))
const items = atlasPhotos.map(photo => {
  const specimen = species.find(item => item.id === photo.speciesId)
  if (!specimen || !/^\/atlas\/photos\/[a-z0-9.-]+\.jpg$/.test(photo.src)) throw new Error('Invalid local reference')
  return {
    id: photo.id, species_id: specimen.id, scientific_name: specimen.name, thai_name: specimen.thaiName,
    specimen_type: specimen.specimenType ?? 'egg', src: photo.src, source_taxon: photo.sourceTaxon,
    caption: photo.caption, credit: photo.credit, license: photo.license, license_url: photo.licenseUrl,
    source_url: photo.sourceUrl, source_image_url: photo.sourceImageUrl, changes: photo.changes,
    limitations: photo.stageNote ?? specimen.clinicalNote ?? '', clinical_note: specimen.clinicalNote ?? '',
    morphology: specimen.description, features: specimen.features,
    validation_status: 'source_reference_not_app_expert_reviewed',
  }
})
await writeFile(new URL('../backend/platform/learning_catalog.json', import.meta.url), JSON.stringify({
  version: 1,
  notice: 'Licensed source-labelled teaching references. No application expert approval is implied. Quiz availability requires a recorded reviewer approval.',
  items,
}, null, 2) + '\n')
process.stdout.write(`Wrote ${items.length} credited source references; zero expert approvals were generated.\n`)
