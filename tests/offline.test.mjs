import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

// Run against a production build: development mode does not install the worker.
const baseURL = process.env.BASE_URL || process.env.HELPMINTHS_TEST_URL || 'http://127.0.0.1:4173'
const distDirectory = resolve(fileURLToPath(new URL('../dist/', import.meta.url)))
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined)
const fixtureImage = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64')
let browser

before(async () => {
  const response = await fetch(new URL('/sw.js', baseURL))
  assert.equal(response.status, 200, 'Start a production server before running test:offline')
  assert.match(response.headers.get('content-type') || '', /javascript/, 'test:offline requires the production /sw.js, not the Vite development server')
  browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
})
after(async () => browser?.close())

async function builtAssetPaths(directory = distDirectory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(entries.map(async entry => {
    const location = resolve(directory, entry.name)
    return entry.isDirectory() ? builtAssetPaths(location) : [`/${location.slice(distDirectory.length + 1).split(sep).join('/')}`]
  }))
  return files.flat()
}

async function waitForController(page) {
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 30_000 })
}

async function workerStatus(page) {
  return page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration()
    const worker = navigator.serviceWorker.controller || registration?.active
    if (!worker) return null
    return new Promise((resolve, reject) => {
      const channel = new MessageChannel()
      const timer = setTimeout(() => reject(new Error('The active worker did not answer the offline status query')), 5000)
      channel.port1.onmessage = event => { clearTimeout(timer); resolve(event.data) }
      worker.postMessage({ type: 'HELPMINTHS_OFFLINE_STATUS' }, [channel.port2])
    })
  })
}

async function waitForReady(page) {
  await waitForController(page)
  await page.waitForFunction(async () => {
    const registration = await navigator.serviceWorker.getRegistration()
    if (!registration?.active) return false
    return new Promise(resolve => {
      const channel = new MessageChannel()
      const timer = setTimeout(() => resolve(false), 2000)
      channel.port1.onmessage = event => { clearTimeout(timer); resolve(event.data?.ready === true) }
      registration.active.postMessage({ type: 'HELPMINTHS_OFFLINE_STATUS' }, [channel.port2])
    })
  }, null, { timeout: 30_000 })
  return workerStatus(page)
}

async function cachedPaths(page) {
  return page.evaluate(async () => {
    const all = []
    for (const name of await caches.keys()) {
      const cache = await caches.open(name)
      all.push(...(await cache.keys()).map(request => new URL(request.url).pathname))
    }
    return [...new Set(all)].sort()
  })
}

function nav(page, label) {
  return page.locator('.sidebar .nav-item').filter({ hasText: label })
}

