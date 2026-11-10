import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import postcss from 'postcss'
import { chromium } from 'playwright'

const baseURL = process.env.HELPMINTHS_TEST_URL || 'http://127.0.0.1:8153'
const cssDirectory = resolve('src/styles')
const literalColor = /#[\da-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\(/i
const namedColor = /\b(?:white|black|red|blue|purple|coral|aqua|cyan|navy|magenta|orange|yellow|green|teal|pink|gray|grey|silver|maroon|lime|olive|fuchsia)\b/i
const colorProperty = /(?:color$|^background|^border|^outline|^fill$|^stroke$|shadow$|^filter$)/i
const spacingProperty = /^(?:padding|margin)(?:-(?:top|right|bottom|left|inline(?:-start|-end)?|block(?:-start|-end)?))?$|^(?:(?:row|column)-)?gap$/
let browser
const auditResults = []

test('one token source supplies colors, typography, spacing and corners without decorative effects', async () => {
  const files = (await readdir(cssDirectory)).filter(name => name.endsWith('.css'))
  assert.ok(files.includes('tokens.css'), 'The shared design tokens must have one source')
  assert.ok(files.length < 26, `Overlapping styles must be consolidated from the previous 26 files (found ${files.length})`)
  const failures = []
  for (const file of files) {
    const root = postcss.parse(await readFile(resolve(cssDirectory, file), 'utf8'))
    root.walkDecls(declaration => {
      if (file !== 'tokens.css' && literalColor.test(declaration.value)) failures.push(`${file}: ${declaration.prop}: ${declaration.value}`)
      const withoutVariableNames = declaration.value.replace(/var\(\s*--[\w-]+\s*(?=[,)])/g, 'var(')
      if (file !== 'tokens.css' && colorProperty.test(declaration.prop) && namedColor.test(withoutVariableNames)) failures.push(`${file}: literal named color ${declaration.prop}: ${declaration.value}`)
      if (/gradient\(/i.test(declaration.value) || /(?:^|-)backdrop-filter$/i.test(declaration.prop)) failures.push(`${file}: decorative effect ${declaration.prop}`)
      if (file !== 'tokens.css' && spacingProperty.test(declaration.prop) && /-?\d*\.?\d+px\b/.test(declaration.value)) failures.push(`${file}: spacing must reference tokens: ${declaration.prop}: ${declaration.value}`)
      if (file !== 'tokens.css' && /border(?:-(?:top|bottom)-(?:left|right))?-radius$/.test(declaration.prop) && /\d*\.?\d+(?:px|rem|em|%)(?=$|[\s),])/.test(declaration.value)) failures.push(`${file}: corners must reference tokens: ${declaration.prop}: ${declaration.value}`)
    })
  }
  assert.deepEqual(failures, [], 'Components must use shared token colors and flat surfaces')
  const tokens = postcss.parse(await readFile(resolve(cssDirectory, 'tokens.css'), 'utf8'))
  const definitions = new Map()
  tokens.walkDecls(declaration => {
    if (declaration.parent.selector === ':root') definitions.set(declaration.prop, declaration.value)
  })
  assert.equal(definitions.get('--color-accent')?.toLowerCase(), '#0d786e')
  assert.match(definitions.get('--font-family') || '', /Noto Sans Thai/)
  assert.equal(definitions.get('--radius-sm'), '8px')
  assert.equal(definitions.get('--radius-md'), '12px')
  assert.equal(definitions.get('--space-1'), '8px')
  assert.equal(definitions.get('--space-2'), '16px')
  assert.equal(definitions.get('--space-3'), '24px')
  for (const [name, value] of definitions) if (/^--space-\d+$/.test(name)) assert.equal(value, Number(name.slice(8)) ? `${Number(name.slice(8)) * 8}px` : '0', `${name} must follow the 8px spacing scale`)
})

