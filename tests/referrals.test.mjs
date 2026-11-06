import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { existsSync } from 'node:fs'
import { chromium } from 'playwright'

// Mutations are allowed only on the explicit localhost synthetic fixture.
const baseURL = process.env.HELPMINTHS_REFERRAL_TEST_URL || 'http://127.0.0.1:5197'
const testPassword = 'Synthetic-referral-only-2026!'
const staffPassword = 'Synthetic-UI-test-only-2026!'
let browser

async function fixture(request) {
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(baseURL).hostname))
  const response = await request.get(`${baseURL}/api/platform/status`)
  assert.equal(response.status(), 200)
  assert.equal(response.headers()['x-helpminths-test-fixture'], 'synthetic-only', 'Refusing writes to an ordinary/production service')
}
before(async () => {
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
    headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  })
})
after(async () => browser?.close())

async function contextForTest() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block', reducedMotion: 'reduce' })
  await fixture(context.request)
  const errors = []
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)))
  await context.route('**/api/platform/**', async route => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) await fixture(context.request)
    await route.continue()
  })
  return { context, errors }
}
async function session(context) { return (await context.request.get(`${baseURL}/api/platform/session`)).json() }
async function nav(page, name) {
  const menu = page.getByRole('button', { name: 'เปิดเมนู', exact: true })
  if (await menu.isVisible() && await menu.getAttribute('aria-expanded') !== 'true') await menu.click()
  await page.locator('.sidebar .nav-item').filter({ hasText: name }).click()
}
async function post(context, path, data, method = 'post') {
  await fixture(context.request)
  const identity = await session(context)
  return context.request[method](`${baseURL}/api/platform${path}`, { data, headers: { 'X-CSRF-Token': identity.csrf_token || '' } })
}

