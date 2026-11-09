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

async function passwordVisibility(page, label, toggleLabel, value) {
  const input = page.getByLabel(label, { exact: true })
  await input.fill(value)
  assert.equal(await input.getAttribute('type'), 'password', `${label} starts hidden`)
  const show = page.getByRole('button', { name: `แสดง${toggleLabel}`, exact: true })
  assert.equal(await show.getAttribute('type'), 'button')
  assert.equal(await show.getAttribute('aria-controls'), await input.getAttribute('id'))
  assert.equal(await show.getAttribute('aria-pressed'), 'false')
  await show.click()
  assert.equal(await input.getAttribute('type'), 'text')
  assert.equal(await input.inputValue(), value)
  const hide = page.getByRole('button', { name: `ซ่อน${toggleLabel}`, exact: true })
  assert.equal(await hide.getAttribute('aria-pressed'), 'true')
  await hide.click()
  assert.equal(await input.getAttribute('type'), 'password')
  assert.equal(await input.inputValue(), value, 'Visibility changes preserve the entered password')
  assert.equal(await page.evaluate(() => window.passwordToggleSubmissions), 0, 'Visibility controls cannot submit the form')
}

test('Settings rechecks a stale unavailable session and enables working account forms with clean account guidance', { timeout: 60_000 }, async () => {
  const page = await browser.newPage({ viewport: { width: 375, height: 1000 }, serviceWorkers: 'block' })
  let available = false, sessionReads = 0
  const errors = [], mutations = []
  page.on('pageerror', failure => errors.push(failure.message))
  await page.addInitScript(() => {
    window.passwordToggleSubmissions = 0
    document.addEventListener('submit', () => { window.passwordToggleSubmissions += 1 }, true)
  })
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
    await passwordVisibility(page, 'รหัสผ่าน', 'รหัสผ่าน', 'login-synthetic-only')
    await page.getByRole('tab', { name: 'สมัครสมาชิก', exact: true }).click()
    assert.equal(await page.getByRole('button', { name: 'สมัครและส่งคำขออนุมัติ', exact: true }).isDisabled(), false, 'A missing first administrator must not disable approval requests')
    assert.equal(await page.getByRole('tab', { name: /^ผู้เชี่ยวชาญ/ }).count(), 1)
    const username = page.getByLabel('ชื่อบัญชี', { exact: true })
    const password = page.getByLabel('รหัสผ่าน', { exact: true })
    const confirmation = page.getByLabel('ยืนยันรหัสผ่าน', { exact: true })
    await passwordVisibility(page, 'รหัสผ่าน', 'รหัสผ่าน', 'abcd')
    await passwordVisibility(page, 'ยืนยันรหัสผ่าน', 'รหัสผ่านยืนยัน', 'abcd')
    await username.fill('q')
    assert.equal(await username.evaluate(input => input.checkValidity()), true, 'One-character usernames must not be blocked by HTML validation')
    await username.fill('Super Admin')
    assert.equal(await username.evaluate(input => input.checkValidity()), true, 'Internal spaces are valid in account names')
    const longUsername = 'readiness_' + 'x'.repeat(100)
    await username.fill(longUsername)
    assert.equal(await username.inputValue(), longUsername, 'The username input must not truncate names at the old64-character boundary')
    assert.equal(await username.evaluate(input => input.checkValidity()), true)
    assert.equal(await username.getAttribute('minlength'), null)
    assert.equal(await username.getAttribute('maxlength'), null)
    for (const candidate of ['abcd', '1234']) {
      await password.fill(candidate); await confirmation.fill(candidate)
      assert.equal(await password.evaluate(input => input.checkValidity()), true, 'Four characters are valid without a composition rule')
      assert.equal(await confirmation.evaluate(input => input.checkValidity()), true)
    }
    await password.fill('abc')
    assert.equal(await password.evaluate(input => input.checkValidity()), false, 'The requested four-character minimum remains enforced')
    assert.equal(await page.getByRole('heading', { name: 'สถานะระบบที่ตรวจได้', exact: true }).count(), 0)
    assert.doesNotMatch(await page.locator('body').innerText(), /บัญชีใหม่เป็นผู้ใช้ทั่วไป สิทธิ์ผู้เชี่ยวชาญต้องได้รับอนุมัติจากผู้ดูแล/)
    assert.equal(await page.locator('.account-temporary-storage').count(), 0)
    assert.doesNotMatch(await page.locator('body').innerText(), /บัญชีและผลตรวจใช้งานได้|ข้อมูลอาจหายเมื่อโฮสต์เริ่มใหม่หรือ deploy|พื้นที่จัดเก็บชั่วคราว/)
    assert.equal(await page.getByText('Not configured', { exact: true }).count(), 0)
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    assert.deepEqual(errors, [])
    assert.deepEqual(mutations, [])
  } finally { await page.close() }
})
