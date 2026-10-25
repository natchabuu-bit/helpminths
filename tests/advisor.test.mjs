import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const baseURL = process.env.HELPMINTHS_TEST_URL || 'http://127.0.0.1:5173'
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined)
const storageKey = 'helpminths.evaluation.v1'
let browser

before(async () => {
  browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
})
after(async () => browser?.close())

async function openPage(options = {}) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block', ...options })
  await page.route('**/api/health', route => route.fulfill({ json: { status: 'ok', model_ready: false, model_name: null, message: 'No trained model configured — test fixture' } }))
  await page.goto(baseURL, { waitUntil: 'networkidle' })
  return page
}

async function nav(page, name) {
  const item = page.locator('.sidebar .nav-item').filter({ hasText: name })
  const mobileMenu = page.getByRole('button', { name: 'เปิดเมนู', exact: true })
  if (await mobileMenu.isVisible() && !(await page.locator('.sidebar').getAttribute('class')).includes('is-open')) await mobileMenu.click()
  await item.click()
  if (name === 'โครงงานและหลักฐาน') await page.locator('.project-page').waitFor()
  else if (name === 'ทดสอบและ Feedback') await page.locator('.eval-page').waitFor()
}

async function createParticipant(page, code = 'QA-P01') {
  await page.getByLabel('รหัสผู้เข้าร่วม').fill(code)
  await page.getByLabel('ยินยอมเข้าร่วมการทดสอบการใช้งานโดยไม่ส่งข้อมูลผู้ป่วย').check()
  await page.getByRole('button', { name: 'เริ่มผู้เข้าร่วมใหม่', exact: true }).click()
}

async function answerSUS(page, answers) {
  for (let index = 0; index < answers.length; index++) {
    await page.getByRole('radio', { name: `SUS ข้อ ${index + 1} คะแนน ${answers[index]}`, exact: true }).check()
  }
}

async function download(page, name) {
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name, exact: true }).click()
  const item = await pending
  return { filename: item.suggestedFilename(), text: await readFile(await item.path(), 'utf8') }
}

async function exportedStudy(page) {
  return JSON.parse((await download(page, 'ดาวน์โหลดผลประเมิน JSON')).text)
}

async function pngFixture(page, name = 'PRIVATE_FILENAME_SHOULD_NOT_PERSIST.png') {
  const data = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 60; canvas.height = 45
    const context = canvas.getContext('2d')
    context.fillStyle = '#b8c9ba'; context.fillRect(0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/png').split(',')[1]
  })
  return { name, mimeType: 'image/png', buffer: Buffer.from(data, 'base64') }
}

test('project recommendations are visible and study summaries start without fabricated evidence', async () => {
  const page = await openPage()
  try {
    await nav(page, 'โครงงานและหลักฐาน')
    let project = await page.locator('main').textContent()
    assert.match(project, /HMW|How might we/i)
    assert.match(project, /สมมติฐาน/)
    await page.getByRole('button', { name: 'กระบวนการพัฒนา', exact: true }).click()
    project = await page.locator('main').textContent()
    for (const stage of ['Empathize', 'Define', 'Ideate', 'Prototype', 'Test']) assert.ok(project.includes(stage), `Missing design thinking stage: ${stage}`)
    await page.getByRole('button', { name: 'ความยั่งยืน', exact: true }).click()
    project = await page.locator('main').textContent()
    assert.match(project, /Render/)
    for (const [label, value] of [['เว็บ / hosting ต่อเดือน', '100'], ['พื้นที่ข้อมูลและสำรองต่อเดือน', '50'], ['ประมวลผลโมเดลต่อเดือน', '200'], ['เวลาบำรุงรักษาต่อเดือน', '2']]) await page.getByRole('spinbutton', { name: label, exact: true }).fill(value)
    assert.equal(await page.getByRole('button', { name: 'บันทึกสมมติฐาน JSON', exact: true }).isDisabled(), true)
    await page.getByRole('spinbutton', { name: 'ต้นทุนเวลาบำรุงรักษา', exact: true }).fill('300')
    const budget = JSON.parse((await download(page, 'บันทึกสมมติฐาน JSON')).text)
    assert.equal(budget.monthlyTotal, 950)
    assert.equal(budget.yearlyTotal, 11400)
    assert.equal(budget.assumptionOnly, true)
    await page.getByRole('button', { name: 'หลักฐานและการทดสอบ', exact: true }).click()
    project = await page.locator('main').textContent()
    assert.match(project, /SUS/)
    await nav(page, 'ทดสอบและ Feedback')
    assert.match(await page.getByTestId('eval-summary-participants').innerText(), /^0(?:\s|$)/)
    const snapshot = await exportedStudy(page)
    assert.equal(snapshot.schema, 'helpminths-usability-study-v1')
    assert.deepEqual(snapshot.data.participants, [])
    assert.deepEqual(snapshot.data.actions, [])
    assert.equal(snapshot.summary.completedSUSCount, 0)
    assert.equal(snapshot.summary.meanSUS, null)
    assert.equal(snapshot.summary.uploadAttemptCount, 0)
    assert.equal(await page.evaluate(key => localStorage.getItem(key), storageKey), null)
  } finally { await page.close() }
})

