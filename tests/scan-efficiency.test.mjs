import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { existsSync } from 'node:fs'
import { chromium } from 'playwright'

// Real API and predictor plumbing, restricted to disposable localhost fixtures.
// These checkerboards are software checks, never diagnostic accuracy evidence.
const origin = new URL(process.env.HELPMINTHS_SCAN_EFFICIENCY_TEST_URL || 'http://127.0.0.1:8130').origin
const password = 'Synthetic-UI-test-only-2026!'
const imagePaths = new Set(['/api/platform/quality', '/api/platform/analyses', '/api/analyze', '/api/images/normalize'])
let browser
before(async () => {
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname), 'Only localhost fixtures may receive test writes')
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), headless: true, args: ['--no-sandbox'] })
})
after(async () => browser?.close())

async function fixture(request) {
  const response = await request.get(`${origin}/api/platform/status`, { maxRedirects: 0 })
  assert.equal(response.status(), 200)
  assert.equal(response.headers()['x-helpminths-test-fixture'], 'synthetic-only', 'Refusing writes without the synthetic fixture marker')
}
async function checked(response, status = 200) {
  assert.equal(response.headers()['x-helpminths-test-fixture'], 'synthetic-only')
  assert.equal(response.status(), status, await response.text())
  return response.json()
}
async function openScan() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', serviceWorkers: 'block' })
  const errors = [], safetyErrors = [], uploads = []
  try {
    await fixture(context.request)
    await checked(await context.request.post(`${origin}/api/platform/login`, { data: { username: 'fixture-lab', password }, maxRedirects: 0 }))
    const configuration = await checked(await context.request.get(`${origin}/api/platform/quality/config`))
    await context.route('**/*', async route => {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) {
        const url = new URL(route.request().url())
        try {
          assert.equal(url.origin, origin)
          assert.ok(url.pathname.startsWith('/api/platform/') || url.pathname === '/api/analyze' || url.pathname === '/api/images/normalize')
          await fixture(context.request)
        } catch (failure) { safetyErrors.push(failure.message); await route.abort('blockedbyclient'); return }
      }
      await route.continue()
    })
    const page = await context.newPage()
    page.setDefaultTimeout(20_000)
    page.on('pageerror', failure => errors.push(failure.message))
    page.on('request', request => {
      const path = new URL(request.url()).pathname
      if (request.method() === 'POST' && imagePaths.has(path)) uploads.push({ path, body: request.postDataBuffer() })
    })
    await page.goto(`${origin}/#scan`, { waitUntil: 'networkidle' })
    return { page, context, uploads, confidence: configuration.inference_confidence, finish: async () => { await context.close(); assert.deepEqual(safetyErrors, []); assert.deepEqual(errors, []) } }
  } catch (failure) { await context.close(); throw failure }
}
async function syntheticImage(page, flat = false) {
  return Buffer.from(await page.evaluate(isFlat => {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 384
    const painter = canvas.getContext('2d')
    for (let y = 0; y < canvas.height; y += 16) for (let x = 0; x < canvas.width; x += 16) {
      const value = isFlat ? 128 : ((x / 16 + y / 16) % 2 ? 180 : 75)
      painter.fillStyle = `rgb(${value},${value},${value})`; painter.fillRect(x, y, 16, 16)
    }
    return canvas.toDataURL('image/png').split(',')[1]
  }, flat), 'base64')
}
async function upload(page, image, code) {
  await page.getByLabel('เลือกภาพจากอุปกรณ์', { exact: true }).setInputFiles({ name: 'SYNTHETIC-efficiency.png', mimeType: 'image/png', buffer: image })
  await page.getByLabel('รหัสตัวอย่างนิรนาม (ไม่บังคับ)', { exact: true }).fill(code)
  const analyze = page.getByRole('button', { name: 'เริ่มวิเคราะห์ภาพ', exact: true })
  await analyze.waitFor()
  await page.waitForFunction(() => { const button = [...document.querySelectorAll('button')].find(node => node.textContent.includes('เริ่มวิเคราะห์ภาพ')); return button && !button.disabled })
}
function analysisResponse(page) { return page.waitForResponse(response => new URL(response.url()).pathname === '/api/platform/analyses' && response.request().method() === 'POST') }
function assertExactRequest(uploaded, image, confidence, acknowledged) {
  assert.equal(uploaded.path, '/api/platform/analyses')
  assert.ok(uploaded.body.includes(image), 'The original prepared PNG bytes must reach the server unchanged')
  const body = uploaded.body.toString('latin1')
  assert.equal(body.match(/name="confidence"\r\n\r\n([^\r\n]+)/)?.[1], String(confidence), 'Inference confidence must remain the configured value')
  assert.equal(body.match(/name="acknowledge_quality"\r\n\r\n([^\r\n]+)/)?.[1], String(acknowledged))
}
function assertFixturePredictions(analysis, confidence) {
  assert.equal(analysis.model, 'UI-TEST-FIXTURE-NOT-TRAINED.pt', 'These are predictable software-fixture outputs, not clinical findings')
  assert.equal(analysis.width, 512); assert.equal(analysis.height, 384)
  const expected = [
    { id: 'ui-fixture-1', class_id: 0, label: 'TEST FIXTURE object A', confidence: .93, bbox: [512 * .15, 384 * .2, 512 * .38, 384 * .48] },
    { id: 'ui-fixture-2', class_id: 1, label: 'TEST FIXTURE object B', confidence: .36, bbox: [512 * .56, 384 * .3, 512 * .81, 384 * .65] },
  ].filter(item => item.confidence >= confidence)
  assert.deepEqual(analysis.detections, expected, 'The fixture must retain every expected class, confidence and box')
}
async function savedCount(context, code) { return checked(await context.request.get(`${origin}/api/platform/analyses?scope=mine&q=${encodeURIComponent(code)}`)) }
async function assertSavedPixels(page, id, original) {
  const equal = await page.evaluate(async ({ analysisId, source }) => {
    async function rgba(blob) {
      const image = await createImageBitmap(blob)
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height
      const context = canvas.getContext('2d'); context.drawImage(image, 0, 0); image.close()
      return context.getImageData(0, 0, canvas.width, canvas.height).data
    }
    const response = await fetch(`/api/platform/analyses/${encodeURIComponent(analysisId)}/image`, { cache: 'no-store', credentials: 'same-origin' })
    if (!response.ok) return false
    const stored = await rgba(await response.blob()), input = await rgba(new Blob([Uint8Array.from(atob(source), character => character.charCodeAt(0))], { type: 'image/png' }))
    return stored.length === input.length && stored.every((value, index) => value === input[index])
  }, { analysisId: id, source: original.toString('base64') })
  assert.equal(equal, true, 'The saved image must preserve every decoded RGBA pixel')
}