test('self-registered owners send uncertain images; approved experts reauthenticate, answer and lock the queue', { timeout: 180_000 }, async () => {
  const owner = await contextForTest(), expert = await contextForTest(), other = await contextForTest()
  try {
    const ownerPage = await owner.context.newPage()
    await ownerPage.goto(`${baseURL}/#settings`, { waitUntil: 'networkidle' })
    await ownerPage.getByRole('tab', { name: 'สมัครสมาชิก', exact: true }).click()
    const name = `referral_owner_${Date.now()}`
    await ownerPage.getByLabel('ชื่อบัญชี', { exact: true }).fill(name)
    await ownerPage.getByLabel('รหัสผ่าน', { exact: true }).fill(testPassword)
    await ownerPage.getByLabel('ยืนยันรหัสผ่าน', { exact: true }).fill(testPassword)
    await ownerPage.getByRole('button', { name: 'สร้างบัญชีและเข้าใช้งาน', exact: true }).click()
    await ownerPage.getByRole('button', { name: 'ออกจากระบบ', exact: true }).waitFor()
    const ownerSession = await session(owner.context)
    assert.equal(ownerSession.user.role, 'lab', 'Public registration must never grant expert permissions')

    const png = await ownerPage.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 384
      const context = canvas.getContext('2d')
      for (let x = 0; x < 512; x += 16) for (let y = 0; y < 384; y += 16) { context.fillStyle = (x / 16 + y / 16) % 2 ? '#b4b4b4' : '#4b4b4b'; context.fillRect(x, y, 16, 16) }
      return canvas.toDataURL('image/png').split(',')[1]
    })
    await fixture(owner.context.request)
    const response = await owner.context.request.post(`${baseURL}/api/platform/analyses`, {
      headers: { 'X-CSRF-Token': ownerSession.csrf_token },
      multipart: { image: { name: 'SYNTHETIC_referral.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') }, sample_code: `TEST_REFERRAL_${Date.now()}`, acknowledge_quality: 'true', quality_comment: 'SYNTHETIC browser workflow only, not microscopy or diagnostic evidence.' },
    })
    assert.equal(response.status(), 201, await response.text())
    const analysis = await response.json()
    assert.equal(analysis.model_version, 'synthetic-ui-fixture-v1')
    await nav(ownerPage, 'ประวัติการตรวจ')
    await ownerPage.locator('.platform-record').filter({ hasText: analysis.sample_code }).getByRole('button', { name: 'เปิดรายการ', exact: true }).click()
    const panel = ownerPage.locator('.referral-panel')
    await panel.getByLabel('สิ่งที่ต้องการให้ผู้เชี่ยวชาญช่วยตรวจ', { exact: true }).fill('SYNTHETIC TEST: uncertain chart region, please review both annotations.')
    await panel.getByRole('button', { name: 'ส่งให้ผู้เชี่ยวชาญ', exact: true }).click()
    await ownerPage.getByText('ส่งภาพเข้าคลังรอผู้เชี่ยวชาญแล้ว', { exact: true }).waitFor()
    await ownerPage.getByRole('button', { name: 'กลับคลังภาพส่งต่อ', exact: true }).click()
    await ownerPage.locator('.expert-referral-card').filter({ hasText: analysis.sample_code }).waitFor()
    assert.equal(await ownerPage.getByRole('button', { name: 'บันทึกผลตรวจทาน', exact: true }).count(), 0)
    const ownerReferral = (await (await owner.context.request.get(`${baseURL}/api/platform/analyses/${analysis.id}/referral`)).json()).referral
    assert.equal(ownerReferral.status, 'pending')
    const pendingHistory = await owner.context.request.get(`${baseURL}/api/platform/analyses?scope=mine&referral_state=not_pending&analysis_id=${analysis.id}`)
    assert.equal(pendingHistory.status(), 200)
    assert.equal((await pendingHistory.json()).total, 0, 'A pending referral must be separated from daily history')

    const otherRegister = await post(other.context, '/register', { username: `referral_other_${Date.now()}`, password: testPassword })
    assert.equal(otherRegister.status(), 201)
    const otherQueue = await other.context.request.get(`${baseURL}/api/platform/referrals?scope=mine`)
    assert.equal((await otherQueue.json()).total, 0)
    assert.equal((await other.context.request.get(`${baseURL}/api/platform/analyses/${analysis.id}/image`)).status(), 403)
    assert.equal((await other.context.request.get(`${baseURL}/api/platform/referrals/${ownerReferral.id}`)).status(), 403)
    assert.equal((await post(other.context, '/expert-login', { password: testPassword })).status(), 403)

    const staffLogin = await post(expert.context, '/login', { username: 'fixture-reviewer', password: staffPassword })
    assert.equal(staffLogin.status(), 200)
    assert.equal((await expert.context.request.get(`${baseURL}/api/platform/analyses/${analysis.id}/image`)).status(), 403, 'Cross-owner image requires expert step-up')
    const expertPage = await expert.context.newPage()
    await expertPage.goto(`${baseURL}/#verification`, { waitUntil: 'networkidle' })
    await expertPage.getByRole('heading', { name: 'ยืนยันตัวตนผู้เชี่ยวชาญ', exact: true }).waitFor()
    assert.equal(await expertPage.locator('.expert-referral-card').count(), 0)
    await expertPage.getByLabel('รหัสผ่านผู้เชี่ยวชาญ', { exact: true }).fill('wrong-password-SYNTHETIC')
    await expertPage.getByRole('button', { name: 'ยืนยันและเข้าคลังภาพ', exact: true }).click()
    await expertPage.locator('.platform-error').waitFor()
    assert.equal((await session(expert.context)).user.username, 'fixture-reviewer', 'Wrong step-up password must preserve the base login')
    await expertPage.getByLabel('รหัสผ่านผู้เชี่ยวชาญ', { exact: true }).fill(staffPassword)
    await expertPage.getByRole('button', { name: 'ยืนยันและเข้าคลังภาพ', exact: true }).click()
    await expertPage.locator('.expert-referral-card').filter({ hasText: analysis.sample_code }).getByRole('button', { name: 'เปิดภาพและตรวจทาน', exact: true }).click()
    await expertPage.getByRole('button', { name: 'ยืนยันกรอบที่ยังไม่ทบทวน', exact: true }).click()
    await expertPage.getByLabel('สถานะการทบทวน').selectOption('verified')
    await expertPage.getByLabel('ความคิดเห็นรวม', { exact: true }).fill('SYNTHETIC TEST CONFIRMED: two chart regions verified for workflow only.')
    await expertPage.getByRole('checkbox', { name: /ตรวจภาพทั้งภาพแล้ว/ }).check()
    await expertPage.getByRole('button', { name: 'บันทึกผลตรวจทาน', exact: true }).click()
    await expertPage.getByText('บันทึกผลตรวจทานแล้ว ผลเดิมและประวัติยังคงตรวจสอบย้อนหลังได้', { exact: true }).waitFor()
    const confirmed = (await (await owner.context.request.get(`${baseURL}/api/platform/analyses/${analysis.id}/referral`)).json()).referral
    assert.equal(confirmed.status, 'confirmed')
    assert.equal(confirmed.reviewer_username, 'fixture-reviewer')
    assert.match(confirmed.response_comment, /SYNTHETIC TEST CONFIRMED/)
    const updated = await (await owner.context.request.get(`${baseURL}/api/platform/analyses/${analysis.id}`)).json()
    assert.deepEqual(updated.detections, analysis.detections, 'Expert confirmation preserves original AI predictions')
    const confirmedHistory = await owner.context.request.get(`${baseURL}/api/platform/analyses?scope=mine&referral_state=not_pending&analysis_id=${analysis.id}`)
    const history = await confirmedHistory.json()
    assert.equal(history.total, 1, 'Confirmation returns one original record to daily history')
    assert.equal(history.items[0].created_at, analysis.created_at, 'Confirmation must not change the original examination day')
    await ownerPage.getByRole('tab', { name: 'ตอบกลับแล้ว', exact: true }).click()
    await ownerPage.locator('.expert-referral-card').filter({ hasText: 'SYNTHETIC TEST CONFIRMED' }).waitFor()
    const lockResponse = expertPage.waitForResponse(response => response.url().endsWith('/api/platform/expert-session') && response.request().method() === 'DELETE')
    await expertPage.getByRole('button', { name: 'ล็อกคลังภาพ', exact: true }).click()
    assert.equal((await lockResponse).status(), 200)
    await expertPage.getByRole('heading', { name: 'ยืนยันตัวตนผู้เชี่ยวชาญ', exact: true }).waitFor()
    assert.equal(await expertPage.getByRole('img', { name: 'ภาพต้นฉบับและกรอบสำหรับตรวจทาน', exact: true }).count(), 0)
    assert.equal((await expert.context.request.get(`${baseURL}/api/platform/analyses/${analysis.id}/image`)).status(), 403)
    assert.deepEqual(owner.errors, []); assert.deepEqual(expert.errors, []); assert.deepEqual(other.errors, [])
  } finally { await owner.context.close(); await expert.context.close(); await other.context.close() }
})