test('consent gates recording; timers survive navigation and only active upload tasks record metadata', { timeout: 90_000 }, async () => {
  const page = await openPage()
  const analysisPosts = []
  page.on('request', request => { if (request.url().includes('/api/analyze') && request.method() === 'POST') analysisPosts.push(request.url()) })
  try {
    const fixture = await pngFixture(page)
    await nav(page, 'ตรวจวิเคราะห์')
    await page.getByLabel('เลือกภาพจากอุปกรณ์').setInputFiles(fixture)
    await page.locator('.scan-image-svg').waitFor()
    await nav(page, 'ทดสอบและ Feedback')
    await page.getByLabel('รหัสผู้เข้าร่วม').fill('QA-TIMER')
    const start = page.getByRole('button', { name: 'เริ่มผู้เข้าร่วมใหม่', exact: true })
    if (await start.isEnabled()) await start.click()
    let snapshot = await exportedStudy(page)
    assert.equal(snapshot.summary.participantCount, 0, 'A participant must not be recorded without consent')
    assert.equal(snapshot.summary.uploadAttemptCount, 0, 'An ordinary upload outside a study must not create study evidence')
    await page.getByLabel('ยินยอมเข้าร่วมการทดสอบการใช้งานโดยไม่ส่งข้อมูลผู้ป่วย').check()
    await start.click()
    await page.getByRole('button', { name: 'เริ่มจับเวลา: ค้นหาไข่พยาธิตืดแคระ', exact: true }).click()
    await page.locator('.page-atlas').waitFor()
    await page.locator('.eval-running-strip').waitFor()
    await nav(page, 'ทดสอบและ Feedback')
    await page.getByTestId('eval-active-timer').waitFor()
    await page.getByRole('button', { name: 'จบงาน: สำเร็จ', exact: true }).click()
    snapshot = await exportedStudy(page)
    const atlas = snapshot.data.participants[0].tasks[0]
    assert.equal(atlas.kind, 'atlas')
    assert.equal(atlas.outcome, 'success')
    assert.ok(atlas.durationMs > 0, 'Navigation must retain the original task start time')
    assert.ok(atlas.endedAt)
    await page.getByRole('button', { name: 'เริ่มจับเวลา: อัปโหลดภาพกล้องจุลทรรศน์', exact: true }).click()
    await page.getByLabel('เลือกภาพจากอุปกรณ์').setInputFiles({ name: 'invalid.txt', mimeType: 'text/plain', buffer: Buffer.from('invalid') })
    await page.getByRole('alert').waitFor()
    await page.getByLabel('เลือกภาพจากอุปกรณ์').setInputFiles(fixture)
    await page.locator('.scan-image-svg').waitFor()
    await nav(page, 'ทดสอบและ Feedback')
    await page.getByRole('button', { name: 'จบงาน: สำเร็จ', exact: true }).click()
    snapshot = await exportedStudy(page)
    assert.equal(snapshot.summary.uploadAttemptCount, 2)
    assert.equal(snapshot.summary.successfulUploadCount, 1)
    const attempts = snapshot.data.participants[0].tasks.find(task => task.kind === 'upload').uploads
    assert.equal(attempts[0].success, false)
    assert.equal(attempts[1].success, true)
    assert.equal(attempts[1].width, 60)
    assert.equal(attempts[1].height, 45)
    const serialized = JSON.stringify(snapshot)
    assert.ok(!serialized.includes(fixture.name), 'The study must not retain uploaded file names')
    assert.ok(!serialized.includes('data:image/'), 'The study must not retain image bytes')
    assert.ok(!serialized.includes('imageUrl'))
    assert.deepEqual(analysisPosts, [], 'Selecting test files must not send them for AI inference automatically')
  } finally { await page.close() }
})

