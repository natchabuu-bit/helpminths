import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { existsSync } from 'node:fs'
import { chromium } from 'playwright'

const baseURL = process.env.HELPMINTHS_NOTIFICATION_TEST_URL || 'http://127.0.0.1:8165'
let browser
before(async () => {
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), headless: true, args: ['--no-sandbox'] })
})
after(async () => browser?.close())

function identity(role = 'reviewer', verified = true, overrides = {}) {
  return { configured: true, csrf_token: 'synthetic-csrf', expert_verified_until: verified ? new Date(Date.now() + 15 * 60_000).toISOString() : null,
    user: { id: `synthetic-${role}`, username: `synthetic-${role}`, full_name: 'บัญชีทดสอบ', role, active: true, approval_status: 'approved', ...overrides }, registration_enabled: true }
}
function notice(index) {
  return { id: `n${index}`, analysis_id: `a${index}`, referral_id: `r${index}`, message_id: `m${index}`, sample_code: `SYNTHETIC_${index}`, kind: 'confirmed', comment: `คำตอบเฉพาะภาพ ${index}`, expert_name: 'สมมติ', created_at: '2026-11-10T10:00:00Z', read_at: null }
}
async function setup(account, { reducedMotion = 'no-preference', total = 3, notices = [], unread = notices.length } = {}) {
  const page = await browser.newPage({ viewport: { width: 375, height: 900 }, reducedMotion, serviceWorkers: 'block' })
  page.setDefaultTimeout(15_000)
  const state = { account, total, notices, unread, reads: [], queueRequests: [], ownerRequests: [], errors: [], holdQueue: null, holdPage: null }
  page.on('pageerror', error => state.errors.push(error.message))
  // All account data and mutations are local browser fixtures. No clinical API
  // or database is read or written by these UI-only checks.
  await page.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function(type, ...args) { return /webgl/i.test(type) ? null : get.call(this, type, ...args) }
  })
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname
    let json = {}
    if (path === '/api/platform/session') json = state.account
    else if (path === '/api/platform/status') json = { configured: true, model: { ready: false } }
    else if (path === '/api/platform/notifications') {
      const offset = Number(url.searchParams.get('offset') || 0)
      state.ownerRequests.push(offset)
      if (offset && state.holdPage) await state.holdPage
      json = { items: state.notices.slice(offset, offset + 20), unread_count: state.unread, total: state.notices.length, limit: 20, offset }
    } else if (/\/notifications\/[^/]+\/read$/.test(path)) {
      assert.equal(request.method(), 'POST')
      const id = path.split('/').at(-2), item = state.notices.find(item => item.id === id)
      state.reads.push(id)
      if (item && !item.read_at) { item.read_at = new Date().toISOString(); state.unread -= 1 }
      json = item
    } else if (path === '/api/platform/referrals' && url.searchParams.get('limit') === '1') {
      assert.equal(request.method(), 'GET')
      assert.equal(url.searchParams.get('scope'), 'expert')
      assert.equal(url.searchParams.get('state'), 'pending')
      state.queueRequests.push(request.url())
      if (state.holdQueue) await state.holdQueue
      json = { total: state.total, items: [], limit: 1, offset: 0 }
    } else if (path === '/api/platform/logout') {
      assert.equal(request.method(), 'POST')
      state.account = { configured: true, user: null, csrf_token: null, expert_verified_until: null }
    } else if (path === '/api/platform/expert-session') json = { verified: !!state.account.expert_verified_until, verified_until: state.account.expert_verified_until }
    else if (path.endsWith('/referral')) json = { referral: null }
    else if (/\/analyses\/a\d+$/.test(path)) json = { id: path.split('/').at(-1), owner_id: state.account.user?.id, sample_code: 'SYNTHETIC', status: 'completed', review_status: 'pending', detections: [], width: 1, height: 1, revision: 1 }
    else json = { items: [], total: 0 }
    assert.ok(['GET', 'HEAD', 'OPTIONS'].includes(request.method()) || /\/notifications\/[^/]+\/read$|\/logout$/.test(path), `Unexpected mutation ${request.method()} ${path}`)
    try { await route.fulfill({ json, headers: { 'Cache-Control': 'no-store', 'X-HelpMinths-Test-Fixture': 'synthetic-only' } }) } catch { /* an abort on logout is expected */ }
  })
  await page.goto(baseURL, { waitUntil: 'networkidle' })
  return { page, state, close: async () => { await page.close(); assert.deepEqual(state.errors, []) } }
}
async function waitAlert(page, expected) {
  await page.waitForFunction(expected => document.querySelector('.notification-trigger')?.classList.contains('has-alert') === expected, expected)
}

test('verified experts see a continuous queue alert, opening it navigates to the review queue', { timeout: 45_000 }, async () => {
  const { page, state, close } = await setup(identity())
  try {
    await waitAlert(page, true)
    const bell = page.getByRole('button', { name: /^การแจ้งเตือน/ })
    assert.match(await bell.getAttribute('aria-label'), /ภาพรอตรวจ 3 ภาพ/)
    const animation = await page.locator('.notification-bell-icon').evaluate(element => { const s = getComputedStyle(element); return [s.animationName, s.animationIterationCount, s.animationDuration] })
    assert.deepEqual(animation, ['notification-attention', 'infinite', '2.8s'])
    await bell.click()
    const popover = page.getByRole('region', { name: 'การแจ้งเตือนคำตอบผู้เชี่ยวชาญ', exact: true })
    assert.match(await popover.innerText(), /มีภาพรอตรวจ 3 ภาพ/)
    assert.deepEqual(state.reads, [], 'Opening the bell cannot mark owner replies read')
    await popover.getByRole('button', { name: 'เปิดภาพรอตรวจ', exact: true }).click()
    await page.waitForURL('**/#verification')
    assert.equal(await popover.count(), 0)
    assert.ok(state.queueRequests.length > 0)
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
  } finally { await close() }
})

