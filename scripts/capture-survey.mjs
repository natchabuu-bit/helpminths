import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'

// Documentation screenshots must use the actual imported public dataset. No
// request interception, clinical fixtures, accounts or patient images are used.
const baseURL = process.env.HELPMINTHS_TEST_URL || 'http://127.0.0.1:8082'
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(baseURL).hostname))
const directory = resolve('public/project/screenshots')
await mkdir(directory, { recursive: true })
const artifact = JSON.parse(await readFile('backend/data/health-survey-2569.json', 'utf8'))
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), headless: true, args: ['--no-sandbox'] })
const captures = []
try {
  for (const width of [1440, 375]) {
    const context = await browser.newContext({ viewport: { width, height: width === 1440 ? 1000 : 900 }, serviceWorkers: 'block', timezoneId: 'Asia/Bangkok' })
    const page = await context.newPage(), errors = []
    page.on('pageerror', error => errors.push(error.message))
    const session = await page.request.get(`${baseURL}/api/platform/session`)
    assert.equal(session.headers()['x-helpminths-test-fixture'], undefined)
    const identity = await session.json()
    assert.equal(identity.configured, false); assert.equal(identity.user, null)
    const response = await page.request.get(`${baseURL}/api/platform/operations/dashboard`), actual = await response.json()
    assert.equal(actual.source.provider, 'uploaded_workbook'); assert.equal(actual.source.version, artifact.dataset.version)
    assert.equal(actual.data.summary.tested_count, 15888); assert.equal(actual.data.summary.infected_count, 698)
    assert.equal(actual.data.named_school_statistics, true)
    assert.equal(actual.data.by_school.length, 170); assert.equal(actual.data.followup_eligible_school_count, 108)
    await page.goto(`${baseURL}/#dashboard`, { waitUntil: 'networkidle' })
    await page.getByTestId('survey-positive').filter({ hasText: '698' }).waitFor()
    await page.evaluate(() => document.fonts.ready)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    const filename = width === 1440 ? 'health-dashboard.png' : 'health-dashboard-mobile.png'
    await page.screenshot({ path: resolve(directory, filename), animations: 'disabled' })
    captures.push({ filename, capturedAt: new Date().toISOString(), viewport: { width, height: width === 1440 ? 1000 : 900 }, description: `Dashboard จาก helminth-dashboard.zip ใช้สถิติจริงจาก 2569.xlsx (${width}px)`, source: 'actual running prototype; uploaded workbook aggregate API', datasetVersion: actual.source.version, privatePatientImages: false })
    if (width === 1440) {
      await page.locator('.hd-grid').screenshot({ path: resolve(directory, 'health-dashboard-charts.png'), animations: 'disabled', style: '.hd-filters { position: relative !important; }' })
      captures.push({ ...captures.at(-1), filename: 'health-dashboard-charts.png', description: 'กราฟสถิติจริงและโรงเรียนที่ควรติดตาม เรียงร้อยละในกลุ่มส่งตรวจตั้งแต่ 30 คน' })
      await page.getByTestId('survey-school-followup').screenshot({ path: resolve(directory, 'health-dashboard-followup.png'), animations: 'disabled', style: '.hd-filters { position: relative !important; }' })
      captures.push({ ...captures.at(-1), filename: 'health-dashboard-followup.png', description: 'โรงเรียนที่ควรติดตาม 8 อันดับแรกจาก 108 แห่งที่ส่งตรวจตั้งแต่ 30 คน ตามคำขอเจ้าของ' })
      await page.getByTestId('survey-aggregate-table').screenshot({ path: resolve(directory, 'health-dashboard-schools.png'), animations: 'disabled', style: '.hd-filters { position: relative !important; }' })
      captures.push({ ...captures.at(-1), filename: 'health-dashboard-schools.png', description: 'ตารางรายชื่อโรงเรียน/ศูนย์ 170 แห่งที่มีผู้ส่งตรวจจริง พร้อมค้นหา เรียง และ CSV' })
    }
    assert.deepEqual(errors, [])
    await context.close()
  }
  const manifestPath = resolve(directory, 'manifest.json'), manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  manifest.files = [...manifest.files.filter(file => !captures.some(capture => capture.filename === file.filename)), ...captures]
  manifest.updatedAt = new Date().toISOString()
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  process.stdout.write(`Captured ${captures.length} dashboard images from dataset ${artifact.dataset.version}\n`)
} finally { await browser.close() }
