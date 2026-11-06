import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { existsSync } from 'node:fs'
import { chromium } from 'playwright'

const baseURL = process.env.HELPMINTHS_TEST_URL || 'http://127.0.0.1:8088'
let browser
before(async () => {
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
    headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  })
})
after(async () => browser?.close())

test('the field overview explores real Atlas anatomy, respects reduced motion and opens the selected reference', { timeout: 90_000 }, async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', serviceWorkers: 'block' })
  const errors = [], analysisRequests = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (request.method() === 'POST' && /\/api\/(analyze|platform\/analyses)$/.test(new URL(request.url()).pathname)) analysisRequests.push(request.url()) })
  try {
    await page.goto(baseURL, { waitUntil: 'networkidle' })
    await page.locator('.field-model-stage canvas').waitFor()
    assert.equal(await page.locator('.atlas-model-stage').count(), 0)
    const rotate = page.locator('.field-model-controls').getByRole('button', { name: 'หมุน', exact: true })
    assert.equal(await rotate.getAttribute('aria-pressed'), 'false', 'Reduced motion must start with rotation paused')
    await rotate.click()
    assert.equal(await rotate.getAttribute('aria-pressed'), 'true')
    await rotate.click()
    await page.getByRole('button', { name: 'ASCARIS ไส้เดือน' }).click()
    await page.locator('.field-specimen-caption').getByRole('heading', { name: 'Ascaris lumbricoides' }).waitFor()
    const section = page.getByRole('button', { name: 'ภาพตัด', exact: true })
    await section.click()
    assert.equal(await section.getAttribute('aria-pressed'), 'false')
    await page.locator('.field-structure-list').getByRole('button', { name: /เซลล์ไข่/ }).focus()
    await page.keyboard.press('Enter')
    assert.equal(await section.getAttribute('aria-pressed'), 'true', 'Selecting an internal structure must reveal it')
    assert.match(await page.locator('.field-structure-description').innerText(), /ปฏิสนธิ|ตัวอ่อน/)
    const zoom = page.getByRole('slider', { name: 'ขยายโมเดลหน้าหลัก', exact: true })
    await zoom.focus(); await zoom.press('End')
    assert.equal(await zoom.inputValue(), '1.7')
    await page.getByRole('button', { name: 'คืนมุมมองโมเดลหน้าหลัก', exact: true }).click()
    assert.equal(await zoom.inputValue(), '1')
    await page.getByRole('button', { name: 'TAENIA พยาธิตืด' }).click()
    await page.locator('.field-structure-list').getByRole('button', { name: /ตะขอ/ }).click()
    assert.match(await page.locator('.field-structure-description').innerText(), /6|สาม|3/)
    await page.getByRole('button', { name: 'ดู Taenia spp. ใน Atlas', exact: true }).click()
    await page.locator('.atlas-specimen-caption').getByRole('heading', { name: 'Taenia spp.', exact: true }).waitFor()
    await page.getByRole('link', { name: 'ข้ามไปเนื้อหาหลัก', exact: true }).focus()
    await page.keyboard.press('Enter')
    assert.equal(await page.evaluate(() => location.hash), '#atlas', 'Skipping navigation must preserve the current page URL')
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'main-content')
    assert.deepEqual(analysisRequests, [], 'Exploring a teaching model must never submit an image for analysis')
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

test('the overview has an honest 2D fallback and keeps camera/upload one action away on phones', { timeout: 60_000 }, async () => {
  const page = await browser.newPage({ viewport: { width: 375, height: 900 }, reducedMotion: 'reduce', serviceWorkers: 'block' })
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      return ['webgl', 'webgl2', 'experimental-webgl'].includes(type) ? null : original.call(this, type, ...args)
    }
  })
  try {
    await page.goto(baseURL, { waitUntil: 'networkidle' })
    await page.locator('.field-model-stage .atlas-svg-fallback').waitFor()
    assert.match(await page.locator('.field-model-stage').innerText(), /2 มิติ.*WebGL/)
    assert.equal(await page.locator('.field-model-stage canvas').count(), 0)
    const quickUpload = page.getByRole('button', { name: 'อัปโหลดหรือถ่ายภาพ', exact: true })
    const box = await quickUpload.boundingBox()
    assert.ok(box && box.y + box.height <= 900, 'Primary upload action should be visible without scrolling')
    await quickUpload.click()
    await page.getByLabel('เลือกภาพจากอุปกรณ์').waitFor({ state: 'attached' })
    const camera = page.getByLabel('ถ่ายภาพด้วยกล้อง')
    assert.equal(await camera.getAttribute('capture'), 'environment')
  } finally { await page.close() }
})

test('the instrument layout fits phone, tablet and desktop with all original navigation entries', { timeout: 90_000 }, async () => {
  for (const width of [320, 375, 768, 1024, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: 'reduce', serviceWorkers: 'block' })
    try {
      await page.goto(baseURL, { waitUntil: 'networkidle' })
      await page.locator('.field-model-stage canvas').waitFor()
      const dimensions = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }))
      assert.ok(dimensions.content <= dimensions.viewport + 1, `Home overflows ${width}px: ${dimensions.content}`)
      assert.equal(await page.locator('.sidebar .nav-item').count(), 10)
      const menu = page.getByRole('button', { name: 'เปิดเมนู', exact: true })
      if (await menu.isVisible()) await menu.click()
      await page.locator('.sidebar .nav-item').filter({ hasText: 'ประเมินและข้อเสนอแนะ' }).click()
      await page.getByRole('tab', { name: 'แบบประเมิน SUS', exact: true }).click()
      assert.equal(await page.getByRole('radio').count(), 50)
      assert.equal(await page.getByRole('textbox').count(), 1)
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `SUS overflows ${width}px`)
    } finally { await page.close() }
  }
})
