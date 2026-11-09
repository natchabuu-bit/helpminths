import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { existsSync } from 'node:fs'
import { chromium } from 'playwright'
import { navigate as nav } from './helpers/navigation.mjs'

// Real approval mutations are restricted to the opt-in localhost fixture. This
// suite never promotes an existing account or writes to a configured deployment.
const fixtureURL = process.env.HELPMINTHS_ADMIN_TEST_URL || 'http://127.0.0.1:8100'
const unconfiguredURL = process.env.HELPMINTHS_ADMIN_DEFAULT_URL || 'http://127.0.0.1:8101'
const staffPassword = 'Synthetic-UI-test-only-2026!'
const applicantPassword = 'Synthetic-admin-workflow-only-2026!'
const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS'])
let browser, ownerStorageState

function fixtureHeader(response) {
  assert.equal(response.headers()['x-helpminths-test-fixture'], 'synthetic-only', 'Refusing writes to a service without the synthetic fixture marker')
}
async function verifyFixture(request) {
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(fixtureURL).hostname), 'Approval fixtures must use localhost')
  const response = await request.get(`${fixtureURL}/api/platform/status`, { maxRedirects: 0 })
  fixtureHeader(response)
  assert.equal(response.status(), 200)
  assert.equal((await response.json()).configured, true)
}
before(async () => {
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), headless: true, args: ['--no-sandbox'] })
  const context = await browser.newContext({ serviceWorkers: 'block' })
  try { await verifyFixture(context.request) } finally { await context.close() }
})
after(async () => browser?.close())

async function fixtureContext(storageState) {
  const context = await browser.newContext({ storageState, viewport: { width: 375, height: 1000 }, serviceWorkers: 'block', reducedMotion: 'reduce' })
  await verifyFixture(context.request)
  const errors = [], safetyErrors = []
  context.on('page', page => {
    page.setDefaultTimeout(20_000)
    page.on('pageerror', error => errors.push(error.message))
  })
  await context.route('**/*', async route => {
    if (!safeMethods.has(route.request().method())) {
      const url = new URL(route.request().url())
      if (url.origin !== new URL(fixtureURL).origin || !url.pathname.startsWith('/api/platform/')) {
        safetyErrors.push(`Refused mutation outside the fixture platform API: ${url.pathname}`)
        await route.abort('blockedbyclient'); return
      }
      try { await verifyFixture(context.request) }
      catch (error) { safetyErrors.push(error.message); await route.abort('blockedbyclient'); return }
    }
    await route.continue()
  })
  return { context, finish: async () => { await context.close(); assert.deepEqual(safetyErrors, []); assert.deepEqual(errors, []) } }
}
async function session(context) {
  const response = await context.request.get(`${fixtureURL}/api/platform/session`)
  fixtureHeader(response)
  assert.equal(response.status(), 200)
  return response.json()
}
async function mutate(context, path, data, method = 'post') {
  await verifyFixture(context.request)
  const identity = await session(context)
  const response = await context.request[method](`${fixtureURL}/api/platform${path}`, { data, maxRedirects: 0, headers: { 'X-CSRF-Token': identity.csrf_token || '' } })
  fixtureHeader(response)
  return response
}
async function signIn(page, username, password = staffPassword) {
  await page.getByLabel('ชื่อบัญชี', { exact: true }).fill(username)
  await page.getByLabel('รหัสผ่าน', { exact: true }).fill(password)
  const completed = page.waitForResponse(response => response.url().endsWith('/api/platform/owner-signin') && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'เข้าสู่หลังบ้าน', exact: true }).click()
  const response = await completed
  fixtureHeader(response)
  assert.equal(response.status(), 200, await response.text())
  return response.json()
}
async function assertFitsPhone(page, label) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label} must fit a 375px viewport`)
}
function ownerRequests(page) {
  const requests = []
  page.on('request', request => {
    if (/^\/api\/platform\/users(?:\/|$)/.test(new URL(request.url()).pathname)) requests.push(request.url())
  })
  return requests
}
function assertNoMemberControls(page) {
  return Promise.all([
    page.locator('.account-super-admin,.platform-user-entry,.platform-user-list').count().then(count => assert.equal(count, 0)),
    page.getByRole('navigation', { name: 'เมนูหลัก', exact: true }).getByRole('button', { name: /หลังบ้าน/ }).count().then(count => assert.equal(count, 0)),
  ])
}

test('standalone dark backoffice signs the actual owner in directly and links back to the public application', { timeout: 90_000 }, async () => {
  const { context, finish } = await fixtureContext()
  try {
    const page = await context.newPage(), reads = ownerRequests(page)
    await page.goto(`${fixtureURL}/#admin`, { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: 'หลังบ้าน Super Admin', exact: true }).waitFor()
    await assertNoMemberControls(page)
    assert.deepEqual(reads, [], 'The logged-out gate must not request the owner inventory')
    await assertFitsPhone(page, 'Logged-out backoffice')
    await page.getByRole('heading', { name: 'เข้าสู่ระบบ Super Admin', exact: true }).waitFor()
    assert.equal(new URL(page.url()).pathname, '/admin/', 'The owner form opens directly in the backoffice')
    assert.equal(await page.getByLabel('รหัสผ่าน', { exact: true }).getAttribute('type'), 'password')
    assert.deepEqual(reads, [], 'The direct owner form must not read the owner inventory')
    const identity = await signIn(page, 'fixture-admin')
    assert.equal(identity.user.is_super_admin, true)
    await page.waitForFunction(() => location.pathname === '/admin/')
    await page.getByRole('heading', { name: 'หลังบ้าน Super Admin', exact: true }).waitFor()
    await page.getByRole('heading', { name: 'อนุมัติคำขอและจัดการสมาชิก', exact: true }).waitFor()
    await page.locator('.platform-loading').waitFor({ state: 'hidden' })
    assert.ok(reads.some(url => new URL(url).searchParams.get('approval_status') === 'pending'), 'The backoffice opens with real pending requests')
    assert.equal(await page.getByRole('group', { name: 'กรองสมาชิก', exact: true }).getByRole('button', { name: 'รออนุมัติ', exact: true }).getAttribute('aria-pressed'), 'true')
    assert.equal(await page.locator('.sidebar').count(), 0, 'Backoffice has an independent application shell')
    await page.locator('.admin-site').waitFor()
    const background = await page.locator('.admin-site').evaluate(node => getComputedStyle(node).backgroundColor)
    const colors = background.match(/\d+/g)?.map(Number) ?? []
    assert.ok(colors.length >= 3 && Math.max(...colors.slice(0, 3)) < 100, 'Backoffice uses a dark background')
    await assertFitsPhone(page, 'Owner backoffice')
    ownerStorageState = await context.storageState()
    await page.getByRole('link', { name: 'กลับไป HelpMinths', exact: true }).click()
    await nav(page, 'ตั้งค่าและบัญชี')
    await page.getByRole('button', { name: 'เปิดหลังบ้าน', exact: true }).click()
    await page.waitForFunction(() => location.pathname === '/admin/')
    await page.reload({ waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: 'อนุมัติคำขอและจัดการสมาชิก', exact: true }).waitFor()
  } finally { await finish() }
})