before(async () => {
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(baseURL).hostname), 'Design fixtures must run only against localhost')
  if (process.env.HELPMINTHS_DESIGN_AUDIT_OUTPUT_DIR) await mkdir(process.env.HELPMINTHS_DESIGN_AUDIT_OUTPUT_DIR, { recursive: true })
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), headless: true, args: ['--no-sandbox'] })
})
after(async () => {
  try { await writeFile(process.env.HELPMINTHS_DESIGN_AUDIT_OUTPUT || '/tmp/helpminths-phase5-design-audit.json', JSON.stringify(auditResults, null, 2)) }
  finally { await browser?.close() }
})

const stamp = '2026-01-01T00:00:00Z'
function user(role, overrides = {}) {
  return { id: `SYNTHETIC-DESIGN-${role}`, username: `design-${role}`, full_name: 'ผู้ทดสอบ ดีไซน์', workplace: 'สถานที่จำลอง', affiliation: 'ข้อมูลทดสอบ', phone: '0812345678', role, active: true, created_at: stamp, approval_status: 'approved', requested_role: role, is_super_admin: role === 'admin', approved_by: null, approved_at: null, ...overrides }
}
function session(role) {
  return { configured: true, csrf_token: role ? 'SYNTHETIC-DESIGN-CSRF' : null, bootstrap_required: false, registration_enabled: true, admin_setup_available: false, owner_username: 'Super Admin', user: role ? user(role) : null }
}
const paged = items => ({ items, total: items.length, limit: 20, offset: 0 })
const source = { provider: 'google_sheets', spreadsheet_id: 'SYNTHETIC-DESIGN-FIXTURE', url: 'https://docs.google.com/spreadsheets/d/SYNTHETIC-DESIGN-FIXTURE/edit', worksheet: 'ข้อมูลจำลอง' }
function survey() {
  return { status: 'ready', source, refresh_seconds: 30, fetched_at: stamp, last_attempt_at: stamp, error: null, warnings: [], data: {
    row_count: 2, tested_count: 100, infected_count: 14, infection_rate_percent: 14,
    metrics: [['total_students', 150], ['tested_count', 100], ['coverage_percent', 100 / 150 * 100], ['infected_count', 14], ['infection_rate_percent', 14], ['multiple_infections_count', 3], ['school_count', 2], ['province_count', 2]].map(([key, value]) => ({ key, value, label: key, unit: key.includes('percent') ? '%' : 'คน' })),
    trend: [], statuses: [], coverage: { dated_rows: 0, status_rows: 0 },
    by_province: [{ province: 'ตาก', records: 1, total_students: 100, tested_count: 60, infected_count: 6 }, { province: 'พิษณุโลก', records: 1, total_students: 50, tested_count: 40, infected_count: 8 }],
    by_parasite: [{ parasite: 'Hookworm', count: 9, unit: 'people' }, { parasite: 'Ascaris lumbricoides', count: 7, unit: 'people' }], available_years: [], available_provinces: ['ตาก', 'พิษณุโลก'],
    history: { years: [2568, 2569], source: { file_name: 'SYNTHETIC-design-history.xlsx', verification_status: 'synthetic' },
      dimensions: [{ key: 'province', label: 'จังหวัดจำลอง', series: [
        { key: 'total', name: 'ยอดรวมจำลอง', is_total: true, coverage_percent: [60, 90], infection_rate_percent: [0, 20] },
        { key: 'fixture-area', name: 'พื้นที่จำลอง', coverage_percent: [40, 80], infection_rate_percent: [5, 10] },
      ] }], species_series: [{ key: 'hookworm', name: 'ปากขอ', positive_share_percent: [15, 75] }], quality: { issues: [] }, scope_note: 'ข้อมูลสังเคราะห์สำหรับตรวจดีไซน์เท่านั้น' },
  } }
}
function clinicalOverview() {
  return { sample_size: 0, scope: 'mine', summary: { total_analyses: 0, successful_analyses: 0, failed_analyses: 0, total_detected_objects: 0, confirmed_objects: 0, uncertain_objects: 0, pending_expert_reviews: 0, completed_expert_reviews: 0, images_failing_quality: 0, average_inference_ms: null }, charts: { analyses_by_date: [], predicted_classes: [], confirmed_classes: [], review_statuses: [], quality_statuses: [], latency_by_date: [], review_errors: [] } }
}
const archiveAccount = { id: 'SYNTHETIC-DESIGN-lab', username: 'design-lab', full_name: 'ผู้ทดสอบ ดีไซน์', image_count: 1 }
const archiveImage = { id: 'SYNTHETIC-DESIGN-archive', owner_id: archiveAccount.id, owner: archiveAccount, created_at: stamp, examined_at: stamp, examined_date: '2026-01-01', source: 'analysis', status: 'completed', sample_code: 'ภาพทดสอบดีไซน์', analysis_id: 'SYNTHETIC-DESIGN-analysis', referral_id: null, attachment_id: null, width: 512, height: 384, image_url: null, image_available: false, operational_deleted: false, review_status: 'verified' }

