import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

// Every mutation is restricted to the explicitly marked disposable localhost
// fixture. The charts/predictions here are software fixtures, not clinical data.
const origin = new URL(process.env.HELPMINTHS_ARCHIVE_TEST_URL || 'http://127.0.0.1:8140').origin
const password = 'Synthetic-UI-test-only-2026!'
const prefix = `SYNTHETIC_ARCHIVE_${Date.now()}`
const correctedLabel = 'SYNTHETIC expert corrected object'
const missedLabel = 'SYNTHETIC expert added object'
const finalComment = 'ผลยืนยันจำลอง: แก้ชนิดวัตถุแรก ตัดวัตถุที่สอง และเพิ่มวัตถุที่ AI ไม่พบ'
const moreComment = 'ข้อความจำลองก่อนยืนยัน: ขอภาพบริเวณขอบให้ชัดเจนขึ้น'
const directory = process.env.HELPMINTHS_ARCHIVE_SCREENSHOT_DIR
const states = []
let browser, admin, member, expert, other, finalCase, unrefCase, zeroCase, pendingCase, rejectedCode, originalNotification, archiveItems, image

async function fixture(request) {
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname), 'Refusing non-local fixture mutations')
  const response = await request.get(`${origin}/api/platform/status`, { maxRedirects: 0 })
  assert.equal(response.status(), 200)
  assert.equal(response.headers()['x-helpminths-test-fixture'], 'synthetic-only', 'Refusing writes without the synthetic fixture marker')
}
async function checked(response, status = 200) {
  assert.equal(response.headers()['x-helpminths-test-fixture'], 'synthetic-only')
  assert.equal(response.status(), status, await response.text())
  return response.json()
}
async function identity(context) { return checked(await context.request.get(`${origin}/api/platform/session`)) }
async function mutate(context, path, data, method = 'post') {
  await fixture(context.request)
  const session = await identity(context)
  return context.request[method](`${origin}/api/platform${path}`, { data, maxRedirects: 0, headers: { 'X-CSRF-Token': session.csrf_token || '' } })
}
async function createContext(username, endpoint = '/login') {
  const context = await browser.newContext({ viewport: { width: 375, height: 1000 }, reducedMotion: 'reduce', serviceWorkers: 'block' })
  const errors = [], safetyErrors = []
  states.push({ context, errors, safetyErrors })
  await fixture(context.request)
  if (username) await checked(await mutate(context, endpoint, { username, password }))
  context.on('page', page => { page.setDefaultTimeout(20_000); page.on('pageerror', failure => errors.push(failure.message)) })
  await context.route('**/*', async route => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) {
      try {
        const url = new URL(route.request().url())
        assert.equal(url.origin, origin)
        assert.ok(url.pathname.startsWith('/api/platform/'))
        await fixture(context.request)
      } catch (failure) { safetyErrors.push(failure.message); await route.abort('blockedbyclient'); return }
    }
    await route.continue()
  })
  return context
}
async function syntheticImage(context, flat = false) {
  const page = await context.newPage()
  try {
    return Buffer.from(await page.evaluate(isFlat => {
      const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 384
      const brush = canvas.getContext('2d')
      for (let y = 0; y < 384; y += 16) for (let x = 0; x < 512; x += 16) {
        const value = isFlat ? 128 : ((x / 16 + y / 16) % 2 ? 180 : 75)
        brush.fillStyle = `rgb(${value},${value},${value})`; brush.fillRect(x, y, 16, 16)
      }
      return canvas.toDataURL('image/png').split(',')[1]
    }, flat), 'base64')
  } finally { await page.close() }
}
async function submit(context, code, pixels = image, status = 201) {
  await fixture(context.request)
  const session = await identity(context)
  return checked(await context.request.post(`${origin}/api/platform/analyses`, {
    headers: { 'X-CSRF-Token': session.csrf_token }, maxRedirects: 0,
    multipart: { sample_code: code, image: { name: 'SYNTHETIC-archive.png', mimeType: 'image/png', buffer: pixels }, acknowledge_quality: 'false' },
  }), status)
}
async function refer(context, analysis) { return checked(await mutate(context, `/analyses/${analysis.id}/referrals`, { expected_revision: analysis.revision, reason: 'SYNTHETIC review workflow only' }), 201) }
async function current(context, analysis) { return checked(await context.request.get(`${origin}/api/platform/analyses/${analysis.id}`)) }
async function fits(page) { assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'The page must fit its viewport') }
async function capture(page, name) { if (directory) { await mkdir(directory, { recursive: true }); await page.screenshot({ path: `${directory}/${name}.png`, fullPage: true }) } }
async function filterArchive(page, query, ownerId) {
  const loaded = page.waitForResponse(response => {
    const url = new URL(response.url())
    return response.request().method() === 'GET' && url.pathname === '/api/platform/admin/image-archive'
      && url.searchParams.get('q') === query && (!ownerId || url.searchParams.get('owner_id') === ownerId)
  })
  await page.getByRole('button', { name: 'ค้นหาภาพ', exact: true }).click()
  await checked(await loaded)
}
async function bellItem(page, code, comment) {
  await page.getByRole('button', { name: /^การแจ้งเตือน/ }).click()
  return page.locator('.notification-item').filter({ hasText: code }).filter({ hasText: comment })
}