test('reduced motion keeps the badge and accessible alert while stopping the animation', { timeout: 30_000 }, async () => {
  const { page, close } = await setup(identity('admin'), { reducedMotion: 'reduce', total: 2 })
  try {
    await waitAlert(page, true)
    assert.equal(await page.locator('.notification-bell-icon').evaluate(element => getComputedStyle(element).animationName), 'none')
    assert.equal(await page.locator('.notification-count').innerText(), '2')
    assert.match(await page.locator('.notification-announcement').innerText(), /ภาพรอตรวจ 2 ภาพ/)
  } finally { await close() }
})

test('unverified or ineligible accounts never request the expert queue', { timeout: 60_000 }, async () => {
  for (const account of [identity('reviewer', false), identity('lab'), identity('student'), identity('reviewer', true, { active: false }), identity('reviewer', true, { approval_status: 'pending' }), { configured: true, user: null, csrf_token: null }]) {
    const { page, state, close } = await setup(account)
    try {
      assert.deepEqual(state.queueRequests, [])
      assert.equal(await page.locator('.notification-trigger.has-alert').count(), 0)
      if (account.user?.role === 'reviewer' && account.user.active && account.user.approval_status === 'approved') {
        await page.getByRole('button', { name: /^การแจ้งเตือน/ }).click()
        await page.getByRole('button', { name: 'ยืนยันตัวตนผู้เชี่ยวชาญ', exact: true }).waitFor()
      }
    } finally { await close() }
  }
})

test('queue changes refresh immediately, lock clears counts, and expiry never shows cached protected totals', { timeout: 45_000 }, async () => {
  const { page, state, close } = await setup(identity())
  try {
    await waitAlert(page, true)
    state.total = 0
    await page.evaluate(() => window.dispatchEvent(new Event('helpminths:expert-queue-changed')))
    await waitAlert(page, false)
    state.total = 4
    await page.evaluate(() => window.dispatchEvent(new Event('helpminths:expert-queue-changed')))
    await waitAlert(page, true)
    await page.evaluate(() => window.dispatchEvent(new Event('helpminths:expert-session-locked')))
    await waitAlert(page, false)
    const requestCount = state.queueRequests.length
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await page.getByRole('button', { name: /^การแจ้งเตือน/ }).click()
    await page.getByRole('button', { name: 'ยืนยันตัวตนผู้เชี่ยวชาญ', exact: true }).waitFor()
    assert.equal(state.queueRequests.length, requestCount)
    assert.doesNotMatch(await page.locator('.notification-popover').innerText(), /มีภาพรอตรวจ 4/)
  } finally { await close() }
  const expiring = identity(); expiring.expert_verified_until = new Date(Date.now() + 3000).toISOString()
  const expired = await setup(expiring)
  try {
    await waitAlert(expired.page, true)
    await waitAlert(expired.page, false)
    assert.equal(await expired.page.locator('.notification-count').count(), 0)
  } finally { await expired.close() }
})

test('owner replies remain animated across pagination and only the selected case is marked read', { timeout: 45_000 }, async () => {
  const { page, state, close } = await setup(identity('lab', false), { total: 0, notices: Array.from({ length: 21 }, (_, index) => notice(index + 1)), unread: 2 })
  let release
  try {
    await waitAlert(page, true)
    await page.getByRole('button', { name: /^การแจ้งเตือน/ }).click()
    assert.deepEqual(state.reads, [])
    state.holdPage = new Promise(resolve => { release = resolve })
    await page.locator('.notification-popover footer').getByRole('button', { name: 'ถัดไป' }).click()
    await page.waitForFunction(() => document.querySelector('.notification-empty')?.textContent.includes('กำลังอ่าน'))
    assert.equal(await page.locator('.notification-trigger.has-alert').count(), 1, 'Changing a page must not make an unread alert disappear')
    assert.equal(await page.locator('.notification-count').innerText(), '2')
    release(); state.holdPage = null
    await page.locator('.notification-item').filter({ hasText: 'SYNTHETIC_21' }).click()
    await page.waitForFunction(() => document.querySelector('.notification-count')?.textContent === '1')
    assert.deepEqual(state.reads, ['n21'])
    assert.equal(new URL(page.url()).hash, '#verification')
    assert.deepEqual(state.queueRequests, [], 'Owner alerts do not grant access to the expert queue')
  } finally { release?.(); await close() }
})

test('logout aborts pending queue refreshes and cannot restore an old account alert', { timeout: 45_000 }, async () => {
  const { page, state, close } = await setup(identity())
  let release
  try {
    await waitAlert(page, true)
    state.holdQueue = new Promise(resolve => { release = resolve })
    const refreshing = page.waitForRequest(request => new URL(request.url()).pathname === '/api/platform/referrals' && new URL(request.url()).searchParams.get('limit') === '1')
    await page.evaluate(() => window.dispatchEvent(new Event('helpminths:expert-queue-changed')))
    await refreshing
    await page.getByRole('button', { name: 'บัญชีของฉัน', exact: true }).click()
    await page.getByRole('region', { name: 'เมนูบัญชี', exact: true }).getByRole('button', { name: 'ออกจากระบบ', exact: true }).click()
    await page.waitForFunction(() => !document.querySelector('.notification-menu'))
    release(); state.holdQueue = null
    assert.equal(await page.locator('.notification-trigger, .notification-count, .notification-popover').count(), 0)
  } finally { release?.(); await close() }
})