// These read-only synthetic responses are UI style fixtures. Every mutation is
// blocked before it could reach an account, source spreadsheet or image store.
async function designPage(role, width) {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce', serviceWorkers: 'block' })
  const page = await context.newPage(), writes = [], errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function(type, ...args) { return ['webgl', 'webgl2', 'experimental-webgl'].includes(type) ? null : original.call(this, type, ...args) }
  })
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) { writes.push(`${request.method()} ${url.pathname}`); await route.abort('blockedbyclient'); return }
    if (url.origin !== new URL(baseURL).origin) { await route.abort('blockedbyclient'); return }
    if (!url.pathname.startsWith('/api/')) { await route.continue(); return }
    const path = url.pathname.replace(/^\/api\/platform/, '')
    let json = paged([])
    if (url.pathname === '/api/health') json = { status: 'ok', model_ready: false, message: 'SYNTHETIC DESIGN FIXTURE - no trained model' }
    else if (path === '/session') json = session(role)
    else if (path === '/status') json = { configured: true, authentication: 'ready', storage: { configured: true, durable: false }, model: { ready: false } }
    else if (path === '/owner-bootstrap/status') json = { configured: true, ready: true, username: 'Super Admin', message: '' }
    else if (path === '/notifications') json = { ...paged([]), unread_count: 0 }
    else if (path === '/quality/config') json = { inference_confidence: .15, review_confidence_threshold: .5 }
    else if (path === '/expert-session') json = { verified: false, verified_until: null }
    else if (path === '/operations/status') json = { configured: true, source, refresh_seconds: 30, access: 'public_aggregates', mapping_configured: true }
    else if (path === '/operations/dashboard') json = survey()
    else if (path === '/dashboard') json = clinicalOverview()
    else if (path === '/history/days') json = { items: [], total_days: 0, total_analyses: 0, timezone: 'Asia/Bangkok' }
    else if (path === '/models') json = { items: [], configured_model: { ready: false, name: null, version: null } }
    else if (path === '/evaluation') json = { status: 'unavailable', message: 'SYNTHETIC DESIGN FIXTURE - no clinical accuracy claim', sample_size: 0, metrics: null }
    else if (path === '/users') {
      const approval = url.searchParams.get('approval_status') || 'approved'
      json = paged([user('lab', { id: `SYNTHETIC-DESIGN-${approval}`, username: `design-${approval}`, approval_status: approval, active: approval === 'approved' })])
    } else if (path === '/admin/image-archive/accounts') json = { items: [archiveAccount], backfill_remaining: 0 }
    else if (path === '/admin/image-archive') json = { ...paged([archiveImage]), backfill_remaining: 0 }
    await route.fulfill({ json, headers: { 'Cache-Control': 'no-store', 'X-HelpMinths-Test-Fixture': 'synthetic-design-read-only' } })
  })
  let number = 0
  const open = async (route = 'home', admin = false) => {
    await page.goto(`${baseURL}/${admin ? 'admin/' : ''}?design-case=${++number}#${route}`, { waitUntil: 'networkidle' })
    await page.evaluate(() => document.fonts.ready)
  }
  return { page, open, finish: async () => { await context.close(); assert.deepEqual(writes, [], 'Design audits must not change accounts or records'); assert.deepEqual(errors, [], 'Audited screens must render without errors') } }
}

