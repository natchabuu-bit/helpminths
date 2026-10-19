import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const baseURL = process.env.HELPMINTHS_TEST_URL || 'http://127.0.0.1:5173'
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined)
const atlasNames = [
  'Ascaris lumbricoides', 'Trichuris trichiura', 'Hookworm', 'Opisthorchis viverrini',
  'Taenia spp.', 'Enterobius vermicularis', 'Minute intestinal flukes (MIF)',
  'Hymenolepis nana', 'Hymenolepis diminuta', 'Echinostoma spp.', 'Fasciolopsis buski',
]
let browser
before(async () => {
  browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
})
after(async () => browser?.close())

async function openPage(options = {}) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, ...options })
  await page.goto(baseURL, { waitUntil: 'networkidle' })
  return page
}

test('live API health reports actual readiness', async () => {
  const page = await openPage()
  try {
    const response = await page.request.get(`${baseURL}/api/health`)
    assert.equal(response.status(), 200)
    const health = await response.json()
    assert.equal(health.status, 'ok')
    assert.equal(typeof health.model_ready, 'boolean')
    assert.equal(typeof health.message, 'string')
  } finally { await page.close() }
})

test('demo overlays filter, select, export labelled data, and retain session history', async () => {
  const page = await openPage()
  try {
    await page.getByRole('button', { name: 'ดูตัวอย่าง', exact: true }).click()
    await page.locator('.scan-demo-banner').waitFor()
    assert.match(await page.locator('.scan-demo-banner').innerText(), /ไม่ใช่ผลตรวจจาก AI/)
    assert.equal(await page.locator('.scan-detection-box').count(), 3)
    await page.locator('.scan-detection-item').nth(2).click()
    assert.match(await page.locator('.scan-detection-item--selected').innerText(), /Trichuris/)
    const slider = page.locator('#scan-confidence')
    await slider.focus()
    await slider.press('End')
    await page.waitForFunction(() => document.querySelectorAll('.scan-detection-box').length === 0)
    await page.getByRole('button', { name: 'ปรับเกณฑ์เป็น 15%' }).click()
    await page.waitForFunction(() => document.querySelectorAll('.scan-detection-box').length === 3)
    await page.getByRole('button', { name: 'ซ่อนกรอบ', exact: true }).click()
    assert.equal(await page.locator('.scan-detection-box').count(), 0)
    await page.getByRole('button', { name: 'แสดงกรอบ', exact: true }).click()
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'ส่งออกรายงาน JSON' }).click()
    const download = await downloadPromise
    const report = JSON.parse(await readFile(await download.path(), 'utf8'))
    assert.equal(report.mode, 'demo')
    assert.equal(report.detections.length, 3)
    assert.match(report.notice, /ไม่ใช่ผลตรวจจาก AI/)
    await page.getByRole('button', { name: /ประวัติการตรวจ/ }).click()
    assert.equal(await page.locator('.history-card').count(), 1)
    await page.locator('.history-card').click()
    await page.locator('.scan-demo-banner').waitFor()
  } finally { await page.close() }
})

test('upload stays available without a model, and unsupported files are rejected', async () => {
  const page = await browser.newPage()
  await page.route('**/api/health', route => route.fulfill({ json: { status: 'ok', model_ready: false, model_name: null, message: 'No trained checkpoint configured' } }))
  try {
    await page.goto(baseURL, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'ตรวจวิเคราะห์ AI' }).click()
    const input = page.getByLabel('เลือกภาพจากอุปกรณ์')
    await input.setInputFiles({ name: 'wrong.txt', mimeType: 'text/plain', buffer: Buffer.from('text') })
    await page.getByRole('alert').waitFor()
    assert.match(await page.getByRole('alert').innerText(), /JPG, PNG หรือ WEBP/)
    await input.setInputFiles({ name: 'slide.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64') })
    await page.locator('.scan-image-svg').waitFor()
    assert.equal(await page.getByRole('button', { name: 'เริ่มวิเคราะห์ภาพ' }).isDisabled(), true)
    assert.match(await page.locator('.scan-model-note').innerText(), /ยังไม่เชื่อมต่อโมเดล AI/)
    assert.equal(await page.locator('.scan-detection-box').count(), 0)
  } finally { await page.close() }
})

