import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright'

const baseURL = process.env.HELPMINTHS_TEST_URL || 'http://127.0.0.1:8089'
let browser
before(async () => {
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), headless: true, args: ['--no-sandbox'] })
})
after(async () => browser?.close())

function raster(format) {
  // Synthetic raster bytes, never microscope or participant data.
  return Buffer.from(execFileSync(resolve('.venv/bin/python'), ['-c', `import base64,io,sys
from PIL import Image
from pillow_heif import register_heif_opener
register_heif_opener()
image=Image.new('RGB',(64,48),(220,30,20))
output=io.BytesIO()
if sys.argv[1]=='GIF':
 image.save(output,format='GIF',save_all=True,append_images=[Image.new('RGB',image.size,(20,220,30))],duration=80,loop=0)
else: image.save(output,format=sys.argv[1])
print(base64.b64encode(output.getvalue()).decode())`, format], { encoding: 'utf8' }).trim(), 'base64')
}

test('a renamed raster, TIFF, HEIC and AVIF open as actual images without requiring an analysis model', { timeout: 60_000 }, async () => {
  const page = await browser.newPage({ viewport: { width: 375, height: 1000 }, serviceWorkers: 'block' })
  const errors = [], analysisPosts = []
  page.on('pageerror', failure => errors.push(failure.message))
  page.on('request', request => { if (request.method() === 'POST' && /\/api\/(analyze|platform\/analyses)$/.test(new URL(request.url()).pathname)) analysisPosts.push(request.url()) })
  try {
    await page.goto(`${baseURL}/#scan`, { waitUntil: 'networkidle' })
    assert.equal(await page.getByLabel('เลือกภาพจากอุปกรณ์').getAttribute('accept'), '*/*')
    for (const format of ['PNG', 'BMP', 'TIFF', 'HEIF', 'AVIF']) {
      await page.getByLabel('เลือกภาพจากอุปกรณ์').setInputFiles({ name: `SYNTHETIC_${format}.unusual-extension`, mimeType: 'application/octet-stream', buffer: raster(format) })
      await page.locator('.scan-image-svg image').waitFor()
      await page.locator('.scan-image-name').filter({ hasText: `SYNTHETIC_${format}` }).waitFor()
      assert.match(await page.locator('.scan-card-caption').first().innerText(), /64 × 48/)
      if (['TIFF', 'HEIF', 'AVIF'].includes(format)) {
        await page.getByRole('status').filter({ hasText: `แปลง ${format}` }).waitFor()
        assert.match(await page.locator('.scan-image-svg image').getAttribute('href'), /^data:image\/png/)
      }
      await page.getByRole('button', { name: 'ล้างภาพในหน้านี้', exact: true }).click()
      await page.locator('.scan-upload-zone').waitFor()
    }
    assert.deepEqual(analysisPosts, [], 'Preparing an image must not run inference automatically')
    assert.deepEqual(errors, [])
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
  } finally { await page.close() }
})

test('animated previews freeze one frame offline and non-image documents cannot masquerade as microscope photos', { timeout: 60_000 }, async () => {
  const context = await browser.newContext({ serviceWorkers: 'block' })
  const page = await context.newPage()
  try {
    await page.goto(`${baseURL}/#scan`, { waitUntil: 'networkidle' })
    await context.setOffline(true)
    await page.getByLabel('เลือกภาพจากอุปกรณ์').setInputFiles({ name: 'SYNTHETIC_animation.gif', mimeType: 'image/gif', buffer: raster('GIF') })
    await page.locator('.scan-image-svg image').waitFor()
    assert.match(await page.locator('.scan-image-svg image').getAttribute('href'), /^data:image\/png/)
    assert.match(await page.getByRole('status').filter({ hasText: 'ใช้ภาพแรก' }).innerText(), /ภาพนิ่ง/)
    const pixel = await page.evaluate(async () => {
      const image = new Image(); image.src = document.querySelector('.scan-image-svg image').getAttribute('href'); await image.decode()
      const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 48
      const context = canvas.getContext('2d'); context.drawImage(image, 0, 0)
      return [...context.getImageData(32, 24, 1, 1).data]
    })
    assert.deepEqual(pixel, [220, 30, 20, 255])
    await context.setOffline(false)
    await page.getByRole('button', { name: 'ล้างภาพในหน้านี้', exact: true }).click()
    for (const [name, content] of [['renamed.jpg', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'], ['report.png', '%PDF-1.7\nnot an image']]) {
      const converted = page.waitForResponse(response => response.url().endsWith('/api/images/normalize') && response.request().method() === 'POST')
      await page.getByLabel('เลือกภาพจากอุปกรณ์').setInputFiles({ name, mimeType: 'image/jpeg', buffer: Buffer.from(content) })
      assert.equal((await converted).status(), 415)
      await page.getByRole('alert').waitFor()
      assert.match(await page.getByRole('alert').innerText(), /ไม่รองรับ SVG, PDF หรือ RAW/)
      assert.equal(await page.locator('.scan-image-svg').count(), 0)
    }
  } finally { await context.close() }
})