// Inspect rendered HTML text, values and placeholders against the composited
// ancestor surfaces. SVG/canvas scientific artwork is not an HTML text palette;
// inactive controls are the WCAG contrast exception, not a pass for active text.
async function audit(page, label) {
  const result = await page.evaluate(() => {
    const failures = [], dedupe = new Set(), cache = new Map()
    const context = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
    const rgba = value => {
      if (cache.has(value)) return cache.get(value)
      context.clearRect(0, 0, 1, 1); context.fillStyle = value; context.fillRect(0, 0, 1, 1)
      const bytes = context.getImageData(0, 0, 1, 1).data
      const color = [bytes[0], bytes[1], bytes[2], bytes[3] / 255]
      cache.set(value, color); return color
    }
    const blend = (top, bottom) => {
      const alpha = top[3] + bottom[3] * (1 - top[3])
      return alpha ? [...[0, 1, 2].map(index => (top[index] * top[3] + bottom[index] * bottom[3] * (1 - top[3])) / alpha), alpha] : [0, 0, 0, 0]
    }
    const luminance = color => color.slice(0, 3).map(value => { const v = value / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4 }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0)
    const ratio = (one, two) => { const a = luminance(one), b = luminance(two); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05) }
    const selector = element => `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}${[...element.classList].slice(0, 3).map(value => `.${value}`).join('')}`
    const rendered = (element, includeDisabled = false) => {
      if (!element || element.namespaceURI !== 'http://www.w3.org/1999/xhtml' || !element.getClientRects().length) return false
      const style = getComputedStyle(element)
      if (style.display === 'none' || style.visibility !== 'visible' || (!includeDisabled && element.closest('button:disabled,input:disabled,select:disabled,textarea:disabled,[aria-disabled="true"]'))) return false
      if (style.clipPath !== 'none' || style.clip !== 'auto') return false
      let opacity = 1
      for (let node = element; node; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity)
      return opacity > .01
    }
    const pixels = (element, textLayer) => {
      const chain = []; for (let node = element; node; node = node.parentElement) chain.unshift(node)
      let group = textLayer || [0, 0, 0, 0]
      // CSS opacity applies to each fully composited group, including its
      // descendants; it must not be applied separately to every ancestor fill.
      for (let index = chain.length - 1; index >= 0; index--) {
        const style = getComputedStyle(chain[index])
        group = blend(group, rgba(style.backgroundColor))
        group[3] *= Number(style.opacity)
      }
      return blend(group, [255, 255, 255, 1])
    }
    let textCount = 0, controlCount = 0, cardCount = 0, minimumContrast = Infinity, minimumHeight = Infinity
    const checkText = (element, text, override = null) => {
      if (!text.trim() || !rendered(element)) return
      const style = getComputedStyle(element), background = pixels(element)
      const color = [...rgba(override?.color || style.color)]; color[3] *= Number(override?.opacity ?? 1)
      const foreground = pixels(element, color), contrast = ratio(foreground, background)
      minimumContrast = Math.min(minimumContrast, contrast); textCount++
      if (contrast + .005 < 4.5) {
        const key = `${selector(element)}|${text.trim().slice(0, 50)}|${color}|${background}`
        if (!dedupe.has(key)) { dedupe.add(key); failures.push({ kind: 'contrast', element: selector(element), text: text.trim().slice(0, 90), ratio: +contrast.toFixed(2), foreground: foreground.map(value => +value.toFixed(1)), background: background.map(value => +value.toFixed(1)) }) }
      }
      if (!style.fontFamily.includes('Noto Sans Thai')) {
        const key = `font:${selector(element)}:${style.fontFamily}`
        if (!dedupe.has(key)) { dedupe.add(key); failures.push({ kind: 'font', element: selector(element), text: text.trim().slice(0, 60), family: style.fontFamily }) }
      }
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      const node = walker.currentNode, parent = node.parentElement
      if (!parent || parent.closest('script,style,svg,canvas,option,textarea')) continue
      const range = document.createRange(); range.selectNodeContents(node)
      if (![...range.getClientRects()].some(box => box.width > 1 && box.height > 1)) continue
      checkText(parent, node.textContent || '')
    }
    for (const element of document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]),select,textarea')) {
      const value = element.tagName === 'SELECT' ? element.selectedOptions[0]?.textContent || '' : element.value
      if (value) checkText(element, element.type === 'password' ? 'รหัสผ่าน' : value)
      else if (element.placeholder) { const placeholder = getComputedStyle(element, '::placeholder'); checkText(element, element.placeholder, { color: placeholder.color, opacity: placeholder.opacity }) }
    }
    for (const element of document.querySelectorAll('button,[role=button],input[type=button],input[type=submit],a[class*=button],summary')) {
      if (!rendered(element, true)) continue
      const box = element.getBoundingClientRect(); controlCount++; minimumHeight = Math.min(minimumHeight, box.height)
      if (box.height + .1 < 44) failures.push({ kind: 'target', element: selector(element), text: element.innerText?.trim().slice(0, 70) || element.getAttribute('aria-label'), height: +box.height.toFixed(2) })
    }
    for (const element of document.querySelectorAll('.field-overview,.workflow-card,.specimen-card,.platform-card,.scan-viewer-card,.scan-results-card,.atlas-workspace,.feedback-card,.admin-archive-card')) {
      if (!rendered(element)) continue
      cardCount++
      const style = getComputedStyle(element), radii = ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius'].map(key => parseFloat(style[key]))
      if (radii.some(value => ![8, 12].includes(value))) failures.push({ kind: 'radius', element: selector(element), radii })
    }
    return { failures, textCount, controlCount, cardCount, minimumContrast: +minimumContrast.toFixed(2), minimumHeight: +minimumHeight.toFixed(2), font: getComputedStyle(document.body).fontFamily, fontLoaded: [...document.fonts].some(face => face.family.includes('Noto Sans Thai') && face.status === 'loaded') && document.fonts.check('400 16px "Noto Sans Thai Variable"', 'ไข่พยาธิ'), colorScheme: getComputedStyle(document.documentElement).colorScheme }
  })
  assert.ok(result.textCount >= 8, `${label} must actually render auditable text`)
  assert.match(result.font, /Noto Sans Thai/, `${label} must use the loaded Thai font`)
  assert.equal(result.fontLoaded, true, `${label} must actually load the bundled Noto font`)
  console.log(`${label}: ${result.textCount} text runs, ${result.controlCount} controls, ${result.cardCount} cards, min contrast ${result.minimumContrast}:1, min target ${result.minimumHeight}px`)
  const report = { label, ...result }
  auditResults.push(report)
  if (process.env.HELPMINTHS_DESIGN_AUDIT_OUTPUT_DIR) await writeFile(resolve(process.env.HELPMINTHS_DESIGN_AUDIT_OUTPUT_DIR, `${label.replace(/[^A-Za-z0-9_-]+/g, '-')}.json`), JSON.stringify(report, null, 2))
  return report
}
function assertAudits(results) {
  const failures = results.flatMap(result => result.failures.map(failure => ({ screen: result.label, ...failure })))
  assert.deepEqual(failures, [], `Every active HTML text sample must reach 4.5:1 and every visible action 44px; ${results.reduce((sum, result) => sum + result.textCount, 0)} text runs audited`)
}

