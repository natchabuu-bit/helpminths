import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { existsSync } from 'node:fs'
import { chromium } from 'playwright'

// SYNTHETIC browser fixtures only. These exercise the real built UI and its
// polling scheduler, not Google access or actual project/patient statistics.
// Every mutation is intercepted and blocked before it reaches a server.
const baseURL = process.env.HELPMINTHS_TEST_URL || 'http://127.0.0.1:8102'
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined)
const spreadsheetId = '1pvGSBJEykTf5NUEsd3SqVdOqpYbpibTj07p23yJ5o-8'
const liveSource = { provider: 'google_sheets', spreadsheet_id: spreadsheetId, url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`, worksheet: null, gid: '', format: 'auto' }
const firstTime = '2026-11-09T01:00:00Z'
const secondTime = '2026-11-09T01:01:00Z'
let browser

before(async () => {
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(baseURL).hostname), 'Run synthetic dashboard tests only against localhost')
  browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
})
after(async () => browser?.close())

function metadata(source = liveSource) {
  return { configured: true, source, schema_id: 'health2-kpd-school-v1', refresh_seconds: 30, access: 'public_aggregates', mapping_configured: true,
    capabilities: { school_summary: true, school_details_extended: true, named_school_statistics: true, person_records_exposed: false, raw_rows_exposed: false } }
}

function schoolRows(revision = 1) {
  const species = { hookworm: 0, ascaris: 0, trichuris: 0, liver_fluke: 0, pinworm: 0, tapeworm: 0, medium_intestinal: 0, strongyloides: 0 }
  return [
    { school_id: 'SYNTHETIC-A', school: `โรงเรียนทดสอบ${revision === 1 ? 'เดิม' : 'ปรับปรุง'}`, tambon: 'ตำบลทดสอบ', province: 'จังหวัดทดสอบ', district: 'อำเภอทดสอบ', affiliation: 'สังกัดทดสอบ', total_students_known: 60, tested_count: revision === 1 ? 40 : 45, infected_count: revision === 1 ? 8 : 9, parasite_counts: { ...species, ascaris: revision === 1 ? 8 : 9 } },
    { school_id: 'SYNTHETIC-B', school: 'ศูนย์ทดสอบกลุ่มเล็ก', tambon: 'ตำบลทดสอบ', province: 'จังหวัดทดสอบ', district: 'อำเภอทดสอบ', affiliation: 'สังกัดทดสอบ', total_students_known: 30, tested_count: 20, infected_count: 5, parasite_counts: { ...species, hookworm: 5 } },
    { school_id: revision === 1 ? 'SYNTHETIC-C' : 'SYNTHETIC-D', school: revision === 1 ? 'โรงเรียนทดสอบอีกอำเภอ' : 'โรงเรียนทดสอบเพิ่มใหม่', tambon: 'ตำบลตัวอย่าง', province: 'จังหวัดทดสอบ', district: 'อำเภอตัวอย่าง', affiliation: 'สังกัดตัวอย่าง', total_students_known: 50, tested_count: 35, infected_count: 2, parasite_counts: { ...species, ascaris: 2 } },
  ].map(row => ({ ...row, coverage_percent: row.tested_count / row.total_students_known * 100, infection_rate_percent: row.infected_count / row.tested_count * 100 }))
}

function fixtureData(revision = 1, query = new URLSearchParams()) {
  const rows = schoolRows(revision).filter(row =>
    (!query.get('province') || row.province === query.get('province')) &&
    (!query.get('district') || row.district === query.get('district')) &&
    (!query.get('affiliation') || row.affiliation === query.get('affiliation')) &&
    (!query.get('school_search') || `${row.school} ${row.tambon}`.includes(query.get('school_search'))))
  const sum = key => rows.reduce((total, row) => total + row[key], 0)
  const summary = { total_students_known: sum('total_students_known'), tested_count: sum('tested_count'), infected_count: sum('infected_count'), school_count: rows.length,
    tested_school_count: rows.length, positive_school_count: rows.length, negative_school_count: 0, zero_tested_school_count: 0, pending_school_count: 0, multiple_infections_count: 0,
    coverage_percent: sum('tested_count') / sum('total_students_known') * 100, infection_rate_percent: sum('infected_count') / sum('tested_count') * 100 }
  const groups = key => [...new Set(rows.map(row => row[key]))].map(label => {
    const selected = rows.filter(row => row[key] === label), total = column => selected.reduce((value, row) => value + row[column], 0)
    return { [key]: label, label, province: 'จังหวัดทดสอบ', school_count: selected.length, total_students_known: total('total_students_known'), tested_count: total('tested_count'), infected_count: total('infected_count'), pending_school_count: 0 }
  })
  const followup = rows.filter(row => row.tested_count >= 30).sort((a, b) => b.infection_rate_percent - a.infection_rate_percent)
  return { schema_id: 'health2-kpd-school-v1', row_count: rows.length, summary, metrics: [], named_school_statistics: true, published_school_count: rows.length,
    available_years: [], options: { provinces: ['จังหวัดทดสอบ'], districts: ['อำเภอทดสอบ', 'อำเภอตัวอย่าง'], affiliations: ['สังกัดทดสอบ', 'สังกัดตัวอย่าง'], statuses: [{ key: 'tested', label: 'มีผู้ส่งตรวจ' }] },
    by_school: rows, by_province: groups('province'), by_district: groups('district'), by_affiliation: groups('affiliation'),
    by_parasite: [{ key: 'ascaris', parasite: 'พยาธิไส้เดือน', count: rows.reduce((total, row) => total + row.parasite_counts.ascaris, 0), rate_percent: rows.reduce((total, row) => total + row.parasite_counts.ascaris, 0) / summary.tested_count * 100, unit: 'people' }],
    by_positivity_band: [{ key: '5to10', label: '5–<10%', school_count: rows.filter(row => row.infection_rate_percent >= 5 && row.infection_rate_percent < 10).length }, { key: '20plus', label: 'ตั้งแต่ 20%', school_count: rows.filter(row => row.infection_rate_percent >= 20).length }],
    followup_schools: followup, followup_eligible_school_count: followup.length, followup_min_tested: 30, quality: { issues: [], issue_count: 0 }, insights: [] }
}

function responseFixture(revision = 1, query, extra = {}) {
  return { status: 'ready', source: liveSource, refresh_seconds: 30, fetched_at: revision === 1 ? firstTime : secondTime, last_attempt_at: secondTime, warnings: [], error: null, data: fixtureData(revision, query), ...extra }
}

async function openDashboard({ status = () => metadata(), dashboard = (url) => responseFixture(1, url.searchParams), width = 1440 } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: 'block', timezoneId: 'Asia/Bangkok' })
  const page = await context.newPage(), errors = [], writes = [], requests = [], metadataRequests = [], apiHeaders = []
  assert.deepEqual(await context.cookies(), [], 'The fixture starts without an authenticated session')
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    window.__syntheticDashboardFetches = []
    const original = window.fetch.bind(window)
    window.fetch = (input, init) => {
      const pathname = new URL(typeof input === 'string' ? input : input.url, location.href).pathname
      if (pathname.startsWith('/api/platform/')) window.__syntheticDashboardFetches.push({ pathname, cache: init?.cache, credentials: init?.credentials })
      return original(input, init)
    }
  })
  // Install the browser clock before application code. Only time advances; the
  // component's actual timers, requests and 30-second poll interval remain intact.
  await page.clock.install({ time: new Date('2026-11-09T12:00:00Z') })
  await page.clock.pauseAt(new Date('2026-11-09T12:01:00Z'))
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      writes.push(`${request.method()} ${url.pathname}`)
      await route.abort('blockedbyclient')
      return
    }
    if (url.pathname.startsWith('/api/platform/')) apiHeaders.push({ cookie: request.headers().cookie, authorization: request.headers().authorization })
    const headers = { 'Cache-Control': 'no-store', 'X-HelpMinths-Test-Fixture': 'synthetic-browser-only' }
    if (url.pathname === '/api/platform/session') return route.fulfill({ headers, json: { configured: false, user: null, csrf_token: null, bootstrap_required: false } })
    if (url.pathname === '/api/platform/operations/status') {
      metadataRequests.push({ url, time: await page.evaluate(() => Date.now()) })
      return route.fulfill({ headers, json: await status(url, metadataRequests.length) })
    }
    if (url.pathname === '/api/platform/operations/dashboard') {
      requests.push({ url, time: await page.evaluate(() => Date.now()) })
      const value = await dashboard(url, requests.length, route)
      if (value !== undefined) await route.fulfill({ headers, json: value })
      return
    }
    await route.continue()
  })
  await page.goto(`${baseURL}/#dashboard`, { waitUntil: 'networkidle' })
  await page.getByTestId('health-survey-dashboard').waitFor()
  return { page, requests, metadataRequests, finish: async () => {
    const cookies = await context.cookies()
    const fetches = await page.evaluate(() => window.__syntheticDashboardFetches)
    await context.close()
    assert.deepEqual(errors, [])
    assert.deepEqual(writes, [], 'The dashboard must not attempt a mutation; every mutation is blocked by this harness')
    assert.deepEqual(cookies, [], 'Reading public aggregates must not create an authentication cookie')
    assert.ok(apiHeaders.every(headers => !headers.cookie && !headers.authorization), 'Anonymous aggregate requests carry no cookie or authorization header')
    assert.ok(fetches.length > 0 && fetches.every(request => request.cache === 'no-store'), 'All platform API fetches bypass the browser cache')
  } }
}

