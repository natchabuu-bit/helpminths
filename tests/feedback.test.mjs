import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { existsSync } from 'node:fs'
import { chromium } from 'playwright'

const baseURL = process.env.HELPMINTHS_TEST_URL || 'http://127.0.0.1:5173'
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined)
const feedbackKey = 'helpminths.feedback.v1'
const legacyKey = 'helpminths.evaluation.v1'
const evaluationNav = 'ประเมินและข้อเสนอแนะ'
let browser

before(async () => {
  browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
})
after(async () => browser?.close())

async function openPage(options = {}, setup) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block', ...options })
  await page.route('**/api/health', route => route.fulfill({ json: { status: 'ok', model_ready: false, model_name: null, message: 'No trained model configured — test fixture' } }))
  if (setup) await setup(page)
  await page.goto(baseURL, { waitUntil: 'networkidle' })
  return page
}

async function nav(page, name) {
  const item = page.locator('.sidebar .nav-item').filter({ hasText: name })
  const mobileMenu = page.getByRole('button', { name: 'เปิดเมนู', exact: true })
  if (await mobileMenu.isVisible() && !(await page.locator('.sidebar').getAttribute('class')).includes('is-open')) await mobileMenu.click()
  await item.click()
  if (name === evaluationNav) await page.getByRole('heading', { name: 'ประเมินการใช้งาน', exact: true }).waitFor()
}

async function answerSUS(page, answers) {
  for (let index = 0; index < answers.length; index++) {
    const radio = page.locator(`input[name="sus-${index + 1}"][value="${answers[index]}"]`)
    await radio.focus()
    await radio.press('Space')
  }
}
async function readSaved(page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key) || 'null'), feedbackKey)
}
async function save(page) {
  await page.getByRole('button', { name: 'บันทึกคำตอบ', exact: true }).click()
}

// These scenarios exercise user-visible behavior and the saved-response contract.
// They never submit responses to a server or create participant-study evidence.
test('navigation removes project and workspace UI; an old project URL safely opens the home page', async () => {
  const page = await openPage()
  try {
    assert.equal(await page.locator('.sidebar .nav-item').count(), 5)
    assert.doesNotMatch(await page.locator('body').innerText(), /โครงงานและหลักฐาน|พื้นที่ทำงาน|WORKSPACE/)
    assert.equal(await page.getByRole('button', { name: 'โครงงานและหลักฐาน', exact: true }).count(), 0)
    await page.goto(`${baseURL}/#project`, { waitUntil: 'networkidle' })
    await page.reload({ waitUntil: 'networkidle' })
    await page.locator('.page-home').waitFor()
    assert.equal(await page.locator('.project-page').count(), 0)
    await nav(page, evaluationNav)
    const form = page.getByTestId('evaluation-page')
    assert.equal(await form.locator('fieldset').count(), 10)
    assert.equal(await form.getByRole('radio').count(), 50)
    assert.equal(await form.getByRole('textbox').count(), 1)
    assert.equal(await form.getByRole('checkbox').count(), 0)
    assert.equal(await form.getByRole('combobox').count(), 0)
    assert.equal(await form.getByRole('spinbutton').count(), 0)
    assert.equal(await form.getByRole('button').count(), 1)
    assert.doesNotMatch(await form.innerText(), /รหัสผู้เข้าร่วม|เริ่มจับเวลา|สัมภาษณ์|รายการปรับปรุง|ดาวน์โหลดผลประเมิน|CSV|JSON/)
    assert.match(await form.innerText(), /ไม่มีการส่งไปยังเซิร์ฟเวอร์/)
  } finally { await page.close() }
})

test('incomplete SUS answers are not saved and focus moves to the unanswered question', async () => {
  const page = await openPage()
  try {
    await nav(page, evaluationNav)
    await answerSUS(page, Array(9).fill(3))
    await save(page)
    await page.getByRole('alert').waitFor()
    assert.match(await page.getByRole('alert').innerText(), /ครบทั้ง 10 ข้อ/)
    assert.equal(await readSaved(page), null)
    await page.waitForFunction(() => document.activeElement?.getAttribute('name') === 'sus-10')
    assert.equal(await page.locator('input[name="sus-10"][aria-invalid="true"]').count(), 5)
    assert.equal(await page.locator('.feedback-progress progress').getAttribute('value'), '9')
    await page.locator('input[name="sus-10"][value="3"]').check()
    await save(page)
    await page.locator('.feedback-result[role="status"]').waitFor()
    assert.equal((await readSaved(page)).susScore, 50)
    assert.equal((await readSaved(page)).feedback, '', 'Additional written feedback is optional')
  } finally { await page.close() }
})