test('a passing image reaches analysis in one unchanged upload without an automatic quality preflight', { timeout: 60_000 }, async () => {
  const run = await openScan()
  try {
    const image = await syntheticImage(run.page), code = `SYNTHETIC_SINGLE_UPLOAD_${Date.now()}`
    await upload(run.page, image, code)
    const response = analysisResponse(run.page)
    await run.page.getByRole('button', { name: 'เริ่มวิเคราะห์ภาพ', exact: true }).click()
    const analysis = await checked(await response, 201)
    assert.equal(analysis.status, 'completed'); assert.equal(analysis.quality.status, 'pass')
    assertFixturePredictions(analysis, run.confidence)
    assert.deepEqual(run.uploads.map(item => item.path), ['/api/platform/analyses'])
    assertExactRequest(run.uploads[0], image, run.confidence, false)
    await run.page.locator('.image-quality-summary.is-pass').waitFor()
    assert.equal((await savedCount(run.context, code)).total, 1)
    const stored = await checked(await run.context.request.get(`${origin}/api/platform/analyses/${analysis.id}`))
    assert.deepEqual(stored.detections, analysis.detections)
    assert.equal(stored.confidence_threshold, run.confidence)
    await assertSavedPixels(run.page, analysis.id, image)
  } finally { await run.finish() }
})

