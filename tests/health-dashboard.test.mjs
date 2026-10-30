import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { existsSync } from 'node:fs'
import { chromium } from 'playwright'

// All numbers below are SYNTHETIC software-test fixtures. They never become
// published project statistics, source data, patient records or model evidence.
const baseURL = process.env.HELPMINTHS_TEST_URL || 'http://127.0.0.1:8081'
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined)
const source = { provider: 'google_sheets', spreadsheet_id: '1OlVnkehNCAJWVE0sR_5ypqi9XeuCI8-d', url: 'https://docs.google.com/spreadsheets/d/1OlVnkehNCAJWVE0sR_5ypqi9XeuCI8-d/edit', worksheet: null }
const fetchedAt = '2026-10-30T01:02:03Z'
let browser
before(async () => {
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(baseURL).hostname), 'Run synthetic dashboard UI tests only against a localhost application')
  browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
})
after(async () => browser?.close())

function metadata() { return { configured: true, source, refresh_seconds: 30, access: 'public_aggregates', mapping_configured: true } }
function dataFixture(province = '') {
  const byProvince = [
    { province: 'พิษณุโลก', records: 1, total_students: 50, tested_count: 40, infected_count: 8 },
    { province: 'ตาก', records: 1, total_students: 100, tested_count: 60, infected_count: 6 },
  ].filter(item => !province || item.province === province)
  const tested = byProvince.reduce((sum, row) => sum + row.tested_count, 0)
  const infected = byProvince.reduce((sum, row) => sum + row.infected_count, 0)
  const students = byProvince.reduce((sum, row) => sum + row.total_students, 0)
  const metrics = [
    { key: 'total_students', label: 'นักเรียนทั้งหมด', value: students, unit: 'คน' },
    { key: 'tested_count', label: 'ส่งตรวจ', value: tested, unit: 'คน' },
    { key: 'coverage_percent', label: 'ร้อยละส่งตรวจ', value: tested / students * 100, unit: '%' },
    { key: 'infected_count', label: 'ตรวจพบพยาธิ', value: infected, unit: 'คน' },
    { key: 'infection_rate_percent', label: 'ร้อยละตรวจพบ', value: infected / tested * 100, unit: '%' },
    { key: 'multiple_infections_count', label: 'ติดพยาธิมากกว่า1ชนิด', value: province === 'ตาก' ? 1 : province ? 2 : 3, unit: 'คน' },
    { key: 'school_count', label: 'โรงเรียนที่มีข้อมูล', value: byProvince.length, unit: 'โรงเรียน' },
    { key: 'province_count', label: 'จังหวัดที่มีข้อมูล', value: byProvince.length, unit: 'จังหวัด' },
  ]
  return { row_count: byProvince.length, tested_count: tested, infected_count: infected, infection_rate_percent: infected / tested * 100,
    metrics, trend: [], statuses: [], coverage: { dated_rows: 0, status_rows: 0 }, by_province: byProvince,
    by_parasite: [{ parasite: 'Hookworm', count: 9, unit: 'people' }, { parasite: 'Ascaris lumbricoides', count: 7, unit: 'people' }],
    available_years: [], available_provinces: ['ตาก', 'พิษณุโลก'] }
}
function responseFixture(status = 'ready', data = dataFixture(), extra = {}) {
  return { status, source, refresh_seconds: 30, fetched_at: status === 'unavailable' ? null : fetchedAt, last_attempt_at: '2026-10-30T01:02:04Z', error: null, warnings: [], data, ...extra }
}
async function openDashboard({ response = () => responseFixture(), metadataResponse = () => metadata(), width = 1440, clock = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: 'block' })
  const page = await context.newPage()
  const errors = [], requests = [], writes = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(request.method() + ' ' + request.url()) })
  if (clock) { await page.clock.install({ time: new Date('2026-10-30T12:00:00Z') }); await page.clock.pauseAt(new Date('2026-10-30T12:01:00Z')) }
  await page.route('**/api/platform/session', route => route.fulfill({ json: { configured: false, user: null, csrf_token: null, bootstrap_required: false } }))
  await page.route('**/api/platform/operations/status', route => route.fulfill({ json: metadataResponse() }))
  await page.route('**/api/platform/operations/dashboard*', async route => {
    const url = new URL(route.request().url())
    requests.push(url)
    const value = await response(url, requests.length, route)
    if (value !== undefined) await route.fulfill({ json: value })
  })
  await page.goto(`${baseURL}/#dashboard`, { waitUntil: 'networkidle' })
  await page.getByTestId('health-survey-dashboard').waitFor()
  return { page, context, requests, finish: async () => { await context.close(); assert.deepEqual(errors, []); assert.deepEqual(writes, [], 'The public survey dashboard must never write source or clinical data') } }
}
async function nav(page, label) {
  const menu = page.getByRole('button', { name: 'เปิดเมนู', exact: true })
  if (await menu.isVisible() && await menu.getAttribute('aria-expanded') !== 'true') await menu.click()
  await page.locator('.sidebar .nav-item').filter({ hasText: label }).click()
}
function card(page, key) { return page.locator(`.hsd-stat-${key} .hsd-stat-value strong`) }
async function expectText(locator, text) { await locator.filter({ hasText: text }).waitFor(); assert.equal(await locator.innerText(), text) }

