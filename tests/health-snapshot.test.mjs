import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'

// These checks use the audited, aggregate-only 2569 import through the real API.
// No synthetic screening values or private original workbook are loaded here.
const baseURL = process.env.HELPMINTHS_TEST_URL || 'http://127.0.0.1:8082'
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined)
let browser
before(async () => {
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(baseURL).hostname), 'Run dashboard checks against a local application only')
  const response = await fetch(`${baseURL}/api/platform/operations/status`)
  assert.equal(response.status, 200)
  assert.equal(response.headers.has('x-helpminths-test-fixture'), false)
  const metadata = await response.json()
  assert.equal(metadata.source.provider, 'uploaded_workbook')
  assert.equal(metadata.source.file_name, '2569.xlsx')
  assert.equal(metadata.refresh_seconds, 0)
  assert.equal(metadata.access, 'public_aggregates')
  browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
})
after(async () => browser?.close())

async function openDashboard({ clock = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block', timezoneId: 'Asia/Bangkok' })
  const page = await context.newPage()
  const errors = [], writes = [], requests = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(request.method() + ' ' + request.url())
    if (new URL(request.url()).pathname === '/api/platform/operations/dashboard') requests.push(new URL(request.url()))
  })
  if (clock) { await page.clock.install({ time: new Date('2026-10-31T12:00:00Z') }); await page.clock.pauseAt(new Date('2026-10-31T12:01:00Z')) }
  await page.goto(`${baseURL}/#dashboard`, { waitUntil: 'networkidle' })
  await page.getByTestId('health-survey-dashboard').waitFor()
  await page.locator('.hsd-status.is-ready').waitFor()
  await page.waitForFunction(() => !document.querySelector('[aria-label="รีเฟรชข้อมูล Dashboard"]')?.disabled)
  return { page, requests, finish: async () => { await context.close(); assert.deepEqual(errors, []); assert.deepEqual(writes, [], 'Public statistics must not write clinical or source data') } }
}
const value = (page, key) => page.locator(`.hsd-stat-${key} .hsd-stat-value strong`)
async function text(locator, expected) { await locator.filter({ hasText: expected }).waitFor(); assert.equal(await locator.innerText(), expected) }
async function changed(page, action) {
  const received = page.waitForResponse(response => new URL(response.url()).pathname === '/api/platform/operations/dashboard')
  await action()
  const response = await received
  assert.equal(response.status(), 200)
  const result = await response.json()
  await page.waitForFunction(() => !document.querySelector('[aria-label="รีเฟรชข้อมูล Dashboard"]')?.disabled)
  return result.data
}
async function reset(page) { return changed(page, () => page.getByRole('button', { name: 'ล้างตัวกรอง', exact: true }).click()) }

test('uploaded design renders actual totals, interactive aggregate charts and clear snapshot provenance across screen sizes', async () => {
  const { page, requests, finish } = await openDashboard({ clock: true })
  try {
    await text(page.getByTestId('survey-positive'), '698')
    await text(page.getByTestId('survey-positivity'), '4.4%')
    await text(value(page, 'tested_count'), '15,888')
    await text(value(page, 'total_students'), '17,122')
    await text(value(page, 'school_count'), '174')
    await text(value(page, 'negative_school_count'), '61')
    assert.equal(await page.getByRole('img', { name: 'ความครอบคลุมส่งตรวจ 92.8%' }).count(), 1)
    assert.match(await page.locator('.hd-hero-note').innerText(), /ส่งตรวจศูนย์ 2 หน่วย.*รอข้อมูล 2 หน่วย/)
    assert.match(await page.locator('.hd-hero-note').innerText(), /พบมากกว่า 1 ชนิด 17 คน/)
    assert.equal(await page.locator('.hd-scatter [role="button"]').count(), 10)
    assert.equal(await page.locator('.hd-chips button').count(), 5)
    assert.deepEqual(await page.locator('.hd-chips strong').allTextContents(), ['61', '51', '32', '15', '11'])
    assert.match(await page.locator('.hsd-status').innerText(), /ข้อมูลจากไฟล์นำเข้า/)
    assert.match(await page.locator('.hsd-refresh-note').innerText(), /นำเข้าไฟล์รุ่นใหม่/)
    assert.match(await page.locator('.hsd-data-footer').innerText(), /2569.xlsx/)
    assert.equal(await page.locator('iframe').count(), 0, 'The replacement dashboard must be integrated with the app')
    const initialRequests = requests.length
    await page.clock.fastForward(90_000)
    assert.equal(requests.length, initialRequests, 'A file snapshot must not pretend to poll a live workbook')
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 })
      const sizes = await page.evaluate(() => ({ viewport: innerWidth, documentWidth: document.documentElement.scrollWidth }))
      assert.ok(sizes.documentWidth <= sizes.viewport + 1, `Dashboard overflow at ${width}px: ${JSON.stringify(sizes)}`)
      assert.equal(await page.getByRole('heading', { name: 'ผลตรวจพยาธิในเด็กและเยาวชน', exact: true }).isVisible(), true)
    }
  } finally { await finish() }
})

