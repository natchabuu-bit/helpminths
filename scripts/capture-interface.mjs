import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright'

const baseURL = process.env.HELPMINTHS_TEST_URL || 'http://127.0.0.1:8088'
const directory = resolve(process.env.HELPMINTHS_SCREENSHOT_DIR || '/tmp/helpminths-interface-previews')
await mkdir(directory, { recursive: true })
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
  headless: true,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
const files = [], errors = []
try {
  for (const [name, width, height] of [['desktop', 1600, 1100], ['mobile', 375, 1000]]) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce', serviceWorkers: 'block' })
    page.on('pageerror', error => errors.push(error.message))
    const sessionResponse = await page.request.get(`${baseURL}/api/platform/session`)
    assert.equal(sessionResponse.ok(), true)
    assert.equal(sessionResponse.headers()['x-helpminths-test-fixture'], undefined, 'Never capture synthetic clinical fixtures as public documentation')
    const session = await sessionResponse.json()
    assert.equal(session.configured, false, 'Capture only public, unconfigured application pages')
    assert.equal(session.user, null)
    const capture = async screen => {
      await page.evaluate(() => document.fonts.ready)
      await page.evaluate(async () => {
        window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      })
      const filename = `${screen}-${name}.png`
      await page.screenshot({ path: resolve(directory, filename), animations: 'disabled' })
      files.push({ filename, viewport: { width, height }, source: 'actual local public application', patientImages: false })
    }
    const nav = async label => {
      await page.getByRole('navigation', { name: 'เมนูหลัก', exact: true }).getByRole('button', { name: label, exact: true }).click()
    }
    await page.goto(baseURL, { waitUntil: 'networkidle' })
    await page.locator('.field-model-stage canvas').waitFor()
    await page.waitForTimeout(500)
    await capture('home')
    await nav('ตรวจวิเคราะห์')
    await page.locator('.scan-upload-zone').waitFor()
    await capture('scan')
    await nav('Atlas 3D')
    await page.locator('.atlas-model-stage canvas').waitFor()
    await page.waitForTimeout(500)
    await capture('atlas')
    await nav('สถิติโรค')
    await page.getByTestId('health-survey-dashboard').waitFor()
    await page.locator('.hd-hero').waitFor()
    await capture('dashboard')
    await page.close()
  }
  assert.deepEqual(errors, [])
  await writeFile(resolve(directory, 'manifest.json'), JSON.stringify({ capturedAt: new Date().toISOString(), note: 'Actual public UI, no clinical images or synthetic analysis results; captures are not usability-study evidence.', files }, null, 2) + '\n')
  console.log(`Captured ${files.length} interface previews: ${directory}`)
} finally { await browser.close() }