before(async () => {
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), headless: true, args: ['--no-sandbox'] })
  admin = await createContext('fixture-admin', '/owner-signin')
  member = await createContext('fixture-lab')
  expert = await createContext('fixture-reviewer', '/expert-signin')
  other = await createContext('fixture-other')
  assert.equal((await identity(admin)).expert_verified_until, null, 'The owner archive must work without a clinical expert step-up')
  image = await syntheticImage(member)

  finalCase = await submit(member, `${prefix}_CORRECTED`)
  let referral = await refer(member, finalCase)
  referral = await checked(await mutate(expert, `/referrals/${referral.id}/response`, { expected_revision: referral.revision, action: 'request_more', comment: moreComment }))
  const inbox = await checked(await member.request.get(`${origin}/api/platform/notifications`))
  originalNotification = inbox.items.find(item => item.analysis_id === finalCase.id && item.kind === 'request_more')
  assert.ok(originalNotification)
  const session = await identity(member)
  const supplemental = await checked(await member.request.post(`${origin}/api/platform/referrals/${referral.id}/attachments`, {
    headers: { 'X-CSRF-Token': session.csrf_token }, maxRedirects: 0,
    multipart: { expected_revision: String(referral.revision), comment: 'SYNTHETIC supplementary chart', image: { name: 'SYNTHETIC-additional.png', mimeType: 'image/png', buffer: image } },
  }), 201)
  assert.ok(supplemental.attachment.id)
  finalCase = await current(expert, finalCase)
  finalCase = await checked(await mutate(expert, `/analyses/${finalCase.id}/reviews`, {
    expected_revision: finalCase.revision, status: 'verified', full_image_reviewed: true, comment: finalComment,
    annotations: [
      { detection_id: String(finalCase.detections[0].id), action: 'correct', label: correctedLabel },
      { detection_id: String(finalCase.detections[1].id), action: 'false_positive' },
      { action: 'missed', label: missedLabel, bbox: [18, 18, 50, 45] },
    ],
  }), 201)
  unrefCase = await submit(other, `${prefix}_NO_REFERRAL`)
  assert.equal(unrefCase.referral_id ?? null, null)
  rejectedCode = `${prefix}_QUALITY_REJECTED`
  const rejection = await submit(member, rejectedCode, await syntheticImage(member, true), 422)
  assert.equal(rejection.detail.code, 'quality_acknowledgement_required')
  assert.equal((await checked(await member.request.get(`${origin}/api/platform/analyses?q=${rejectedCode}`))).total, 0)
  zeroCase = await submit(member, `${prefix}_ZERO_CONFIRMED`)
  zeroCase = await checked(await mutate(expert, `/analyses/${zeroCase.id}/reviews`, {
    expected_revision: zeroCase.revision, status: 'verified', full_image_reviewed: true, comment: 'ผลยืนยันจำลอง: ไม่ใช่วัตถุเป้าหมายทั้งสองตำแหน่ง',
    annotations: zeroCase.detections.map(item => ({ detection_id: String(item.id), action: 'false_positive' })),
  }), 201)
  pendingCase = await submit(member, `${prefix}_AWAITING_CONFIRMATION`)
  const pendingReferral = await refer(member, pendingCase)
  await checked(await mutate(expert, `/referrals/${pendingReferral.id}/response`, { expected_revision: pendingReferral.revision, action: 'request_more', comment: 'ข้อความจำลองระหว่างตรวจ: ต้องการภาพเพิ่ม ยังไม่ยืนยันชนิด' }))
  archiveItems = (await checked(await admin.request.get(`${origin}/api/platform/admin/image-archive?q=${prefix}&limit=100`))).items
  assert.equal(archiveItems.length, 6, 'Every diagnostic/supplemental image, including the rejected image, must be archived exactly once')
})
after(async () => {
  for (const state of states) {
    await state.context.close()
    assert.deepEqual(state.errors, [])
    assert.deepEqual(state.safetyErrors, [])
  }
  await browser?.close()
})

