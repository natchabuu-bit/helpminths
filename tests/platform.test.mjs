import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'

// This suite may mutate ONLY the deliberately opt-in, localhost synthetic
// fixture. Never substitute the public site URL or real clinical photographs.
const fixtureURL = process.env.HELPMINTHS_PLATFORM_TEST_URL || 'http://127.0.0.1:8091'
const defaultURL = process.env.HELPMINTHS_PLATFORM_DEFAULT_URL || 'http://127.0.0.1:8082'
const testPassword = 'Synthetic-UI-test-only-2026!'
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined)
let browser

function fixtureHeader(response) {
  assert.equal(response.headers()['x-helpminths-test-fixture'], 'synthetic-only', 'Refusing mutation: server is not the opt-in synthetic test fixture')
}
async function verifyFixture(request) {
  const url = new URL(fixtureURL)
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Synthetic fixture URL must be localhost')
  const response = await request.get(`${fixtureURL}/api/platform/status`)
  fixtureHeader(response)
  assert.equal(response.status(), 200)
  assert.equal((await response.json()).configured, true)
}
before(async () => {
  browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
  const context = await browser.newContext({ serviceWorkers: 'block' })
  try { await verifyFixture(context.request) } finally { await context.close() }
})
after(async () => browser?.close())

async function fixturePage() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' })
  await verifyFixture(context.request)
  const safetyErrors = [], pageErrors = []
  // Recheck the identifying response before every browser-originated mutation,
  // including login/logout, rather than trusting the port number alone.
  await context.route('**/api/platform/**', async route => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) {
      try { await verifyFixture(context.request) }
      catch (error) { safetyErrors.push(error.message); await route.abort('blockedbyclient'); return }
    }
    await route.continue()
  })
  const page = await context.newPage()
  page.setDefaultTimeout(20_000)
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.goto(`${fixtureURL}/#settings`, { waitUntil: 'networkidle' })
  return { page, context, finish: async () => { await context.close(); assert.deepEqual(safetyErrors, []); assert.deepEqual(pageErrors, []) } }
}
async function nav(page, label) {
  const menu = page.getByRole('button', { name: 'เปิดเมนู', exact: true })
  const item = page.locator('.sidebar .nav-item').filter({ hasText: label })
  if (await menu.isVisible() && await menu.getAttribute('aria-expanded') !== 'true') await menu.click()
  await item.click()
}
async function login(page, role) {
  await nav(page, 'ตั้งค่าและบัญชี')
  await page.getByLabel('ชื่อบัญชี', { exact: true }).fill(`fixture-${role}`)
  await page.getByLabel('รหัสผ่าน', { exact: true }).fill(testPassword)
  const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/platform/login') && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click()
  const response = await responsePromise
  fixtureHeader(response)
  assert.equal(response.status(), 200, await response.text())
  await page.getByRole('button', { name: 'ออกจากระบบ', exact: true }).waitFor()
  assert.equal((await response.json()).user.username, `fixture-${role}`)
}
async function logout(page) {
  await nav(page, 'ตั้งค่าและบัญชี')
  await page.getByRole('button', { name: 'ออกจากระบบ', exact: true }).click()
  await page.getByLabel('ชื่อบัญชี', { exact: true }).waitFor()
}
async function session(page) {
  const response = await page.request.get(`${fixtureURL}/api/platform/session`)
  fixtureHeader(response)
  return response.json()
}
async function mutate(page, path, data, method = 'post') {
  await verifyFixture(page.request)
  const identity = await session(page)
  const response = await page.request[method](`${fixtureURL}/api/platform${path}`, { data, headers: { 'X-CSRF-Token': identity.csrf_token || '' } })
  fixtureHeader(response)
  return response
}
async function syntheticPNG(page, flat = false) {
  const encoded = await page.evaluate(isFlat => {
    const canvas = document.createElement('canvas')
    canvas.width = 512; canvas.height = 384
    const context = canvas.getContext('2d')
    for (let y = 0; y < 384; y += 16) for (let x = 0; x < 512; x += 16) {
      const value = isFlat ? 128 : ((x / 16 + y / 16) % 2 ? 180 : 75)
      context.fillStyle = `rgb(${value},${value},${value})`; context.fillRect(x, y, 16, 16)
    }
    return canvas.toDataURL('image/png').split(',')[1]
  }, flat)
  return Buffer.from(encoded, 'base64')
}
async function assertNoPrivateImage(page, id) {
  await nav(page, 'ตรวจวิเคราะห์')
  assert.equal(await page.locator('.scan-image-svg image').count(), 0, 'Account switch must discard the previous upload/DataURL')
  assert.equal(await page.locator('.scan-detection-item').count(), 0, 'Account switch must discard previous results')
  await nav(page, 'ประวัติการตรวจ')
  await page.locator('.platform-loading').waitFor({ state: 'hidden' })
  assert.equal(await page.locator('.history-card').count(), 0, 'Private analyses must never enter public/session history')
  assert.equal(await page.locator('.platform-record').filter({ hasText: id }).count(), 0)
  assert.equal(await page.locator('img[src^="data:image"],image[href^="data:image"]').count(), 0)
}