test('completed SUS responses save the correct 0, 50 and 100 scores only on explicit save', { timeout: 90_000 }, async () => {
  const page = await openPage()
  const writes = []
  page.on('request', request => { if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) writes.push({ method: request.method(), url: request.url() }) })
  try {
    await nav(page, evaluationNav)
    const cases = [
      { answers: Array.from({ length: 10 }, (_, i) => i % 2 === 0 ? 1 : 5), expected: 0 },
      { answers: Array(10).fill(3), expected: 50 },
      { answers: Array.from({ length: 10 }, (_, i) => i % 2 === 0 ? 5 : 1), expected: 100 },
    ]
    let previous = null
    for (const scenario of cases) {
      await answerSUS(page, scenario.answers)
      assert.deepEqual(await readSaved(page), previous, 'Changing answers must leave the saved response untouched until Save is chosen')
      await save(page)
      await page.locator('.feedback-result[role="status"]').waitFor()
      const stored = await readSaved(page)
      assert.equal(stored.version, 1)
      assert.deepEqual(stored.answers, scenario.answers)
      assert.equal(stored.susScore, scenario.expected)
      assert.ok(Number.isFinite(Date.parse(stored.savedAt)))
      assert.match(await page.locator('.feedback-result').innerText(), /บนอุปกรณ์นี้/)
      previous = stored
    }
    assert.deepEqual(writes, [], 'Saving this local form must not make a remote write request')
  } finally { await page.close() }
})

test('drafts survive navigation; explicit saved answers survive reload without altering legacy study data', async () => {
  const legacy = '{"fixture":"existing study data must stay unchanged"}'
  const page = await openPage({}, page => page.addInitScript(({ key, value }) => localStorage.setItem(key, value), { key: legacyKey, value: legacy }))
  try {
    await nav(page, evaluationNav)
    const payload = '<script>window.__feedbackProbe=1</script> เพิ่มคำอธิบายปุ่มซูม'
    await page.getByLabel('ข้อเสนอแนะของคุณ', { exact: true }).fill(payload)
    await answerSUS(page, Array(10).fill(3))
    assert.equal(await readSaved(page), null)
    await nav(page, 'ภาพรวม')
    await nav(page, evaluationNav)
    assert.equal(await page.getByLabel('ข้อเสนอแนะของคุณ', { exact: true }).inputValue(), payload)
    assert.equal(await page.getByRole('radio', { checked: true }).count(), 10)
    await save(page)
    await page.locator('.feedback-result[role="status"]').waitFor()
    assert.equal((await readSaved(page)).feedback, payload)
    assert.equal(await page.evaluate(key => localStorage.getItem(key), legacyKey), legacy)
    await page.reload({ waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: 'ประเมินการใช้งาน', exact: true }).waitFor()
    assert.equal(await page.getByRole('radio', { checked: true }).count(), 10)
    assert.equal(await page.getByLabel('ข้อเสนอแนะของคุณ', { exact: true }).inputValue(), payload)
    assert.equal(await page.evaluate(() => window.__feedbackProbe), undefined, 'Written feedback must remain text')
    const before = await readSaved(page)
    await page.getByLabel('ข้อเสนอแนะของคุณ', { exact: true }).fill('แก้ไขไว้ แต่ยังไม่บันทึก')
    assert.deepEqual(await readSaved(page), before)
    await page.reload({ waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: 'ประเมินการใช้งาน', exact: true }).waitFor()
    assert.equal(await page.getByLabel('ข้อเสนอแนะของคุณ', { exact: true }).inputValue(), payload, 'Reload should restore the last explicitly saved response')
    assert.equal(await page.evaluate(key => localStorage.getItem(key), legacyKey), legacy)
  } finally { await page.close() }
})

test('storage failure reports an error honestly and preserves the entered answers', async () => {
  const page = await openPage({}, page => page.addInitScript(() => {
    Storage.prototype.setItem = function () { throw new DOMException('Blocked in this test', 'QuotaExceededError') }
  }))
  try {
    await nav(page, evaluationNav)
    await answerSUS(page, Array(10).fill(3))
    await page.getByLabel('ข้อเสนอแนะของคุณ', { exact: true }).fill('คำตอบนี้ต้องยังอยู่เมื่อบันทึกไม่ได้')
    await save(page)
    await page.getByRole('alert').waitFor()
    assert.match(await page.getByRole('alert').innerText(), /บันทึกคำตอบไม่ได้/)
    assert.equal(await page.locator('.feedback-result[role="status"]').count(), 0)
    assert.equal(await readSaved(page), null)
    assert.equal(await page.getByRole('radio', { checked: true }).count(), 10)
    assert.equal(await page.getByLabel('ข้อเสนอแนะของคุณ', { exact: true }).inputValue(), 'คำตอบนี้ต้องยังอยู่เมื่อบันทึกไม่ได้')
  } finally { await page.close() }
})