test('owner approves and rejects real pending requests in the phone backoffice and server permissions follow each decision', { timeout: 120_000 }, async () => {
  assert.ok(ownerStorageState, 'The real owner login must succeed before approval checks')
  const owner = await fixtureContext(ownerStorageState), applicants = []
  try {
    const suffix = Date.now()
    for (const [kind, decision] of [['user', 'approved'], ['expert', 'approved'], ['expert', 'rejected']]) {
      const applicant = await fixtureContext()
      applicants.push(applicant)
      const username = `admin_${kind}_${decision}_${suffix}`
      const response = await mutate(applicant.context, '/register', { username, password: applicantPassword, account_type: kind, full_name: 'ผู้ทดสอบ ระบบ', workplace: 'ห้องปฏิบัติการทดสอบ', affiliation: 'หน่วยงานทดสอบ', phone: '0812345678' })
      assert.equal(response.status(), 201, await response.text())
      const pending = await response.json()
      assert.equal(pending.user.approval_status, 'pending')
      assert.equal(pending.user.role, 'lab', 'An expert request cannot grant expert permissions before approval')
      assert.equal((await session(applicant.context)).user, null)
      applicant.user = pending.user
      applicant.decision = decision
      applicant.role = kind === 'expert' ? 'reviewer' : 'lab'
    }
    const page = await owner.context.newPage()
    await page.goto(`${fixtureURL}/#admin`, { waitUntil: 'networkidle' })
    for (const applicant of applicants) {
      const { user, decision, role } = applicant
      const select = page.getByLabel(`สิทธิ์ที่จะอนุมัติของ ${user.username}`)
      await select.waitFor()
      assert.equal(await select.inputValue(), role)
      const label = `${decision === 'approved' ? 'อนุมัติบัญชี' : 'ไม่อนุมัติบัญชี'} ${user.username}`
      const completed = page.waitForResponse(response => response.url().endsWith(`/users/${user.id}`) && response.request().method() === 'PATCH')
      await page.getByRole('button', { name: label, exact: true }).click()
      await assertFitsPhone(page, 'Approval confirmation')
      await page.getByRole('alertdialog').getByRole('button', { name: 'ยืนยัน', exact: true }).click()
      const response = await completed
      fixtureHeader(response)
      assert.equal(response.status(), 200, await response.text())
      const updated = await response.json()
      assert.equal(updated.approval_status, decision)
      assert.equal(updated.is_super_admin, false)
      if (decision === 'approved') assert.equal(updated.role, role)
      await page.getByRole('button', { name: label, exact: true }).waitFor({ state: 'detached' })
      await assertFitsPhone(page, 'Pending request list')
      const login = await mutate(applicant.context, role === 'reviewer' ? '/expert-signin' : '/login', { username: user.username, password: applicantPassword })
      assert.equal(login.status(), decision === 'approved' ? 200 : 403, await login.text())
      const identity = await session(applicant.context)
      if (decision === 'approved') {
        assert.equal(identity.user.role, role)
        assert.equal(identity.user.approval_status, 'approved')
        const denied = await applicant.context.request.get(`${fixtureURL}/api/platform/users`)
        fixtureHeader(denied)
        assert.equal(denied.status(), 403, 'Approving an ordinary or expert account must not grant owner inventory access')
        if (role === 'reviewer') assert.ok(Date.parse(identity.expert_verified_until) > Date.now())
      } else {
        assert.equal(identity.user, null)
        assert.equal((await mutate(applicant.context, '/login', { username: user.username, password: applicantPassword })).status(), 403)
      }
    }
    await page.getByRole('group', { name: 'กรองสมาชิก', exact: true }).getByRole('button', { name: 'สมาชิกทั้งหมด', exact: true }).click()
    for (const applicant of applicants) {
      const row = page.locator('.platform-user-entry').filter({ has: page.getByText(applicant.user.username, { exact: true }) })
      await row.waitFor()
      assert.match(await row.innerText(), applicant.decision === 'approved' ? /อนุมัติแล้ว/ : /ไม่อนุมัติ/)
    }
    await assertFitsPhone(page, 'All-member inventory')
  } finally {
    await owner.finish()
    for (const applicant of applicants) await applicant.finish()
  }
})