test('account settings verify the current password, rotate sessions and preserve the same owner at phone width', { timeout: 90_000 }, async () => {
  const owner = await contextForTest(), otherDevice = await contextForTest()
  try {
    const username = `account_owner_${Date.now()}`
    const registered = await post(owner.context, '/register', { username, password: testPassword })
    assert.equal(registered.status(), 201)
    const original = await session(owner.context)
    const secondLogin = await post(otherDevice.context, '/login', { username, password: testPassword })
    assert.equal(secondLogin.status(), 200)
    const page = await owner.context.newPage()
    await page.setViewportSize({ width: 375, height: 1000 })
    await page.goto(`${baseURL}/#settings`, { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: 'เปลี่ยนชื่อบัญชีและรหัสผ่าน', exact: true }).waitFor()
    const newUsername = `${username}_new`, newPassword = 'Changed-synthetic-account-2026!'
    await page.getByLabel('ชื่อบัญชีที่ต้องการใช้', { exact: true }).fill(newUsername)
    await page.getByLabel('รหัสผ่านปัจจุบัน', { exact: true }).fill('incorrect-SYNTHETIC-password')
    await page.getByLabel('รหัสผ่านใหม่ (เว้นว่างหากไม่เปลี่ยน)', { exact: true }).fill(newPassword)
    await page.getByLabel('ยืนยันรหัสผ่านใหม่', { exact: true }).fill(newPassword)
    const rejected = page.waitForResponse(response => response.url().endsWith('/api/platform/account') && response.request().method() === 'PATCH')
    await page.getByRole('button', { name: 'บันทึกบัญชีของฉัน', exact: true }).click()
    assert.equal((await rejected).status(), 403)
    assert.equal((await session(owner.context)).user.username, username, 'Wrong current password cannot change the account or log out its owner')
    assert.equal((await session(otherDevice.context)).user.id, original.user.id)

    await page.getByLabel('รหัสผ่านปัจจุบัน', { exact: true }).fill(testPassword)
    const accepted = page.waitForResponse(response => response.url().endsWith('/api/platform/account') && response.request().method() === 'PATCH')
    await page.getByRole('button', { name: 'บันทึกบัญชีของฉัน', exact: true }).click()
    assert.equal((await accepted).status(), 200)
    await page.getByText('บันทึกบัญชีแล้ว เซสชันเดิมถูกยกเลิก กรุณาใช้ชื่อบัญชีและรหัสผ่านล่าสุดในอุปกรณ์อื่น', { exact: true }).waitFor()
    assert.equal(await page.getByLabel('รหัสผ่านปัจจุบัน', { exact: true }).inputValue(), '')
    assert.equal(await page.getByLabel('รหัสผ่านใหม่ (เว้นว่างหากไม่เปลี่ยน)', { exact: true }).inputValue(), '')
    assert.equal(await page.getByLabel('ยืนยันรหัสผ่านใหม่', { exact: true }).inputValue(), '')
    const updated = await session(owner.context)
    assert.equal(updated.user.id, original.user.id, 'The account must retain ownership of its existing results')
    assert.equal(updated.user.username, newUsername)
    assert.equal(updated.user.role, 'lab')
    assert.equal(updated.expert_verified_until, null)
    assert.equal((await session(otherDevice.context)).user, null, 'Changing credentials revokes the other device session')
    assert.equal((await otherDevice.context.request.get(`${baseURL}/api/platform/analyses?scope=mine`)).status(), 401)
    assert.equal((await post(otherDevice.context, '/login', { username: newUsername, password: testPassword })).status(), 401, 'The old password must stop working')
    assert.equal((await post(otherDevice.context, '/login', { username: newUsername, password: newPassword })).status(), 200)
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Account forms must fit a 375px phone')
    assert.deepEqual(owner.errors, []); assert.deepEqual(otherDevice.errors, [])
  } finally { await owner.context.close(); await otherDevice.context.close() }
})

