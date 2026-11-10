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

const removedDecorativeCopy = /PARASITOLOGY AI PLATFORM|PARASITOLOGY \/ A CLOSER LOOK|EXPLORE EVERY DETAIL|DESIGNED FOR A CLEARER VIEW|SPECIMEN\s+\d+|MORPHOLOGY(?: \/| STUDIO| GUIDE)|INTELLIGENT MICROSCOPY|THE MORPHOLOGY COLLECTION|YOUR DISCOVERIES/
async function assertNoDecorativeCopy(page) {
  assert.doesNotMatch(await page.locator('body').textContent(), removedDecorativeCopy, 'Decorative English must be removed rather than hidden')
}

test('the home page keeps three clear sections and two hero actions across screen sizes', { timeout: 60_000 }, async () => {
  for (const width of [320, 375, 768, 1024, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce', serviceWorkers: 'block' })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await noWebGL(page)
    const fixture = await mockAccount(page, account(null))
    try {
      await page.goto(baseURL, { waitUntil: 'networkidle' })
      await page.evaluate(() => document.fonts.ready)
      const sections = page.locator('.home-sections > section')
      assert.equal(await sections.count(), 3)
      assert.equal(await sections.nth(0).evaluate(element => element.classList.contains('field-overview')), true)
      assert.equal(await sections.nth(1).evaluate(element => element.classList.contains('workflow-section')), true)
      assert.equal(await sections.nth(2).evaluate(element => element.classList.contains('atlas-preview')), true)
      const hero = page.locator('.field-overview')
      const heading = hero.getByRole('heading', { level: 1, name: 'ตรวจภาพไข่พยาธิ', exact: true })
      await heading.waitFor()
      assert.equal(await page.locator('main h1').count(), 1)
      const lines = await heading.evaluate(element => {
        const range = document.createRange(); range.selectNodeContents(element)
        return new Set([...range.getClientRects()].map(rect => Math.round(rect.top))).size
      })
      assert.equal(lines, 1, `The introductory heading must stay on one line at ${width}px`)
      assert.equal(await hero.locator('.field-intro').count(), 1)
      assert.equal(await hero.locator('.field-intro br').count(), 0)
      assert.ok((await hero.locator('.field-intro').innerText()).trim().length > 0)
      assert.equal(await hero.getByRole('button').count(), 2)
      const start = hero.getByRole('button', { name: 'เริ่มตรวจวิเคราะห์', exact: true })
      const demo = hero.getByRole('button', { name: 'ดูตัวอย่าง', exact: true })
      assert.equal(await start.isVisible(), true)
      assert.equal(await demo.isVisible(), true)
      const bounds = await start.boundingBox()
      assert.ok(bounds && bounds.y + bounds.height < 800, `The primary action must stay above the mobile tabs at ${width}px`)
      const note = hero.locator('.research-note')
      assert.match(await note.innerText(), /ผล AI ต้องได้รับการทบทวนโดยผู้เชี่ยวชาญ/)
      assert.ok((await note.boundingBox()).y >= bounds.y + bounds.height, 'The short research note must follow the actions')
      assert.equal(await page.locator('.workflow-card').count(), 3)
      assert.equal(await page.locator('.specimen-card').count(), 3)
      assert.equal(await page.locator('.capability-strip, .feedback-invite, .field-mobile-upload, .field-model-stage').count(), 0)
      assert.equal(await page.getByRole('heading', { name: 'ภาพรวมระบบวิเคราะห์', exact: true }).count(), 0)
      assert.equal(await page.locator('main').getByRole('button', { name: 'วิเคราะห์ภาพ', exact: true }).count(), 0)
      await assertNoDecorativeCopy(page)
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Home must not overflow at ${width}px`)
      assert.deepEqual(fixture.mutations, [])
      assert.deepEqual(errors, [])
    } finally { await page.close() }
  }
})

test('hero and workflow actions open upload, honest demo and the selected Atlas references without submitting an image', { timeout: 60_000 }, async () => {
  const page = await browser.newPage({ viewport: { width: 375, height: 900 }, reducedMotion: 'reduce', serviceWorkers: 'block' })
  const errors = [], analysisRequests = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (request.method() === 'POST' && /\/api\/(analyze|platform\/analyses)$/.test(new URL(request.url()).pathname)) analysisRequests.push(request.url()) })
  await noWebGL(page)
  const fixture = await mockAccount(page, account(null))
  const home = async () => {
    await page.getByRole('button', { name: 'HelpMinths หน้าหลัก', exact: true }).click()
    await page.getByRole('heading', { name: 'ตรวจภาพไข่พยาธิ', exact: true }).waitFor()
  }
  try {
    await page.goto(baseURL, { waitUntil: 'networkidle' })
    const start = page.locator('.field-overview').getByRole('button', { name: 'เริ่มตรวจวิเคราะห์', exact: true })
    await start.focus(); await page.keyboard.press('Enter')
    await page.getByLabel('เลือกภาพจากอุปกรณ์').waitFor({ state: 'attached' })
    assert.equal(new URL(page.url()).hash, '#scan')
    assert.equal(await page.getByLabel('ถ่ายภาพด้วยกล้อง').getAttribute('capture'), 'environment')
    await assertNoDecorativeCopy(page)
    await home()
    await page.locator('.field-overview').getByRole('button', { name: 'ดูตัวอย่าง', exact: true }).click()
    await page.locator('.scan-demo-banner').waitFor()
    assert.match(await page.locator('.scan-demo-banner').innerText(), /ไม่ใช่ผลตรวจจาก AI/)
    assert.equal(await page.locator('.scan-detection-box').count(), 3)
    await home()
    await page.locator('.workflow-section').getByRole('button', { name: 'อัปโหลดภาพ', exact: true }).click()
    await page.getByLabel('เลือกภาพจากอุปกรณ์').waitFor({ state: 'attached' })
    await home()
    await page.locator('.workflow-section').getByRole('button', { name: 'ลองดูตัวอย่าง', exact: true }).click()
    await page.locator('.scan-demo-banner').waitFor()
    await home()
    await page.locator('.workflow-section').getByRole('button', { name: 'เปิด Atlas 3D', exact: true }).click()
    await page.locator('.atlas-svg-fallback').waitFor()
    await assertNoDecorativeCopy(page)
    await home()
    for (const name of ['Opisthorchis viverrini', 'Minute intestinal flukes (MIF)', 'Hymenolepis nana']) {
      await page.locator('.specimen-card').filter({ hasText: name }).click()
      await page.locator('.atlas-specimen-caption').getByRole('heading', { name, exact: true }).waitFor()
      await page.getByRole('link', { name: 'ข้ามไปเนื้อหาหลัก', exact: true }).focus()
      await page.keyboard.press('Enter')
      assert.equal(new URL(page.url()).hash, '#atlas', 'Skipping navigation must preserve the selected reference URL')
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'main-content')
      await home()
    }
    assert.deepEqual(analysisRequests, [], 'Exploring upload, a demo or teaching references must not submit a clinical image')
    assert.deepEqual(fixture.mutations, [])
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

test('four primary menus stay at the top on desktop and at the bottom on phones, with SUS in the footer', { timeout: 90_000 }, async () => {
  for (const width of [320, 375, 768, 1024, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: 'reduce', serviceWorkers: 'block' })
    try {
      await page.goto(baseURL, { waitUntil: 'networkidle' })
      await page.getByRole('heading', { name: 'ตรวจภาพไข่พยาธิ', exact: true }).waitFor()
      const navigation = page.getByRole('navigation', { name: 'เมนูหลัก', exact: true })
      const dimensions = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }))
      assert.ok(dimensions.content <= dimensions.viewport + 1, `Home overflows ${width}px: ${dimensions.content}`)
      assert.equal(await navigation.getByRole('button').count(), 4)
      for (const label of ['ตรวจวิเคราะห์', 'Atlas 3D', 'สถิติโรค', 'งานของฉัน']) assert.equal(await navigation.getByRole('button', { name: label, exact: true }).isVisible(), true)
      assert.equal(await page.locator('.sidebar').count(), 0, 'The previous sidebar must not coexist with the new navigation')
      assert.equal(await navigation.getByRole('button', { name: /ตั้งค่า|คู่มือ|ประเมิน/ }).count(), 0)
      assert.equal(await page.getByRole('button', { name: 'ห้องเรียนพยาธิ', exact: true }).count(), 0)
      assert.equal(await page.getByRole('button', { name: 'จัดการ', exact: true }).count(), 0, 'A guest must not see management controls')
      const bounds = await navigation.boundingBox()
      assert.ok(bounds)
      if (width < 1024) {
        assert.equal(await navigation.evaluate(element => getComputedStyle(element).position), 'fixed')
        assert.ok(bounds.y >= 850 && bounds.y + bounds.height <= 1001, `Mobile tabs must sit within the bottom edge at ${width}px`)
      } else assert.ok(bounds.y < 180, `Desktop navigation must be in the page header at ${width}px`)
      await navigation.getByRole('button', { name: 'ตรวจวิเคราะห์', exact: true }).click()
      assert.equal(await navigation.getByRole('button', { name: 'ตรวจวิเคราะห์', exact: true }).getAttribute('aria-current'), 'page')
      assert.equal(await navigation.locator('[aria-current="page"]').count(), 1)
      const sus = page.locator('footer').getByRole('link', { name: 'ประเมินและเสนอแนะ', exact: true })
      assert.equal(await sus.count(), 1, 'SUS has one entry in the footer')
      await sus.click()
      await page.getByRole('heading', { name: 'ประเมินการใช้งาน', exact: true }).waitFor()
      assert.equal(await page.getByRole('radio').count(), 50)
      assert.equal(await page.getByRole('textbox').count(), 1)
      assert.ok((await page.locator('body').innerText()).includes('ผล AI ต้องได้รับการทบทวนโดยผู้เชี่ยวชาญ'))
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `SUS overflows ${width}px`)
    } finally { await page.close() }
  }
})

// Session responses are isolated UI fixtures, not proof of backend permissions.
// Every non-read request is blocked before it could reach a real database.
async function mockAccount(page, currentSession, analyses = []) {
  const mutations = [], privateReads = [], reads = []
  await page.route('**/api/platform/**', async route => {
    const request = route.request(), url = new URL(request.url())
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) { mutations.push(url.pathname); await route.abort('blockedbyclient'); return }
    reads.push(url.href)
    const source = typeof currentSession === 'function' ? currentSession() : currentSession
    let json
    if (url.pathname === '/api/platform/session') json = source
    else if (url.pathname === '/api/platform/analyses') {
      privateReads.push(url.href)
      json = { items: analyses, total: analyses.length, limit: 20, offset: 0 }
    } else if (url.pathname === '/api/platform/history/days') {
      privateReads.push(url.href)
      json = { items: [], total_days: 0, total_analyses: analyses.length, timezone: 'Asia/Bangkok' }
    } else if (url.pathname === '/api/platform/dashboard') json = {
      sample_size: 0, scope: 'mine',
      summary: { total_analyses: 0, successful_analyses: 0, failed_analyses: 0, total_detected_objects: 0, confirmed_objects: 0, uncertain_objects: 0, pending_expert_reviews: 0, completed_expert_reviews: 0, images_failing_quality: 0, average_inference_ms: null },
      charts: { analyses_by_date: [], predicted_classes: [], confirmed_classes: [], review_statuses: [], quality_statuses: [], latency_by_date: [], review_errors: [] },
    }
    else if (url.pathname === '/api/platform/quality/config') json = { inference_confidence: .15, review_confidence_threshold: .5 }
    else json = { items: [], total: 0, limit: 20, offset: 0, verified: false, verified_until: null }
    await route.fulfill({ json, headers: { 'Cache-Control': 'no-store', 'X-HelpMinths-Test-Fixture': 'synthetic-ui-only' } })
  })
  return { mutations, privateReads, reads }
}
function account(role, overrides = {}) {
  return { configured: true, csrf_token: role ? 'SYNTHETIC-UI-CSRF' : null, bootstrap_required: false, registration_enabled: true,
    user: role ? { id: `SYNTHETIC-${role}`, username: `fixture-${role}`, full_name: 'ผู้ทดสอบ หน้าจอ', workplace: 'หน่วยงานจำลอง', affiliation: 'ข้อมูลทดสอบ', phone: '0812345678', role, active: true, created_at: '2026-01-01T00:00:00Z', approval_status: 'approved', requested_role: role, is_super_admin: false, approved_by: null, approved_at: null, ...overrides } : null }
}
async function noWebGL(page) {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function(type, ...args) { return ['webgl', 'webgl2', 'experimental-webgl'].includes(type) ? null : original.call(this, type, ...args) }
  })
}

test('the home page does not load operational dashboards or clinical records for any account role', { timeout: 60_000 }, async () => {
  for (const role of [null, 'student', 'lab', 'reviewer', 'admin']) {
    const page = await browser.newPage({ viewport: { width: 375, height: 1000 }, reducedMotion: 'reduce', serviceWorkers: 'block' })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await noWebGL(page)
    const fixture = await mockAccount(page, account(role))
    try {
      await page.goto(`${baseURL}/#home`, { waitUntil: 'networkidle' })
      await page.getByRole('heading', { name: 'ตรวจภาพไข่พยาธิ', exact: true }).waitFor()
      const operational = fixture.reads.filter(value => /^\/api\/platform\/(?:dashboard|analyses|history|referrals|reports|evaluation|models|performance|quality\/audits)(?:\/|$)/.test(new URL(value).pathname))
      assert.deepEqual(operational, [], `${role || 'guest'} home must not fetch operational or clinical datasets`)
      assert.equal(await page.locator('.home-sections > section').count(), 3)
      assert.equal(await page.locator('.platform-stat-grid, .platform-chart-grid').count(), 0)
      assert.equal(await page.getByRole('heading', { name: 'ภาพรวมระบบวิเคราะห์', exact: true }).count(), 0)
      await assertNoDecorativeCopy(page)
      assert.deepEqual(fixture.mutations, [])
      assert.deepEqual(errors, [])
    } finally { await page.close() }
  }
})

test('an authorized member can open the operational overview from Reports without loading it on arrival', { timeout: 60_000 }, async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', serviceWorkers: 'block' })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await noWebGL(page)
  const fixture = await mockAccount(page, account('lab'))
  const dashboardReads = () => fixture.reads.filter(value => new URL(value).pathname === '/api/platform/dashboard')
  try {
    await page.goto(`${baseURL}/#reports`, { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: 'รายงานและส่งออกข้อมูล', exact: true }).waitFor()
    const disclosure = page.locator('summary').filter({ hasText: 'ภาพรวมการดำเนินงาน' })
    await disclosure.waitFor()
    assert.deepEqual(dashboardReads(), [], 'Arriving at Reports must not mount the collapsed operational overview')
    assert.equal(await page.getByRole('heading', { name: 'ภาพรวมระบบวิเคราะห์', exact: true }).count(), 0)
    await disclosure.click()
    await page.getByRole('heading', { name: 'ยังไม่มีข้อมูลการวิเคราะห์จริง', exact: true }).waitFor()
    assert.equal(dashboardReads().length, 1)
    assert.equal(await page.getByRole('heading', { name: 'ภาพรวมระบบวิเคราะห์', level: 2, exact: true }).count(), 1)
    assert.equal(await page.locator('main h1').count(), 1, 'The embedded overview must not add a second page-level heading')
    assert.deepEqual(fixture.mutations, [])
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

test('management is shown only for approved active admin, reviewer and lab sessions', { timeout: 90_000 }, async () => {
  for (const [role, overrides, permitted] of [[null, {}, false], ['student', {}, false], ['lab', {}, true], ['reviewer', {}, true], ['admin', {}, true], ['lab', { approval_status: 'pending' }, false], ['admin', { active: false }, false]]) {
    const page = await browser.newPage({ viewport: { width: 375, height: 1000 }, reducedMotion: 'reduce', serviceWorkers: 'block' })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await noWebGL(page)
    const fixture = await mockAccount(page, account(role, overrides))
    try {
      await page.goto(`${baseURL}/#scan`, { waitUntil: 'networkidle' })
      const navigation = page.getByRole('navigation', { name: 'เมนูหลัก', exact: true })
      assert.equal(await navigation.getByRole('button').count(), 4)
      const manage = page.getByRole('button', { name: 'จัดการ', exact: true })
      assert.equal(await manage.count(), permitted ? 1 : 0, `${role || 'guest'} must respect the existing session role`)
      if (permitted) {
        await manage.click()
        const menu = page.getByRole('region', { name: 'เมนูจัดการ', exact: true })
        await menu.waitFor()
        for (const name of ['ทบทวนโดยผู้เชี่ยวชาญ', 'รายงาน', 'ประเมินโมเดล']) assert.equal(await menu.getByRole('button', { name, exact: true }).count(), 1)
        assert.equal(await menu.getByRole('button', { name: /ตั้งค่า|SUS/ }).count(), 0)
        await page.keyboard.press('Escape')
        await menu.waitFor({ state: 'hidden' })
        assert.equal(await manage.evaluate(element => element === document.activeElement), true)
        await manage.press('ArrowDown')
        await menu.waitFor()
        await page.keyboard.press('Home')
        await page.keyboard.press('ArrowDown')
        const reports = menu.getByRole('button', { name: 'รายงาน', exact: true })
        assert.equal(await reports.evaluate(element => element === document.activeElement), true)
        await page.keyboard.press('Enter')
        await menu.waitFor({ state: 'hidden' })
        assert.equal(new URL(page.url()).hash, '#reports')
        assert.equal(await manage.evaluate(element => element === document.activeElement), true, 'Selecting a management destination must preserve keyboard focus')
        await page.getByRole('heading', { name: 'รายงานและส่งออกข้อมูล', exact: true }).waitFor()
        await manage.click()
        assert.equal(await reports.getAttribute('aria-current'), 'page')
        assert.equal(await menu.locator('[aria-current="page"]').count(), 1)
        await page.keyboard.press('Escape')
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${role || 'guest'} header must fit a phone`)
      assert.deepEqual(fixture.mutations, [])
      assert.deepEqual(errors, [])
    } finally { await page.close() }
  }
})

test('avatar-only settings and the single help modal retain skip navigation, focus-visible and focus trapping', { timeout: 60_000 }, async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', serviceWorkers: 'block' })
  await noWebGL(page)
  const fixture = await mockAccount(page, account(null))
  try {
    await page.goto(`${baseURL}/#scan`, { waitUntil: 'networkidle' })
    const skip = page.getByRole('link', { name: 'ข้ามไปเนื้อหาหลัก', exact: true })
    await skip.focus(); await page.keyboard.press('Enter')
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'main-content')
    assert.equal(new URL(page.url()).hash, '#scan')
    const atlas = page.getByRole('navigation', { name: 'เมนูหลัก', exact: true }).getByRole('button', { name: 'Atlas 3D', exact: true })
    await atlas.focus()
    await page.keyboard.press('Tab')
    const outline = await page.evaluate(() => ({ style: getComputedStyle(document.activeElement).outlineStyle, width: parseFloat(getComputedStyle(document.activeElement).outlineWidth) }))
    assert.notEqual(outline.style, 'none'); assert.ok(outline.width >= 2, 'Keyboard focus must remain visibly outlined')
    assert.equal(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true)
    const help = page.getByRole('button', { name: 'คู่มือการใช้งาน', exact: true })
    assert.equal(await help.count(), 1)
    await help.click()
    const dialog = page.getByRole('dialog', { name: 'เริ่มต้นกับ HelpMinths', exact: true })
    await dialog.waitFor()
    const focusables = dialog.locator('button, a[href], input, select, [tabindex="0"]')
    await focusables.last().focus(); await page.keyboard.press('Tab')
    assert.equal(await focusables.first().evaluate(element => element === document.activeElement), true)
    await focusables.first().focus(); await page.keyboard.press('Shift+Tab')
    assert.equal(await focusables.last().evaluate(element => element === document.activeElement), true)
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden' })
    assert.equal(await help.evaluate(element => element === document.activeElement), true)
    assert.equal(await page.getByRole('navigation', { name: 'เมนูหลัก', exact: true }).getByRole('button', { name: /ตั้งค่า/ }).count(), 0)
    await page.getByRole('button', { name: 'เข้าสู่ระบบหรือสมัครสมาชิก', exact: true }).click()
    await page.getByRole('region', { name: 'เมนูบัญชี', exact: true }).getByRole('button', { name: 'ตั้งค่า', exact: true }).click()
    await page.getByRole('heading', { name: 'ตั้งค่าและบัญชีผู้ใช้', exact: true }).waitFor()
    assert.equal(new URL(page.url()).hash, '#settings')
    assert.deepEqual(fixture.mutations, [])
  } finally { await page.close() }
})

test('My Work tabs retain session results and clear private history when the account session ends', { timeout: 90_000 }, async () => {
  const page = await browser.newPage({ viewport: { width: 375, height: 1000 }, reducedMotion: 'reduce', serviceWorkers: 'block' })
  await noWebGL(page)
  let currentSession = account(null)
  const privateRecord = { id: 'SYNTHETIC-private-record', owner_id: 'SYNTHETIC-lab', sample_code: 'PRIVATE-ACCOUNT-FIXTURE', width: 512, height: 384, revision: 1, status: 'completed', review_status: 'pending', created_at: '2026-01-01T00:00:00Z', detections: [], latest_review: null, image_url: null }
  const fixture = await mockAccount(page, () => currentSession, [privateRecord])
  try {
    await page.goto(baseURL, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'ดูตัวอย่าง', exact: true }).click()
    await page.locator('.scan-demo-banner').waitFor()
    await page.getByRole('navigation', { name: 'เมนูหลัก', exact: true }).getByRole('button', { name: 'งานของฉัน', exact: true }).click()
    await page.getByRole('heading', { name: 'งานของฉัน', exact: true }).waitFor()
    const tabs = page.getByRole('tablist', { name: 'รายการงานของฉัน', exact: true })
    const saved = tabs.getByRole('tab', { name: 'ประวัติการตรวจ', exact: true }), session = tabs.getByRole('tab', { name: 'ผลในเซสชันนี้', exact: true })
    assert.equal(await session.getAttribute('aria-selected'), 'true')
    assert.equal(await page.locator('.history-card').count(), 1)
    await saved.click()
    assert.equal(await page.locator('.history-card').count(), 0, 'Inactive session cards must be unmounted')
    assert.deepEqual(fixture.privateReads, [], 'A guest must not fetch saved account history')
    await saved.focus(); await page.keyboard.press('ArrowRight')
    assert.equal(await session.getAttribute('aria-selected'), 'true')
    await page.locator('.history-card').click()
    await page.locator('.scan-demo-banner').waitFor()
    assert.equal(await page.locator('.scan-detection-box').count(), 3)

    currentSession = account('lab')
    // A different document URL re-runs the session request with the member fixture.
    await page.goto(`${baseURL}/?ui-fixture=member#work`, { waitUntil: 'networkidle' })
    await saved.waitFor()
    assert.equal(await saved.getAttribute('aria-selected'), 'true')
    await page.getByRole('heading', { name: 'PRIVATE-ACCOUNT-FIXTURE', exact: true }).waitFor()
    assert.ok(fixture.privateReads.some(value => new URL(value).searchParams.get('scope') === 'mine'), 'Saved work must keep the existing owner-only history query')
    currentSession = account(null)
    await page.evaluate(() => dispatchEvent(new CustomEvent('helpminths:session-expired', { detail: { userId: 'SYNTHETIC-lab' } })))
    await page.getByRole('button', { name: 'เข้าสู่ระบบหรือสมัครสมาชิก', exact: true }).waitFor()
    assert.equal(await page.getByText('PRIVATE-ACCOUNT-FIXTURE', { exact: true }).count(), 0)
    assert.equal(await session.getAttribute('aria-selected'), 'true')
    await page.goto(`${baseURL}/#history`, { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: 'งานของฉัน', exact: true }).waitFor()
    assert.equal(new URL(page.url()).hash, '#work', 'Old history links must open the unified work page')
    assert.deepEqual(fixture.mutations, [])
  } finally { await page.close() }
})


test('management deep links show an access message without reading private management records', { timeout: 60_000 }, async () => {
  for (const role of [null, 'student']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', serviceWorkers: 'block' })
    await noWebGL(page)
    const fixture = await mockAccount(page, account(role))
    const managementReads = []
    page.on('request', request => {
      if (/\/api\/platform\/(?:analyses|history|referrals|reports|expert-session|quality\/audits|performance)(?:[/?]|$)/.test(request.url())) managementReads.push(request.url())
    })
    try {
      for (const destination of ['verification', 'reports', 'performance']) {
        await page.goto(`${baseURL}/#${destination}`, { waitUntil: 'networkidle' })
        await page.getByRole('heading', { name: role ? 'ส่วนนี้สำหรับผู้ปฏิบัติงาน' : 'เข้าสู่ระบบเพื่อใช้งานส่วนนี้', exact: true }).waitFor()
        assert.equal(await page.getByRole('button', { name: 'จัดการ', exact: true }).count(), 0)
        assert.deepEqual(managementReads, [], `${role || 'guest'} must not mount a protected ${destination} data loader`)
      }
      assert.deepEqual(fixture.mutations, [])
    } finally { await page.close() }
  }
})