test('approved general, expert, read-only and nonowner admin accounts cannot render or fetch the backoffice inventory', { timeout: 120_000 }, async () => {
  const ordinaryAdminName = `admin_nonowner_${Date.now()}`
  const owner = await fixtureContext(ownerStorageState)
  try {
    const created = await mutate(owner.context, '/users', { username: ordinaryAdminName, password: staffPassword, role: 'admin' })
    assert.equal(created.status(), 201, await created.text())
    assert.equal((await created.json()).is_super_admin, false, 'An administrator role alone does not create a system owner')
  } finally { await owner.finish() }
  for (const role of ['lab', 'reviewer', 'student', 'admin']) {
    const { context, finish } = await fixtureContext()
    try {
      const signedIn = await mutate(context, '/login', { username: role === 'admin' ? ordinaryAdminName : `fixture-${role}`, password: staffPassword })
      assert.equal(signedIn.status(), 200, await signedIn.text())
      const identity = await session(context)
      assert.equal(identity.user.role, role)
      assert.equal(identity.user.is_super_admin, false)
      const page = await context.newPage(), reads = ownerRequests(page)
      await page.goto(`${fixtureURL}/#admin`, { waitUntil: 'networkidle' })
      await page.getByRole('heading', { name: 'หลังบ้าน Super Admin', exact: true }).waitFor()
      await page.getByRole('heading', { name: 'บัญชีนี้ไม่มีสิทธิ์เข้าหลังบ้าน', exact: true }).waitFor()
      await assertNoMemberControls(page)
      assert.deepEqual(reads, [], `${role} must be gated before the owner API can run`)
      await assertFitsPhone(page, `${role} backoffice gate`)
      await page.goto(`${fixtureURL}/#settings`, { waitUntil: 'networkidle' })
      assert.equal(await page.getByRole('button', { name: 'เปิดหลังบ้าน', exact: true }).count(), 0)
      assert.doesNotMatch(await page.locator('body').innerText(), /พอร์ทัล/)
      assert.deepEqual(reads, [], `${role} Settings must not request the owner inventory`)
      const denied = await context.request.get(`${fixtureURL}/api/platform/users`)
      fixtureHeader(denied)
      assert.equal(denied.status(), 403, 'The server must independently enforce owner inventory access')
      if (role === 'student') {
        assert.equal((await mutate(context, '/expert-login', { password: staffPassword })).status(), 403, 'The read-only fixture keeps its original permissions')
        assert.equal((await session(context)).user.role, 'student')
      }
    } finally { await finish() }
  }
})