test('a first quality warning creates no analysis and still requires acknowledgement before the unchanged retry', { timeout: 60_000 }, async () => {
  const run = await openScan()
  try {
    const image = await syntheticImage(run.page, true), code = `SYNTHETIC_WARNING_${Date.now()}`
    await upload(run.page, image, code)
    const rejected = analysisResponse(run.page)
    await run.page.getByRole('button', { name: 'เริ่มวิเคราะห์ภาพ', exact: true }).click()
    const rejection = await checked(await rejected, 422)
    assert.equal(rejection.detail.code, 'quality_acknowledgement_required')
    assert.equal(rejection.detail.quality.status, 'warning')
    await run.page.locator('.image-quality-summary.is-warning').waitFor()
    assert.equal((await savedCount(run.context, code)).total, 0)
    assert.deepEqual(run.uploads.map(item => item.path), ['/api/platform/analyses'])
    assertExactRequest(run.uploads[0], image, run.confidence, false)
    await run.page.getByRole('button', { name: 'เริ่มวิเคราะห์ภาพ', exact: true }).click()
    await run.page.locator('.scan-error').waitFor()
    assert.equal(run.uploads.length, 1, 'A known warning must be blocked locally until acknowledged')
    await run.page.getByRole('checkbox', { name: /ฉันรับทราบข้อจำกัด/ }).check()
    await run.page.getByLabel('เหตุผลที่ใช้ภาพนี้ต่อ', { exact: true }).fill('SYNTHETIC SOFTWARE TEST: confirm unchanged quality override safeguards.')
    const retried = analysisResponse(run.page)
    await run.page.getByRole('button', { name: 'เริ่มวิเคราะห์ภาพ', exact: true }).click()
    const analysis = await checked(await retried, 201)
    assert.equal(analysis.status, 'completed'); assert.equal(analysis.quality.status, 'warning')
    assertFixturePredictions(analysis, run.confidence)
    assert.equal(run.uploads.length, 2); assertExactRequest(run.uploads[1], image, run.confidence, true)
    assert.equal((await savedCount(run.context, code)).total, 1)
    await assertSavedPixels(run.page, analysis.id, image)
  } finally { await run.finish() }
})

test('manual quality checking remains available and analysis independently checks the same image', { timeout: 60_000 }, async () => {
  const run = await openScan()
  try {
    const image = await syntheticImage(run.page), code = `SYNTHETIC_MANUAL_QUALITY_${Date.now()}`
    await upload(run.page, image, code)
    const checking = run.page.waitForResponse(response => new URL(response.url()).pathname === '/api/platform/quality' && response.request().method() === 'POST')
    await run.page.getByRole('button', { name: 'ตรวจคุณภาพภาพ', exact: true }).click()
    assert.equal((await checked(await checking)).status, 'pass')
    await run.page.locator('.image-quality-summary.is-pass').waitFor()
    assert.deepEqual(run.uploads.map(item => item.path), ['/api/platform/quality'])
    assert.ok(run.uploads[0].body.includes(image), 'A manual quality check must also receive the exact prepared image')
    assert.equal((await savedCount(run.context, code)).total, 0)
    const response = analysisResponse(run.page)
    await run.page.getByRole('button', { name: 'เริ่มวิเคราะห์ภาพ', exact: true }).click()
    const analysis = await checked(await response, 201)
    assert.equal(analysis.quality.status, 'pass')
    assertFixturePredictions(analysis, run.confidence)
    assert.deepEqual(run.uploads.map(item => item.path), ['/api/platform/quality', '/api/platform/analyses'])
    assertExactRequest(run.uploads[1], image, run.confidence, false)
    assert.equal((await savedCount(run.context, code)).total, 1)
  } finally { await run.finish() }
})
