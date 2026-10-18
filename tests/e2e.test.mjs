import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const baseURL = process.env.HELPMINTHS_TEST_URL || 'http://127.0.0.1:5173'
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined)
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

test('mocked inference contract renders server boxes without inventing an Atlas match', async () => {
  const page = await browser.newPage()
  let receivedMultipart = false
  await page.route('**/api/health', route => route.fulfill({ json: { status: 'ok', model_ready: true, model_name: 'contract-test-only.pt', message: 'Test fixture' } }))
  await page.route('**/api/analyze', async route => {
    const request = route.request()
    const body = request.postDataBuffer()?.toString('latin1') || ''
    receivedMultipart = request.method() === 'POST' && request.headers()['content-type'].includes('multipart/form-data') && body.includes('name="image"') && body.includes('name="confidence"') && body.includes('0.15')
    await route.fulfill({ json: { id: 'contract-test', filename: 'fixture.png', width: 100, height: 80, model: 'contract-test-only.pt', duration_ms: 12, detections: [{ id: 'box-1', class_id: 9, label: 'Uncatalogued helminth egg', confidence: 0.91, bbox: [8, 7, 45, 50] }] } })
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
    const analyze = page.getByRole('button', { name: 'เริ่มวิเคราะห์ภาพ' })
    await analyze.waitFor()
    await analyze.click()
    await page.locator('.scan-detection-box').waitFor()
    assert.equal(receivedMultipart, true)
    assert.equal(await page.locator('.scan-detection-box > rect').first().getAttribute('x'), '8')
    assert.equal(await page.locator('.scan-detection-box > rect').first().getAttribute('width'), '37')
    assert.match(await page.locator('.scan-detection-item').innerText(), /Uncatalogued helminth egg/)
    assert.equal(await page.locator('.scan-atlas-link').count(), 0)
    assert.equal(await page.locator('.scan-demo-banner').count(), 0)
  } finally { await page.close() }
})

test('Atlas renders WebGL, updates structures, toggles labels without React errors, and closes expanded view', async () => {
  const page = await openPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    await page.getByRole('button', { name: 'Atlas 3D', exact: true }).click()
    await page.locator('.atlas-model-stage canvas').waitFor()
    assert.equal(await page.locator('.atlas-species-item').count(), 8)
    await page.getByRole('button', { name: 'หยุดหมุนอัตโนมัติ' }).click()
    await page.getByRole('button', { name: 'ภาพตัดภายใน', exact: true }).click()
    await page.getByRole('button', { name: 'จุดสังเกต', exact: true }).click()
    await page.getByRole('button', { name: 'จุดสังเกต', exact: true }).click()
    await page.getByLabel('ค้นหาชื่อพยาธิ').fill('Trichuris')
    assert.equal(await page.locator('.atlas-species-item').count(), 1)
    await page.locator('.atlas-species-item').click()
    assert.match(await page.locator('.atlas-specimen-caption').innerText(), /Trichuris trichiura/)
    assert.equal(await page.locator('.atlas-model-stage canvas').count(), 1)
    await page.getByLabel('ค้นหาชื่อพยาธิ').fill('')
    await page.locator('.atlas-model-stage canvas').evaluate(canvas => { canvas.dataset.testPersistence = 'original' })
    for (let index = 0; index < 8; index++) {
      await page.locator('.atlas-species-item').nth(index).click()
      assert.equal(await page.locator('.atlas-model-stage canvas').getAttribute('data-test-persistence'), 'original')
      // Canvas keeps fallback markup in its DOM even when WebGL is active.
      assert.equal(await page.locator('.atlas-svg-fallback').isVisible(), false)
    }
    await page.getByRole('button', { name: 'ขยายมุมมอง' }).click()
    await page.getByRole('dialog').waitFor()
    await page.keyboard.press('Escape')
    assert.equal(await page.getByRole('dialog').count(), 0)
    await page.getByRole('button', { name: 'ภาพรวม', exact: true }).click()
    await page.waitForTimeout(150)
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

test('mobile navigation offers rear camera capture; Atlas falls back without WebGL', async () => {
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
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  } finally { await page.close() }
})
