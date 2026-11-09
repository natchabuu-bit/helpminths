import assert from 'node:assert/strict'
import { existsSync, mkdirSync } from 'node:fs'
import { test } from 'node:test'
import { chromium } from 'playwright'

// The host password is supplied only to an empty, private localhost fixture.
// No production account, default password, or previously configured DB is used.
const fixtureURL = process.env.HELPMINTHS_OWNER_BOOTSTRAP_TEST_URL
const ownerPassword = process.env.HELPMINTHS_OWNER_BOOTSTRAP_TEST_PASSWORD
const syntheticPassword = 'Synthetic-owner-workflow-test-only-2026!'
const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS'])

test('a host-bootstrapped owner signs in directly and approves real requests at phone and desktop widths', {
  skip: !fixtureURL || !ownerPassword ? 'Requires an opt-in synthetic startup fixture and its test-only host password' : false,
  timeout: 180_000,
}, async () => {
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(fixtureURL).hostname), 'Owner bootstrap writes require localhost')
  assert.ok(ownerPassword.startsWith('Synthetic-') && ownerPassword.length >= 12, 'Only a synthetic test host password may be used')
  const origin = new URL(fixtureURL).origin
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), headless: true, args: ['--no-sandbox'] })
  const contexts = [], pageErrors = [], safetyErrors = []

  function fixtureHeader(response) {
    assert.equal(response.headers()['x-helpminths-test-fixture'], 'synthetic-only', 'Refusing mutation without the synthetic fixture marker')
  }
  async function verifyFixture(request) {
    const response = await request.get(`${origin}/api/platform/status`, { maxRedirects: 0 })
    fixtureHeader(response)
    assert.equal(response.status(), 200)
    assert.equal((await response.json()).configured, true)
  }
  async function newContext(storageState) {
    const context = await browser.newContext({ storageState, viewport: { width: 375, height: 1000 }, reducedMotion: 'reduce', serviceWorkers: 'block' })
    contexts.push(context)
    await verifyFixture(context.request)
    context.on('page', page => {
      page.setDefaultTimeout(20_000)
      page.on('pageerror', error => pageErrors.push(error.message))
    })
    await context.route('**/*', async route => {
      if (!safeMethods.has(route.request().method())) {
        const url = new URL(route.request().url())
        if (url.origin !== origin || !url.pathname.startsWith('/api/platform/')) {
          safetyErrors.push(`Refused mutation outside the localhost fixture: ${url.pathname}`)
          await route.abort('blockedbyclient'); return
        }
        try { await verifyFixture(context.request) }
        catch (error) { safetyErrors.push(error.message); await route.abort('blockedbyclient'); return }
      }
      await route.continue()
    })
    return context
  }
  async function session(context) {
    const response = await context.request.get(`${origin}/api/platform/session`)
    fixtureHeader(response)
    assert.equal(response.status(), 200)
    return response.json()
  }
  async function mutate(context, path, data, method = 'post') {
    await verifyFixture(context.request)
    const identity = await session(context)
    const response = await context.request[method](`${origin}/api/platform${path}`, { data, maxRedirects: 0, headers: { 'X-CSRF-Token': identity.csrf_token || '' } })
    fixtureHeader(response)
    return response
  }
  async function submitOwner(page, username, password, expectedStatus) {
    await page.getByLabel('ชื่อบัญชี', { exact: true }).fill(username)
    await page.getByLabel('รหัสผ่าน', { exact: true }).fill(password)
    const completed = page.waitForResponse(response => response.url().endsWith('/api/platform/owner-signin') && response.request().method() === 'POST')
    await page.getByRole('button', { name: 'เข้าสู่หลังบ้าน', exact: true }).click()
    const response = await completed
    fixtureHeader(response)
    assert.equal(response.status(), expectedStatus, await response.text())
    return response.json()
  }
  async function fits(page, name) {
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name} must fit without horizontal scrolling`)
  }
  async function initiallyVisible(locator, name) {
    const bounds = await locator.boundingBox()
    assert.ok(bounds && bounds.y >= 0 && bounds.y + bounds.height <= 1000, `${name} should be visible when the backoffice opens: ${JSON.stringify(bounds)}`)
  }

  try {
    const owner = await newContext()
    const initial = await session(owner)
    assert.equal(initial.user, null)
    assert.equal(initial.bootstrap_required, false, 'Startup must have created the real owner before any login')
    assert.equal(initial.owner_login_username, 'Super Admin', 'A fresh host uses the documented owner name')
    assert.equal(initial.owner_bootstrap.configured, true)
    assert.equal(initial.owner_bootstrap.ready, true)
    assert.ok(!JSON.stringify(initial).includes(ownerPassword), 'The host password must never be returned by the session API')

    const page = await owner.newPage(), inventoryReads = []
    page.on('request', request => {
      if (/^\/api\/platform\/users(?:\/|$)/.test(new URL(request.url()).pathname)) inventoryReads.push(request.url())
    })
    await page.goto(`${origin}/#admin`, { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: 'เข้าสู่ระบบ Super Admin', exact: true }).waitFor()
    assert.equal(await page.getByLabel('ชื่อบัญชี', { exact: true }).inputValue(), initial.owner_login_username)
    const password = page.getByLabel('รหัสผ่าน', { exact: true })
    assert.equal(await password.getAttribute('type'), 'password')
    await page.getByRole('button', { name: 'แสดงรหัสผ่าน', exact: true }).click()
    assert.equal(await password.getAttribute('type'), 'text')
    await page.getByRole('button', { name: 'ซ่อนรหัสผ่าน', exact: true }).click()
    assert.equal(await password.getAttribute('type'), 'password')
    await fits(page, 'Direct owner login')
    assert.deepEqual(inventoryReads, [], 'The public owner form must not read the member inventory')

    await submitOwner(page, initial.owner_login_username, 'Synthetic-wrong-owner-password-only!', 401)
    assert.equal((await session(owner)).user, null, 'A failed login cannot create an owner session')
    assert.equal(new URL(page.url()).hash, '#admin')
    assert.deepEqual(inventoryReads, [], 'A failed login cannot read the owner inventory')
    const identity = await submitOwner(page, initial.owner_login_username, ownerPassword, 200)
    assert.equal(identity.user.is_super_admin, true)
    await page.getByRole('heading', { name: 'อนุมัติคำขอและจัดการสมาชิก', exact: true }).waitFor()
    assert.equal(new URL(page.url()).hash, '#admin', 'Owner login must remain on the backoffice')
    const inventory = await owner.request.get(`${origin}/api/platform/users`)
    fixtureHeader(inventory)
    assert.equal(inventory.status(), 200)
    const freshUsers = await inventory.json()
    assert.equal(freshUsers.total, 1, 'The host bootstrap fixture must start with only its real owner')
    assert.equal(freshUsers.items[0].id, identity.user.id)
    assert.equal(freshUsers.items[0].approval_status, 'approved')
    const pendingInventory = await owner.request.get(`${origin}/api/platform/users?approval_status=pending`)
    fixtureHeader(pendingInventory)
    assert.equal(pendingInventory.status(), 200)
    assert.equal((await pendingInventory.json()).total, 0, 'No applicants may be preseeded into the host bootstrap fixture')
    const ownerState = await owner.storageState()

    const applicants = []
    for (const [index, accountType] of ['user', 'expert'].entries()) {
      const context = await newContext()
      const response = await mutate(context, '/register', { username: `boot_${accountType === 'expert' ? 'e' : 'u'}_${Date.now().toString(36)}_${index}`, password: syntheticPassword, account_type: accountType })
      assert.equal(response.status(), 201, await response.text())
      const { user } = await response.json()
      assert.equal(user.approval_status, 'pending')
      assert.equal(user.is_super_admin, false)
      assert.equal(user.role, 'lab')
      assert.equal((await session(context)).user, null)
      applicants.push({ context, user, role: accountType === 'expert' ? 'reviewer' : 'lab' })
    }

    // The same owner session is reused for both viewports, avoiding extra logins.
    for (const width of [375, 1440]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.reload({ waitUntil: 'networkidle' })
      await page.evaluate(() => scrollTo(0, 0))
      const pending = page.getByRole('group', { name: 'กรองสมาชิก', exact: true }).getByRole('button', { name: 'รออนุมัติ', exact: true })
      await pending.waitFor()
      assert.equal(await pending.getAttribute('aria-pressed'), 'true')
      for (const { user } of applicants) await page.getByRole('button', { name: `อนุมัติบัญชี ${user.username}`, exact: true }).waitFor()
      if (process.env.HELPMINTHS_OWNER_TEST_SCREENSHOT_DIR) {
        mkdirSync(process.env.HELPMINTHS_OWNER_TEST_SCREENSHOT_DIR, { recursive: true })
        await page.screenshot({ path: `${process.env.HELPMINTHS_OWNER_TEST_SCREENSHOT_DIR}/owner-pending-${width}.png`, fullPage: true })
      }
      await initiallyVisible(pending, `Pending filter at ${width}px`)
      await initiallyVisible(page.locator('.platform-user-entry').first().getByRole('button', { name: /^อนุมัติบัญชี / }), `First approval button at ${width}px`)
      const management = await page.locator('.account-super-admin').boundingBox()
      const help = await page.locator('.admin-approval-guide').boundingBox()
      assert.ok(management && help && management.y < help.y, 'Real pending requests must appear before setup/help content')
      await fits(page, `Owner pending requests at ${width}px`)
    }
    assert.ok(inventoryReads.some(url => new URL(url).searchParams.get('approval_status') === 'pending'))

    await page.setViewportSize({ width: 375, height: 1000 })
    for (const { context, user, role } of applicants) {
      const select = page.getByLabel(`สิทธิ์ที่จะอนุมัติของ ${user.username}`, { exact: true })
      assert.equal(await select.inputValue(), role)
      const completed = page.waitForResponse(response => response.url().endsWith(`/users/${user.id}`) && response.request().method() === 'PATCH')
      await page.getByRole('button', { name: `อนุมัติบัญชี ${user.username}`, exact: true }).click()
      await fits(page, 'Approval confirmation')
      await page.getByRole('alertdialog').getByRole('button', { name: 'ยืนยัน', exact: true }).click()
      const response = await completed
      fixtureHeader(response)
      assert.equal(response.status(), 200, await response.text())
      const approved = await response.json()
      assert.equal(approved.approval_status, 'approved')
      assert.equal(approved.role, role)
      assert.equal(approved.is_super_admin, false)
      const login = await mutate(context, role === 'reviewer' ? '/expert-signin' : '/login', { username: user.username, password: syntheticPassword })
      assert.equal(login.status(), 200, await login.text())
      assert.equal((await session(context)).user.role, role)
      const denied = await context.request.get(`${origin}/api/platform/users`)
      fixtureHeader(denied)
      assert.equal(denied.status(), 403, 'Approved members do not gain owner access')
    }

    for (const role of ['admin', 'student']) {
      const username = `bootstrap_nonowner_${role}_${Date.now()}`
      const created = await mutate(owner, '/users', { username, password: syntheticPassword, role })
      assert.equal(created.status(), 201, await created.text())
      assert.equal((await created.json()).is_super_admin, false)
      const context = await newContext()
      const login = await mutate(context, '/login', { username, password: syntheticPassword })
      assert.equal(login.status(), 200, await login.text())
      const member = await session(context)
      assert.equal(member.user.role, role)
      const denied = await context.request.get(`${origin}/api/platform/users`)
      fixtureHeader(denied)
      assert.equal(denied.status(), 403)
      assert.equal((await mutate(context, `/users/${applicants[0].user.id}`, { role: 'admin' }, 'patch')).status(), 403, 'The backend also denies member-management mutations')
      const memberPage = await context.newPage(), memberReads = []
      memberPage.on('request', request => {
        if (/^\/api\/platform\/users(?:\/|$)/.test(new URL(request.url()).pathname)) memberReads.push(request.url())
      })
      await memberPage.goto(`${origin}/#admin`, { waitUntil: 'networkidle' })
      await memberPage.getByRole('heading', { name: 'บัญชีนี้ไม่มีสิทธิ์เข้าหลังบ้าน', exact: true }).waitFor()
      assert.equal(await memberPage.locator('.account-super-admin,.platform-user-entry').count(), 0)
      assert.deepEqual(memberReads, [])
      await submitOwner(memberPage, username, syntheticPassword, 403)
      assert.equal((await session(context)).user.id, member.user.id, 'A correct ordinary password cannot replace the session with an owner')
      assert.deepEqual(memberReads, [])
      if (role === 'admin') {
        await submitOwner(memberPage, initial.owner_login_username, 'Synthetic-wrong-owner-password-only!', 401)
        assert.equal((await session(context)).user.id, member.user.id, 'A wrong owner password preserves the current ordinary session')
        assert.deepEqual(memberReads, [])
        await submitOwner(memberPage, initial.owner_login_username, ownerPassword, 200)
        await memberPage.getByRole('heading', { name: 'อนุมัติคำขอและจัดการสมาชิก', exact: true }).waitFor()
        assert.equal((await session(context)).user.is_super_admin, true, 'The direct form can switch an ordinary session to the actual owner')
      }
      await fits(memberPage, `${role} direct owner switch`)
    }

    const persisted = await newContext(ownerState)
    const reopened = await persisted.newPage()
    await reopened.goto(`${origin}/#admin`, { waitUntil: 'networkidle' })
    await reopened.getByRole('heading', { name: 'อนุมัติคำขอและจัดการสมาชิก', exact: true }).waitFor()
    assert.equal((await session(persisted)).user.is_super_admin, true, 'A refresh uses the real server session')
    assert.deepEqual(safetyErrors, [])
    assert.deepEqual(pageErrors, [])
  } finally {
    await Promise.allSettled(contexts.map(context => context.close()))
    await browser.close()
  }
})