test('account forms accept one-character and long usernames with four-character passwords without composition rules', { timeout: 90_000 }, async () => {
  const owner = await contextForTest(), otherDevice = await contextForTest()
  try {
    const page = await owner.context.newPage()
    await page.setViewportSize({ width: 375, height: 1000 })
    await page.goto(`${baseURL}/#settings`, { waitUntil: 'networkidle' })
    await page.getByRole('tab', { name: 'สมัครสมาชิก', exact: true }).click()
    const usernameInput = page.getByLabel('ชื่อบัญชี', { exact: true })
    const passwordInput = page.getByLabel('รหัสผ่าน', { exact: true })
    const confirmation = page.getByLabel('ยืนยันรหัสผ่าน', { exact: true })
    assert.equal(await usernameInput.getAttribute('minlength'), null)
    assert.equal(await usernameInput.getAttribute('maxlength'), null)
    await passwordInput.fill('abcd'); await confirmation.fill('abcd')
    assert.equal(await passwordInput.evaluate(input => input.checkValidity()), true, 'Letters-only passwords of length4 must be allowed')

    // Names are deliberately short; a successful account edit below releases
    // the name for reruns on the same isolated fixture. A conflict is not a
    // validation failure and can be retried with another synthetic character.
    let shortUsername, created
    for (const candidate of ['q', 'w', 'e', 'r', 't', 'y']) {
      await usernameInput.fill(candidate)
      assert.equal(await usernameInput.evaluate(input => input.checkValidity()), true)
      const pending = page.waitForResponse(response => response.url().endsWith('/api/platform/register') && response.request().method() === 'POST')
      await page.getByRole('button', { name: 'สร้างบัญชีและเข้าใช้งาน', exact: true }).click()
      const response = await pending
      assert.ok([201, 409].includes(response.status()), `Short-name registration returned ${response.status()}: ${await response.text()}`)
      if (response.status() === 201) { shortUsername = candidate; created = await response.json(); break }
    }
    assert.ok(shortUsername && created, 'A synthetic one-character name must be registered')
    assert.equal(created.user.username, shortUsername)
    assert.equal(created.user.role, 'lab', 'Relaxed credential lengths must not change role approval')
    await page.getByRole('button', { name: 'ออกจากระบบ', exact: true }).waitFor()
    const original = await session(owner.context)
    assert.equal((await post(otherDevice.context, '/login', { username: shortUsername, password: 'abcd' })).status(), 200)

    const longUsername = `credential_${Date.now()}_${'x'.repeat(100)}`
    const editedName = page.getByLabel('ชื่อบัญชีที่ต้องการใช้', { exact: true })
    await editedName.fill(longUsername)
    assert.equal(await editedName.inputValue(), longUsername)
    assert.equal(await editedName.evaluate(input => input.checkValidity()), true, 'Names longer than64 characters must remain valid')
    assert.equal(await editedName.getAttribute('minlength'), null)
    assert.equal(await editedName.getAttribute('maxlength'), null)
    await page.getByLabel('รหัสผ่านปัจจุบัน', { exact: true }).fill('abcd')
    const newPassword = page.getByLabel('รหัสผ่านใหม่ (เว้นว่างหากไม่เปลี่ยน)', { exact: true })
    await newPassword.fill('1234')
    await page.getByLabel('ยืนยันรหัสผ่านใหม่', { exact: true }).fill('1234')
    assert.equal(await newPassword.evaluate(input => input.checkValidity()), true, 'Numbers-only passwords of length4 must be allowed')
    const changed = page.waitForResponse(response => response.url().endsWith('/api/platform/account') && response.request().method() === 'PATCH')
    await page.getByRole('button', { name: 'บันทึกบัญชีของฉัน', exact: true }).click()
    assert.equal((await changed).status(), 200)
    await page.getByText('บันทึกบัญชีแล้ว เซสชันเดิมถูกยกเลิก กรุณาใช้ชื่อบัญชีและรหัสผ่านล่าสุดในอุปกรณ์อื่น', { exact: true }).waitFor()
    const updated = await session(owner.context)
    assert.equal(updated.user.id, original.user.id)
    assert.equal(updated.user.username, longUsername)
    assert.equal(updated.user.role, 'lab')
    assert.equal((await session(otherDevice.context)).user, null, 'Credential changes still revoke other sessions')
    assert.equal(await page.getByRole('heading', { name: 'สถานะระบบที่ตรวจได้', exact: true }).count(), 0)
    assert.doesNotMatch(await page.locator('body').innerText(), /บัญชีใหม่เป็นผู้ใช้ทั่วไป สิทธิ์ผู้เชี่ยวชาญต้องได้รับอนุมัติจากผู้ดูแล/)
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Long usernames must not overflow a375px account screen')
    await page.getByRole('button', { name: 'ออกจากระบบ', exact: true }).click()
    await page.getByLabel('ชื่อบัญชี', { exact: true }).fill(longUsername)
    await page.getByLabel('รหัสผ่าน', { exact: true }).fill('1234')
    const loggedIn = page.waitForResponse(response => response.url().endsWith('/api/platform/login') && response.request().method() === 'POST')
    await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click()
    assert.equal((await loggedIn).status(), 200)
    await page.getByRole('button', { name: 'ออกจากระบบ', exact: true }).waitFor()
    assert.equal((await session(owner.context)).user.id, original.user.id)
    assert.deepEqual(owner.errors, []); assert.deepEqual(otherDevice.errors, [])
  } finally { await owner.context.close(); await otherDevice.context.close() }
})