test('authenticated quality gate, saved predictions, expert decisions, audit, reports, feedback, and account isolation', { timeout: 240_000 }, async () => {
  const { page, context, finish } = await fixturePage()
  try {
    await login(page, 'lab')
    await nav(page, 'ตรวจวิเคราะห์')
    const sampleCode = `TEST_UI_${Date.now()}`
    const png = await syntheticPNG(page, true)
    await page.getByLabel('เลือกภาพจากอุปกรณ์').setInputFiles({ name: `${sampleCode}.png`, mimeType: 'image/png', buffer: png })
    await page.getByLabel('รหัสตัวอย่างนิรนาม').fill(sampleCode)
    await page.getByLabel('รหัสหน่วยงาน (ถ้ามี)').fill('SYNTHETIC_TEST')
    let analysisPosts = 0
    page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/api/platform/analyses')) analysisPosts += 1 })
    const qualityPromise = page.waitForResponse(response => response.url().endsWith('/api/platform/quality') && response.request().method() === 'POST')
    await page.getByRole('button', { name: 'ตรวจคุณภาพภาพ', exact: true }).click()
    const qualityResponse = await qualityPromise
    fixtureHeader(qualityResponse)
    const quality = await qualityResponse.json()
    assert.equal(quality.status, 'warning')
    assert.ok(quality.checks.some(check => check.status !== 'pass'))
    await page.locator('.image-quality-summary.is-warning').waitFor()
    await page.getByRole('button', { name: 'เริ่มวิเคราะห์ภาพ', exact: true }).click()
    await page.locator('.scan-error').waitFor()
    assert.match(await page.locator('.scan-error').innerText(), /ระบุเหตุผล/)
    assert.equal(analysisPosts, 0, 'Quality rejection must happen before invoking the predictor')
    // The backend independently enforces acknowledgement, even if UI checks are bypassed.
    await verifyFixture(page.request)
    const labSession = await session(page)
    const blocked = await page.request.post(`${fixtureURL}/api/platform/analyses`, { headers: { 'X-CSRF-Token': labSession.csrf_token }, multipart: { image: { name: 'TEST_ONLY_flat.png', mimeType: 'image/png', buffer: png }, sample_code: 'TEST_ONLY_UNACKNOWLEDGED', confidence: '.15', acknowledge_quality: 'false' } })
    fixtureHeader(blocked)
    assert.equal(blocked.status(), 422)
    assert.equal((await blocked.json()).detail.code, 'quality_acknowledgement_required')
    await page.getByRole('checkbox', { name: /ฉันรับทราบข้อจำกัด/ }).check()
    await page.getByLabel('เหตุผลที่ใช้ภาพนี้ต่อ').fill('SYNTHETIC TEST ONLY: verify acknowledgement and expert-review workflow; this is not microscopy.')
    const analysisPromise = page.waitForResponse(response => response.url().endsWith('/api/platform/analyses') && response.request().method() === 'POST')
    await page.getByRole('button', { name: 'เริ่มวิเคราะห์ภาพ', exact: true }).click()
    const analysisResponse = await analysisPromise
    fixtureHeader(analysisResponse)
    assert.equal(analysisResponse.status(), 201, await analysisResponse.text())
    const original = await analysisResponse.json()
    assert.equal(original.status, 'completed')
    assert.equal(original.model_version, 'synthetic-ui-fixture-v1')
    assert.deepEqual(original.detections.map(item => item.label), ['TEST FIXTURE object A', 'TEST FIXTURE object B'])
    assert.equal(original.counts.predicted_total, 2)
    await page.locator('.scan-detection-item').first().waitFor()
    await page.locator('#scan-confidence').focus(); await page.locator('#scan-confidence').press('Home')
    assert.equal(await page.locator('.scan-detection-item').count(), 2)
    await page.getByRole('button', { name: 'เปิดรายการและทบทวนผล', exact: true }).click()
    await page.locator('.platform-object').first().waitFor()
    assert.equal(await page.getByRole('button', { name: 'บันทึกผลตรวจทาน', exact: true }).count(), 0, 'Lab users can read but cannot adjudicate')
    const denied = await mutate(page, `/analyses/${original.id}/reviews`, { expected_revision: original.revision, status: 'in_review', annotations: [] })
    assert.equal(denied.status(), 403)

    // Shared-device regression: same mounted application, explicit logout, other owner.
    await logout(page)
    await login(page, 'other')
    await assertNoPrivateImage(page, original.id)
    for (const suffix of ['', '/image', '/reviews', '/audit', '/export.csv']) {
      const forbidden = await page.request.get(`${fixtureURL}/api/platform/analyses/${original.id}${suffix}`)
      fixtureHeader(forbidden)
      assert.equal(forbidden.status(), 403, `Other owner must not access ${suffix || 'detail'}`)
    }
    await logout(page)
    await login(page, 'reviewer')
    await nav(page, 'ประวัติการตรวจ')
    await page.getByLabel('Analysis ID', { exact: true }).fill(original.id)
    await page.getByRole('button', { name: 'ใช้ตัวกรอง', exact: true }).click()
    const record = page.locator('.platform-record').filter({ hasText: original.id })
    await record.getByRole('button', { name: 'เปิดรายการ', exact: true }).click()
    await page.getByLabel('การดำเนินการ').selectOption('correct')
    await page.getByLabel('ชนิดที่ตรวจทาน', { exact: true }).fill('TEST FIXTURE corrected A')
    await page.getByLabel('หมายเหตุสำหรับวัตถุนี้').fill('SYNTHETIC TEST: reviewer changes the first chart label.')
    await page.locator('.platform-object').filter({ hasText: 'TEST FIXTURE object B' }).click()
    await page.getByLabel('การดำเนินการ').selectOption('false_positive')
    await page.getByLabel('หมายเหตุสำหรับวัตถุนี้').fill('SYNTHETIC TEST: second chart annotation is rejected.')
    await page.getByRole('button', { name: 'เพิ่มวัตถุที่ตกหล่น', exact: true }).click()
    const svg = page.getByRole('img', { name: 'ภาพต้นฉบับและกรอบสำหรับตรวจทาน', exact: true })
    await svg.scrollIntoViewIfNeeded()
    const box = await svg.boundingBox()
    assert.ok(box)
    await page.mouse.move(box.x + box.width * .2, box.y + box.height * .72)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * .34, box.y + box.height * .87, { steps: 4 })
    await page.mouse.up()
    await page.getByLabel('ชนิดที่ตรวจทาน', { exact: true }).fill('TEST FIXTURE missed object')
    await page.getByLabel('หมายเหตุสำหรับวัตถุนี้').fill('SYNTHETIC TEST: manually added chart region, not AI output.')
    await page.getByLabel('สถานะการทบทวน').selectOption('verified')
    await page.getByLabel('ความคิดเห็นรวม').fill('SYNTHETIC TEST ONLY. Full chart reviewed; original model predictions must remain unchanged.')
    await page.getByRole('checkbox', { name: /ตรวจภาพทั้งภาพแล้ว/ }).check()
    const reviewPromise = page.waitForResponse(response => response.url().endsWith(`/analyses/${original.id}/reviews`) && response.request().method() === 'POST')
    await page.getByRole('button', { name: 'บันทึกผลตรวจทาน', exact: true }).click()
    const reviewResponse = await reviewPromise
    fixtureHeader(reviewResponse)
    assert.equal(reviewResponse.status(), 201, await reviewResponse.text())
    const reviewed = await reviewResponse.json()
    assert.equal(reviewed.review_status, 'verified')
    assert.deepEqual(reviewed.detections, original.detections, 'Expert decisions cannot overwrite original predictions')
    assert.equal(reviewed.counts.confirmed_total, 2)
    assert.equal(reviewed.counts.false_positive_total, 1)
    assert.equal(reviewed.counts.missed_detection_total, 1)
    const auditResponse = await page.request.get(`${fixtureURL}/api/platform/analyses/${original.id}/audit`)
    const audit = await auditResponse.json()
    assert.ok(audit.items.some(item => item.action === 'updated' && item.before_data && item.after_data?.review_status === 'verified'), 'Review audit must preserve before/after data')
    await page.getByText('บันทึกผลตรวจทานแล้ว ผลเดิมและประวัติยังคงตรวจสอบย้อนหลังได้', { exact: true }).waitFor()
    for (const [button, prefix] of [['รายงาน PDF', '%PDF'], ['ข้อมูล CSV', null]]) {
      const downloadPromise = page.waitForEvent('download', { timeout: 45_000 })
      void downloadPromise.catch(() => {})
      const suffix = prefix ? '/report.pdf' : '/export.csv'
      const responsePromise = page.waitForResponse(response => response.url().endsWith(`/analyses/${original.id}${suffix}`))
      await page.getByRole('button', { name: button, exact: true }).click()
      const response = await responsePromise
      assert.equal(response.status(), 200, `${button}: ${response.status() === 200 ? '' : await response.text()}`)
      const download = await downloadPromise
      const content = await readFile(await download.path())
      if (prefix) assert.equal(content.subarray(0, 4).toString(), prefix)
      else { assert.match(content.toString('utf8'), /TEST FIXTURE object A/); assert.match(content.toString('utf8'), /TEST FIXTURE corrected A/); assert.match(content.toString('utf8'), /TEST FIXTURE missed object/) }
    }
    await nav(page, 'ประเมินและข้อเสนอแนะ')
    await page.getByText('Model evaluation data unavailable', { exact: true }).waitFor()
    const evaluation = await (await page.request.get(`${fixtureURL}/api/platform/evaluation`)).json()
    assert.equal(evaluation.status, 'unavailable'); assert.equal(evaluation.sample_size, 0); assert.equal(evaluation.metrics, null)
    await page.getByRole('tab', { name: 'ข้อเสนอแนะผลตรวจ', exact: true }).click()
    await page.getByLabel('Analysis ID', { exact: true }).fill(original.id)
    await page.getByLabel('ประเภทข้อเสนอแนะ').selectOption('incorrect_classification')
    assert.equal(await page.getByLabel('ประเภทข้อเสนอแนะ').locator('option').count(), 8)
    await page.getByLabel('รายละเอียด', { exact: true }).fill('SYNTHETIC TEST feedback linked to the actual reviewed fixture record.')
    const feedbackPromise = page.waitForResponse(response => response.url().endsWith('/api/platform/feedback') && response.request().method() === 'POST')
    await page.getByRole('button', { name: 'บันทึกข้อเสนอแนะ', exact: true }).click()
    const feedbackResponse = await feedbackPromise
    fixtureHeader(feedbackResponse)
    assert.equal(feedbackResponse.status(), 201, await feedbackResponse.text())
    const feedback = await feedbackResponse.json()
    assert.equal(feedback.category, 'incorrect_classification'); assert.equal(feedback.analysis_id, original.id); assert.equal(feedback.status, 'pending')

    // Real expired cookie (not a stubbed 401) must clear the React identity and
    // the previously selected private analysis without reloading the document.
    await context.clearCookies()
    const unauthorizedPromise = page.waitForResponse(response => response.url().includes('/api/platform/dashboard') && response.status() === 401)
    await nav(page, 'ภาพรวม')
    await unauthorizedPromise
    await page.getByRole('heading', { name: 'เข้าสู่ระบบเพื่อดูข้อมูล', exact: true }).waitFor()
    await nav(page, 'ตั้งค่าและบัญชี')
    await page.getByLabel('ชื่อบัญชี', { exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'ออกจากระบบ', exact: true }).count(), 0)
    await assertNoPrivateImage(page, original.id)
  } finally { await finish() }
})