test('AI predictions stay distinct from the expert final diagnosis, including when opening an older notification', { timeout: 90_000 }, async () => {
  const page = await member.newPage()
  await page.goto(`${origin}/#verification`, { waitUntil: 'networkidle' })
  await (await bellItem(page, finalCase.sample_code, moreComment)).click()
  await page.locator(`.referral-panel[data-referral-id="${originalNotification.referral_id}"]`).waitFor()
  const comparison = page.locator('.diagnosis-comparison').first()
  await comparison.waitFor()
  const ai = comparison.getByRole('region', { name: 'ผลที่ AI ทำนาย', exact: true })
  const confirmed = comparison.getByRole('region', { name: 'ผลจากผู้เชี่ยวชาญ', exact: true })
  assert.match(await ai.innerText(), /TEST FIXTURE object A/)
  assert.match(await ai.innerText(), /TEST FIXTURE object B/)
  assert.doesNotMatch(await ai.innerText(), new RegExp(correctedLabel))
  assert.match(await confirmed.innerText(), new RegExp(correctedLabel))
  assert.match(await confirmed.innerText(), new RegExp(missedLabel))
  assert.match(await confirmed.innerText(), /ยืนยัน/)
  assert.match(await page.locator(`.referral-response[data-message-id="${originalNotification.message_id}"]`).innerText(), new RegExp(moreComment))
  const expertOverlay = page.getByRole('button', { name: 'กรอบที่ผู้เชี่ยวชาญยืนยัน', exact: true })
  await expertOverlay.waitFor()
  assert.equal(await expertOverlay.getAttribute('aria-pressed'), 'true', 'A confirmed image must initially display the confirmed expert boxes')
  const aiOverlay = page.getByRole('button', { name: 'กรอบที่ AI ทำนาย', exact: true })
  await aiOverlay.click()
  assert.equal(await aiOverlay.getAttribute('aria-pressed'), 'true')
  await expertOverlay.click()
  assert.equal(await expertOverlay.getAttribute('aria-pressed'), 'true')
  await fits(page)
  await capture(page, 'member-ai-expert-comparison-375')
  await page.setViewportSize({ width: 1440, height: 1000 })
  await fits(page)
  await capture(page, 'member-ai-expert-comparison-1440')

  await page.reload({ waitUntil: 'networkidle' })
  await (await bellItem(page, pendingCase.sample_code, 'ยังไม่ยืนยันชนิด')).click()
  const pending = page.locator('.diagnosis-comparison').first()
  await pending.waitFor()
  assert.match(await pending.getByRole('region', { name: 'ผลจากผู้เชี่ยวชาญ', exact: true }).innerText(), /ยังไม่|รอ|เพิ่มเติม/)
  assert.doesNotMatch(await pending.getByRole('region', { name: 'ผลจากผู้เชี่ยวชาญ', exact: true }).innerText(), /SYNTHETIC expert corrected object/)
})