test('public Dashboard navigation and upstream failure never manufacture screening figures', async () => {
  const { page, finish } = await openDashboard({ response: () => responseFixture('unavailable', null, { error: { code: 'connection_failed', message: 'SYNTHETIC TEST: upstream is unavailable' } }) })
  try {
    await page.getByRole('heading', { name: 'ยังอ่านข้อมูลจาก Google Sheets ไม่ได้', exact: true }).waitFor()
    assert.equal(await page.locator('.sidebar .nav-item').count(), 10)
    assert.equal(await page.locator('.sidebar .nav-item[aria-current="page"]').innerText(), 'Dashboard')
    for (const key of ['total_students', 'tested_count', 'infected_count', 'infection_rate_percent', 'coverage_percent']) assert.equal(await card(page, key).innerText(), '—')
    assert.equal(await page.locator('.hsd-status.is-ready').count(), 0)
    assert.equal(await page.locator('.hsd-province-table tbody tr').count(), 0)
    assert.equal(await page.locator('.hsd-update strong').innerText(), 'ยังไม่มีการอ่านข้อมูลสำเร็จ')
    assert.equal(await page.getByRole('combobox', { name: 'ปีข้อมูล Dashboard' }).isDisabled(), true)
    assert.equal(await page.getByRole('combobox', { name: 'จังหวัด Dashboard' }).isDisabled(), true)
    assert.equal(await page.getByRole('link', { name: 'เปิดแหล่งข้อมูล' }).getAttribute('href'), source.url)
    assert.match(await page.locator('.hsd-refresh-note').innerText(), /30.*วินาที/)
    await nav(page, 'ภาพรวม')
    await page.locator('.page-home').waitFor()
    await nav(page, 'Dashboard')
    await page.getByRole('heading', { name: 'สถานการณ์การติดพยาธิ', exact: true }).waitFor()
  } finally { await finish() }
})