test('SUS requires all ten answers and exports correct scores rather than treating them as percentages', async () => {
  const page = await openPage()
  try {
    await nav(page, 'ทดสอบและ Feedback')
    await createParticipant(page, 'QA-SUS1')
    await answerSUS(page, Array(9).fill(1))
    assert.equal(await page.getByRole('button', { name: 'บันทึกคำตอบ SUS', exact: true }).isDisabled(), true)
    let snapshot = await exportedStudy(page)
    assert.equal(snapshot.summary.meanSUS, null)
    assert.equal(snapshot.summary.completedSUSCount, 0)
    await page.getByRole('radio', { name: 'SUS ข้อ 10 คะแนน 1', exact: true }).check()
    await page.getByRole('button', { name: 'บันทึกคำตอบ SUS', exact: true }).click()
    snapshot = await exportedStudy(page)
    assert.equal(snapshot.summary.meanSUS, 50)
    assert.equal(snapshot.summary.completedSUSCount, 1)
    assert.deepEqual(snapshot.data.participants[0].susAnswers, Array(10).fill(1))
    assert.ok(snapshot.data.participants[0].susCompletedAt)
    await createParticipant(page, 'QA-SUS2')
    await answerSUS(page, Array.from({ length: 10 }, (_, i) => i % 2 === 0 ? 5 : 1))
    await page.getByRole('button', { name: 'บันทึกคำตอบ SUS', exact: true }).click()
    snapshot = await exportedStudy(page)
    assert.equal(snapshot.summary.completedSUSCount, 2)
    assert.equal(snapshot.summary.meanSUS, 75, 'The mean of actual completed scores 50 and 100 must be 75')
    assert.equal(snapshot.data.participants.length, 2)
    assert.match(snapshot.susTranslation, /ยังไม่อ้าง/)
    const csv = await download(page, 'ดาวน์โหลดผลประเมิน CSV')
    assert.match(csv.text, /QA-SUS1/)
    assert.match(csv.text, /QA-SUS2/)
    assert.match(csv.text, /50/)
    assert.match(csv.text, /100/)
    await page.getByRole('radio', { name: 'SUS ข้อ 1 คะแนน 1', exact: true }).check()
    snapshot = await exportedStudy(page)
    assert.equal(snapshot.summary.completedSUSCount, 1, 'Editing an answer invalidates the previous completed response until saved again')
    assert.equal(snapshot.summary.meanSUS, 50)
  } finally { await page.close() }
})

test('study persistence is opt-in, survives reload with metadata only and can be fully erased', async () => {
  const page = await openPage()
  try {
    await nav(page, 'ทดสอบและ Feedback')
    await createParticipant(page, 'QA-LOCAL')
    assert.equal(await page.evaluate(key => localStorage.getItem(key), storageKey), null)
    await page.getByLabel('บันทึกข้อมูลประเมินบนเครื่องนี้').check()
    await page.waitForFunction(key => JSON.parse(localStorage.getItem(key) || 'null')?.data?.participants?.length === 1, storageKey)
    const stored = await page.evaluate(key => localStorage.getItem(key), storageKey)
    assert.match(stored, /QA-LOCAL/)
    assert.ok(!stored.includes('imageUrl') && !stored.includes('data:image/') && !stored.includes('base64'))
    await page.reload({ waitUntil: 'networkidle' })
    await nav(page, 'ทดสอบและ Feedback')
    assert.equal((await exportedStudy(page)).summary.participantCount, 1)
    await page.getByRole('button', { name: 'ล้างข้อมูลประเมินทั้งหมด', exact: true }).click()
    assert.equal((await exportedStudy(page)).summary.participantCount, 0)
    assert.equal(await page.evaluate(key => localStorage.getItem(key), storageKey), null)
    assert.equal(await page.getByLabel('บันทึกข้อมูลประเมินบนเครื่องนี้').isChecked(), false)
  } finally { await page.close() }
})

