import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright'

const baseURL = process.env.HELPMINTHS_TEST_URL || 'http://127.0.0.1:8081'
const directory = resolve(process.env.HELPMINTHS_SCREENSHOT_DIR || 'public/project/screenshots')
await mkdir(directory, { recursive: true })
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
  headless: true,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
const files = []
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Bangkok', serviceWorkers: 'block' })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const capture = async (filename, description) => {
    await page.evaluate(() => document.fonts.ready)
    await page.evaluate(async () => {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
      for (const selector of ['main', '.sidebar']) document.querySelector(selector)?.scrollTo({ top: 0, left: 0, behavior: 'instant' })
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    })
    await page.screenshot({ path: resolve(directory, filename), animations: 'disabled' })
    files.push({ filename, description, source: 'actual running prototype', privatePatientImages: false })
  }
  const status = await page.request.get(`${baseURL}/api/platform/session`)
  if (!status.ok()) throw new Error('The current platform session API must be available before capture')
  if (status.headers()['x-helpminths-test-fixture']) throw new Error('Public screenshots must not use the synthetic backend fixture')
  const session = await status.json()
  if (typeof session.configured !== 'boolean') throw new Error('Unexpected platform session response')
  if (session.user || session.configured) throw new Error('Capture public documentation only from an unconfigured, unauthenticated application')
  await page.goto(baseURL, { waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: 'มองเห็น เข้าใจ เรียนรู้' }).waitFor()
  await capture('home.png', 'หน้าแรกและสถานะบริการจริง')
  await page.getByRole('button', { name: 'ดูตัวอย่าง', exact: true }).click()
  await page.locator('.scan-demo-banner').waitFor()
  await capture('scan-demo.png', 'โหมดสาธิต ภาพและกรอบจำลอง ไม่ใช่ผล AI')
  await page.getByRole('button', { name: /ประวัติการตรวจ/ }).click()
  await page.locator('.history-card').waitFor()
  await capture('history-demo.png', 'ประวัติผลสาธิตในเซสชัน ไม่ใช่ข้อมูลผู้ป่วย')
  await page.getByRole('button', { name: 'Atlas 3D', exact: true }).click()
  await page.locator('.atlas-species-item').filter({ hasText: 'Hymenolepis nana' }).click()
  await page.locator('.atlas-model-stage canvas').waitFor()
  const pause = page.getByRole('button', { name: 'หยุดหมุนอัตโนมัติ', exact: true })
  if (await pause.count()) await pause.click()
  await page.waitForTimeout(1000)
  await capture('atlas.png', 'H. nana: ภาพจริง Thomas P. Buckelew CC BY-NC 4.0 เทียบโมเดลอธิบายโครงสร้าง')
  await page.getByRole('button', { name: 'ประเมินและข้อเสนอแนะ', exact: true }).click()
  await page.getByRole('tab', { name: 'แบบประเมิน SUS', exact: true }).click()
  await page.getByRole('heading', { name: 'ประเมินการใช้งาน', exact: true }).waitFor()
  await capture('evaluation.png', 'แบบประเมิน SUS และช่องข้อเสนอแนะ ไม่มีคำตอบตัวอย่าง')
  await page.getByRole('button', { name: 'ห้องเรียนพยาธิ', exact: true }).click()
  await page.locator('.learning-page').waitFor()
  await capture('learning.png', 'ห้องเรียนใช้ภาพอ้างอิงจริง มีเครดิตและข้อจำกัด แบบทดสอบยังไม่มีผู้ตรวจอนุมัติ')
  await page.getByRole('button', { name: 'ตั้งค่าและบัญชี', exact: true }).click()
  await page.locator('.platform-page').waitFor()
  await capture('settings.png', 'สถานะการตั้งค่าจริง ยังไม่มีฐานข้อมูล บัญชี หรือโมเดลที่เชื่อมต่อ')
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click()
  await page.getByTestId('health-survey-dashboard').waitFor()
  await page.locator('.hsd-update button:not(:disabled)').waitFor()
  await capture('health-dashboard.png', 'Dashboard กพด. เขตสุขภาพที่ 2 หน้าตาจาก ZIP ของเจ้าของ แสดงสถานะแหล่งข้อมูลจริง ไม่มีสถิติโครงการจำลอง')
  if (errors.length) throw new Error(`Browser errors during capture: ${errors.join('; ')}`)
  await writeFile(resolve(directory, 'manifest.json'), JSON.stringify({
    capturedAt: new Date().toISOString(), timezone: 'Asia/Bangkok', viewport: { width: 1440, height: 1000 },
    notice: 'ภาพหน้าจอจากเว็บต้นแบบ โหมดตรวจและประวัติในภาพใช้ข้อมูลสาธิต ภาพเหล่านี้ไม่ใช่หลักฐานทดสอบจากผู้เข้าร่วม',
    files,
  }, null, 2) + '\n')
  process.stdout.write(`Captured ${files.length} real prototype screenshots in ${directory}\n`)
} finally { await browser.close() }