test('aggregate figures, coinfection cautions, source-driven filters and responsive tables preserve their units', async () => {
  const { page, requests, finish } = await openDashboard({ response: url => responseFixture('ready', dataFixture(url.searchParams.get('province') || '')) })
  try {
    await expectText(card(page, 'tested_count'), '100')
    await expectText(card(page, 'infected_count'), '14')
    await expectText(card(page, 'coverage_percent'), '66.7')
    await expectText(card(page, 'infection_rate_percent'), '14')
    assert.equal(await page.locator('.hsd-province-table tbody tr').count(), 2)
    assert.match(await page.locator('.hsd-data-footer').innerText(), /จำนวนแถวไม่เท่ากับจำนวนคน/)
    assert.match(await page.locator('.hsd-parasite-bars').locator('xpath=..').innerText(), /ผู้ติดพยาธิหลายชนิด.*ไม่รวม/)
    assert.equal(await page.getByRole('combobox', { name: 'ปีข้อมูล Dashboard' }).isDisabled(), true, 'No year may be invented when the supplied schema has no year')
    const province = page.getByRole('combobox', { name: 'จังหวัด Dashboard' })
    assert.deepEqual(await province.locator('option').allTextContents(), ['ทุกจังหวัดที่มีข้อมูล', 'ตาก', 'พิษณุโลก'])
    await province.selectOption('ตาก')
    await expectText(card(page, 'tested_count'), '60')
    await expectText(card(page, 'infected_count'), '6')
    assert.equal(requests.at(-1).searchParams.get('province'), 'ตาก')
    assert.equal(await page.locator('.hsd-province-table tbody tr').count(), 1)
    await page.getByRole('button', { name: 'ล้างตัวกรอง', exact: true }).click()
    await expectText(card(page, 'tested_count'), '100')
    assert.equal(requests.at(-1).searchParams.has('province'), false)
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 })
      const size = await page.evaluate(() => ({ viewport: innerWidth, actual: document.documentElement.scrollWidth }))
      assert.ok(size.actual <= size.viewport + 1, `Dashboard must not overflow ${width}px (${size.actual})`)
      assert.equal(await page.getByRole('heading', { name: 'สถานการณ์การติดพยาธิ', exact: true }).isVisible(), true)
    }
    assert.equal(await card(page, 'infected_count').innerText(), '14', 'The unique infected-person total must not be replaced by 9+7 parasite findings')
  } finally { await finish() }
})

test('actual 30-second polling retains a labelled stale snapshot and the last successful source timestamp', async () => {
  const { page, requests, finish } = await openDashboard({ clock: true, response: (_url, count) => count === 1 ? responseFixture() : responseFixture('unavailable', null, { last_attempt_at: '2026-10-30T01:03:04Z', error: { code: 'connection_failed', message: 'SYNTHETIC TEST: later fetch failed' } }) })
  try {
    await expectText(card(page, 'tested_count'), '100')
    const originalTimestamp = await page.locator('.hsd-update strong').innerText()
    assert.notEqual(originalTimestamp, 'ยังไม่มีการอ่านข้อมูลสำเร็จ')
    await page.clock.fastForward(29_999)
    assert.equal(requests.length, 1)
    await page.clock.fastForward(1)
    await page.getByRole('heading', { name: 'ข้อมูลอาจยังไม่เป็นปัจจุบัน', exact: true }).waitFor()
    assert.equal(requests.length, 2)
    assert.equal(await card(page, 'tested_count').innerText(), '100')
    assert.equal(await page.locator('.hsd-update strong').innerText(), originalTimestamp)
    assert.equal(await page.locator('.hsd-status.is-stale').count(), 1)
    assert.equal(await page.locator('.hsd-status.is-ready').count(), 0)
    await page.getByRole('button', { name: 'รีเฟรชข้อมูล Dashboard', exact: true }).click()
    await page.waitForFunction(() => !document.querySelector('.hsd-update button')?.disabled)
    assert.equal(requests.length, 3)
    assert.equal(await page.locator('.hsd-update strong').innerText(), originalTimestamp)
  } finally { await finish() }
})