test('real feedback reaches report and slides safely, and new pages fit a phone viewport', { timeout: 90_000 }, async () => {
  const page = await openPage()
  try {
    await nav(page, 'ทดสอบและ Feedback')
    await createParticipant(page, 'QA-REPORT')
    const payload = '<script>window.__reportProbe=1</script>'
    await page.getByLabel('ปัญหาหรือข้อสังเกตจากการใช้จริง').fill(payload)
    await page.getByLabel('ข้อเสนอแนะของผู้เข้าร่วม').fill('เพิ่มคำอธิบายปุ่มซูม')
    await nav(page, 'โครงงานและหลักฐาน')
    await nav(page, 'ทดสอบและ Feedback')
    assert.equal(await page.getByLabel('ปัญหาหรือข้อสังเกตจากการใช้จริง').inputValue(), payload, 'Unsaved feedback must survive navigating to another page')
    await page.getByRole('button', { name: 'บันทึกข้อเสนอแนะ', exact: true }).click()
    assert.equal((await exportedStudy(page)).summary.feedbackCount, 1)
    await page.getByLabel('อุปสรรคที่พบ').fill('QA interview fixture: หาปุ่มซูมไม่พบในครั้งแรก')
    await page.getByRole('button', { name: 'บันทึกสัมภาษณ์', exact: true }).click()
    assert.equal((await exportedStudy(page)).summary.interviewCount, 1)
    await page.getByLabel('ปัญหาที่ต้องปรับ').fill('ปุ่มซูมค้นหายาก')
    await page.getByLabel('สิ่งที่จะปรับปรุง').fill('เพิ่มคำอธิบายปุ่มซูม')
    await page.getByLabel('สถานะเริ่มต้น').selectOption('implemented')
    await page.getByRole('button', { name: 'เพิ่มรายการปรับปรุง', exact: true }).click()
    assert.equal((await exportedStudy(page)).data.actions.length, 0, 'An implemented claim requires supporting evidence')
    await page.getByLabel('หลักฐานการปรับหรือผลตรวจซ้ำ').fill('QA fixture: บันทึกรุ่นและตรวจคำอธิบายปุ่มแล้ว')
    await page.getByRole('button', { name: 'เพิ่มรายการปรับปรุง', exact: true }).click()
    assert.equal((await exportedStudy(page)).data.actions[0].status, 'implemented')
    await nav(page, 'โครงงานและหลักฐาน')
    const report = await download(page, 'ดาวน์โหลดรายงาน HTML')
    assert.match(report.text, /<!doctype html>/i)
    assert.match(report.text, /Brooke/)
    assert.match(report.text, /Render/)
    assert.ok(report.text.includes('window.__reportProbe=1'), 'A report must contain actual entered feedback')
    assert.ok(!report.text.includes(payload), 'Feedback must be escaped before being placed in HTML')
    assert.match(report.text, /&lt;script&gt;/)
    const slides = await download(page, 'ดาวน์โหลดสไลด์ HTML')
    assert.match(slides.text, /<!doctype html>/i)
    assert.match(slides.text, /Brooke/)
    assert.ok(!slides.text.includes(payload))
    assert.ok((slides.text.match(/<section\b/g) || []).length >= 5)
    await page.setViewportSize({ width: 375, height: 812 })
    for (const section of ['โครงงานและหลักฐาน', 'ทดสอบและ Feedback']) {
      await nav(page, section)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, `${section} must not overflow horizontally on a phone`)
    }
  } finally { await page.close() }
})