test('Learning Lab scores only after explicit reference approval, with real attempts and role restrictions', { timeout: 180_000 }, async () => {
  const { page, finish } = await fixturePage()
  try {
    // Withdraw previous synthetic-suite approvals so this test also reruns cleanly.
    await login(page, 'reviewer')
    let catalog = await (await page.request.get(`${fixtureURL}/api/platform/learning/catalog`)).json()
    for (const reference of catalog.items.filter(item => item.approval?.approved)) {
      const response = await mutate(page, '/learning/approvals', { reference_id: reference.id, expected_revision: reference.approval.revision, approved: false, rights_confirmed: true, label_reviewed: true, limitations_reviewed: true, notes: 'Synthetic browser test resets prior educational approval, not production data.' })
      assert.equal(response.status(), 200, await response.text())
    }
    await logout(page)
    await login(page, 'student')
    await nav(page, 'ห้องเรียนพยาธิ')
    await page.getByRole('button', { name: 'แบบฝึกหัดมีคะแนน', exact: true }).click()
    await page.getByText(/ยังไม่มีภาพที่ผู้ตรวจยืนยันสำหรับแบบฝึกหัด/).waitFor()
    assert.equal(await page.getByRole('button', { name: 'เริ่มทำแบบฝึกหัด', exact: true }).isDisabled(), true)
    const quizDenied = await mutate(page, '/learning/quizzes', { mode: 'pretest', question_count: 1 })
    assert.equal(quizDenied.status(), 409)
    catalog = await (await page.request.get(`${fixtureURL}/api/platform/learning/catalog`)).json()
    const approvalDenied = await mutate(page, '/learning/approvals', { reference_id: catalog.items[0].id, approved: true, rights_confirmed: true, label_reviewed: true, limitations_reviewed: true, notes: 'Synthetic student must not approve educational ground truth.' })
    assert.equal(approvalDenied.status(), 403)
    await nav(page, 'ประวัติการตรวจ')
    await page.getByRole('heading', { name: 'บัญชีนี้ไม่มีสิทธิ์ในส่วนนี้', exact: true }).waitFor()
    await logout(page)
    await login(page, 'reviewer')
    await nav(page, 'ห้องเรียนพยาธิ')
    await page.locator('.learning-approval').waitFor()
    await page.locator('.learning-approval input[type="checkbox"]').nth(0).check()
    await page.locator('.learning-approval input[type="checkbox"]').nth(1).check()
    await page.locator('.learning-approval input[type="checkbox"]').nth(2).check()
    await page.getByLabel('คำอธิบายการตรวจสำหรับผู้เรียน (แสดงร่วมกับภาพ)').fill('SYNTHETIC UI TEST ONLY: verifies the approval workflow, not a real clinical expert endorsement.')
    const approvalPromise = page.waitForResponse(response => response.url().endsWith('/learning/approvals') && response.request().method() === 'POST')
    await page.getByRole('button', { name: 'บันทึกการตรวจยืนยัน', exact: true }).click()
    const approvalResponse = await approvalPromise
    assert.equal(approvalResponse.status(), 200, await approvalResponse.text())
    const approval = await approvalResponse.json()
    assert.equal(approval.approved, true)
    await logout(page)
    await login(page, 'student')
    const priorProgress = await (await page.request.get(`${fixtureURL}/api/platform/learning/progress`)).json()
    await nav(page, 'ห้องเรียนพยาธิ')
    await page.getByRole('button', { name: 'แบบฝึกหัดมีคะแนน', exact: true }).click()
    await page.getByLabel('จำนวนภาพสูงสุด').selectOption('1')
    await page.getByLabel('รูปแบบ').selectOption('pretest')
    const quizPromise = page.waitForResponse(response => response.url().endsWith('/learning/quizzes') && response.request().method() === 'POST')
    await page.getByRole('button', { name: 'เริ่มทำแบบฝึกหัด', exact: true }).click()
    const quizResponse = await quizPromise
    assert.equal(quizResponse.status(), 200, await quizResponse.text())
    const quiz = await quizResponse.json()
    assert.equal(quiz.questions.length, 1)
    assert.equal(Object.hasOwn(quiz.questions[0], 'correct_species_id'), false, 'Quiz response must not include a fabricated/revealed answer')
    await page.getByRole('radio', { name: 'ยังไม่สามารถระบุได้', exact: true }).check()
    const attemptPromise = page.waitForResponse(response => response.url().endsWith(`/learning/quizzes/${quiz.id}/submit`) && response.request().method() === 'POST')
    await page.getByRole('button', { name: 'บันทึกคำตอบและดูผล', exact: true }).click()
    const attemptResponse = await attemptPromise
    assert.equal(attemptResponse.status(), 200, await attemptResponse.text())
    const attempt = await attemptResponse.json()
    assert.equal(attempt.total, 1); assert.equal(attempt.correct, 0); assert.equal(attempt.percentage_correct, 0)
    assert.equal(attempt.results[0].reference_id, approval.reference_id)
    assert.equal(attempt.results[0].reviewer_id, approval.reviewer_id)
    await page.getByRole('heading', { name: 'ผลแบบฝึกหัด: 0 / 1', exact: true }).waitFor()
    const progress = await (await page.request.get(`${fixtureURL}/api/platform/learning/progress`)).json()
    assert.equal(progress.attempt_count, priorProgress.attempt_count + 1)
    await page.getByRole('button', { name: 'ความก้าวหน้าของฉัน', exact: true }).click()
    await page.getByText(`มีคำตอบที่บันทึกจริง ${progress.attempt_count} ชุด`, { exact: true }).waitFor()
  } finally { await finish() }
})