test('only the actual Super Admin can view the daily account-grouped archive, results and retained images', { timeout: 120_000 }, async () => {
  const original = archiveItems.find(item => item.analysis_id === finalCase.id && item.source === 'analysis')
  const additional = archiveItems.find(item => item.analysis_id === finalCase.id && item.source === 'supplemental')
  const rejected = archiveItems.find(item => item.sample_code === rejectedCode)
  assert.ok(original && additional && rejected)
  assert.equal(rejected.status, 'quality_rejected'); assert.equal(rejected.analysis_id, null)
  assert.equal(original.owner.username, 'fixture-lab')
  assert.match(original.examined_date, /^\d{4}-\d{2}-\d{2}$/)
  const finalArchive = await checked(await admin.request.get(`${origin}/api/platform/admin/image-archive/${original.id}`))
  assert.deepEqual(finalArchive.analysis.detections, finalCase.detections, 'The immutable AI answer must remain alongside the expert answer')
  assert.ok(finalArchive.reviews.some(review => review.annotations.some(annotation => annotation.label === correctedLabel)))
  assert.ok(finalArchive.referrals.some(referral => referral.messages.some(message => message.comment === moreComment)))
  assert.ok(finalArchive.referrals.some(referral => referral.messages.some(message => message.comment === finalComment)))
  const nonownerName = `synthetic_archive_admin_${Date.now()}`
  await checked(await mutate(admin, '/users', { username: nonownerName, password, role: 'admin' }), 201)
  const regularAdmin = await createContext(nonownerName, '/expert-signin')
  const student = await createContext('fixture-student')
  const anonymous = await createContext()
  for (const context of [member, other, expert, regularAdmin, student, anonymous]) {
    const expected = context === anonymous ? 401 : 403
    for (const path of ['/admin/image-archive', '/admin/image-archive/accounts', '/admin/image-archive/days', `/admin/image-archive/${original.id}`, `/admin/image-archive/${original.id}/image`, `/audit/admin_image/${original.id}`]) {
      const denied = await context.request.get(`${origin}/api/platform${path}`)
      assert.equal(denied.status(), expected, path)
      assert.equal(denied.headers()['cache-control'], 'no-store')
    }
  }
  const page = await admin.newPage()
  await page.goto(`${origin}/admin/`, { waitUntil: 'networkidle' })
  await page.getByRole('tab', { name: 'คลังภาพและผลตรวจ', exact: true }).click()
  await page.getByRole('heading', { name: 'คลังภาพและผลตรวจ', exact: true }).waitFor()
  await page.getByLabel('ค้นหาภาพ', { exact: true }).fill(prefix)
  await filterArchive(page, prefix)
  await page.getByRole('button', { name: `เปิดภาพ ${finalCase.sample_code} ของ fixture-lab`, exact: true }).first().waitFor()
  await page.getByRole('button', { name: `เปิดภาพ ${unrefCase.sample_code} ของ fixture-other`, exact: true }).waitFor()
  assert.ok(await page.locator('.admin-archive-day').count() >= 1)
  assert.equal(await page.getByRole('region', { name: 'ภาพของ fixture-lab', exact: true }).count(), 1)
  assert.equal(await page.getByRole('region', { name: 'ภาพของ fixture-other', exact: true }).count(), 1)
  await fits(page)
  await capture(page, 'admin-daily-image-archive-375')
  await page.setViewportSize({ width: 1440, height: 1000 })
  await fits(page)
  await capture(page, 'admin-daily-image-archive-1440')
  await page.getByLabel('บัญชีผู้ส่ง', { exact: true }).selectOption(unrefCase.owner_id)
  await page.locator('.admin-archive-advanced > summary').click()
  await page.getByLabel('ตั้งแต่วันที่', { exact: true }).fill(original.examined_date)
  await page.getByLabel('ถึงวันที่', { exact: true }).fill(original.examined_date)
  await filterArchive(page, prefix, unrefCase.owner_id)
  await page.getByRole('button', { name: `เปิดภาพ ${unrefCase.sample_code} ของ fixture-other`, exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: `เปิดภาพ ${finalCase.sample_code} ของ fixture-lab`, exact: true }).count(), 0)
  await page.getByRole('button', { name: `เปิดภาพ ${unrefCase.sample_code} ของ fixture-other`, exact: true }).click()
  await page.getByRole('region', { name: 'ข้อมูลภาพในคลัง', exact: true }).waitFor()
  assert.match(await page.locator('.admin-archive-detail').innerText(), /fixture-other/)
  assert.match(await page.locator('.admin-archive-detail').innerText(), /TEST FIXTURE object A/)

  finalCase = await current(member, finalCase)
  await checked(await mutate(member, `/analyses/${finalCase.id}?expected_revision=${finalCase.revision}`, undefined, 'delete'))
  assert.equal((await member.request.get(`${origin}/api/platform/analyses/${finalCase.id}/image`)).status(), 404)
  for (const item of [original, additional]) {
    const retained = await checked(await admin.request.get(`${origin}/api/platform/admin/image-archive/${item.id}`))
    assert.equal(retained.operational_deleted, true)
    const retainedImage = await admin.request.get(`${origin}/api/platform/admin/image-archive/${item.id}/image`)
    assert.equal(retainedImage.status(), 200)
    assert.match(retainedImage.headers()['content-type'], /image\/png/)
    assert.equal(retainedImage.headers()['cache-control'], 'no-store')
  }
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('tab', { name: 'คลังภาพและผลตรวจ', exact: true }).click()
  await page.getByLabel('ค้นหาภาพ', { exact: true }).fill(zeroCase.sample_code)
  await filterArchive(page, zeroCase.sample_code)
  await page.getByRole('button', { name: `เปิดภาพ ${zeroCase.sample_code} ของ fixture-lab`, exact: true }).click()
  await page.locator('.admin-archive-detail').waitFor()
  assert.match(await page.locator('.admin-archive-detail').getByRole('region', { name: 'ผลจากผู้เชี่ยวชาญ', exact: true }).innerText(), /ยืนยัน 0 ตำแหน่ง.*ไม่พบไข่หรือตัวอ่อนพยาธิในภาพนี้/s)
  await capture(page, 'admin-zero-confirmed-diagnosis-1440')
  await page.getByRole('button', { name: 'ออกจากระบบ', exact: true }).click()
  await page.getByRole('heading', { name: 'เข้าสู่ระบบ Super Admin', exact: true }).waitFor()
  assert.equal(await page.locator('.admin-archive-detail,.admin-archive-grid,.admin-archive-page').count(), 0)
})