const count = (page) => page.locator('.hsd-stat-tested_count .hsd-stat-value strong')
async function expectText(locator, expected) {
  await locator.filter({ hasText: expected }).waitFor()
  assert.equal(await locator.innerText(), expected)
}
async function ready(page) { await page.waitForFunction(() => !document.querySelector('[aria-label="รีเฟรชข้อมูล Dashboard"]')?.disabled) }
async function change(page, action, advance = 0) {
  const pending = page.waitForResponse(response => new URL(response.url()).pathname === '/api/platform/operations/dashboard')
  await action()
  if (advance) await page.clock.fastForward(advance)
  await pending
  await ready(page)
}

test('synthetic live Sheet polling replaces school totals and rows after 30 seconds, then preserves a labelled stale snapshot', async () => {
  const { page, requests, metadataRequests, finish } = await openDashboard({ dashboard: (url, read) => read < 3
    ? responseFixture(read, url.searchParams, { source: { ...liveSource, version: `SYNTHETIC-CONTENT-${read}` } })
    : responseFixture(2, url.searchParams, { status: 'unavailable', fetched_at: null, data: null, error: { code: 'connection_failed', message: 'SYNTHETIC: later upstream read failed' } }) })
  try {
    await expectText(count(page), '95')
    await expectText(page.getByTestId('survey-positive'), '15')
    const table = page.getByTestId('survey-aggregate-table')
    await table.getByRole('rowheader', { name: 'โรงเรียนทดสอบเดิม', exact: true }).waitFor()
    assert.equal(await table.locator('tbody tr').count(), 3)
    assert.equal(await page.getByRole('link', { name: 'เปิดแหล่งข้อมูล' }).getAttribute('href'), liveSource.url)
    assert.match(await page.locator('.hsd-refresh-note').innerText(), /30.*วินาที/)
    assert.equal(await page.getByRole('combobox', { name: 'ปีข้อมูล Dashboard' }).isDisabled(), true, 'A year cannot be invented for an undated live sheet')
    assert.equal(await page.getByTestId('survey-history').count(), 0, 'Live values must not inherit the historical workbook panel')
    const originalTimestamp = await page.locator('.hsd-update strong').innerText()
    await page.clock.fastForward(29_999)
    assert.equal(requests.length, 1)
    assert.equal(metadataRequests.length, 1)
    await page.clock.fastForward(1)
    await expectText(count(page), '100')
    await expectText(page.getByTestId('survey-positive'), '16')
    await table.getByRole('rowheader', { name: 'โรงเรียนทดสอบปรับปรุง', exact: true }).waitFor()
    await table.getByRole('rowheader', { name: 'โรงเรียนทดสอบเพิ่มใหม่', exact: true }).waitFor()
    assert.equal(await table.getByRole('rowheader', { name: 'โรงเรียนทดสอบเดิม', exact: true }).count(), 0)
    assert.equal(await table.locator('tbody tr[data-school-id="SYNTHETIC-C"]').count(), 0)
    assert.equal(await table.locator('tbody tr[data-school-id="SYNTHETIC-D"]').count(), 1)
    assert.equal(requests.length, 2)
    assert.equal(metadataRequests.length, 2)
    assert.equal(requests[1].time - requests[0].time, 30_000, 'Exactly one real poll runs after the advertised interval')
    const updatedTimestamp = await page.locator('.hsd-update strong').innerText()
    assert.notEqual(updatedTimestamp, originalTimestamp)
    await page.clock.fastForward(30_000)
    await page.getByRole('heading', { name: 'ข้อมูลอาจยังไม่เป็นปัจจุบัน', exact: true }).waitFor()
    assert.equal(requests.length, 3)
    assert.equal(requests[2].time - requests[1].time, 30_000)
    assert.equal(await count(page).innerText(), '100')
    assert.equal(await page.getByTestId('survey-positive').innerText(), '16')
    assert.equal(await page.locator('.hsd-update strong').innerText(), updatedTimestamp)
    assert.equal(await table.locator('tbody tr').count(), 3)
    assert.equal(await page.locator('.hsd-status.is-stale').count(), 1)
    assert.equal(await page.locator('.hsd-status.is-ready').count(), 0)
    await page.setViewportSize({ width: 375, height: 1000 })
    const size = await page.evaluate(() => ({ viewport: innerWidth, actual: document.documentElement.scrollWidth }))
    assert.ok(size.actual <= size.viewport + 1, `Rich live dashboard overflows at 375px: ${JSON.stringify(size)}`)
  } finally { await finish() }
})