test('public screens keep readable text and 44px controls on phones and desktops', { timeout: 180_000 }, async () => {
  const results = []
  for (const width of [375, 1440]) {
    const fixture = await designPage(null, width), { page, open } = fixture
    try {
      await open(); results.push(await audit(page, `${width} guest home`))
      await page.getByRole('button', { name: 'คู่มือการใช้งาน', exact: true }).click()
      results.push(await audit(page, `${width} help modal`))
      await page.keyboard.press('Escape')
      await open('scan'); await page.locator('.scan-status-line').filter({ hasText: 'ยังไม่เชื่อมต่อโมเดล AI' }).waitFor()
      results.push(await audit(page, `${width} scan unavailable`))
      await page.getByRole('button', { name: 'ดูตัวอย่างสาธิต', exact: true }).click(); await page.locator('.scan-demo-banner').waitFor()
      results.push(await audit(page, `${width} scan demo`))
      await open('atlas'); await page.locator('.atlas-svg-fallback').waitFor()
      results.push(await audit(page, `${width} Atlas`))
      await page.getByLabel('ค้นหาชื่อพยาธิ').fill('Strongyloides'); await page.locator('.atlas-species-item').click()
      await page.locator('.strongyloides-guide').waitFor()
      results.push(await audit(page, `${width} Strongyloides guide`))
      await open('evaluation'); await page.getByTestId('evaluation-page').waitFor()
      results.push(await audit(page, `${width} SUS`))
      await open('settings'); await page.getByRole('tab', { name: 'สมัครสมาชิก', exact: true }).click()
      results.push(await audit(page, `${width} registration`))
    } finally { await fixture.finish() }
  }
  assertAudits(results)
})