test('area, affiliation and status filters recompute real counts while preserving pending and zero denominators', async () => {
  const { page, requests, finish } = await openDashboard()
  try {
    const provinces = page.getByRole('combobox', { name: 'จังหวัด Dashboard' })
    assert.deepEqual(await provinces.locator('option').allTextContents(), ['ทุกจังหวัดที่มีข้อมูล', 'ตาก', 'พิษณุโลก', 'อุตรดิตถ์', 'เพชรบูรณ์'])
    const phit = await changed(page, () => provinces.selectOption('พิษณุโลก'))
    assert.equal(phit.summary.tested_count, 441)
    await text(value(page, 'tested_count'), '441')
    await text(page.getByTestId('survey-positive'), '1')
    assert.equal(await page.getByRole('img', { name: 'ความครอบคลุมส่งตรวจ 47.2%' }).count(), 1)
    assert.deepEqual(await page.getByRole('combobox', { name: 'อำเภอ Dashboard' }).locator('option').allTextContents(), ['ทุกอำเภอ', 'ชาติตระการ', 'นครไทย'])
    const district = await changed(page, () => page.getByRole('combobox', { name: 'อำเภอ Dashboard' }).selectOption('ชาติตระการ'))
    assert.equal(requests.at(-1).searchParams.get('district'), 'ชาติตระการ')
    await text(value(page, 'tested_count'), district.summary.tested_count.toLocaleString('th-TH'))
    await reset(page)
    const affiliation = await changed(page, () => page.getByRole('combobox', { name: 'สังกัด Dashboard' }).selectOption('ตชด.34'))
    assert.equal(affiliation.summary.tested_count, 3702)
    await text(value(page, 'tested_count'), '3,702')
    await text(page.getByTestId('survey-positive'), '148')
    const empty = await changed(page, () => provinces.selectOption('พิษณุโลก'))
    assert.equal(empty.summary.school_count, 0)
    assert.equal(empty.summary.tested_count, null)
    assert.equal(await page.getByRole('combobox', { name: 'สังกัด Dashboard' }).inputValue(), 'ตชด.34', 'An incompatible selected filter must stay visible until explicitly cleared')
    await page.getByRole('heading', { name: 'ไม่มีรายการตามตัวกรองนี้', exact: true }).waitFor()
    await text(value(page, 'tested_count'), '—')
    await reset(page)
    const pending = await changed(page, () => page.getByRole('combobox', { name: 'สถานะข้อมูล Dashboard' }).selectOption('pending'))
    assert.equal(pending.summary.school_count, 2)
    assert.equal(pending.summary.tested_count, null)
    await text(value(page, 'tested_count'), '—')
    await text(page.getByTestId('survey-positive'), '—')
    await text(page.getByTestId('survey-positivity'), '—')
    assert.equal(await page.getByRole('img', { name: 'ความครอบคลุมส่งตรวจ ยังคำนวณไม่ได้' }).count(), 1)
    assert.match(await page.locator('.hd-ring').innerText(), /—/)
    const zero = await changed(page, () => page.getByRole('combobox', { name: 'สถานะข้อมูล Dashboard' }).selectOption('zero_tested'))
    assert.equal(zero.summary.tested_count, 0)
    assert.equal(zero.summary.infection_rate_percent, null)
    await text(value(page, 'tested_count'), '0')
    await text(page.getByTestId('survey-positive'), '0')
    await text(page.getByTestId('survey-positivity'), '—')
    assert.equal(zero.quality.formula_error_count, 22)
  } finally { await finish() }
})