test('mocked inference preserves exact model labels and links only supported taxa to the correct Atlas entry', { timeout: 90_000 }, async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  let receivedMultipart = false
  const unrelatedLabels = ['Uncatalogued helminth egg', 'Schistosoma mansoni', 'Schistosoma haematobium', 'Schistosoma japonicum', 'Opisthorchis felineus', 'Clonorchis sinensis', 'Opisthorchis spp.', 'Fasciola hepatica', 'Fasciola gigantica', 'Hymenolepis spp.']
  const ovLabels = ['Opisthorchis viverrine', 'OV', 'O. viverrini', 'Opisthorchis viverrini']
  const newReferences = [
    { labels: ['MIF', 'Haplorchis taichui'], name: 'Minute intestinal flukes (MIF)', note: /OV.*Clonorchis/ },
    { labels: ['Hymenolepis nana', 'H. nana', 'Dwarf tapeworm'], name: 'Hymenolepis nana', note: /polar filaments/ },
    { labels: ['Hymenolepis diminuta', 'H. diminuta', 'Rat tapeworm'], name: 'Hymenolepis diminuta', note: /สเกล/ },
    { labels: ['Echinostoma spp.', 'Echinostoma revolutum'], name: 'Echinostoma spp.', note: /Fasciola/ },
    { labels: ['Fasciolopsis buski', 'F. buski'], name: 'Fasciolopsis buski', note: /Fasciola/ },
  ]
  const cases = [
    ...unrelatedLabels.map(label => ({ label, name: null })),
    ...ovLabels.map(label => ({ label, name: 'Opisthorchis viverrini' })),
    ...newReferences.flatMap(reference => reference.labels.map(label => ({ label, name: reference.name, note: reference.note }))),
  ]
  const labels = cases.map(item => item.label)
  await page.route('**/api/health', route => route.fulfill({ json: { status: 'ok', model_ready: true, model_name: 'contract-test-only.pt', message: 'Test fixture' } }))
  await page.route('**/api/analyze', async route => {
    const request = route.request()
    const body = request.postDataBuffer()?.toString('latin1') || ''
    receivedMultipart = request.method() === 'POST' && request.headers()['content-type'].includes('multipart/form-data') && body.includes('name="image"') && body.includes('name="confidence"') && body.includes('0.15')
    await route.fulfill({ json: { id: 'contract-test', filename: 'fixture.png', width: 100, height: 80, model: 'contract-test-only.pt', duration_ms: 12, detections: labels.map((label, index) => ({ id: `box-${index}`, class_id: index, label, confidence: 0.91, bbox: [8, 7, 45, 50] })) } })
  })
  try {
    await page.goto(baseURL, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'ตรวจวิเคราะห์ AI' }).click()
    const png = await page.evaluate(() => {
      const canvas = document.createElement('canvas')
      canvas.width = 100; canvas.height = 80
      const context = canvas.getContext('2d')
      context.fillStyle = '#dad5bb'; context.fillRect(0, 0, 100, 80)
      return canvas.toDataURL('image/png').split(',')[1]
    })
    await page.getByLabel('เลือกภาพจากอุปกรณ์').setInputFiles({ name: 'fixture.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
    await page.getByRole('button', { name: 'เริ่มวิเคราะห์ภาพ' }).click()
    await page.locator('.scan-detection-box').first().waitFor()
    assert.equal(receivedMultipart, true)
    assert.equal(await page.locator('.scan-detection-box > rect').first().getAttribute('x'), '8')
    assert.equal(await page.locator('.scan-detection-box > rect').first().getAttribute('width'), '37')
    assert.equal(await page.locator('.scan-detection-item').count(), labels.length)
    for (let index = 0; index < cases.length; index++) {
      const expected = cases[index]
      const item = page.locator('.scan-detection-item').nth(index)
      assert.ok((await item.innerText()).includes(expected.label), 'Inference labels must retain the exact model-provided spelling')
      await item.click()
      assert.equal(await page.locator('.scan-atlas-link').count(), expected.name ? 1 : 0, `${expected.label} must only link to a supported Atlas reference`)
      assert.equal(await page.locator('.scan-ov-note').count(), expected.name === 'Opisthorchis viverrini' ? 1 : 0, 'Only an OV match must display the OV-specific microscopy limitation')
      assert.equal(await page.locator('.scan-species-note').count(), expected.note ? 1 : 0, `${expected.label} must show its own microscopy limitation`)
      if (expected.note) assert.match(await page.locator('.scan-species-note').innerText(), expected.note)
    }
    assert.equal(await page.locator('.scan-demo-banner').count(), 0)
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'ส่งออกรายงาน JSON' }).click()
    const report = JSON.parse(await readFile(await (await downloadPromise).path(), 'utf8'))
    assert.deepEqual(report.detections.map(item => item.label), labels, 'Atlas aliases must not rewrite exported model labels')
    // Navigate via real result links, then reopen the session record. This checks
    // the specimen reached, rather than merely whether a link is present.
    for (const name of ['Opisthorchis viverrini', ...newReferences.map(item => item.name)]) {
      const index = cases.findIndex(item => item.name === name)
      await page.locator('.scan-detection-item').nth(index).click()
      if (name === 'Opisthorchis viverrini') {
        assert.match(await page.locator('.scan-ov-note').innerText(), /Clonorchis/)
        assert.match(await page.locator('.scan-ov-note').innerText(), /ยังไม่ยืนยันชนิด/)
      }
      await page.locator('.scan-atlas-link').click()
      await page.locator('.atlas-model-stage canvas').waitFor()
      assert.equal(await page.locator('.atlas-specimen-caption h2').innerText(), name)
      await page.getByRole('button', { name: /ประวัติการตรวจ/ }).click()
      await page.locator('.history-card').click()
      await page.locator('.scan-detection-box').first().waitFor()
    }
  } finally { await page.close() }
})

