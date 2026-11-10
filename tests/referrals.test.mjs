import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { existsSync } from 'node:fs'
import { chromium } from 'playwright'
import { navigate as nav } from './helpers/navigation.mjs'

// Mutations are allowed only on the explicit localhost synthetic fixture.
const baseURL = process.env.HELPMINTHS_REFERRAL_TEST_URL || 'http://127.0.0.1:5197'
const testPassword = 'Synthetic-referral-only-2026!'
const staffPassword = 'Synthetic-UI-test-only-2026!'
let browser
let approvalStorageState

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

async function contextForTest(storageState) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block', reducedMotion: 'reduce', storageState })
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
async function post(context, path, data, method = 'post') {
  await fixture(context.request)
  const identity = await session(context)
  let response = await context.request[method](`${baseURL}/api/platform${path}`, { data, headers: { 'X-CSRF-Token': identity.csrf_token || '' } })
  assert.equal(response.headers()['x-helpminths-test-fixture'], 'synthetic-only')
  // The real login limiter is shared by all browser suites on localhost.
  // Setup calls honor its cooldown rather than changing production limits.
  if (response.status() === 429) {
    const retrySeconds = Number(response.headers()['retry-after'])
    assert.ok(Number.isFinite(retrySeconds) && retrySeconds > 0 && retrySeconds <= 60)
    await new Promise(resolve => setTimeout(resolve, retrySeconds * 1000 + 100))
    await fixture(context.request)
    response = await context.request[method](`${baseURL}/api/platform${path}`, { data, headers: { 'X-CSRF-Token': identity.csrf_token || '' } })
    assert.equal(response.headers()['x-helpminths-test-fixture'], 'synthetic-only')
  }
  return response
}
async function ownerContextForTest() {
  if (!approvalStorageState) {
    const admin = await contextForTest()
    try {
      assert.equal((await post(admin.context, '/login', { username: 'fixture-admin', password: staffPassword })).status(), 200)
      approvalStorageState = await admin.context.storageState()
    } finally { await admin.context.close() }
  }
  return contextForTest(approvalStorageState)
}
async function approveUser(user, role = 'lab') {
  const admin = await ownerContextForTest()
  try {
    const approved = await post(admin.context, `/users/${user.id}`, { approval_status: 'approved', role }, 'patch')
    assert.equal(approved.status(), 200, await approved.text())
    return approved.json()
  } finally { await admin.context.close() }
}
async function fillProfile(page) {
  await page.getByLabel('ชื่อ-นามสกุล', { exact: true }).fill('ผู้ทดสอบ ระบบ')
  await page.getByLabel('สถานที่ทำงาน', { exact: true }).fill('ห้องปฏิบัติการทดสอบ')
  await page.getByLabel('สังกัด', { exact: true }).fill('หน่วยงานทดสอบ')
  await page.getByLabel('เบอร์โทร 10 หลัก', { exact: true }).fill('0812345678')
}
async function registerApproved(context, username, password = testPassword) {
  const registered = await post(context, '/register', { username, password, account_type: 'user', full_name: 'ผู้ทดสอบ ระบบ', workplace: 'ห้องปฏิบัติการทดสอบ', affiliation: 'หน่วยงานทดสอบ', phone: '0812345678' })
  assert.equal(registered.status(), 201, await registered.text())
  const body = await registered.json()
  assert.equal(body.user.approval_status, 'pending')
  assert.equal((await session(context)).user, null, 'Public registration cannot create a signed-in session')
  await approveUser(body.user)
  assert.equal((await post(context, '/login', { username, password })).status(), 200)
  return body
}