test('distribution chips and keyboard scatter selection filter the whole dashboard rather than only changing chart decoration', async () => {
  const { page, requests, finish } = await openDashboard()
  try {
    const high = page.locator('.hd-chips').getByRole('button', { name: /ตั้งแต่ 20%/ })
    const selected = await changed(page, () => high.click())
    assert.equal(requests.at(-1).searchParams.get('positivity_band'), '20plus')
    assert.equal(selected.summary.school_count, 11)
    await text(value(page, 'school_count'), '11')
    await text(page.getByTestId('survey-positive'), selected.summary.infected_count.toLocaleString('th-TH'))
    assert.equal(await high.getAttribute('aria-pressed'), 'true')
    assert.deepEqual(await page.locator('.hd-chips strong').allTextContents(), ['61', '51', '32', '15', '11'])
    await reset(page)
    const point = page.locator('.hd-scatter [role="button"]').filter({ has: page.locator('title', { hasText: 'แม่สอด' }) }).first()
    const scoped = await changed(page, async () => { await point.focus(); await point.press('Enter') })
    assert.equal(requests.at(-1).searchParams.get('province'), 'ตาก')
    assert.equal(requests.at(-1).searchParams.get('district'), 'แม่สอด')
    await text(value(page, 'tested_count'), scoped.summary.tested_count.toLocaleString('th-TH'))
    assert.equal(await page.getByRole('combobox', { name: 'อำเภอ Dashboard' }).inputValue(), 'แม่สอด')
    assert.equal(await page.locator('.hd-scatter [role="button"]').count(), 1)
  } finally { await finish() }
})

test('quality notes, searchable sortable aggregate table and CSV retain source conflicts and public-only fields', async () => {
  const { page, finish } = await openDashboard()
  try {
    const pin = page.locator('.hsd-parasite-bars > li').filter({ hasText: 'พยาธิเข็มหมุด' })
    assert.match(await pin.innerText(), /รายงาน 7.*สอดคล้องเงื่อนไขตัวเลข 6.*ต้องตรวจทาน 1/)
    assert.match(await pin.locator('.hd-bar-value').innerText(), /7.*—/s)
    assert.match(await page.locator('.hsd-parasite-bars > li').filter({ hasText: 'พยาธิไส้เดือน' }).innerText(), /ไม่ระบุ 1 ช่อง/)
    assert.match(await page.locator('.hsd-parasite-bars > li').filter({ hasText: 'พยาธิตืด' }).innerText(), /ไม่ระบุ 1 ช่อง/)
    await page.getByRole('button', { name: 'ข้อมูลและที่มา', exact: true }).click()
    assert.equal(await page.locator('.hd-quality').getAttribute('open'), '')
    assert.match(await page.locator('.hd-quality-body').innerText(), /S37/)
    assert.match(await page.locator('.hd-quality-body').innerText(), /U142/)
    assert.match(await page.locator('.hd-quality-body').innerText(), /M111/)
    assert.match(await page.locator('.hd-quality-body').innerText(), /ชื่อไฟล์.*ไม่มีวันที่/)
    const table = page.locator('.hsd-province-table')
    assert.equal(await table.locator('tbody tr').count(), 10)
    await page.getByRole('group', { name: 'ระดับตารางสรุป' }).getByRole('button', { name: 'จังหวัด', exact: true }).click()
    assert.equal(await table.locator('tbody tr').count(), 4)
    const countSort = table.locator('thead').getByRole('button', { name: /^ส่งตรวจ/ })
    await countSort.click()
    assert.match(await table.locator('tbody tr').first().innerText(), /ตาก.*15,136.*697/)
    await countSort.click()
    assert.match(await table.locator('tbody tr').first().innerText(), /เพชรบูรณ์.*49/)
    await page.getByRole('searchbox', { name: 'ค้นหาตารางพื้นที่และสังกัด' }).fill('พิษณุโลก')
    assert.equal(await table.locator('tbody tr').count(), 1)
    const downloadEvent = page.waitForEvent('download')
    await page.getByRole('button', { name: 'ดาวน์โหลด CSV', exact: true }).click()
    const download = await downloadEvent
    assert.equal(download.suggestedFilename(), 'HelpMinths-province-summary.csv')
    const content = await readFile(await download.path(), 'utf8')
    assert.ok(content.startsWith('\ufeff'))
    assert.match(content, /พิษณุโลก.*934.*441.*1/)
    assert.equal(content.trim().split(/\r?\n/).length, 2, 'CSV must match the searched aggregate table')
    assert.doesNotMatch(content, /โรงเรียน|ตำบล|ชื่อผู้ป่วย/)
    assert.equal(await page.getByTestId('survey-positive').innerText(), '698', 'Searching a table must not silently change the page-wide cohort')
  } finally { await finish() }
})