// This scenario opens every reference and developmental stage in software WebGL.
// Keep the individual Playwright timeouts; allow the complete tour to finish on CPU renderers.
test('a first home visit prepares unvisited Atlas, fonts, local images and explicitly labelled demo for offline use', { timeout: 180_000 }, async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'allow', acceptDownloads: true })
  const page = await context.newPage()
  const pageErrors = []
  const analysisRequests = []
  const successfulAnalysisResponses = []
  page.on('pageerror', error => pageErrors.push(error.message))
  context.on('request', request => {
    if (new URL(request.url()).pathname === '/api/analyze' && request.method() === 'POST') analysisRequests.push(request.url())
  })
  context.on('response', response => {
    if (new URL(response.url()).pathname === '/api/analyze' && response.request().method() === 'POST' && response.ok()) successfulAnalysisResponses.push(response.status())
  })
  try {
    await page.goto(baseURL, { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: 'มองเห็น เข้าใจ เรียนรู้' }).waitFor()
    assert.equal(await page.locator('.atlas-model-stage').count(), 0, 'Atlas must not be opened online before this offline check')
    const initial = await waitForReady(page)
    assert.equal(initial.ready, true)
    await page.locator('.offline-panel strong').filter({ hasText: /^พร้อมใช้งานออฟไลน์$/ }).waitFor()

    const before = await cachedPaths(page)
    const allBuiltAssets = await builtAssetPaths()
    const requiredAssets = allBuiltAssets.filter(path => path.startsWith('/assets/'))
    const photoPaths = allBuiltAssets.filter(path => /^\/atlas\/photos\/.+\.jpg$/.test(path))
    assert.equal(photoPaths.length, 11, 'The offline package must include all eleven licensed original micrographs')
    for (const photo of photoPaths) assert.ok(before.includes(photo), `The first home visit did not precache an unvisited Atlas photograph: ${photo}`)
    assert.ok(requiredAssets.some(path => /\/Atlas-.*\.js$/.test(path)), 'The production build must contain a lazy Atlas chunk')
    assert.ok(requiredAssets.some(path => /\.woff2$/.test(path)), 'Bundled fonts must be available in the offline build')
    for (const asset of requiredAssets) assert.ok(before.includes(asset), `Required built asset was not precached: ${asset}`)
    assert.equal(before.some(path => path.startsWith('/api/')), false, 'API responses must not be in the static cache')

    // An explicit online health request must still bypass the worker cache.
    await page.evaluate(() => fetch('/api/health').then(response => response.text()).catch(() => null))
    assert.equal((await cachedPaths(page)).some(path => path.startsWith('/api/')), false)

    await context.setOffline(true)
    await page.waitForFunction(() => navigator.onLine === false)
    const offlineReload = await page.reload({ waitUntil: 'domcontentloaded' })
    assert.equal(offlineReload.status(), 200)
    assert.equal(offlineReload.fromServiceWorker(), true, 'Offline navigation must come from the installed service worker')
    await page.locator('.offline-panel strong').filter({ hasText: /^กำลังใช้งานออฟไลน์$/ }).waitFor()
    await nav(page, 'Atlas 3D').click()
    await page.locator('.atlas-model-stage canvas').waitFor()
    assert.equal(await page.locator('.atlas-species-item').count(), 12)
    const offlinePhotoNames = ['Ascaris lumbricoides', 'Trichuris trichiura', 'Hookworm', 'Taenia spp.', 'Enterobius vermicularis', 'Hymenolepis nana', 'Hymenolepis diminuta', 'Fasciolopsis buski', 'Strongyloides stercoralis']
    const decodedPhotos = new Set()
    for (const name of offlinePhotoNames) {
      await page.getByLabel('ค้นหาชื่อพยาธิ').fill(name)
      await page.locator('.atlas-species-item').click()
      const count = ['Ascaris lumbricoides', 'Strongyloides stercoralis'].includes(name) ? 2 : 1
      for (let index = 0; index < count; index++) {
        await page.waitForFunction(() => { const image = document.querySelector('.atlas-real-photo'); return image?.complete && image.naturalWidth > 0 })
        decodedPhotos.add(await page.locator('.atlas-real-photo').getAttribute('src'))
        assert.match(await page.locator('.atlas-photo-attribution').innerText(), /Thomas P\. Buckelew.*CC BY-NC/s)
        if (index + 1 < count) {
          if (name === 'Ascaris lumbricoides') await page.locator('.ascaris-stage-option[data-stage="embryonated"]').click()
          else await page.getByRole('button', { name: 'ภาพจริงถัดไป' }).click()
        }
      }
      if (name === 'Hymenolepis nana') {
        await page.locator('.atlas-structure-list button').filter({ hasText: 'เส้นใยขั้ว' }).click()
        assert.equal(await page.getByRole('button', { name: 'ภาพตัดภายใน', exact: true }).getAttribute('aria-pressed'), 'true')
        assert.match(await page.locator('.atlas-structure-description').innerText(), /polar filaments/)
        assert.ok(await page.locator('.atlas-structure-sources a').count() > 0, 'Feature explanations and their citation labels must load offline')
        await page.getByRole('button', { name: 'ขยายภาพจริง', exact: true }).click()
        assert.equal(Number(await page.getByRole('slider', { name: 'ซูมภาพจริง', exact: true }).inputValue()), 1.25)
      }
      if (name === 'Strongyloides stercoralis') {
        assert.equal(await page.locator('.atlas-structure-list button').filter({ hasText: 'Genital primordium' }).getAttribute('aria-pressed'), 'true', 'The first offline larval visit must select its prominent genital primordium')
        assert.match(await page.locator('.atlas-structure-description').innerText(), /genital primordium/i)
        assert.ok(await page.locator('.atlas-structure-sources a').count() > 0)
        assert.match(await page.locator('.strongyloides-comparison').innerText(), /rhabditiform.*Strongyloides.*Hookworm/s)
        assert.match(await page.locator('.atlas-photo-panel .atlas-pane-title h3').innerText(), /ตัวอ่อน/)
        assert.equal(await page.locator('.atlas-photo-feature.is-supported').count(), 0, 'Offline photo display must not invent a resolved genital primordium')
        await page.getByRole('button', { name: 'ขยายดู Genital primordium', exact: true }).click()
        assert.equal(Number(await page.getByRole('slider', { name: 'ซูมโมเดล 3D' }).inputValue()), 1.6)
        assert.equal(await page.locator('.strongyloides-guide-figure svg').getAttribute('data-selected-structure'), 'genital-primordium')
      }
    }
    assert.deepEqual([...decodedPhotos].sort(), photoPaths.sort(), 'All previously unvisited photographs must decode while fully offline')
    await page.getByLabel('ค้นหาชื่อพยาธิ').fill('Ascaris')
    await page.locator('.atlas-species-item').click()
    for (const stage of ['unfertilized', 'fertilized', 'cleavage', 'embryonated']) {
      const stageButton = page.locator(`.ascaris-stage-option[data-stage="${stage}"]`)
      await stageButton.click()
      assert.equal(await stageButton.getAttribute('aria-pressed'), 'true')
      const diagram = page.locator(`.ascaris-stage-figure svg[data-ascaris-stage="${stage}"]`)
      assert.equal(await diagram.count(), 1, 'Every Ascaris stage illustration must be available on the first offline Atlas visit')
      assert.ok((await page.locator('.ascaris-stage-description').innerText()).length > 60)
      assert.ok(await page.locator('.ascaris-stages a[href^="https://"]').count() > 0, 'Stage explanations must retain source references offline')
      const coat = page.getByRole('button', { name: 'เปลือกชั้นนอกหลุด (Decorticated)', exact: true })
      await coat.click()
      assert.equal(await stageButton.getAttribute('aria-pressed'), 'true', 'Offline decortication must preserve the developmental stage')
      assert.equal(await diagram.getAttribute('data-decorticated'), 'true')
      assert.equal(await diagram.getByRole('group', { name: 'ชั้นผิวนอกขรุขระของไข่ Ascaris', exact: true }).count(), 0)
      assert.equal(await page.locator('.atlas-real-photo').count(), 0, 'No coated photo may be substituted for an offline decorticated specimen')
      assert.match(await page.locator('.atlas-photo-empty').innerText(), /Decorticated|เปลือก.*หลุด/i)
      await coat.click()
      if (stage === 'cleavage') assert.equal(await page.locator('.atlas-real-photo').count(), 0)
      else await page.waitForFunction(() => { const image = document.querySelector('.atlas-real-photo'); return image?.complete && image.naturalWidth > 0 })
    }
    await page.getByRole('button', { name: 'ภาพตัดภายใน', exact: true }).click()
    await page.getByLabel('ค้นหาชื่อพยาธิ').fill('OV')
    assert.equal(await page.locator('.atlas-species-item').count(), 1)
    await page.locator('.atlas-species-item').click()
    assert.equal(await page.locator('.atlas-specimen-caption h2').innerText(), 'Opisthorchis viverrini', 'The new OV Atlas must load offline even when it was never visited online')
    assert.match(await page.locator('.atlas-feature-section').innerText(), /operculum and shoulders/)
    assert.match(await page.locator('.atlas-feature-section').innerText(), /abopercular knob/)
    assert.match(await page.locator('.atlas-clinical-note').innerText(), /Clonorchis/)
    assert.match(await page.locator('.atlas-photo-empty').innerText(), /ยังไม่มีภาพไข่จริง/)
    assert.ok(await page.locator('.atlas-photo-sources a').count() > 0, 'Missing imagery must preserve source references while offline')
    const addedOfflineReferences = [
      { query: 'MIF', name: 'Minute intestinal flukes (MIF)', feature: /miracidium/, note: /OV.*Clonorchis/ },
      { query: 'ตืดแคระ', name: 'Hymenolepis nana', feature: /polar filaments/, note: /ภาพเดียว/ },
      { query: 'ตืดหนู', name: 'Hymenolepis diminuta', feature: /no polar filaments/, note: /สเกล/ },
      { query: 'ขนาดกลาง', name: 'Echinostoma spp.', feature: /ยังไม่เป็นตัวอ่อน/, note: /Fasciola/ },
      { query: 'ขนาดใหญ่', name: 'Fasciolopsis buski', feature: /ยังไม่เป็นตัวอ่อน/, note: /Fasciola/ },
    ]
    for (const expected of addedOfflineReferences) {
      await page.getByLabel('ค้นหาชื่อพยาธิ').fill(expected.query)
      assert.equal(await page.locator('.atlas-species-item').count(), 1)
      await page.locator('.atlas-species-item').click()
      assert.equal(await page.locator('.atlas-specimen-caption h2').innerText(), expected.name, 'Each new reference must load without ever having been opened online')
      assert.match(await page.locator('.atlas-feature-section').innerText(), expected.feature)
      assert.match(await page.locator('.atlas-clinical-note').innerText(), expected.note)
      assert.equal(await page.locator('.atlas-model-stage canvas').count(), 1)
      assert.equal(await page.locator('.atlas-svg-fallback').isVisible(), false, 'The new 3D specimen must render offline')
    }
    const fonts = await page.evaluate(async () => {
      await document.fonts.load('500 16px "Noto Sans Thai Variable"', 'ไข่พยาธิ')
      await document.fonts.load('500 16px "Inter Variable"', 'HelpMinths')
      await document.fonts.ready
      return { thai: document.fonts.check('500 16px "Noto Sans Thai Variable"', 'ไข่พยาธิ'), latin: document.fonts.check('500 16px "Inter Variable"', 'HelpMinths') }
    })
    assert.deepEqual(fonts, { thai: true, latin: true }, 'Both bundled font families must load without a network')

    await nav(page, 'ตรวจวิเคราะห์').click()
    await page.getByLabel('เลือกภาพจากอุปกรณ์').setInputFiles({ name: 'private-offline-slide.png', mimeType: 'image/png', buffer: fixtureImage })
    await page.locator('.scan-image-svg').waitFor()
    assert.equal(await page.getByRole('button', { name: 'เริ่มวิเคราะห์ภาพ', exact: true }).isDisabled(), true, 'Real AI analysis must remain unavailable offline')
    assert.equal(await page.locator('.scan-detection-box').count(), 0, 'Selecting a local image must not fabricate detections')
    assert.equal(analysisRequests.length, 0, 'Selecting a local image must not send it to the API')

    // Even a direct failed upload request must not be queued for later sending.
    const attempt = await page.evaluate(async bytes => {
      const form = new FormData()
      form.append('image', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), 'never-queue-offline.png')
      try { await fetch('/api/analyze', { method: 'POST', body: form }); return 'unexpected-response' }
      catch { return 'network-failed' }
    }, [...fixtureImage])
    assert.equal(attempt, 'network-failed', 'The worker must never substitute a cached prediction for an offline API request')
    const attemptedBeforeReconnect = analysisRequests.length
    assert.ok(attemptedBeforeReconnect >= 1)
    assert.deepEqual(await cachedPaths(page), before, 'Images and failed API requests must not enter Cache Storage')

    await context.setOffline(false)
    await page.waitForFunction(() => navigator.onLine === true)
    await page.evaluate(() => fetch('/api/health').then(response => response.text()).catch(() => null))
    // Give online listeners and background retry handlers an opportunity to run.
    await page.waitForTimeout(1000)
    assert.equal(analysisRequests.length, attemptedBeforeReconnect, 'Reconnecting must not automatically resend an offline image')
    assert.deepEqual(successfulAnalysisResponses, [])
    assert.match(await page.locator('.scan-image-name').innerText(), /private-offline-slide\.png/, 'Connectivity changes must preserve the current local image')

    await context.setOffline(true)
    await nav(page, 'ภาพรวม').click()
    await page.getByRole('button', { name: 'ดูตัวอย่าง', exact: true }).click()
    await page.locator('.scan-demo-banner').waitFor()
    assert.match(await page.locator('.scan-demo-banner').innerText(), /ไม่ใช่ผลตรวจจาก AI/)
    assert.equal(await page.locator('.scan-detection-box').count(), 3)
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'ส่งออกรายงาน JSON' }).click()
    const report = JSON.parse(await readFile(await (await downloadPromise).path(), 'utf8'))
    assert.equal(report.mode, 'demo')
    assert.match(report.notice, /ไม่ใช่ผลตรวจจาก AI/)
    assert.equal(report.detections.length, 3)
    assert.deepEqual(await cachedPaths(page), before, 'Demo and uploaded images remain outside the persistent static cache')
    assert.deepEqual(pageErrors, [])
  } finally { await context.close() }
})

const contentTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
}

async function faultInjectionServer() {
  const assets = await builtAssetPaths()
  const atlasPath = assets.find(path => /\/Atlas-.*\.js$/.test(path))
  assert.ok(atlasPath, 'A lazy Atlas chunk is required for the incomplete-download test')
  // Serve one immutable build even if another process rebuilds the real app.
  const files = new Map(await Promise.all(assets.map(async path => [path, await readFile(resolve(distDirectory, `.${path}`))])))
  const worker = files.get('/sw.js').toString('utf8')
  const version = worker.match(/const BUILD_VERSION\s*=\s*["']([^"']+)["']/)?.[1]
  assert.ok(version, 'The production worker must identify its build revision')
  const state = { blockedAsset: atlasPath, blockedRequests: 0, version: `${version}-first-install`, originalVersion: version }
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
      if (pathname === state.blockedAsset) {
        state.blockedRequests += 1
        response.writeHead(503, { 'content-type': 'text/plain', 'cache-control': 'no-store' }); response.end('Intentional test-only unavailable asset'); return
      }
      if (pathname === '/api/health') {
        response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        response.end(JSON.stringify({ status: 'ok', model_ready: false, message: 'Production offline-worker test server; no model configured' })); return
      }
      const location = resolve(distDirectory, `.${pathname === '/' ? '/index.html' : pathname}`)
      if (!location.startsWith(`${distDirectory}${sep}`)) { response.writeHead(403); response.end(); return }
      let body = files.get(pathname === '/' ? '/index.html' : pathname)
      if (!body) { response.writeHead(404); response.end(); return }
      if (pathname === '/sw.js') body = Buffer.from(worker.replace(/const BUILD_VERSION\s*=\s*["'][^"']+["']/, `const BUILD_VERSION = ${JSON.stringify(state.version)}`))
      response.writeHead(200, { 'content-type': contentTypes[extname(location)] || 'application/octet-stream', 'cache-control': 'no-store', 'service-worker-allowed': '/' })
      response.end(body)
    } catch { response.writeHead(404); response.end() }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return { state, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections() }) }
}