test('synthetic live school filters reach the API, remain on polling, and keep minimum-30 follow-up separate from all tested schools', async () => {
  const { page, requests, finish } = await openDashboard()
  try {
    await expectText(count(page), '95')
    const followup = page.getByTestId('survey-school-followup'), table = page.getByTestId('survey-aggregate-table')
    assert.equal(await followup.locator('ol li').count(), 2)
    assert.match(await followup.innerText(), /30 คนขึ้นไป/)
    assert.equal(await followup.getByRole('button', { name: 'ดู ศูนย์ทดสอบกลุ่มเล็ก ในตาราง', exact: true }).count(), 0)
    assert.equal(await table.locator('tbody tr').count(), 3, 'All tested schools include the 20-person school')
    const initialRequests = requests.length
    await table.getByRole('checkbox', { name: 'เฉพาะแห่งที่ส่งตรวจตั้งแต่ 30 คน', exact: true }).check()
    assert.equal(await table.locator('tbody tr').count(), 2)
    assert.equal(requests.length, initialRequests, 'Minimum-30 table selection uses the current cohort')
    await table.getByRole('button', { name: 'แสดงรายชื่อทั้งหมด', exact: true }).click()
    await change(page, () => page.getByRole('combobox', { name: 'อำเภอ Dashboard', exact: true }).selectOption('อำเภอทดสอบ'))
    await expectText(count(page), '60')
    await change(page, () => page.getByRole('combobox', { name: 'สังกัด Dashboard', exact: true }).selectOption('สังกัดทดสอบ'))
    await change(page, () => page.getByRole('searchbox', { name: 'ค้นหาโรงเรียนหรือตำบลใน Dashboard', exact: true }).fill('ตำบลทดสอบ'), 300)
    const selected = requests.at(-1).url.searchParams
    assert.equal(selected.get('district'), 'อำเภอทดสอบ')
    assert.equal(selected.get('affiliation'), 'สังกัดทดสอบ')
    assert.equal(selected.get('school_search'), 'ตำบลทดสอบ')
    assert.equal(await table.locator('tbody tr').count(), 2)
    assert.equal(await followup.locator('ol li').count(), 1)
    const beforePoll = requests.length
    await page.clock.fastForward(29_999)
    assert.equal(requests.length, beforePoll)
    const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/platform/operations/dashboard')
    await page.clock.fastForward(1)
    await refreshed
    await ready(page)
    assert.equal(requests.length, beforePoll + 1)
    assert.equal(requests.at(-1).url.search, requests.at(-2).url.search, 'The periodic refresh carries the active rich filters')
    assert.equal(await page.getByRole('combobox', { name: 'อำเภอ Dashboard', exact: true }).inputValue(), 'อำเภอทดสอบ')
    assert.equal(await page.getByRole('combobox', { name: 'สังกัด Dashboard', exact: true }).inputValue(), 'สังกัดทดสอบ')
    assert.equal(await page.getByRole('searchbox', { name: 'ค้นหาโรงเรียนหรือตำบลใน Dashboard', exact: true }).inputValue(), 'ตำบลทดสอบ')
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 })
      const size = await page.evaluate(() => ({ viewport: innerWidth, actual: document.documentElement.scrollWidth }))
      assert.ok(size.actual <= size.viewport + 1, `Filtered school view overflows at ${width}px: ${JSON.stringify(size)}`)
    }
  } finally { await finish() }
})