async function passwordVisibility(page, label, toggleLabel, value, scope = page) {
  const input = scope.getByLabel(label, { exact: true })
  await input.fill(value)
  assert.equal(await input.getAttribute('type'), 'password', `${label} starts hidden`)
  await input.evaluate(element => {
    const form = element.closest('form')
    window.passwordToggleSubmissions = 0
    if (form) form.addEventListener('submit', () => { window.passwordToggleSubmissions += 1 }, { capture: true, once: true })
  })
  const writes = []
  const observe = request => {
    if (new URL(request.url()).pathname.startsWith('/api/platform/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(request.url())
  }
  page.on('request', observe)
  try {
    const controls = input.locator('..')
    const show = controls.getByRole('button', { name: `แสดง${toggleLabel}`, exact: true })
    assert.equal(await show.getAttribute('type'), 'button')
    assert.equal(await show.getAttribute('aria-controls'), await input.getAttribute('id'))
    assert.equal(await show.getAttribute('aria-pressed'), 'false')
    await show.click()
    assert.equal(await input.getAttribute('type'), 'text')
    assert.equal(await input.inputValue(), value)
    const hide = controls.getByRole('button', { name: `ซ่อน${toggleLabel}`, exact: true })
    assert.equal(await hide.getAttribute('aria-pressed'), 'true')
    await hide.click()
    assert.equal(await input.getAttribute('type'), 'password')
    assert.equal(await input.inputValue(), value, 'Visibility changes preserve the entered password')
    assert.equal(await page.evaluate(() => window.passwordToggleSubmissions), 0, 'Visibility controls cannot submit the surrounding form')
    assert.deepEqual(writes, [], 'Visibility controls cannot issue account mutations')
  } finally { page.off('request', observe) }
}

test('public expert approval, private request-more images and full confirmation complete the owner referral', { timeout: 240_000 }, async () => {
  const owner = await contextForTest(), expert = await contextForTest(), other = await contextForTest(), admin = await contextForTest()
  try {
    const ownerName = `referral_owner_${Date.now()}`, expertName = `referral_expert_${Date.now()}`
    const ownerPage = await owner.context.newPage(), expertPage = await expert.context.newPage(), adminPage = await admin.context.newPage()
    await ownerPage.goto(`${baseURL}/#settings`, { waitUntil: 'networkidle' })
    await ownerPage.getByRole('tab', { name: 'สมัครสมาชิก', exact: true }).click()
    await ownerPage.getByLabel('ชื่อบัญชี', { exact: true }).fill(ownerName)
    await passwordVisibility(ownerPage, 'รหัสผ่าน', 'รหัสผ่าน', testPassword)
    await passwordVisibility(ownerPage, 'ยืนยันรหัสผ่าน', 'รหัสผ่านยืนยัน', testPassword)
    await fillProfile(ownerPage)
    const ownerSignup = ownerPage.waitForResponse(response => response.url().endsWith('/api/platform/register') && response.request().method() === 'POST')
    await ownerPage.getByRole('button', { name: 'สมัครและส่งคำขออนุมัติ', exact: true }).click()
    const ownerRegistered = await ownerSignup
    assert.equal(ownerRegistered.status(), 201, await ownerRegistered.text())
    const pendingOwner = await ownerRegistered.json()
    assert.equal(pendingOwner.user.approval_status, 'pending')
    assert.equal(ownerRegistered.headers()['set-cookie'], undefined)
    await ownerPage.getByRole('heading', { name: 'สมัครสมาชิกแล้ว รอการอนุมัติ', exact: true }).waitFor()
    assert.equal((await session(owner.context)).user, null, 'Registration must not log in an unapproved user')
    await ownerPage.getByRole('tab', { name: 'เข้าสู่ระบบ', exact: true }).click()
    await ownerPage.getByLabel('ชื่อบัญชี', { exact: true }).fill(ownerName)
    await ownerPage.getByLabel('รหัสผ่าน', { exact: true }).fill(testPassword)
    const pendingLogin = ownerPage.waitForResponse(response => response.url().endsWith('/api/platform/login') && response.request().method() === 'POST')
    await ownerPage.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click()
    assert.equal((await pendingLogin).status(), 403)
    assert.equal(await ownerPage.getByRole('button', { name: 'ออกจากระบบ', exact: true }).count(), 0)

    await expertPage.goto(`${baseURL}/#settings`, { waitUntil: 'networkidle' })
    await expertPage.getByRole('tab', { name: /^ผู้เชี่ยวชาญ/ }).click()
    await expertPage.getByRole('tab', { name: 'สมัครเป็นผู้เชี่ยวชาญ', exact: true }).click()
    await expertPage.getByLabel('ชื่อบัญชี', { exact: true }).fill(expertName)
    await passwordVisibility(expertPage, 'รหัสผ่าน', 'รหัสผ่าน', testPassword)
    await passwordVisibility(expertPage, 'ยืนยันรหัสผ่าน', 'รหัสผ่านยืนยัน', testPassword)
    await fillProfile(expertPage)
    const expertSignup = expertPage.waitForResponse(response => response.url().endsWith('/api/platform/register') && response.request().method() === 'POST')
    await expertPage.getByRole('button', { name: 'ส่งคำขอเป็นผู้เชี่ยวชาญ', exact: true }).click()
    const expertRegistered = await expertSignup
    assert.equal(expertRegistered.status(), 201, await expertRegistered.text())
    const pendingExpert = await expertRegistered.json()
    assert.equal(pendingExpert.user.role, 'lab')
    assert.equal(pendingExpert.user.requested_role, 'reviewer')
    assert.equal(pendingExpert.user.approval_status, 'pending')
    assert.equal((await session(expert.context)).user, null)
    assert.equal((await post(expert.context, '/expert-signin', { username: expertName, password: testPassword })).status(), 403)
    await expertPage.getByRole('heading', { name: 'สมัครสมาชิกแล้ว รอการอนุมัติ', exact: true }).waitFor()

    await adminPage.goto(`${baseURL}/admin/`, { waitUntil: 'networkidle' })
    await adminPage.getByLabel('ชื่อบัญชี', { exact: true }).fill('fixture-admin')
    await adminPage.getByLabel('รหัสผ่าน', { exact: true }).fill(staffPassword)
    await adminPage.getByRole('button', { name: 'เข้าสู่หลังบ้าน', exact: true }).click()
    await adminPage.getByRole('heading', { name: 'อนุมัติคำขอและจัดการสมาชิก', exact: true }).waitFor()
    approvalStorageState = await admin.context.storageState()
    for (const [username, role] of [[ownerName, 'lab'], [expertName, 'reviewer']]) {
      await adminPage.getByLabel(`สิทธิ์ที่จะอนุมัติของ ${username}`).selectOption(role)
      const approved = adminPage.waitForResponse(response => response.url().endsWith(`/users/${username === ownerName ? pendingOwner.user.id : pendingExpert.user.id}`) && response.request().method() === 'PATCH')
      await adminPage.getByRole('button', { name: `อนุมัติบัญชี ${username}`, exact: true }).click()
      await adminPage.getByRole('alertdialog').getByRole('button', { name: 'ยืนยัน', exact: true }).click()
      assert.equal((await approved).status(), 200)
    }
    await ownerPage.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click()
    await ownerPage.getByRole('button', { name: 'ออกจากระบบ', exact: true }).waitFor()
    const ownerSession = await session(owner.context)
    assert.equal(ownerSession.user.role, 'lab')
    assert.equal(ownerSession.user.approval_status, 'approved')

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
    const ownerReferral = (await (await owner.context.request.get(`${baseURL}/api/platform/analyses/${analysis.id}/referral`)).json()).referral
    assert.equal(ownerReferral.status, 'pending')
    assert.equal(await ownerPage.getByRole('button', { name: 'ยืนยันผลและปิดรายการ', exact: true }).count(), 0)
    const allPending = await (await owner.context.request.get(`${baseURL}/api/platform/analyses?scope=mine&referral_state=all&analysis_id=${analysis.id}`)).json()
    assert.equal(allPending.total, 1, 'All history must retain a pending original record')
    const completedPending = await (await owner.context.request.get(`${baseURL}/api/platform/analyses?scope=mine&referral_state=not_pending&analysis_id=${analysis.id}`)).json()
    assert.equal(completedPending.total, 0)

    await registerApproved(other.context, `referral_other_${Date.now()}`)
    assert.equal((await (await other.context.request.get(`${baseURL}/api/platform/referrals?scope=mine`)).json()).total, 0)
    assert.equal((await other.context.request.get(`${baseURL}/api/platform/analyses/${analysis.id}/image`)).status(), 403)
    assert.equal((await other.context.request.get(`${baseURL}/api/platform/referrals/${ownerReferral.id}`)).status(), 403)
    assert.equal((await post(other.context, `/referrals/${ownerReferral.id}/response`, { action: 'request_more', comment: 'SYNTHETIC forbidden outsider', expected_revision: ownerReferral.revision })).status(), 403)
    assert.equal((await post(other.context, '/expert-signin', { username: ownerSession.user.username, password: testPassword })).status(), 403)

    await expertPage.getByRole('tab', { name: 'เข้าสู่ระบบผู้เชี่ยวชาญ', exact: true }).click()
    await expertPage.getByLabel('ชื่อบัญชี', { exact: true }).fill(expertName)
    await passwordVisibility(expertPage, 'รหัสผ่าน', 'รหัสผ่าน', 'wrong-password-SYNTHETIC')
    await expertPage.getByRole('button', { name: 'เข้าสู่ระบบผู้เชี่ยวชาญ', exact: true }).click()
    await expertPage.locator('.platform-error').waitFor()
    assert.equal((await session(expert.context)).user, null, 'Wrong credentials cannot open an expert session')
    await expertPage.getByLabel('รหัสผ่าน', { exact: true }).fill(testPassword)
    const signedIn = expertPage.waitForResponse(response => response.url().endsWith('/api/platform/expert-signin') && response.request().method() === 'POST')
    await expertPage.getByRole('button', { name: 'เข้าสู่ระบบผู้เชี่ยวชาญ', exact: true }).click()
    const expertLogin = await signedIn
    assert.equal(expertLogin.status(), 200, await expertLogin.text())
    const expertIdentity = await session(expert.context)
    assert.equal(expertIdentity.user.username, expertName)
    assert.equal(expertIdentity.user.role, 'reviewer')
    assert.ok(Date.parse(expertIdentity.expert_verified_until) > Date.now())
    assert.equal(await expertPage.getByLabel('คลังภาพ', { exact: true }).count(), 0)
    assert.equal(await expertPage.locator('.expert-referral-reply').count(), 0)
    await expertPage.locator('.expert-referral-card').filter({ hasText: analysis.sample_code }).getByRole('button', { name: 'เปิดภาพและตรวจทาน', exact: true }).click()
    assert.equal(await expertPage.getByRole('button', { name: 'ยืนยันผลและปิดรายการ', exact: true }).isDisabled(), true)
    assert.match(await expertPage.locator('#review-decision-missing').innerText(), /เหลือ 2 วัตถุที่ยังไม่ตรวจ/)
    assert.equal(await expertPage.getByLabel('สถานะการทบทวน', { exact: true }).count(), 0)
    assert.equal(await expertPage.getByRole('group', { name: 'ผลตรวจวัตถุที่เลือก' }).getByRole('button').count(), 4)
    assert.equal(await expertPage.getByLabel('การดำเนินการ', { exact: true }).count(), 0)
    assert.equal(await expertPage.getByLabel('ชนิดที่ตรวจทาน', { exact: true }).count(), 0)
    await expertPage.getByRole('button', { name: 'แก้ชนิด', exact: true }).click()
    await expertPage.getByLabel('ชนิดที่ตรวจทาน', { exact: true }).waitFor()
    assert.equal(await expertPage.getByLabel('x1', { exact: true }).isVisible(), false)
    await expertPage.getByRole('button', { name: 'ไม่แน่ใจ', exact: true }).click()
    assert.match(await expertPage.locator('#review-decision-missing').innerText(), /มี 1 วัตถุที่ยังไม่แน่ใจ/)
    await expertPage.getByRole('button', { name: 'ถูกต้อง', exact: true }).click()
    assert.equal(await expertPage.locator('.diagnosis-comparison').count(), 0)
    assert.equal(await expertPage.locator('.expert-technical-history').count(), 0)
    assert.equal(await expertPage.getByRole('button', { name: 'รีเฟรชรายการ', exact: true }).count(), 0)
    assert.equal(await expertPage.getByRole('button', { name: 'นำออกจากประวัติ', exact: true }).count(), 0)
    assert.equal(await expertPage.getByRole('button', { name: 'ล็อกคลังภาพ', exact: true }).count(), 1)
    const savedDraftMessage = 'SYNTHETIC saved draft to resume, not a final confirmation.'
    await expertPage.getByLabel('ข้อความถึงผู้ส่ง', { exact: true }).fill(savedDraftMessage)
    await expertPage.getByRole('checkbox', { name: 'ตรวจภาพทั้งภาพแล้ว', exact: true }).check()
    const draftSaved = expertPage.waitForResponse(response => response.url().endsWith(`/analyses/${analysis.id}/reviews`) && response.request().method() === 'POST')
    await expertPage.getByRole('button', { name: 'บันทึกร่าง', exact: true }).click()
    const savedDraft = await draftSaved
    assert.equal(savedDraft.status(), 201, await savedDraft.text())
    assert.equal((await savedDraft.json()).latest_review.status, 'in_review')
    await expertPage.getByText('บันทึกร่างแล้ว', { exact: true }).waitFor()
    await expertPage.locator('.expert-referral-card').filter({ hasText: analysis.sample_code }).getByRole('button', { name: 'เปิดภาพและตรวจทาน', exact: true }).click()
    assert.equal(await expertPage.getByLabel('ข้อความถึงผู้ส่ง', { exact: true }).inputValue(), savedDraftMessage, 'Saved drafts restore the message as well as object decisions')
    assert.equal(await expertPage.getByRole('checkbox', { name: 'ตรวจภาพทั้งภาพแล้ว', exact: true }).isChecked(), true)
    assert.equal(await expertPage.getByRole('button', { name: 'ถูกต้อง', exact: true }).getAttribute('aria-pressed'), 'true')
    assert.equal(await expertPage.getByRole('button', { name: 'ยืนยันผลและปิดรายการ', exact: true }).isDisabled(), true, 'A saved partial draft cannot become final')
    await expertPage.getByRole('checkbox', { name: 'ตรวจภาพทั้งภาพแล้ว', exact: true }).uncheck()
    const requestMore = 'SYNTHETIC REQUEST MORE: please send a second chart image with a wider field.'
    await expertPage.getByLabel('ข้อความถึงผู้ส่ง', { exact: true }).fill(requestMore)
    const asked = expertPage.waitForResponse(response => response.url().endsWith(`/analyses/${analysis.id}/reviews`) && response.request().method() === 'POST')
    await expertPage.getByRole('button', { name: 'ขอภาพเพิ่มเติม', exact: true }).click()
    assert.equal((await asked).status(), 201)
    const needsMore = (await (await owner.context.request.get(`${baseURL}/api/platform/analyses/${analysis.id}/referral`)).json()).referral
    assert.equal(needsMore.status, 'needs_more')
    assert.equal(needsMore.response_comment, requestMore)
    assert.ok(needsMore.latest_review_id)
    assert.equal(needsMore.latest_review.status, 'needs_additional_review', 'Requesting an image records an incomplete review, never a final confirmation')

    await ownerPage.getByRole('button', { name: 'รีเฟรชสถานะภาพส่งต่อ', exact: true }).click()
    await ownerPage.getByRole('region', { name: 'ข้อความตอบกลับระหว่างตรวจ', exact: true }).filter({ hasText: requestMore }).waitFor()
    await ownerPage.getByLabel('ภาพเพิ่มเติม', { exact: true }).setInputFiles({ name: 'SYNTHETIC_additional_chart.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
    await ownerPage.getByLabel('ข้อความประกอบภาพ (ไม่บังคับ)', { exact: true }).fill('SYNTHETIC owner attachment: a second generated chart, not a clinical image.')
    const attachmentSaved = ownerPage.waitForResponse(response => response.url().includes(`/referrals/${ownerReferral.id}/`) && response.request().method() === 'POST')
    await ownerPage.getByRole('button', { name: 'ส่งภาพเพิ่มเติม', exact: true }).click()
    const uploaded = await attachmentSaved
    assert.equal(uploaded.status(), 201, await uploaded.text())
    await ownerPage.getByText('ส่งภาพเพิ่มเติมแล้ว รายการกลับเข้าคิวรอตรวจ', { exact: true }).waitFor()
    const requeued = (await (await owner.context.request.get(`${baseURL}/api/platform/analyses/${analysis.id}/referral`)).json()).referral
    assert.equal(requeued.status, 'pending')
    const attachments = await (await owner.context.request.get(`${baseURL}/api/platform/referrals/${ownerReferral.id}/attachments`)).json()
    assert.equal(attachments.total, 1)
    const attachmentURL = attachments.items[0].image_url
    assert.ok(attachmentURL.startsWith('/api/platform/referrals/'), 'Additional images use a private authenticated resource')
    const attachmentResponse = await owner.context.request.get(`${baseURL}${attachmentURL}`)
    assert.equal(attachmentResponse.status(), 200)
    assert.match(attachmentResponse.headers()['cache-control'], /no-store/)
    assert.equal((await other.context.request.get(`${baseURL}${attachmentURL}`)).status(), 403, 'Another owner cannot read a requested image')

    await expertPage.getByText('ส่งคำขอภาพเพิ่มเติมแล้ว', { exact: true }).waitFor()
    await expertPage.getByRole('tab', { name: 'รอตรวจ', exact: true }).click()
    await expertPage.getByRole('button', { name: 'รีเฟรช', exact: true }).click()
    assert.equal(await expertPage.getByLabel('คลังภาพ', { exact: true }).count(), 0)
    assert.equal(await expertPage.locator('.expert-referral-reply').count(), 0)
    await expertPage.locator('.expert-referral-card').filter({ hasText: analysis.sample_code }).getByRole('button', { name: 'เปิดภาพและตรวจทาน', exact: true }).click()
    assert.equal(await expertPage.getByLabel('ข้อความถึงผู้ส่ง', { exact: true }).inputValue(), '', 'An earlier image request must not be reused as a final answer')
    await expertPage.locator('.referral-history > summary').click()
    await expertPage.locator('.referral-attachments img').waitFor()
    assert.equal((await expert.context.request.get(`${baseURL}${attachmentURL}`)).status(), 200, 'The approved expert can inspect the additional private image')
    await expertPage.getByRole('button', { name: 'ยืนยันกรอบที่ยังไม่ทบทวนทั้งหมด', exact: true }).click()
    const finalReply = 'SYNTHETIC TEST CONFIRMED: original and additional chart regions reviewed for workflow only.'
    await expertPage.getByLabel('ข้อความถึงผู้ส่ง', { exact: true }).fill(finalReply)
    await expertPage.getByRole('checkbox', { name: /ตรวจภาพทั้งภาพแล้ว/ }).check()
    const confirmedResponse = expertPage.waitForResponse(response => response.url().endsWith(`/analyses/${analysis.id}/reviews`) && response.request().method() === 'POST')
    await expertPage.getByRole('button', { name: 'ยืนยันผลและปิดรายการ', exact: true }).click()
    const finalResponse = await confirmedResponse
    assert.equal(finalResponse.status(), 201, await finalResponse.text())
    await expertPage.getByText('ยืนยันผลและปิดรายการแล้ว', { exact: true }).waitFor()
    const confirmed = (await (await owner.context.request.get(`${baseURL}/api/platform/analyses/${analysis.id}/referral`)).json()).referral
    assert.equal(confirmed.status, 'confirmed')
    assert.equal(confirmed.reviewer_username, expertName)
    assert.equal(confirmed.response_comment, finalReply)
    const updated = await (await owner.context.request.get(`${baseURL}/api/platform/analyses/${analysis.id}`)).json()
    assert.deepEqual(updated.detections, analysis.detections, 'Expert confirmation preserves original AI predictions')
    const confirmedHistory = await (await owner.context.request.get(`${baseURL}/api/platform/analyses?scope=mine&referral_state=all&analysis_id=${analysis.id}`)).json()
    assert.equal(confirmedHistory.total, 1, 'The same original record remains in all history')
    assert.equal(confirmedHistory.items[0].created_at, analysis.created_at, 'Replies and attachments preserve the original examination day')
    await expertPage.getByRole('tab', { name: 'เสร็จสิ้น', exact: true }).click()
    const completedCard = expertPage.locator('.expert-referral-card').filter({ hasText: analysis.sample_code })
    await completedCard.getByRole('button', { name: 'เปิดภาพและตรวจทาน', exact: true }).click()
    assert.equal(await expertPage.getByLabel('ข้อความถึงผู้ส่ง', { exact: true }).count(), 0, 'Closed cases are read-only')
    await expertPage.getByRole('region', { name: 'คำอธิบายผลยืนยันจากผู้เชี่ยวชาญ', exact: true }).waitFor()
    assert.equal(await expertPage.locator('.review-download-menu').count(), 1)
    await expertPage.getByRole('button', { name: 'กลับคลังภาพส่งต่อ', exact: true }).click()
    await expertPage.getByRole('tab', { name: 'รอตรวจ', exact: true }).click()
    await expertPage.locator('.expert-referral-card').filter({ hasText: analysis.sample_code }).waitFor({ state: 'detached' })
    await expertPage.locator('.platform-loading').waitFor({ state: 'hidden' })
    assert.equal(await expertPage.locator('.expert-referral-card').filter({ hasText: analysis.sample_code }).count(), 0)
    await nav(ownerPage, 'ประวัติการตรวจ')
    const historyCard = ownerPage.locator('.history-page .platform-record').filter({ hasText: analysis.sample_code })
    await historyCard.filter({ hasText: finalReply }).waitFor()
    const originalDay = new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'long' }).format(new Date(analysis.created_at))
    await ownerPage.locator('.history-day-group').getByRole('heading', { name: originalDay, exact: true }).waitFor()
    assert.equal(await ownerPage.getByRole('tab', { name: 'ทั้งหมด', exact: true }).getAttribute('aria-selected'), 'true')
    await ownerPage.getByRole('tab', { name: 'เสร็จสิ้น', exact: true }).click()
    await historyCard.waitFor()
    const lockResponse = expertPage.waitForResponse(response => response.url().endsWith('/api/platform/expert-session') && response.request().method() === 'DELETE')
    await expertPage.getByRole('button', { name: 'ล็อกคลังภาพ', exact: true }).click()
    assert.equal((await lockResponse).status(), 200)
    await expertPage.getByRole('heading', { name: 'ยืนยันตัวตนผู้เชี่ยวชาญ', exact: true }).waitFor()
    assert.equal((await expert.context.request.get(`${baseURL}/api/platform/analyses/${analysis.id}/image`)).status(), 403)
    assert.equal((await expert.context.request.get(`${baseURL}${attachmentURL}`)).status(), 403)
    await historyCard.getByRole('button', { name: 'นำออกจากประวัติ', exact: true }).click()
    const deletion = ownerPage.waitForResponse(response => response.url().includes(`/analyses/${analysis.id}?expected_revision=`) && response.request().method() === 'DELETE')
    await ownerPage.getByRole('alertdialog').getByRole('button', { name: 'ยืนยัน', exact: true }).click()
    assert.equal((await deletion).status(), 200)
    await historyCard.waitFor({ state: 'detached' })
    assert.deepEqual(owner.errors, []); assert.deepEqual(expert.errors, []); assert.deepEqual(other.errors, []); assert.deepEqual(admin.errors, [])
  } finally { await owner.context.close(); await expert.context.close(); await other.context.close(); await admin.context.close() }
})

test('account settings verify the current password, rotate sessions and preserve the same owner at phone width', { timeout: 90_000 }, async () => {
  const owner = await contextForTest(), otherDevice = await contextForTest()
  try {
    const username = `account_owner_${Date.now()}`
    await registerApproved(owner.context, username)
    const original = await session(owner.context)
    const secondLogin = await post(otherDevice.context, '/login', { username, password: testPassword })
    assert.equal(secondLogin.status(), 200)
    const page = await owner.context.newPage()
    await page.setViewportSize({ width: 375, height: 1000 })
    await page.goto(`${baseURL}/#settings`, { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: 'ข้อมูลบัญชี', exact: true }).waitFor()
    const newUsername = `${username}_new`, newPassword = 'Changed-synthetic-account-2026!'
    await page.getByLabel('ชื่อบัญชีที่ต้องการใช้', { exact: true }).fill(newUsername)
    await passwordVisibility(page, 'รหัสผ่านปัจจุบัน', 'รหัสผ่านปัจจุบัน', 'incorrect-SYNTHETIC-password')
    await passwordVisibility(page, 'รหัสผ่านใหม่ (เว้นว่างหากไม่เปลี่ยน)', 'รหัสผ่านใหม่', newPassword)
    await passwordVisibility(page, 'ยืนยันรหัสผ่านใหม่', 'รหัสผ่านใหม่ที่ยืนยัน', newPassword)
    const rejected = page.waitForResponse(response => response.url().endsWith('/api/platform/account') && response.request().method() === 'PATCH')
    await page.getByRole('button', { name: 'บันทึกบัญชีของฉัน', exact: true }).click()
    assert.equal((await rejected).status(), 403)
    assert.equal((await session(owner.context)).user.username, username, 'Wrong current password cannot change the account or log out its owner')
    assert.equal((await session(otherDevice.context)).user.id, original.user.id)

    await page.getByLabel('รหัสผ่านปัจจุบัน', { exact: true }).fill(testPassword)
    const accepted = page.waitForResponse(response => response.url().endsWith('/api/platform/account') && response.request().method() === 'PATCH')
    await page.getByRole('button', { name: 'บันทึกบัญชีของฉัน', exact: true }).click()
    assert.equal((await accepted).status(), 200)
    await page.getByText('บันทึกข้อมูลบัญชีแล้ว', { exact: true }).waitFor()
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

    await fillProfile(page)

    // Names are deliberately short; a successful account edit below releases
    // the name for reruns on the same isolated fixture. A conflict is not a
    // validation failure and can be retried with another synthetic character.
    let shortUsername, created
    for (const candidate of ['q', 'w', 'e', 'r', 't', 'y']) {
      await usernameInput.fill(candidate)
      assert.equal(await usernameInput.evaluate(input => input.checkValidity()), true)
      const pending = page.waitForResponse(response => response.url().endsWith('/api/platform/register') && response.request().method() === 'POST')
      await page.getByRole('button', { name: 'สมัครและส่งคำขออนุมัติ', exact: true }).click()
      const response = await pending
      assert.ok([201, 409].includes(response.status()), `Short-name registration returned ${response.status()}: ${await response.text()}`)
      if (response.status() === 201) { shortUsername = candidate; created = await response.json(); break }
    }
    assert.ok(shortUsername && created, 'A synthetic one-character name must be registered')
    assert.equal(created.user.username, shortUsername)
    assert.equal(created.user.role, 'lab', 'Relaxed credential lengths must not change role approval')
    assert.equal(created.user.approval_status, 'pending')
    assert.equal((await session(owner.context)).user, null, 'A four-character password cannot bypass approval')
    await approveUser(created.user)
    await page.getByRole('tab', { name: 'เข้าสู่ระบบ', exact: true }).click()
    await page.getByLabel('ชื่อบัญชี', { exact: true }).fill(shortUsername)
    await page.getByLabel('รหัสผ่าน', { exact: true }).fill('abcd')
    const firstLogin = page.waitForResponse(response => response.url().endsWith('/api/platform/login') && response.request().method() === 'POST')
    await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click()
    assert.equal((await firstLogin).status(), 200)
    await page.getByRole('button', { name: 'ออกจากระบบ', exact: true }).waitFor()
    const original = await session(owner.context)
    assert.equal((await post(otherDevice.context, '/login', { username: shortUsername, password: 'abcd' })).status(), 200)

    const longUsername = `credential ${Date.now()} ${'x'.repeat(100)}`
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
    await page.getByText('บันทึกข้อมูลบัญชีแล้ว', { exact: true }).waitFor()
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

test('administrator account creation and password reset controls show and hide without saving changes', { timeout: 60_000 }, async () => {
  const admin = await ownerContextForTest()
  try {
    const page = await admin.context.newPage()
    await page.setViewportSize({ width: 375, height: 1000 })
    await page.goto(`${baseURL}/admin/`, { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: 'อนุมัติคำขอและจัดการสมาชิก', exact: true }).waitFor()
    await page.locator('.account-create-member summary').click()
    await passwordVisibility(page, 'รหัสผ่านใหม่ (อย่างน้อย 4 ตัว)', 'รหัสผ่านใหม่', 'unused-admin-created-password')
    await page.getByRole('button', { name: 'สมาชิกทั้งหมด', exact: true }).click()
    const account = page.locator('.platform-user-entry').filter({ has: page.getByText('fixture-lab', { exact: true }) })
    await account.waitFor()
    await passwordVisibility(page, 'เปลี่ยนรหัสผ่านของ fixture-lab', 'รหัสผ่านใหม่ของ fixture-lab', 'unused-admin-reset-password', account)
    assert.equal(await page.getByRole('alertdialog').count(), 0, 'Toggling a password must not open the account-change confirmation')
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Administrator password controls must fit a 375px phone')
    assert.deepEqual(admin.errors, [])
  } finally { await admin.context.close() }
})

test('Super admin rejects a pending expert request and rejected credentials stay signed out at phone width', { timeout: 90_000 }, async () => {
  const applicant = await contextForTest(), admin = await ownerContextForTest()
  try {
    const username = `rejected_expert_${Date.now()}`
    const registered = await post(applicant.context, '/register', { username, password: testPassword, account_type: 'expert', full_name: 'ผู้ทดสอบ ระบบ', workplace: 'ห้องปฏิบัติการทดสอบ', affiliation: 'หน่วยงานทดสอบ', phone: '0812345678' })
    assert.equal(registered.status(), 201)
    const pending = (await registered.json()).user
    assert.equal(pending.approval_status, 'pending')
    assert.equal((await session(applicant.context)).user, null)
    const page = await admin.context.newPage()
    await page.setViewportSize({ width: 375, height: 1000 })
    await page.goto(`${baseURL}/admin/`, { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: 'อนุมัติคำขอและจัดการสมาชิก', exact: true }).waitFor()
    assert.equal(await page.getByLabel(`สิทธิ์ที่จะอนุมัติของ ${username}`).inputValue(), 'reviewer')
    const rejected = page.waitForResponse(response => response.url().endsWith(`/users/${pending.id}`) && response.request().method() === 'PATCH')
    await page.getByRole('button', { name: `ไม่อนุมัติบัญชี ${username}`, exact: true }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'ยืนยัน', exact: true }).click()
    const response = await rejected
    assert.equal(response.status(), 200, await response.text())
    assert.equal((await response.json()).approval_status, 'rejected')
    await page.getByRole('button', { name: `ไม่อนุมัติบัญชี ${username}`, exact: true }).waitFor({ state: 'detached' })
    await page.getByRole('group', { name: 'กรองสมาชิก', exact: true }).getByRole('button', { name: 'ผู้เชี่ยวชาญ', exact: true }).click()
    await page.locator('.platform-user-entry').filter({ hasText: username }).filter({ hasText: 'ไม่อนุมัติ' }).waitFor()
    assert.equal((await post(applicant.context, '/expert-signin', { username, password: testPassword })).status(), 403)
    assert.equal((await post(applicant.context, '/login', { username, password: testPassword })).status(), 403)
    assert.equal((await session(applicant.context)).user, null)
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    assert.deepEqual(applicant.errors, []); assert.deepEqual(admin.errors, [])
  } finally { await applicant.context.close(); await admin.context.close() }
})

test('Scan saves a blank-code image, retries a failed expert referral, then keeps it in all history and the pending queue', { timeout: 120_000 }, async () => {
  const owner = await contextForTest()
  try {
    await registerApproved(owner.context, `scan_referral_${Date.now()}`)
    const page = await owner.context.newPage()
    await page.setViewportSize({ width: 375, height: 1000 })
    const imageWrites = []
    page.on('request', request => {
      if (request.method() === 'POST' && /\/api\/(?:analyze|platform\/analyses(?:\/[^/]+\/referrals)?)$/.test(new URL(request.url()).pathname)) imageWrites.push(request.url())
    })
    await page.goto(`${baseURL}/#scan`, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'ดูตัวอย่างสาธิต', exact: true }).click()
    await page.locator('.scan-demo-banner').waitFor()
    assert.equal(await page.getByRole('button', { name: 'ส่งภาพให้ผู้เชี่ยวชาญยืนยัน', exact: true }).count(), 0, 'A synthetic demonstration cannot be referred as a private analysis')
    assert.deepEqual(imageWrites, [], 'Opening the demonstration cannot create an analysis or referral')
    assert.equal((await (await owner.context.request.get(`${baseURL}/api/platform/analyses?scope=mine`)).json()).total, 0)
    await page.getByRole('button', { name: 'ล้างภาพในหน้านี้', exact: true }).click()

    const png = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 384
      const context = canvas.getContext('2d')
      for (let x = 0; x < 512; x += 16) for (let y = 0; y < 384; y += 16) {
        context.fillStyle = (x / 16 + y / 16) % 2 ? '#b4b4b4' : '#4b4b4b'
        context.fillRect(x, y, 16, 16)
      }
      return canvas.toDataURL('image/png').split(',')[1]
    })
    await page.getByLabel('เลือกภาพจากอุปกรณ์', { exact: true }).setInputFiles({ name: 'SYNTHETIC_blank_code_referral.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
    await page.locator('.scan-image-svg image').waitFor()
    const sampleCode = page.getByLabel('รหัสตัวอย่างนิรนาม (ไม่บังคับ)', { exact: true })
    assert.equal(await sampleCode.inputValue(), '')
    const qualityResponse = page.waitForResponse(response => response.url().endsWith('/api/platform/quality') && response.request().method() === 'POST')
    await page.getByRole('button', { name: 'ตรวจคุณภาพภาพ', exact: true }).click()
    assert.equal((await qualityResponse).status(), 200)
    await page.locator('.image-quality-summary').waitFor()
    const acknowledgement = page.getByRole('checkbox', { name: 'ฉันรับทราบข้อจำกัด และต้องการดำเนินการต่อเพื่อให้ผู้เชี่ยวชาญทบทวน', exact: true })
    if (await acknowledgement.isVisible()) {
      await acknowledgement.check()
      await page.getByLabel('เหตุผลที่ใช้ภาพนี้ต่อ', { exact: true }).fill('SYNTHETIC browser workflow only; not microscopy or diagnostic evidence.')
    }
    const analysisResponse = page.waitForResponse(response => response.url().endsWith('/api/platform/analyses') && response.request().method() === 'POST')
    await page.getByRole('button', { name: 'เริ่มวิเคราะห์ภาพ', exact: true }).click()
    const saved = await analysisResponse
    assert.equal(saved.status(), 201, await saved.text())
    const analysis = await saved.json()
    assert.equal(analysis.model_version, 'synthetic-ui-fixture-v1')
    assert.equal(analysis.sample_code, `HM-${analysis.id.slice(0, 8).toUpperCase()}`, 'A blank sample code receives the saved record identifier')
    const dailyBefore = await (await owner.context.request.get(`${baseURL}/api/platform/analyses?scope=mine&referral_state=not_pending&analysis_id=${analysis.id}`)).json()
    assert.equal(dailyBefore.total, 1)

    let attempts = 0
    await page.route(`**/api/platform/analyses/${analysis.id}/referrals`, async route => {
      if (route.request().method() === 'POST' && ++attempts === 1) {
        await route.fulfill({ status: 503, json: { detail: 'SYNTHETIC referral retry fixture' }, headers: { 'X-HelpMinths-Test-Fixture': 'synthetic-only' } })
      } else await route.fallback()
    })
    const refer = page.getByRole('button', { name: 'ส่งภาพให้ผู้เชี่ยวชาญยืนยัน', exact: true })
    const failedResponse = page.waitForResponse(response => response.url().endsWith(`/analyses/${analysis.id}/referrals`) && response.request().method() === 'POST')
    await refer.click()
    assert.equal((await failedResponse).status(), 503)
    await page.getByRole('alert').filter({ hasText: 'SYNTHETIC referral retry fixture' }).waitFor()
    assert.equal(new URL(page.url()).hash, '#scan', 'A failed referral stays on the analysis for retry')
    assert.equal(await refer.isEnabled(), true)
    assert.equal((await (await owner.context.request.get(`${baseURL}/api/platform/analyses/${analysis.id}/referral`)).json()).referral, null, 'The mocked failure must create no referral in the database')
    assert.equal((await (await owner.context.request.get(`${baseURL}/api/platform/analyses/${analysis.id}`)).json()).revision, analysis.revision)

    const referredResponse = page.waitForResponse(response => response.url().endsWith(`/analyses/${analysis.id}/referrals`) && response.request().method() === 'POST')
    const privateImage = page.waitForResponse(response => response.url().endsWith(`/analyses/${analysis.id}/image`) && response.request().method() === 'GET')
    await refer.click()
    const sent = await referredResponse
    assert.equal(sent.status(), 201, await sent.text())
    const referral = await sent.json()
    assert.equal(referral.analysis_id, analysis.id)
    assert.equal(referral.status, 'pending')
    assert.equal(attempts, 2)
    await page.waitForURL(`${baseURL}/#verification`)
    await page.getByRole('img', { name: 'ภาพและกรอบที่ AI ทำนาย', exact: true }).waitFor()
    const preview = await privateImage
    assert.equal(preview.status(), 200, 'Success loads the exact selected private image through its authenticated endpoint')
    assert.match(preview.headers()['cache-control'], /no-store/)
    const pendingHistory = await (await owner.context.request.get(`${baseURL}/api/platform/analyses?scope=mine&referral_state=not_pending&analysis_id=${analysis.id}`)).json()
    assert.equal(pendingHistory.total, 0, 'A pending referral is omitted from completed history')
    assert.equal((await (await owner.context.request.get(`${baseURL}/api/platform/history/days?referral_state=not_pending`)).json()).total_analyses, 0)
    await nav(page, 'ประวัติการตรวจ')
    await page.locator('.history-page .platform-record').filter({ hasText: analysis.sample_code }).waitFor()
    assert.equal(await page.getByRole('tab', { name: 'ทั้งหมด', exact: true }).getAttribute('aria-selected'), 'true', 'All history is the default and includes pending referrals')
    await page.getByRole('tab', { name: 'เสร็จสิ้น', exact: true }).click()
    await page.locator('.history-page .platform-record').filter({ hasText: analysis.sample_code }).waitFor({ state: 'detached' })
    await page.locator('.history-page .platform-loading').waitFor({ state: 'hidden' })
    assert.equal(await page.locator('.history-page .platform-record').count(), 0)
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'The scan-to-referral workflow must fit a 375px phone')
    assert.deepEqual(owner.errors, [])
  } finally { await owner.context.close() }
})
// Phase E regression. Uses this file's existing localhost fixture helpers only.
// Its fixed short browser expiry tests UI timeouts without changing backend's
// real 15-minute authentication rule. Actual backend expiry/ACL is covered by
// deleting the expert step-up, then attempting a real guarded review request.
test('expert drafts survive timed and server-triggered reauthentication without rebasing a stale revision', { timeout: 240_000 }, async () => {
  const owner = await contextForTest(), expert = await contextForTest()
  try {
    await registerApproved(owner.context, `expiry_owner_${Date.now()}`)
    assert.equal((await post(expert.context, '/expert-signin', { username: 'fixture-reviewer', password: staffPassword })).status(), 200)
    const page = await expert.context.newPage()
    // Only three browser minutes pass; real renewed backend expiry remains in
    // the future. A full fake 15 minutes would make valid server dates look old.
    await page.clock.install({ time: new Date() })
    const deadline = await page.evaluate(() => new Date(Date.now() + 180_000).toISOString())
    let shortenExpiry = true
    await page.route('**/api/platform/expert-session', async route => {
      if (route.request().method() !== 'GET') return route.fallback()
      const response = await route.fetch()
      const body = await response.json()
      await route.fulfill({ response, json: shortenExpiry && body.verified ? { ...body, verified_until: deadline } : body })
    })
    const png = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 384
      const ctx = canvas.getContext('2d')
      for (let x = 0; x < 512; x += 16) for (let y = 0; y < 384; y += 16) {
        ctx.fillStyle = (x / 16 + y / 16) % 2 ? '#b4b4b4' : '#4b4b4b'; ctx.fillRect(x, y, 16, 16)
      }
      return canvas.toDataURL('image/png').split(',')[1]
    })
    await fixture(owner.context.request)
    const identity = await session(owner.context)
    const created = await owner.context.request.post(`${baseURL}/api/platform/analyses`, {
      headers: { 'X-CSRF-Token': identity.csrf_token },
      multipart: { image: { name: 'SYNTHETIC_expiry.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') }, sample_code: `TEST_EXPIRY_${Date.now()}`, acknowledge_quality: 'true', quality_comment: 'SYNTHETIC expiry regression chart only.' },
    })
    assert.equal(created.status(), 201, await created.text())
    const initial = await created.json()
    assert.equal((await post(owner.context, `/analyses/${initial.id}/referrals`, { expected_revision: initial.revision, reason: 'SYNTHETIC expiry regression request.' })).status(), 201)
    const original = await (await owner.context.request.get(`${baseURL}/api/platform/analyses/${initial.id}`)).json()
    await page.goto(`${baseURL}/#verification`, { waitUntil: 'networkidle' })
    await page.locator('.expert-referral-card').filter({ hasText: original.sample_code }).getByRole('button', { name: 'เปิดภาพและตรวจทาน', exact: true }).click()
    await page.getByRole('button', { name: 'แก้ชนิด', exact: true }).click()
    await page.getByLabel('ชนิดที่ตรวจทาน', { exact: true }).fill('SYNTHETIC corrected A retained')
    await page.locator('.review-object-notes > summary').click()
    await page.getByLabel('หมายเหตุสำหรับวัตถุนี้', { exact: true }).fill('SYNTHETIC original-object note retained')
    await page.locator('.platform-object').filter({ hasText: 'TEST FIXTURE object B' }).click()
    await page.getByRole('button', { name: 'ไม่ใช่ไข่พยาธิ', exact: true }).click()
    await page.getByRole('button', { name: 'เพิ่มวัตถุที่ตกหล่น', exact: true }).click()
    const svg = page.getByRole('img', { name: 'ภาพต้นฉบับและกรอบสำหรับตรวจทาน', exact: true })
    await svg.scrollIntoViewIfNeeded()
    const bounds = await svg.boundingBox()
    assert.ok(bounds)
    await page.mouse.move(bounds.x + bounds.width * .2, bounds.y + bounds.height * .72)
    await page.mouse.down()
    await page.mouse.move(bounds.x + bounds.width * .34, bounds.y + bounds.height * .87, { steps: 4 })
    await page.mouse.up()
    await page.getByLabel('ชนิดที่ตรวจทาน', { exact: true }).fill('SYNTHETIC missed object retained')
    await page.locator('.review-object-notes > summary').click()
    await page.getByLabel('หมายเหตุสำหรับวัตถุนี้', { exact: true }).fill('SYNTHETIC missed-object note retained')
    await page.getByLabel('ข้อความถึงผู้ส่ง', { exact: true }).fill('SYNTHETIC unsaved reply retained')
    await page.getByRole('checkbox', { name: 'ตรวจภาพทั้งภาพแล้ว', exact: true }).check()
    const draftSnapshot = async () => ({
      selectedObject: await page.locator('.platform-object[aria-pressed="true"]').innerText(),
      label: await page.getByLabel('ชนิดที่ตรวจทาน', { exact: true }).inputValue(),
      objectNote: await page.getByLabel('หมายเหตุสำหรับวัตถุนี้', { exact: true }).inputValue(),
      coordinates: await page.locator('.platform-coordinate-grid input').evaluateAll(inputs => inputs.map(input => input.value)),
      reply: await page.getByLabel('ข้อความถึงผู้ส่ง', { exact: true }).inputValue(),
      fullImage: await page.getByRole('checkbox', { name: 'ตรวจภาพทั้งภาพแล้ว', exact: true }).isChecked(),
    })
    const draft = await draftSnapshot()
    assert.equal(draft.coordinates.length, 4)
    await page.clock.fastForward(61_000)
    await page.getByRole('button', { name: 'ต่ออายุการยืนยัน', exact: true }).waitFor()
    assert.equal(await page.getByRole('dialog', { name: 'ยืนยันตัวตนผู้เชี่ยวชาญ', exact: true }).count(), 0, 'Two-minute warning must not interrupt work')
    await page.clock.fastForward(120_000)
    const modal = page.getByRole('dialog', { name: 'ยืนยันตัวตนผู้เชี่ยวชาญ', exact: true })
    await modal.waitFor()
    assert.equal(await modal.getAttribute('aria-modal'), 'true')
    assert.equal(await page.locator('.expert-verification-page image[href^="blob:"],.expert-verification-page img[src^="blob:"]').count(), 0, 'Locked views revoke/remove protected image sources')
    for (const key of [...Array(10).fill('Tab'), ...Array(10).fill('Shift+Tab')]) {
      await page.keyboard.press(key)
      assert.equal(await modal.evaluate(element => element.contains(document.activeElement)), true, 'Password modal must trap focus')
    }
    await page.keyboard.press('Escape')
    assert.equal(await modal.isVisible(), true, 'An expired session cannot dismiss the password modal to expose the draft')
    await modal.getByLabel('รหัสผ่านผู้เชี่ยวชาญ', { exact: true }).fill('wrong-synthetic-password')
    const wrong = page.waitForResponse(response => response.url().endsWith('/expert-login') && response.request().method() === 'POST')
    await modal.getByRole('button', { name: 'ยืนยันและเข้าคลังภาพ', exact: true }).click()
    assert.equal((await wrong).status(), 403)
    assert.equal(await modal.isVisible(), true)
    shortenExpiry = false
    await modal.getByLabel('รหัสผ่านผู้เชี่ยวชาญ', { exact: true }).fill(staffPassword)
    const renewal = page.waitForResponse(response => response.url().endsWith('/expert-login') && response.request().method() === 'POST')
    await modal.getByRole('button', { name: 'ยืนยันและเข้าคลังภาพ', exact: true }).click()
    assert.equal((await renewal).status(), 200)
    await modal.waitFor({ state: 'hidden' })
    await svg.waitFor()
    assert.deepEqual(await draftSnapshot(), draft, 'All unsaved object, coordinate, selection and decision state survives renewal')
    await page.locator('.platform-object').filter({ hasText: 'TEST FIXTURE object A' }).click()
    assert.equal(await page.getByRole('button', { name: 'แก้ชนิด', exact: true }).getAttribute('aria-pressed'), 'true')
    assert.equal(await page.getByLabel('ชนิดที่ตรวจทาน', { exact: true }).inputValue(), 'SYNTHETIC corrected A retained')
    assert.equal(await page.getByLabel('หมายเหตุสำหรับวัตถุนี้', { exact: true }).inputValue(), 'SYNTHETIC original-object note retained')
    await page.locator('.platform-object').filter({ hasText: 'SYNTHETIC missed object retained' }).click()

    // Server revocation exercises the actual protected review endpoint, not a
    // mocked 403 or a frontend-only timeout.
    assert.equal((await post(expert.context, '/expert-session', {}, 'delete')).status(), 200)
    const rejected = page.waitForResponse(response => response.url().endsWith(`/analyses/${original.id}/reviews`) && response.request().method() === 'POST')
    await page.getByRole('button', { name: 'บันทึกร่าง', exact: true }).click()
    const denied = await rejected
    assert.equal(denied.status(), 403)
    assert.equal((await denied.json()).detail.code, 'expert_verification_required')
    await modal.waitFor()
    assert.equal(await page.locator('.expert-verification-page image[href^="blob:"],.expert-verification-page img[src^="blob:"]').count(), 0)

    // A separate tab may renew/write while this editor remains locked. The
    // editor must retain its original revision and expose the real409 later.
    assert.equal((await post(expert.context, '/expert-login', { password: staffPassword })).status(), 200)
    const concurrent = await post(expert.context, `/analyses/${original.id}/reviews`, {
      expected_revision: original.revision, status: 'in_review', full_image_reviewed: false,
      comments: 'SYNTHETIC concurrent tab writes first', annotations: [],
    })
    assert.equal(concurrent.status(), 201, await concurrent.text())
    assert.ok((await concurrent.json()).revision > original.revision)
    await modal.getByLabel('รหัสผ่านผู้เชี่ยวชาญ', { exact: true }).fill(staffPassword)
    const renewedAgain = page.waitForResponse(response => response.url().endsWith('/expert-login') && response.request().method() === 'POST')
    await modal.getByRole('button', { name: 'ยืนยันและเข้าคลังภาพ', exact: true }).click()
    assert.equal((await renewedAgain).status(), 200)
    await modal.waitFor({ state: 'hidden' })
    assert.deepEqual(await draftSnapshot(), draft, 'A refreshed server revision must not replace an unsaved draft')
    const stale = page.waitForResponse(response => response.url().endsWith(`/analyses/${original.id}/reviews`) && response.request().method() === 'POST')
    await page.getByRole('button', { name: 'บันทึกร่าง', exact: true }).click()
    const conflict = await stale
    assert.equal(conflict.request().postDataJSON().expected_revision, original.revision, 'Never silently rebase an existing draft on renewal')
    assert.equal(conflict.status(), 409)
    await page.getByRole('alert').filter({ hasText: 'ผลนี้เปลี่ยนไปแล้ว' }).waitFor()
    assert.deepEqual(await draftSnapshot(), draft, 'A conflict keeps the draft available for deliberate resolution')
    assert.deepEqual(expert.errors, [])
  } finally { await owner.context.close(); await expert.context.close() }
})