test('Atlas renders WebGL, updates structures, toggles labels without React errors, and closes expanded view', async () => {
  const page = await openPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    await page.getByRole('button', { name: 'Atlas 3D', exact: true }).click()
    await page.locator('.atlas-model-stage canvas').waitFor()
    assert.deepEqual(await page.locator('.atlas-species-item strong').allTextContents(), atlasNames)
    await page.getByRole('button', { name: 'หยุดหมุนอัตโนมัติ' }).click()
    await page.getByRole('button', { name: 'ภาพตัดภายใน', exact: true }).click()
    await page.getByRole('button', { name: 'จุดสังเกต', exact: true }).click()
    await page.getByRole('button', { name: 'จุดสังเกต', exact: true }).click()
    await page.getByLabel('ค้นหาชื่อพยาธิ').fill('Trichuris')
    assert.equal(await page.locator('.atlas-species-item').count(), 1)
    await page.locator('.atlas-species-item').click()
    assert.match(await page.locator('.atlas-specimen-caption').innerText(), /Trichuris trichiura/)
    assert.equal(await page.locator('.atlas-model-stage canvas').count(), 1)
    await page.getByLabel('ค้นหาชื่อพยาธิ').fill('OV')
    assert.equal(await page.locator('.atlas-species-item').count(), 1, 'The familiar Thai OV abbreviation must find the liver fluke')
    await page.locator('.atlas-species-item').click()
    assert.equal(await page.locator('.atlas-specimen-caption h2').innerText(), 'Opisthorchis viverrini')
    assert.match(await page.locator('.atlas-feature-section').innerText(), /operculum and shoulders/)
    assert.match(await page.locator('.atlas-feature-section').innerText(), /abopercular knob/)
    assert.match(await page.locator('.atlas-clinical-note').innerText(), /Clonorchis/)
    assert.match(await page.locator('.atlas-clinical-note').innerText(), /ไม่ควรยืนยันชนิดจากภาพไข่เพียงอย่างเดียว/)
    assert.match(await page.locator('.atlas-annotations').innerText(), /Miracidium/i)
    const canvas = page.locator('.atlas-model-stage canvas')
    const bounds = await canvas.boundingBox()
    await page.mouse.move(bounds.x + bounds.width * .45, bounds.y + bounds.height * .5)
    await page.mouse.down()
    await page.mouse.move(bounds.x + bounds.width * .65, bounds.y + bounds.height * .6, { steps: 8 })
    await page.mouse.up()
    await page.getByRole('button', { name: 'เริ่มมุมมองใหม่' }).click()
    await page.getByRole('button', { name: 'หมุนอัตโนมัติ', exact: true }).click()
    await page.getByRole('button', { name: 'จุดสังเกต', exact: true }).click()
    assert.equal(await page.locator('.atlas-annotations').count(), 0)
    await page.getByRole('button', { name: 'จุดสังเกต', exact: true }).click()
    await page.getByLabel('ค้นหาชื่อพยาธิ').fill('')
    await page.locator('.atlas-model-stage canvas').evaluate(canvas => { canvas.dataset.testPersistence = 'original' })
    for (let index = 0; index < atlasNames.length; index++) {
      await page.locator('.atlas-species-item').nth(index).click()
      assert.equal(await page.locator('.atlas-model-stage canvas').getAttribute('data-test-persistence'), 'original')
      assert.equal(await page.locator('.atlas-specimen-caption h2').innerText(), atlasNames[index])
      // Canvas keeps fallback markup in its DOM even when WebGL is active.
      assert.equal(await page.locator('.atlas-svg-fallback').isVisible(), false)
    }
    const addedReferences = [
      { query: 'MIF', name: 'Minute intestinal flukes (MIF)', feature: /miracidium/, note: /เป็นกลุ่มอ้างอิง.*OV.*Clonorchis/ },
      { query: 'ตืดแคระ', name: 'Hymenolepis nana', feature: /polar filaments/, note: /ภาพเดียว/ },
      { query: 'ตืดหนู', name: 'Hymenolepis diminuta', feature: /no polar filaments/, note: /สเกล/ },
      { query: 'ขนาดกลาง', name: 'Echinostoma spp.', feature: /ยังไม่เป็นตัวอ่อน/, note: /Fasciola/ },
      { query: 'ขนาดใหญ่', name: 'Fasciolopsis buski', feature: /ยังไม่เป็นตัวอ่อน/, note: /Fasciola/ },
    ]
    for (const expected of addedReferences) {
      await page.getByLabel('ค้นหาชื่อพยาธิ').fill(expected.query)
      assert.equal(await page.locator('.atlas-species-item').count(), 1, `${expected.query} must find the new reference`)
      await page.locator('.atlas-species-item').click()
      assert.equal(await page.locator('.atlas-specimen-caption h2').innerText(), expected.name)
      assert.match(await page.locator('.atlas-feature-section').innerText(), expected.feature)
      assert.match(await page.locator('.atlas-clinical-note').innerText(), expected.note)
      if (expected.name.startsWith('Hymenolepis')) assert.match(await page.locator('.atlas-feature-section').innerText(), /ตะขอ 3 คู่ \(6 hooks\)/)
      if (/Echinostoma|Fasciolopsis/.test(expected.name)) assert.doesNotMatch(await page.locator('.atlas-annotations').innerText(), /Miracidium/i)
      assert.equal(await page.locator('.atlas-model-stage canvas').getAttribute('data-test-persistence'), 'original')
      assert.equal(await page.locator('.atlas-svg-fallback').isVisible(), false)
    }
    await page.getByRole('button', { name: 'ขยายมุมมอง' }).click()
    await page.getByRole('dialog').waitFor()
    await page.keyboard.press('Escape')
    assert.equal(await page.getByRole('dialog').count(), 0)
    await page.getByRole('button', { name: 'ภาพรวม', exact: true }).click()
    await page.locator('.specimen-card').filter({ hasText: 'Opisthorchis viverrini' }).click()
    await page.locator('.atlas-model-stage canvas').waitFor()
    assert.equal(await page.locator('.atlas-specimen-caption h2').innerText(), 'Opisthorchis viverrini', 'The featured OV home card must remount the Atlas at OV rather than the fallback specimen')
    await page.waitForTimeout(150)
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

test('mobile navigation offers rear camera capture; fallback drawings show the distinct structures of all added eggs', { timeout: 60_000 }, async () => {
  const page = await browser.newPage({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true })
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function(type, ...args) {
      if (String(type).startsWith('webgl')) return null
      return original.call(this, type, ...args)
    }
  })
  try {
    await page.goto(baseURL, { waitUntil: 'networkidle' })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.getByRole('button', { name: 'เปิดเมนู' }).click()
    await page.getByRole('button', { name: 'ตรวจวิเคราะห์ AI' }).click()
    assert.equal(await page.getByLabel('ถ่ายภาพด้วยกล้อง').getAttribute('capture'), 'environment')
    await page.getByRole('button', { name: 'เปิดเมนู' }).click()
    await page.getByRole('button', { name: 'Atlas 3D', exact: true }).click()
    await page.locator('.atlas-svg-fallback').waitFor()
    assert.match(await page.locator('.atlas-svg-fallback').innerText(), /ไม่รองรับ WebGL/)
    await page.getByLabel('ค้นหาชื่อพยาธิ').fill('OV')
    assert.equal(await page.locator('.atlas-species-item').count(), 1)
    await page.locator('.atlas-species-item').click()
    const fallback = page.locator('.atlas-svg-fallback')
    await fallback.getByRole('img', { name: 'ภาพวาดจำลองไข่ Opisthorchis viverrini', exact: true }).waitFor()
    assert.equal(await fallback.getByRole('group', { name: 'ฝาปิดและบ่าของไข่ OV', exact: true }).count(), 1)
    assert.equal(await fallback.getByRole('group', { name: 'ปุ่มเล็กที่ขั้วตรงข้ามฝา (abopercular knob)', exact: true }).count(), 1)
    assert.equal(await fallback.getByRole('group', { name: 'ตัวอ่อน miracidium ของไข่ OV', exact: true }).count(), 0)
    await page.getByRole('button', { name: 'ภาพตัดภายใน', exact: true }).click()
    assert.equal(await fallback.getByRole('group', { name: 'ตัวอ่อน miracidium ของไข่ OV', exact: true }).count(), 1)
    const cutaway = page.getByRole('button', { name: 'ภาพตัดภายใน', exact: true })
    for (const name of atlasNames.slice(6)) {
      await page.getByLabel('ค้นหาชื่อพยาธิ').fill(name)
      assert.equal(await page.locator('.atlas-species-item').count(), 1)
      await page.locator('.atlas-species-item').click()
      await fallback.getByRole('img', { name: `ภาพวาดจำลองไข่ ${name}`, exact: true }).waitFor()
      assert.equal(await page.locator('.atlas-specimen-caption h2').innerText(), name)
      if (await cutaway.getAttribute('aria-pressed') === 'true') await cutaway.click()
      assert.equal(await fallback.getByRole('group', { name: 'ตะขอ 3 คู่', exact: true }).count(), 0, 'Oncosphere hooks must be an internal structure')
      if (name === 'Minute intestinal flukes (MIF)') {
        assert.equal(await fallback.getByRole('group', { name: 'ฝาปิดของไข่ MIF', exact: true }).count(), 1)
        assert.equal(await fallback.getByRole('group', { name: 'ตัวอ่อน miracidium ของไข่ MIF', exact: true }).count(), 0)
      } else if (name === 'Hymenolepis nana') {
        assert.equal(await fallback.getByRole('group', { name: 'เส้นใยขั้วของไข่ Hymenolepis nana', exact: true }).count(), 0)
      } else if (name === 'Hymenolepis diminuta') {
        assert.equal(await fallback.getByRole('group', { name: 'ผนังสองชั้นของไข่ Hymenolepis diminuta', exact: true }).locator('ellipse').count(), 2)
      } else {
        assert.equal(await fallback.getByRole('group', { name: `ฝาปิดของไข่ ${name}`, exact: true }).count(), 1)
        assert.equal(await fallback.getByRole('group', { name: 'กลุ่มเซลล์ไข่แดง ไข่ยังไม่เจริญเป็นตัวอ่อน', exact: true }).count(), 0)
      }
      await cutaway.click()
      if (name.startsWith('Hymenolepis')) {
        assert.equal(await fallback.getByRole('group', { name: 'ตะขอ 3 คู่', exact: true }).locator('path').count(), 6, `${name} must show a six-hooked oncosphere`)
        assert.equal(await fallback.getByRole('group', { name: 'เส้นใยขั้วของไข่ Hymenolepis nana', exact: true }).count(), name === 'Hymenolepis nana' ? 1 : 0, 'Polar filaments distinguish nana from diminuta')
      } else if (name === 'Minute intestinal flukes (MIF)') {
        assert.equal(await fallback.getByRole('group', { name: 'ตัวอ่อน miracidium ของไข่ MIF', exact: true }).count(), 1)
      } else {
        assert.equal(await fallback.getByRole('group', { name: 'กลุ่มเซลล์ไข่แดง ไข่ยังไม่เจริญเป็นตัวอ่อน', exact: true }).count(), 1)
        assert.equal(await fallback.getByRole('group', { name: /miracidium/i }).count(), 0, 'Fresh-stool Echinostoma and Fasciolopsis diagrams must show an unembryonated egg')
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `The new ${name} specimen must fit a mobile viewport`)
    }
    await page.getByLabel('ค้นหาชื่อพยาธิ').fill('')
    assert.deepEqual(await page.locator('.atlas-species-item strong').allTextContents(), atlasNames, 'Removed Schistosoma entries must stay absent on mobile')
  } finally { await page.close() }
})