test('metadata provider changes clear workbook numbers and history before a live read completes; mismatched old responses stay rejected', async () => {
  const workbookSource = { provider: 'uploaded_workbook', file_name: 'SYNTHETIC-HISTORICAL-WORKBOOK.xlsx', version: 'SYNTHETIC-WORKBOOK-V1', year: 2569, imported_at: firstTime }
  const workbookData = { ...fixtureData(), history: { years: [2568, 2569], source: { file_name: 'SYNTHETIC-HISTORY.json' }, dimensions: [], species_series: [] } }
  let releaseOldResponse
  const heldResponse = new Promise(resolve => { releaseOldResponse = resolve })
  const { page, requests, finish } = await openDashboard({ status: (_url, read) => metadata(read === 1 ? workbookSource : liveSource), dashboard: async (url, read) => {
    if (read === 1) return responseFixture(1, url.searchParams, { source: workbookSource, data: workbookData })
    if (read === 2) { await heldResponse; return responseFixture(1, url.searchParams, { source: workbookSource, data: workbookData }) }
    return responseFixture(2, url.searchParams)
  } })
  try {
    await expectText(count(page), '95')
    await page.getByTestId('survey-history').waitFor()
    await page.getByRole('button', { name: 'รีเฟรชข้อมูล Dashboard', exact: true }).click()
    await page.getByRole('link', { name: 'เปิดแหล่งข้อมูล' }).waitFor()
    assert.equal(await page.getByRole('link', { name: 'เปิดแหล่งข้อมูล' }).getAttribute('href'), liveSource.url)
    assert.equal(await count(page).innerText(), '—', 'Workbook numbers clear when new metadata arrives, before the delayed response')
    assert.equal(await page.getByTestId('survey-history').count(), 0)
    assert.equal(await page.locator('.hsd-province-table tbody tr').count(), 0)
    assert.equal(await page.locator('.hsd-update strong').innerText(), 'ยังไม่มีการอ่านข้อมูลสำเร็จ')
    releaseOldResponse()
    await ready(page)
    assert.equal(requests.length, 2)
    assert.equal(await count(page).innerText(), '—', 'A late workbook response cannot be attributed to the new Google Sheet')
    assert.equal(await page.getByTestId('survey-history').count(), 0)
    assert.equal(await page.locator('.hsd-status.is-stale').count(), 0, 'A different provider has no same-source snapshot to retain')
    await change(page, () => page.getByRole('button', { name: 'รีเฟรชข้อมูล Dashboard', exact: true }).click())
    await expectText(count(page), '100')
    assert.equal(await page.getByTestId('survey-history').count(), 0)
    assert.equal(await page.locator('.hsd-status.is-ready').count(), 1)
  } finally { releaseOldResponse(); await finish() }
})

test('a synthetic public-source 403 reports unavailable source data without inventing counts or requiring an account', async () => {
  const { page, requests, finish } = await openDashboard({ dashboard: async (_url, _read, route) => {
    await route.fulfill({ status: 403, headers: { 'Cache-Control': 'no-store' }, json: { detail: 'SYNTHETIC: public upstream access was denied' } })
  } })
  try {
    await page.getByRole('heading', { name: 'ยังอ่านข้อมูลจาก Google Sheets ไม่ได้', exact: true }).waitFor()
    assert.equal(requests.length, 1)
    assert.equal(await count(page).innerText(), '—')
    assert.equal(await page.getByTestId('survey-positive').innerText(), '—')
    assert.equal(await page.getByRole('heading', { name: 'แหล่งข้อมูลนี้ต้องเข้าสู่ระบบ', exact: true }).count(), 0)
    assert.equal(await page.locator('.hsd-status.is-ready').count(), 0)
    assert.equal(await page.locator('.hsd-province-table tbody tr').count(), 0)
    assert.equal(await page.getByRole('link', { name: 'เปิดแหล่งข้อมูล' }).getAttribute('href'), liveSource.url)
  } finally { await finish() }
})