test('admin user inventory and rejected credentials use real authentication', { timeout: 90_000 }, async () => {
  const { page, finish } = await fixturePage()
  try {
    await page.getByLabel('ชื่อบัญชี', { exact: true }).fill('fixture-admin')
    await page.getByLabel('รหัสผ่าน', { exact: true }).fill('deliberately-wrong-test-password')
    const deniedPromise = page.waitForResponse(response => response.url().endsWith('/api/platform/login') && response.status() === 401)
    await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click()
    await deniedPromise
    await page.locator('.platform-error').waitFor()
    assert.equal(await page.getByLabel('ชื่อบัญชี', { exact: true }).count(), 1)
    await login(page, 'admin')
    await page.getByRole('heading', { name: 'จัดการผู้ใช้', exact: true }).waitFor()
    const usersResponse = await page.request.get(`${fixtureURL}/api/platform/users`)
    assert.equal(usersResponse.status(), 200)
    const users = await usersResponse.json()
    assert.ok(users.total >= 5)
    for (const user of users.items) {
      assert.equal(Object.hasOwn(user, 'password'), false); assert.equal(Object.hasOwn(user, 'password_hash'), false)
    }
    assert.ok(users.items.some(user => user.role === 'student'))
    assert.ok(users.items.some(user => user.role === 'reviewer'))
  } finally { await finish() }
})