test('member screens and overlays share the accessible design tokens', { timeout: 180_000 }, async () => {
  const results = []
  for (const width of [375, 1440]) {
    const fixture = await designPage('lab', width), { page, open } = fixture
    try {
      await open('dashboard'); await page.getByTestId('health-survey-dashboard').waitFor(); await page.getByTestId('survey-positive').filter({ hasText: '14' }).waitFor()
      results.push(await audit(page, `${width} disease statistics`))
      await open('settings'); await page.getByRole('heading', { name: 'บัญชีปัจจุบัน', exact: true }).waitFor()
      results.push(await audit(page, `${width} member account`))
      await page.getByRole('button', { name: 'บัญชีของฉัน', exact: true }).click(); await page.getByRole('region', { name: 'เมนูบัญชี', exact: true }).waitFor()
      results.push(await audit(page, `${width} avatar menu`))
      await open('work'); await page.getByRole('heading', { name: 'งานของฉัน', exact: true }).waitFor()
      results.push(await audit(page, `${width} saved work`))
      await open('reports'); await page.getByRole('heading', { name: 'รายงานและส่งออกข้อมูล', exact: true }).waitFor()
      await page.locator('summary').filter({ hasText: 'ภาพรวมการดำเนินงาน' }).click()
      await page.getByRole('heading', { name: 'ภาพรวมระบบวิเคราะห์', exact: true }).waitFor()
      results.push(await audit(page, `${width} reports and overview`))
      await open('performance'); await page.getByRole('heading', { name: 'ประเมินโมเดล', exact: true }).waitFor()
      results.push(await audit(page, `${width} model evaluation`))
    } finally { await fixture.finish() }
  }
  assertAudits(results)
})

test('dark backoffice remains readable for login, approval actions and the image archive', { timeout: 180_000 }, async () => {
  const results = []
  for (const width of [375, 1440]) {
    const guest = await designPage(null, width)
    try {
      await guest.open('', true); await guest.page.getByRole('heading', { name: 'เข้าสู่ระบบ Super Admin', exact: true }).waitFor()
      const result = await audit(guest.page, `${width} dark admin login`); assert.equal(result.colorScheme, 'dark'); results.push(result)
    } finally { await guest.finish() }
    const owner = await designPage('admin', width), { page, open } = owner
    try {
      await open('', true); await page.getByRole('heading', { name: 'อนุมัติคำขอและจัดการสมาชิก', exact: true }).waitFor(); await page.locator('.platform-user-entry').waitFor()
      results.push(await audit(page, `${width} dark pending approvals`))
      await page.getByRole('group', { name: 'กรองสมาชิก', exact: true }).getByRole('button', { name: 'สมาชิกทั้งหมด', exact: true }).click()
      await page.locator('.platform-user-entry').filter({ hasText: 'design-approved' }).waitFor()
      results.push(await audit(page, `${width} dark approved member`))
      await open('archive', true); await page.getByRole('heading', { name: 'คลังภาพและผลตรวจ', exact: true }).waitFor()
      results.push(await audit(page, `${width} dark image archive`))
    } finally { await owner.finish() }
  }
  assertAudits(results)
})