test('public Settings user and expert views use plain account wording at phone width', { timeout: 60_000 }, async () => {
  const { context, finish } = await fixtureContext()
  try {
    const page = await context.newPage(), reads = ownerRequests(page)
    await page.goto(`${fixtureURL}/#settings`, { waitUntil: 'networkidle' })
    for (const expert of [false, true]) {
      await page.getByRole('tablist', { name: 'ช่องทางเข้าใช้งาน', exact: true }).getByRole('tab', { name: expert ? /^ผู้เชี่ยวชาญ/ : /^ผู้ใช้ทั่วไป/ }).click()
      for (const registering of [false, true]) {
        await page.getByRole('tab', { name: registering ? expert ? 'สมัครเป็นผู้เชี่ยวชาญ' : 'สมัครสมาชิก' : expert ? 'เข้าสู่ระบบผู้เชี่ยวชาญ' : 'เข้าสู่ระบบ', exact: true }).click()
        assert.doesNotMatch(await page.locator('body').innerText(), /พอร์ทัล/)
        assert.equal(await page.getByLabel('ชื่อบัญชี', { exact: true }).isDisabled(), false)
        await assertFitsPhone(page, `${expert ? 'Expert' : 'General'} account ${registering ? 'registration' : 'login'}`)
      }
    }
    await assertNoMemberControls(page)
    assert.deepEqual(reads, [])
  } finally { await finish() }
})

test('unconfigured direct backoffice route shows a truthful gate without member controls or owner requests', { timeout: 60_000 }, async () => {
  const context = await browser.newContext({ viewport: { width: 375, height: 1000 }, serviceWorkers: 'block' })
  const errors = [], writes = []
  try {
    const status = await context.request.get(`${unconfiguredURL}/api/platform/status`)
    assert.equal(status.status(), 200)
    assert.equal((await status.json()).configured, false, 'This check requires an unconfigured server and never changes its setup')
    await context.route('**/*', async route => {
      if (!safeMethods.has(route.request().method())) { writes.push(route.request().url()); await route.abort('blockedbyclient'); return }
      await route.continue()
    })
    const page = await context.newPage(), reads = ownerRequests(page)
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`${unconfiguredURL}/#admin`, { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: 'หลังบ้าน Super Admin', exact: true }).waitFor()
    await page.getByRole('heading', { name: 'ยังเชื่อมต่อระบบบัญชีไม่ได้', exact: true }).waitFor()
    await assertNoMemberControls(page)
    assert.deepEqual(reads, [], 'An unconfigured backoffice must not fetch users')
    assert.equal(await page.getByRole('button', { name: 'เปิดหลังบ้าน', exact: true }).count(), 0)
    await assertFitsPhone(page, 'Unconfigured backoffice')
    assert.deepEqual(writes, [])
    assert.deepEqual(errors, [])
  } finally { await context.close() }
})

test('first-owner backoffice guidance explains host setup before an administrator exists', { timeout: 60_000 }, async () => {
  const { context, finish } = await fixtureContext()
  const writes = []
  try {
    // Read-only synthetic readiness case: the running fixture already has its
    // owner, so no real owner credentials or host configuration are changed.
    await context.route('**/api/platform/**', async route => {
      if (!safeMethods.has(route.request().method())) { writes.push(route.request().url()); await route.abort('blockedbyclient'); return }
      if (new URL(route.request().url()).pathname === '/api/platform/session') {
        await route.fulfill({ json: { configured: true, user: null, csrf_token: null, bootstrap_required: true, registration_enabled: true, admin_setup_available: false, owner_login_username: 'Super Admin', owner_bootstrap: { configured: false, ready: false, message: '' } }, headers: { 'Cache-Control': 'no-store', 'X-HelpMinths-Test-Fixture': 'synthetic-only' } })
        return
      }
      await route.fallback()
    })
    const page = await context.newPage(), reads = ownerRequests(page)
    await page.goto(`${fixtureURL}/#admin`, { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: 'ตั้งรหัสผ่าน Super Admin ครั้งแรก', exact: true }).waitFor()
    await page.getByText('HELPMINTHS_SUPER_ADMIN_PASSWORD', { exact: true }).waitFor()
    assert.match(await page.locator('.admin-first-setup').innerText(), /Render.*Environment.*Manual Deploy/s)
    await assertNoMemberControls(page)
    await assertFitsPhone(page, 'First-owner setup guidance')
    assert.deepEqual(reads, [])
    assert.deepEqual(writes, [])
  } finally { await finish() }
})
