import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { existsSync } from 'node:fs'
import { chromium } from 'playwright'

const baseURL = process.env.HELPMINTHS_TEST_URL || 'http://127.0.0.1:8089'
let browser
before(async () => {
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), headless: true, args: ['--no-sandbox'] })
})
after(async () => browser?.close())

test('Settings rechecks a stale unavailable session and enables actual account forms without claiming durable storage', { timeout: 60_000 }, async () => {
  const page = await browser.newPage({ viewport: { width: 375, height: 1000 }, serviceWorkers: 'block' })
  let available = false, sessionReads = 0
  const errors = [], mutations = []
  page.on('pageerror', failure => errors.push(failure.message))
  // Isolated readiness responses only. This scenario must never create a real
  // account or contact any configured clinical database behind the test URL.
  await page.route('**/api/platform/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      mutations.push(path); await route.abort('blockedbyclient'); return
    }
    const json = path === '/api/platform/session'
      ? (sessionReads++, { configured: available, user: null, csrf_token: null, bootstrap_required: available, registration_enabled: available, admin_setup_available: false })
      : path === '/api/platform/status'
        ? { configured: available, database: available ? 'ready' : 'not_configured', authentication: available ? 'bootstrap_required' : 'not_configured', schema_version: available ? 1 : null,
          storage: { configured: available, durable: false, mode: available ? 'temporary' : 'not_configured', automatic: available }, model: { ready: false, name: null, message: 'SYNTHETIC readiness fixture, no trained model' } }
        : {}
    await route.fulfill({ json, headers: { 'Cache-Control': 'no-store', 'X-HelpMinths-Test-Fixture': 'synthetic-only' } })
  })
  try {
    await page.goto(`${baseURL}/#settings`, { waitUntil: 'networkidle' })
    const login = page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true })
    assert.equal(await login.isDisabled(), true)
    assert.equal(await page.getByLabel('ชื่อบัญชี', { exact: true }).isDisabled(), true)
    await page.getByRole('button', { name: 'ตรวจสอบระบบอีกครั้ง', exact: true }).waitFor()
    const before = sessionReads
    available = true
    await page.getByRole('button', { name: 'ตรวจสอบระบบอีกครั้ง', exact: true }).click()
    await page.getByRole('heading', { name: 'ระบบบัญชีพร้อมใช้งาน', exact: true }).waitFor()
    assert.ok(sessionReads > before, 'A retry must ask the session API again, not enable client-side fake state')
    assert.equal(await login.isDisabled(), false)
    assert.equal(await page.getByLabel('ชื่อบัญชี', { exact: true }).isDisabled(), false)
    await page.getByRole('tab', { name: 'สมัครสมาชิก', exact: true }).click()
    assert.equal(await page.getByRole('button', { name: 'สร้างบัญชีและเข้าใช้งาน', exact: true }).isDisabled(), false, 'A missing first administrator must not disable ordinary registration')
    await page.locator('.account-temporary-storage').waitFor()
    assert.match(await page.locator('.account-temporary-storage').innerText(), /บัญชีและผลตรวจใช้งานได้.*ข้อมูลอาจหายเมื่อโฮสต์เริ่มใหม่หรือ deploy/s)
    assert.equal(await page.getByText('Not configured', { exact: true }).count(), 0)
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    assert.deepEqual(errors, [])
    assert.deepEqual(mutations, [])
  } finally { await page.close() }
})