test('offline polling pauses, reconnect wakes it, and leaving the page removes its poll timer', async () => {
  const { page, context, requests, finish } = await openDashboard({ clock: true })
  try {
    await expectText(card(page, 'tested_count'), '100')
    await context.setOffline(true)
    await page.locator('.hsd-status').filter({ hasText: 'ออฟไลน์' }).waitFor()
    await page.clock.fastForward(90_000)
    assert.equal(requests.length, 1, 'Offline state must pause the upstream polling loop')
    assert.equal(await page.locator('.hsd-status.is-ready').count(), 0)
    const reconnected = page.waitForResponse(response => new URL(response.url()).pathname === '/api/platform/operations/dashboard')
    await context.setOffline(false)
    await reconnected
    await page.locator('.hsd-status.is-ready').waitFor()
    assert.equal(requests.length, 2, 'Reconnect must refresh immediately')
    await nav(page, 'ภาพรวม')
    const afterLeaving = requests.length
    await page.clock.fastForward(90_000)
    assert.equal(requests.length, afterLeaving, 'Unmounting the dashboard must dispose its polling timer')
  } finally { await finish() }
})

test('an authenticated source never starts a data request from an anonymous dashboard', async () => {
  const { page, requests, finish } = await openDashboard({ metadataResponse: () => ({ ...metadata(), access: 'authenticated' }) })
  try {
    await page.getByRole('heading', { name: 'แหล่งข้อมูลนี้ต้องเข้าสู่ระบบ', exact: true }).waitFor()
    assert.equal(requests.length, 0)
    assert.equal(await card(page, 'tested_count').innerText(), '—')
    assert.equal(await page.locator('.hsd-province-table tbody tr').count(), 0)
  } finally { await finish() }
})

test('a permission change clears old aggregates rather than retaining them under a public screen', async () => {
  const { page, requests, finish } = await openDashboard({ response: async (_url, count, route) => {
    if (count === 1) return responseFixture()
    await route.fulfill({ status: 401, json: { detail: 'SYNTHETIC TEST: source now requires authentication' } })
  } })
  try {
    await expectText(card(page, 'tested_count'), '100')
    await page.getByRole('button', { name: 'รีเฟรชข้อมูล Dashboard', exact: true }).click()
    await page.getByRole('heading', { name: 'แหล่งข้อมูลนี้ต้องเข้าสู่ระบบ', exact: true }).waitFor()
    assert.equal(requests.length, 2)
    assert.equal(await card(page, 'tested_count').innerText(), '—')
    assert.equal(await page.locator('.hsd-province-table tbody tr').count(), 0)
    assert.equal(await page.locator('.hsd-status.is-ready').count(), 0)
  } finally { await finish() }
})

test('changing the spreadsheet source clears old aggregates before reporting the new source failure', async () => {
  const replacement = { ...source, spreadsheet_id: 'CUSTOM_NEW_SOURCE_FIXTURE', worksheet: 'NEW_SYNTHETIC_SHEET', url: 'https://docs.google.com/spreadsheets/d/CUSTOM_NEW_SOURCE_FIXTURE/edit' }
  let metadataReads = 0
  const { page, requests, finish } = await openDashboard({
    metadataResponse: () => ({ ...metadata(), source: ++metadataReads === 1 ? source : replacement }),
    response: (_url, count) => count === 1 ? responseFixture() : responseFixture('unavailable', null, { source: replacement, error: { code: 'connection_failed', message: 'SYNTHETIC TEST: replacement source is unavailable' } }),
  })
  try {
    await expectText(card(page, 'tested_count'), '100')
    await page.getByRole('button', { name: 'รีเฟรชข้อมูล Dashboard', exact: true }).click()
    await page.getByRole('heading', { name: 'ยังอ่านข้อมูลจาก Google Sheets ไม่ได้', exact: true }).waitFor()
    assert.equal(requests.length, 2)
    assert.equal(await card(page, 'tested_count').innerText(), '—', 'An old source value must not be attributed to its replacement')
    assert.equal(await card(page, 'infected_count').innerText(), '—')
    assert.equal(await page.locator('.hsd-update strong').innerText(), 'ยังไม่มีการอ่านข้อมูลสำเร็จ')
    assert.equal(await page.locator('.hsd-province-table tbody tr').count(), 0)
    assert.equal(await page.getByRole('link', { name: 'เปิดแหล่งข้อมูล' }).getAttribute('href'), replacement.url)
  } finally { await finish() }
})