test('unconfigured platform pages remain truthful and usable at 375px and 1440px', { timeout: 180_000 }, async () => {
  const context = await browser.newContext({ serviceWorkers: 'block' })
  const errors = []
  try {
    const statusResponse = await context.request.get(`${defaultURL}/api/platform/status`)
    assert.equal(statusResponse.status(), 200)
    assert.equal((await statusResponse.json()).configured, false, 'Default-state check requires an unconfigured server; it never modifies configuration')
    for (const width of [375, 1440]) {
      const page = await context.newPage()
      await page.setViewportSize({ width, height: 1000 })
      page.on('pageerror', error => errors.push(error.message))
      await page.goto(`${defaultURL}/#home`, { waitUntil: 'networkidle' })
      const pages = { home: 'ภาพรวม', history: 'ประวัติการตรวจ', verification: 'ทบทวนโดยผู้เชี่ยวชาญ', reports: 'รายงาน', performance: 'ประเมินและข้อเสนอแนะ', learning: 'ห้องเรียนพยาธิ', settings: 'ตั้งค่าและบัญชี', scan: 'ตรวจวิเคราะห์' }
      for (const [id, label] of Object.entries(pages)) {
        await nav(page, label)
        await page.waitForFunction(expected => location.hash === `#${expected}`, id)
        await page.locator('.platform-loading,.loading-state').waitFor({ state: 'hidden' })
        await page.locator('main h1').first().waitFor()
        const size = await page.evaluate(() => ({ width: innerWidth, documentWidth: document.documentElement.scrollWidth, fontSize: parseFloat(getComputedStyle(document.querySelector('main p')).fontSize) }))
        assert.ok(size.documentWidth <= size.width + 1, `${id} must not overflow the ${width}px viewport (${size.documentWidth})`)
        assert.ok(size.fontSize >= 14, `${id} supporting text must remain readable`)
        if (['home', 'history', 'verification', 'reports', 'performance'].includes(id)) {
          await page.getByText('Not configured', { exact: true }).first().waitFor()
          assert.equal(await page.locator('.platform-stat-grid').count(), 0, 'Unconfigured state must not fabricate dashboard statistics')
        }
        if (id === 'settings') assert.equal(await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).isDisabled(), true)
        if (id === 'performance') {
          await page.getByRole('tab', { name: 'แบบประเมิน SUS', exact: true }).click()
          await page.locator('.feedback-question').first().waitFor()
          assert.equal(await page.locator('.feedback-question').count(), 10, 'Simple SUS remains available separately from model research feedback')
        }
      }
      await page.close()
    }
    assert.deepEqual(errors, [])
  } finally { await context.close() }
})
