import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { existsSync } from 'node:fs'
import { chromium } from 'playwright'

// Every write is restricted to an explicitly marked, disposable localhost DB.
const origin = new URL(process.env.HELPMINTHS_ACCOUNT_FLOW_TEST_URL || 'http://127.0.0.1:8120').origin
const password = 'Synthetic-UI-test-only-2026!'
const profile = { full_name: 'สมมติ ทดสอบระบบ', workplace: 'ห้องปฏิบัติการจำลอง', affiliation: 'หน่วยงานทดสอบเท่านั้น', phone: '0812345678' }
let browser
before(async () => {
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname))
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), headless: true, args: ['--no-sandbox'] })
})
after(async () => browser?.close())
async function fixture(request) {
  const response = await request.get(`${origin}/api/platform/status`, { maxRedirects: 0 })
  assert.equal(response.headers()['x-helpminths-test-fixture'], 'synthetic-only', 'Refusing writes without an explicit synthetic fixture')
  assert.equal(response.status(), 200)
}
async function contextForTest() {
  const context = await browser.newContext({ viewport: { width: 375, height: 1000 }, reducedMotion: 'reduce', serviceWorkers: 'block' })
  await fixture(context.request)
  const errors = []
  context.on('page', page => { page.setDefaultTimeout(20_000); page.on('pageerror', error => errors.push(error.message)) })
  await context.route('**/*', async route => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) {
      const url = new URL(route.request().url())
      assert.equal(url.origin, origin)
      assert.ok(url.pathname.startsWith('/api/platform/'))
      await fixture(context.request)
    }
    await route.continue()
  })
  return { context, finish: async () => { await context.close(); assert.deepEqual(errors, []) } }
}
async function session(context) { return (await context.request.get(`${origin}/api/platform/session`)).json() }
async function mutate(context, path, data, method = 'post') {
  await fixture(context.request)
  const identity = await session(context)
  const response = await context.request[method](`${origin}/api/platform${path}`, { data, maxRedirects: 0, headers: { 'X-CSRF-Token': identity.csrf_token || '' } })
  assert.equal(response.headers()['x-helpminths-test-fixture'], 'synthetic-only')
  return response
}
async function jsonResponse(response, status = 200) { assert.equal(response.status(), status, await response.text()); return response.json() }
async function fillProfile(page) {
  for (const [label, key] of [['ชื่อ-นามสกุล', 'full_name'], ['สถานที่ทำงาน', 'workplace'], ['สังกัด', 'affiliation'], ['เบอร์โทร 10 หลัก', 'phone']]) await page.getByLabel(label, { exact: true }).fill(profile[key])
}
async function fitsPhone(page) { assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Content must fit a 375px phone') }

test('both registration channels require a full profile and show no readiness banner', { timeout: 60_000 }, async () => {
  const { context, finish } = await contextForTest()
  try {
    const page = await context.newPage()
    await page.goto(`${origin}/#settings`, { waitUntil: 'networkidle' })
    for (const expert of [false, true]) {
      await page.getByRole('tablist', { name: 'ช่องทางเข้าใช้งาน', exact: true }).getByRole('tab', { name: expert ? /^ผู้เชี่ยวชาญ/ : /^ผู้ใช้ทั่วไป/ }).click()
      await page.getByRole('tab', { name: expert ? 'สมัครเป็นผู้เชี่ยวชาญ' : 'สมัครสมาชิก', exact: true }).click()
      for (const label of ['ชื่อ-นามสกุล', 'สถานที่ทำงาน', 'สังกัด', 'เบอร์โทร 10 หลัก']) {
        const field = page.getByLabel(label, { exact: true })
        await field.fill('')
        assert.equal(await field.evaluate(input => input.required && !input.checkValidity()), true, `${label} is mandatory for both channels`)
      }
      const phone = page.getByLabel('เบอร์โทร 10 หลัก', { exact: true })
      await phone.fill('081234567'); assert.equal(await phone.evaluate(input => input.checkValidity()), false)
      await phone.fill('abcdefghij'); assert.equal(await phone.evaluate(input => input.checkValidity()), false)
      await phone.fill(profile.phone); assert.equal(await phone.evaluate(input => input.checkValidity()), true)
      await fitsPhone(page)
    }
    assert.equal(await page.locator('.account-readiness').count(), 0)
    assert.equal(await page.getByRole('button', { name: 'ตรวจสอบระบบอีกครั้ง', exact: true }).count(), 0)
    assert.doesNotMatch(await page.locator('body').innerText(), /ระบบบัญชีพร้อมใช้งาน เลือกช่องทาง/)
  } finally { await finish() }
})

test('profile dropdown and private per-case expert notifications open the selected reply and survive reload', { timeout: 150_000 }, async () => {
  const owner = await contextForTest(), admin = await contextForTest(), expert = await contextForTest(), stranger = await contextForTest()
  try {
    await jsonResponse(await mutate(admin.context, '/owner-signin', { username: 'fixture-admin', password }))
    await jsonResponse(await mutate(expert.context, '/expert-signin', { username: 'fixture-reviewer', password }))
    await jsonResponse(await mutate(stranger.context, '/login', { username: 'fixture-other', password }))
    const page = await owner.context.newPage(), username = `notification_owner_${Date.now()}`
    await page.goto(`${origin}/#settings`, { waitUntil: 'networkidle' })
    await page.getByRole('tab', { name: 'สมัครสมาชิก', exact: true }).click()
    await page.getByLabel('ชื่อบัญชี', { exact: true }).fill(username)
    await page.getByLabel('รหัสผ่าน', { exact: true }).fill(password)
    await page.getByLabel('ยืนยันรหัสผ่าน', { exact: true }).fill(password)
    await fillProfile(page)
    const registering = page.waitForResponse(response => response.url().endsWith('/api/platform/register') && response.request().method() === 'POST')
    await page.getByRole('button', { name: 'สมัครและส่งคำขออนุมัติ', exact: true }).click()
    const registered = await jsonResponse(await registering, 201)
    for (const [key, value] of Object.entries(profile)) assert.equal(registered.user[key], value)
    assert.equal((await session(owner.context)).user, null, 'Registration must still require owner approval')
    await jsonResponse(await mutate(admin.context, `/users/${registered.user.id}`, { approval_status: 'approved', role: 'lab' }, 'patch'))
    await page.getByRole('tab', { name: 'เข้าสู่ระบบ', exact: true }).click()
    await page.getByLabel('ชื่อบัญชี', { exact: true }).fill(username)
    await page.getByLabel('รหัสผ่าน', { exact: true }).fill(password)
    const signingIn = page.waitForResponse(response => response.url().endsWith('/api/platform/login') && response.request().method() === 'POST')
    await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click()
    await jsonResponse(await signingIn)
    const account = page.getByRole('button', { name: 'บัญชีของฉัน', exact: true })
    await account.click()
    const menu = page.getByRole('region', { name: 'เมนูบัญชี', exact: true })
    await menu.waitFor()
    assert.match(await menu.innerText(), /สมมติ ทดสอบระบบ/)
    assert.match(await menu.innerText(), /ผู้ใช้ทั่วไป.*อนุมัติแล้ว/s)
    await page.keyboard.press('Escape')
    assert.equal(await account.evaluate(node => node === document.activeElement), true)
    await account.click()
    await menu.getByRole('button', { name: 'ตั้งค่า', exact: true }).click()
    assert.equal(new URL(page.url()).hash, '#settings')
    assert.equal(await menu.count(), 0)
    const summary = page.locator('.account-summary-grid')
    assert.deepEqual(await summary.locator('span').allTextContents(), ['บทบาท', 'สถานะบัญชี'])
    assert.equal(await page.locator('.account-preferences').getByLabel('ชื่อ-นามสกุล', { exact: true }).inputValue(), profile.full_name)
    assert.equal(await page.getByLabel('ชื่อบัญชีที่ต้องการใช้', { exact: true }).inputValue(), username)

    const image = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 384
      const painter = canvas.getContext('2d')
      for (let x = 0; x < 512; x += 16) for (let y = 0; y < 384; y += 16) { painter.fillStyle = (x / 16 + y / 16) % 2 ? '#b4b4b4' : '#4b4b4b'; painter.fillRect(x, y, 16, 16) }
      return canvas.toDataURL('image/png').split(',')[1]
    })
    const cases = []
    for (const code of ['SYNTHETIC_NOTIFICATION_A', 'SYNTHETIC_NOTIFICATION_B']) {
      const identity = await session(owner.context)
      await fixture(owner.context.request)
      const analysis = await jsonResponse(await owner.context.request.post(`${origin}/api/platform/analyses`, {
        headers: { 'X-CSRF-Token': identity.csrf_token },
        multipart: { image: { name: 'SYNTHETIC-notification.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') }, sample_code: code, acknowledge_quality: 'true', quality_comment: 'Synthetic chart for software verification only.' },
      }), 201)
      const referral = await jsonResponse(await mutate(owner.context, `/analyses/${analysis.id}/referrals`, { expected_revision: analysis.revision, reason: `Synthetic review of ${code}` }), 201)
      cases.push({ analysis, referral })
    }
    const firstComment = 'คำตอบจำลองเฉพาะภาพ A: ต้องการภาพบริเวณขอบเพิ่มเติม'
    const secondComment = 'คำตอบจำลองเฉพาะภาพ B: ตรวจทานลักษณะแล้ว'
    await jsonResponse(await mutate(expert.context, `/referrals/${cases[0].referral.id}/response`, { expected_revision: cases[0].referral.revision, action: 'request_more', comment: firstComment }))
    await jsonResponse(await mutate(expert.context, `/referrals/${cases[1].referral.id}/response`, { expected_revision: cases[1].referral.revision, action: 'reply', comment: secondComment }))
    let inbox = await jsonResponse(await owner.context.request.get(`${origin}/api/platform/notifications`))
    assert.equal(inbox.total, 2); assert.equal(inbox.unread_count, 2)
    assert.deepEqual(new Set(inbox.items.map(item => item.analysis_id)), new Set(cases.map(item => item.analysis.id)))
    const firstNotification = inbox.items.find(item => item.analysis_id === cases[0].analysis.id)
    const strangerInbox = await jsonResponse(await stranger.context.request.get(`${origin}/api/platform/notifications`))
    assert.equal(strangerInbox.total, 0, 'Other accounts do not receive these private replies')
    assert.equal((await mutate(stranger.context, `/notifications/${firstNotification.id}/read`, {})).status(), 404)
    await page.reload({ waitUntil: 'networkidle' })
    const bell = page.getByRole('button', { name: /^การแจ้งเตือน/ })
    await bell.click()
    const notifications = page.locator('.notification-popover')
    const firstRead = page.waitForResponse(response => response.url().endsWith(`/notifications/${firstNotification.id}/read`) && response.request().method() === 'POST')
    await notifications.locator('.notification-item').filter({ hasText: cases[0].analysis.sample_code }).click()
    await jsonResponse(await firstRead)
    await page.getByRole('region', { name: 'คำตอบที่เลือกจากการแจ้งเตือน', exact: true }).waitFor()
    const selectedAnswer = page.locator(`.referral-response[data-message-id="${firstNotification.message_id}"]`)
    await selectedAnswer.waitFor()
    assert.match(await selectedAnswer.innerText(), new RegExp(firstComment))
    await page.getByRole('heading', { name: cases[0].analysis.sample_code, exact: true }).waitFor()
    inbox = await jsonResponse(await owner.context.request.get(`${origin}/api/platform/notifications`))
    assert.equal(inbox.unread_count, 1)
    assert.ok(inbox.items.find(item => item.id === firstNotification.id).read_at)
    await fitsPhone(page)
    await page.reload({ waitUntil: 'networkidle' })
    await bell.click()
    const secondNotification = inbox.items.find(item => item.analysis_id === cases[1].analysis.id)
    const secondRead = page.waitForResponse(response => response.url().endsWith(`/notifications/${secondNotification.id}/read`) && response.request().method() === 'POST')
    await page.locator('.notification-item').filter({ hasText: cases[1].analysis.sample_code }).click()
    await jsonResponse(await secondRead)
    const secondAnswer = page.locator(`.referral-response[data-message-id="${secondNotification.message_id}"]`)
    await secondAnswer.waitFor()
    assert.match(await secondAnswer.innerText(), new RegExp(secondComment))
    await page.getByRole('heading', { name: cases[1].analysis.sample_code, exact: true }).waitFor()
    assert.equal((await jsonResponse(await owner.context.request.get(`${origin}/api/platform/notifications`))).unread_count, 0)
    await fitsPhone(page)

    // Reading an old response must preserve that exact message even after final confirmation.
    const latest = await jsonResponse(await expert.context.request.get(`${origin}/api/platform/analyses/${cases[1].analysis.id}`))
    await jsonResponse(await mutate(expert.context, `/analyses/${latest.id}/reviews`, { expected_revision: latest.revision, full_image_reviewed: true, status: 'verified', comment: 'คำยืนยันจำลองภาพ B เสร็จสิ้น', annotations: latest.detections.map(item => ({ detection_id: String(item.id), action: 'confirm' })) }), 201)
    await page.reload({ waitUntil: 'networkidle' }); await bell.click()
    assert.equal(await page.locator('.notification-item').filter({ hasText: cases[1].analysis.sample_code }).count(), 2, 'Each expert response remains its own notification')
    await page.locator('.notification-item').filter({ hasText: secondComment }).click()
    await page.locator(`.referral-response[data-message-id="${secondNotification.message_id}"]`).waitFor()
    assert.match(await page.locator(`.referral-response[data-message-id="${secondNotification.message_id}"]`).innerText(), new RegExp(secondComment))
    await account.click()
    await page.getByRole('region', { name: 'เมนูบัญชี', exact: true }).getByRole('button', { name: 'ออกจากระบบ', exact: true }).click()
    await page.getByRole('button', { name: 'เข้าสู่ระบบหรือสมัครสมาชิก', exact: true }).waitFor()
    assert.equal(await page.locator('.notification-popover,.notification-item,.referral-response').count(), 0, 'Logout clears private account UI')
    assert.equal((await session(owner.context)).user, null)
  } finally { await Promise.all([owner.finish(), admin.finish(), expert.finish(), stranger.finish()]) }
})