test('incomplete downloads never claim readiness; a failed update preserves the usable version and a healthy update waits', { timeout: 90_000 }, async () => {
  const server = await faultInjectionServer()
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'allow' })
  const page = await context.newPage()
  try {
    await page.goto(server.url, { waitUntil: 'networkidle' })
    await page.waitForFunction(async () => {
      const registration = await navigator.serviceWorker.getRegistration()
      return !registration || (!registration.installing && !registration.active && !registration.waiting)
    })
    assert.ok(server.state.blockedRequests > 0, 'The missing lazy chunk must actually be requested during install')
    assert.equal(await page.locator('.offline-panel strong').filter({ hasText: /^พร้อมใช้งานออฟไลน์$/ }).count(), 0, 'An incomplete installation must never advertise offline readiness')
    assert.equal(await page.evaluate(() => navigator.serviceWorker.controller !== null), false)

    server.state.blockedAsset = null
    await page.evaluate(() => navigator.serviceWorker.register('/sw.js'))
    const firstReady = await waitForReady(page)
    assert.equal(firstReady.ready, true)
    assert.equal(firstReady.version, server.state.version)
    const initialPaths = await cachedPaths(page)
    assert.ok(initialPaths.some(path => /\/Atlas-.*\.js$/.test(path)))

    // Serve a byte-different worker revision without changing the built assets or
    // their integrity hashes. Only the test HTTP server modifies its response.
    const newVersion = `${server.state.originalVersion}-next-build`
    server.state.version = newVersion
    server.state.blockedAsset = initialPaths.find(path => /\/Atlas-.*\.js$/.test(path))
    const blockedBefore = server.state.blockedRequests
    await page.evaluate(async () => { const registration = await navigator.serviceWorker.getRegistration(); await registration.update() })
    await page.waitForFunction(async () => { const registration = await navigator.serviceWorker.getRegistration(); return registration?.active && !registration.installing && !registration.waiting })
    assert.ok(server.state.blockedRequests > blockedBefore)
    assert.deepEqual(await workerStatus(page), firstReady, 'A failed update must leave the old complete worker active')
    assert.deepEqual(await cachedPaths(page), initialPaths)

    await context.setOffline(true)
    const offlineReload = await page.reload({ waitUntil: 'domcontentloaded' })
    assert.equal(offlineReload.fromServiceWorker(), true)
    await nav(page, 'Atlas 3D').click()
    await page.locator('.atlas-model-stage canvas').waitFor()
    assert.equal((await workerStatus(page)).version, firstReady.version)

    server.state.blockedAsset = null
    await context.setOffline(false)
    // The application's online listener checks for an update. Avoid starting a
    // second simultaneous update job from the test itself.
    await page.waitForFunction(async () => {
      const registration = await navigator.serviceWorker.getRegistration()
      return registration?.waiting?.state === 'installed' && !registration.installing
    })
    assert.equal((await workerStatus(page)).version, firstReady.version, 'An available update must not forcibly replace a running session')

    // An update waiting in the background cannot make an incomplete active
    // package appear usable. Simulate browser eviction of one unused icon.
    await page.evaluate(async version => {
      const cache = await caches.open(`helpminths-static-${version}`)
      window.__offlineTestSavedIcon = await cache.match('/favicon.svg')
      await cache.delete('/favicon.svg')
      window.dispatchEvent(new Event('online'))
    }, firstReady.version)
    assert.equal((await workerStatus(page)).ready, false)
    await page.locator('.offline-panel strong').filter({ hasText: /^ยังไม่พร้อมใช้งานออฟไลน์$/ }).waitFor()
    await page.evaluate(async version => {
      const cache = await caches.open(`helpminths-static-${version}`)
      await cache.put('/favicon.svg', window.__offlineTestSavedIcon)
      delete window.__offlineTestSavedIcon
      window.dispatchEvent(new Event('online'))
    }, firstReady.version)
    await page.locator('.offline-panel strong').filter({ hasText: /^พร้อมใช้งานออฟไลน์$/ }).waitFor()
    assert.equal((await workerStatus(page)).version, firstReady.version)

    // Normal lifecycle activation is allowed once the old session is closed.
    await page.close()
    const nextPage = await context.newPage()
    await nextPage.goto(server.url, { waitUntil: 'networkidle' })
    const nextReady = await waitForReady(nextPage)
    assert.equal(nextReady.version, newVersion)
    assert.equal(nextReady.ready, true)
  } finally { await context.close(); await server.close() }
})
