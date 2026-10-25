import { actionLabels, calculateSUS, roleLabels, studyTasks, susQuestions } from '../data/evaluation'
import type { StudySnapshot, StudySummary } from '../data/evaluation'
import * as projectContent from '../data/project'
import type { ProjectBudget } from '../data/project'
import { projectReferences } from '../data/projectReferences'
import { atlasPhotos } from '../data/atlasPhotos'

export interface ProjectExportInput { summary: StudySummary; snapshot: unknown; modelReady: boolean; budget?: ProjectBudget | null }

const atlasCapturePhoto = atlasPhotos.find(photo => photo.id === 'hymenolepis-nana-buckelew')
const screenshotDefinitions = [
  { file: 'home.png', title: 'ภาพรวม HelpMinths', caption: 'ภาพหน้าจอจริงของต้นแบบ หน้าแรกแสดงทางเข้าสู่การเรียนรู้และสถานะบริการ' },
  { file: 'scan-demo.png', title: 'ตรวจวิเคราะห์ — โหมดสาธิต', caption: 'ภาพหน้าจอจริงของโหมดสาธิต ภาพกล้องและกรอบในโหมดนี้เป็นภาพจำลอง ไม่ใช่ผลจากโมเดล AI' },
  { file: 'atlas.png', title: 'Atlas 3D', caption: 'ภาพหน้าจอจริงของ Atlas แบบจำลองใช้สอนโครงสร้าง ไม่ใช่ภาพสแกนสามมิติของสิ่งส่งตรวจ', credit: atlasCapturePhoto?.credit ?? 'Thomas P. Buckelew, Ph.D.', license: atlasCapturePhoto?.license ?? 'CC BY-NC 4.0', licenseUrl: atlasCapturePhoto?.licenseUrl ?? 'https://creativecommons.org/licenses/by-nc/4.0/', sourceUrl: atlasCapturePhoto?.sourceUrl },
  { file: 'history-demo.png', title: 'ประวัติในเซสชัน', caption: 'ภาพหน้าจอจริงของประวัติผลสาธิต ข้อมูลในภาพนี้ไม่ใช่ผลตรวจผู้ป่วยและไม่ใช่ผลวัดความแม่นยำ' },
  { file: 'evaluation.png', title: 'พื้นที่ทดสอบและ Feedback', caption: 'ภาพหน้าจอจริงของเครื่องมือเก็บหลักฐาน ไม่ใช้ภาพหน้าจอนี้แทนผลจากผู้เข้าร่วมจริง' },
] as const
interface CapturedScreen { title: string; caption: string; dataUrl: string; credit?: string; license?: string; licenseUrl?: string; sourceUrl?: string }

function escape(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}
function safeUrl(value: string): string { try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) ? escape(u.href) : '#' } catch { return '#' } }
function dateParts() {
  const now = new Date()
  const pieces = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const part = (type: string) => pieces.find(p => p.type === type)?.value ?? ''
  return { file: `${part('year')}-${part('month')}-${part('day')}`, label: new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'long', timeStyle: 'short' }).format(now) }
}
function formatDate(value: unknown): string {
  const date = new Date(String(value ?? ''))
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' }).format(date) : 'ไม่ระบุ'
}
function finite(value: unknown): string { return typeof value === 'number' && Number.isFinite(value) ? escape(value) : 'ยังไม่มีข้อมูล' }
function score(value: number | null): string { return value !== null && Number.isFinite(value) ? value.toFixed(1) : 'ยังไม่มีคะแนนครบ 10 ข้อ' }
function snapshotOf(value: unknown): StudySnapshot | null {
  if (!value || typeof value !== 'object') return null
  const snapshot = value as Partial<StudySnapshot>
  return snapshot.schema === 'helpminths-usability-study-v1' && Array.isArray(snapshot.data?.participants) && Array.isArray(snapshot.data?.actions) ? snapshot as StudySnapshot : null
}
function cite(id: string): string {
  const index = projectReferences.findIndex(ref => ref.id === id)
  return index < 0 ? '' : `<a class="citation" href="#reference-${escape(id)}">[${index + 1}]</a>`
}
const keyLabels: Record<string, string> = {
  id: 'รหัส', name: 'ชื่อ', title: 'ประเด็น', role: 'บทบาท', type: 'ประเภท', status: 'สถานะ', label: 'หัวข้อ',
  summary: 'สรุป', description: 'รายละเอียด', detail: 'รายละเอียด', context: 'บริบท', goal: 'เป้าหมาย', goals: 'เป้าหมาย',
  pain: 'ข้อจำกัด', painPoint: 'ข้อจำกัด', painPoints: 'ข้อจำกัด', need: 'ความต้องการ', needs: 'ความต้องการ',
  evidence: 'หลักฐาน', evidenceStatus: 'สถานะหลักฐาน', assumption: 'สมมติฐาน', assumptions: 'สมมติฐาน',
  action: 'การดำเนินงาน', actions: 'การดำเนินงาน', current: 'สถานะปัจจุบัน', proposed: 'ข้อเสนอ',
  before: 'ก่อนใช้ต้นแบบ', after: 'เส้นทางที่เสนอ', opportunity: 'โอกาสพัฒนา', stage: 'ขั้น', phase: 'ขั้น',
  owner: 'ผู้รับผิดชอบ', responsibility: 'หน้าที่', responsibilities: 'หน้าที่', cadence: 'รอบทบทวน',
  output: 'ผลที่ต้องได้', deliverable: 'ผลที่ต้องได้', limitation: 'ข้อจำกัด', limits: 'ข้อจำกัด',
  rationale: 'เหตุผล', choice: 'ทางเลือก', result: 'ผล', target: 'เป้าหมาย', next: 'ขั้นถัดไป',
  updatedAt: 'ปรับปรุงล่าสุด', purpose: 'วัตถุประสงค์', problem: 'ปัญหา', scope: 'ขอบเขต', tagline: 'แนวคิด',
  friction: 'อุปสรรค', support: 'สิ่งที่เสนอให้ช่วย', thai: 'ความหมาย', state: 'สถานะ', option: 'ทางเลือก',
  strength: 'จุดเด่น', tradeoff: 'ข้อแลกเปลี่ยน', area: 'งานที่ดูแล', proposedOwner: 'ผู้รับผิดชอบที่เสนอ',
  duties: 'หน้าที่', gate: 'เงื่อนไขผ่านระยะ', date: 'วันที่', source: 'ที่มา', change: 'สิ่งที่ปรับ',
}
function structure(value: unknown, depth = 0): string {
  if (value === null || value === undefined) return '<span class="muted">ยังไม่ระบุ</span>'
  if (typeof value === 'boolean') return value ? 'ใช่' : 'ไม่ใช่'
  if (typeof value !== 'object') return escape(typeof value === 'string' && value in actionLabels ? actionLabels[value as keyof typeof actionLabels] : value)
  if (depth > 4) return escape(JSON.stringify(value))
  if (Array.isArray(value)) return `<ul>${value.map(item => `<li>${structure(item, depth + 1)}</li>`).join('')}</ul>`
  return `<dl>${Object.entries(value as Record<string, unknown>).filter(([key]) => !['id', 'key'].includes(key)).map(([key, item]) => `<dt>${escape(keyLabels[key] ?? key)}</dt><dd>${structure(item, depth + 1)}</dd>`).join('')}</dl>`
}
function contentCards(value: unknown): string {
  return Array.isArray(value) ? `<div class="cards">${value.map(item => `<article class="card">${structure(item)}</article>`).join('')}</div>` : structure(value)
}
function table(headers: string[], rows: string[][], empty: string): string {
  return rows.length ? `<div class="table-wrap"><table><thead><tr>${headers.map(h => `<th>${escape(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : `<p class="pending">${escape(empty)}</p>`
}
function bibliography(): string {
  return `<ol class="references">${projectReferences.map(ref => `<li id="reference-${escape(ref.id)}"><p>${escape(ref.citation)} <a href="${safeUrl(ref.url)}" target="_blank" rel="noopener noreferrer">ต้นทาง</a></p>${ref.accessNote ? `<small>${escape(ref.accessNote)}</small>` : ''}</li>`).join('')}</ol>`
}
async function screenshots(): Promise<CapturedScreen[]> {
  return Promise.all(screenshotDefinitions.map(async screen => {
    const response = await fetch(`/project/screenshots/${screen.file}`, { cache: 'no-cache' })
    if (!response.ok) throw new Error(`ยังโหลดภาพหน้าจอ ${screen.file} ไม่ได้ กรุณาลองใหม่หลังอัปเดตเว็บไซต์ครบ`)
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (![137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)) throw new Error(`ไฟล์ภาพหน้าจอ ${screen.file} ไม่ใช่ PNG ที่สมบูรณ์`)
    const blob = new Blob([bytes], { type: 'image/png' })
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader(); reader.onerror = () => reject(new Error('เตรียมภาพหน้าจอสำหรับส่งออกไม่สำเร็จ')); reader.onload = () => resolve(String(reader.result)); reader.readAsDataURL(blob)
    })
    return { ...screen, dataUrl }
  }))
}
function screenCredit(screen: CapturedScreen): string {
  return screen.credit ? `<br><small>ภาพจุลทรรศน์: ${escape(screen.credit)} · ${screen.licenseUrl ? `<a href="${safeUrl(screen.licenseUrl)}" target="_blank" rel="noopener noreferrer">${escape(screen.license)}</a>` : escape(screen.license)}${screen.sourceUrl ? ` · <a href="${safeUrl(screen.sourceUrl)}" target="_blank" rel="noopener noreferrer">แหล่งภาพ</a>` : ''} · แสดงย่อภายในภาพหน้าจอต้นแบบ</small>` : ''
}
function figure(screen: CapturedScreen, index: number): string {
  return `<figure><img src="${escape(screen.dataUrl)}" alt="${escape(screen.title)}"><figcaption>ภาพที่ ${index + 1}: ${escape(screen.caption)}${screenCredit(screen)}</figcaption></figure>`
}
function summaryTable(summary: StudySummary): string {
  return table(['ตัวชี้วัดจากข้อมูลที่บันทึก', 'ผล ณ เวลาส่งออก'], [
    ['ผู้เข้าร่วมที่ให้ความยินยอม', `${finite(summary.participantCount)} คน`],
    ['บันทึกสัมภาษณ์', `${finite(summary.interviewCount)} คน`],
    ['งาน Atlas ที่บันทึกผลแล้ว / ทำสำเร็จ', `${finite(summary.atlasAttemptCount)} / ${finite(summary.completedAtlasCount)} งาน`],
    ['ความพยายามอัปโหลด / เตรียมภาพสำเร็จ', `${finite(summary.uploadAttemptCount)} / ${finite(summary.successfulUploadCount)} ครั้ง`],
    ['SUS ที่ตอบครบและบันทึกแล้ว', `${finite(summary.completedSUSCount)} คน`],
    ['คะแนน SUS เฉลี่ย (0–100 ไม่ใช่ร้อยละ)', escape(score(summary.meanSUS))],
    ['รายการ Feedback', finite(summary.feedbackCount)],
  ], '')
}
function budgetTable(budget: ProjectBudget | null | undefined): string {
  if (!budget || [budget.hosting, budget.storage, budget.compute, budget.maintenanceHours, budget.hourlyRate].some(v => !Number.isFinite(v) || v < 0)) return '<p class="pending">ยังไม่มีสมมติฐานงบประมาณที่กรอกครบ รายงานนี้ไม่ระบุราคาจริงของผู้ให้บริการ</p>'
  const maintenance = budget.maintenanceHours * budget.hourlyRate, total = budget.hosting + budget.storage + budget.compute + maintenance
  const money = (v: number) => escape(new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' }).format(v))
  if (![maintenance, total, total * 12].every(Number.isFinite)) return '<p class="pending">สมมติฐานงบประมาณเกินช่วงที่คำนวณได้</p>'
  return `<p class="notice">สมมติฐานที่ผู้ใช้กรอกเพื่อวางแผน ไม่ใช่ใบเสนอราคาหรือค่าใช้จ่ายจริงจาก Render</p>${table(['รายการสมมติฐาน', 'จำนวน'], [
    ['เว็บและ API / เดือน', money(budget.hosting)], ['พื้นที่และสำรอง / เดือน', money(budget.storage)], ['compute โมเดล / เดือน', money(budget.compute)],
    ['เวลาดูแล / เดือน', `${finite(budget.maintenanceHours)} ชั่วโมง`], ['ค่าแรงต่อชั่วโมง', money(budget.hourlyRate)], ['ค่าดูแลที่คำนวณ / เดือน', money(maintenance)],
    ['รวมประมาณการ / เดือน', money(total)], ['รวมประมาณการ / ปี (12 เดือน)', money(total * 12)],
  ], '')}`
}
function designStages(summary: StudySummary) {
  return projectContent.designThinkingStages.map(stage => stage.key === 'empathize' && summary.interviewCount > 0
    ? { ...stage, state: `มีบันทึกสัมภาษณ์จริง ${summary.interviewCount} คน ต้องวิเคราะห์ก่อนปรับ persona/โจทย์` }
    : stage.key === 'test' && summary.participantCount > 0
      ? { ...stage, state: `เริ่มเก็บข้อมูลแล้ว: ผู้เข้าร่วม ${summary.participantCount} คน, งาน Atlas ที่บันทึกผล ${summary.atlasAttemptCount} งาน, SUS ครบ ${summary.completedSUSCount} คน` }
      : stage)
}
function prototypeStages(summary: StudySummary) {
  return projectContent.prototypeStages.map((stage, index) => index === 1 && summary.participantCount > 0
    ? { ...stage, status: `มีบันทึกผู้เข้าร่วม ${summary.participantCount} คน / SUS ครบ ${summary.completedSUSCount} คน` }
    : stage)
}
function studyResults(snapshot: StudySnapshot | null): string {
  if (!snapshot || !snapshot.data.participants.length) return '<p class="pending">ยังไม่มีข้อมูลผู้เข้าร่วมจริงที่บันทึกในเครื่องนี้ จึงยังไม่มีผลสัมภาษณ์ เวลา คะแนน SUS หรือ Feedback จากผู้ใช้ให้สรุป</p>'
  const participants = snapshot.data.participants
  const participantRows = participants.map(p => [escape(p.code), escape(roleLabels[p.role] ?? p.role), escape(formatDate(p.consentAt)), escape(p.susCompletedAt ? score(calculateSUS(p.susAnswers)) : 'ยังไม่บันทึก SUS ครบ')])
  const taskRows = participants.flatMap(p => p.tasks.map(t => [escape(p.code), escape(t.title), escape(t.outcome), t.durationMs !== null && Number.isFinite(t.durationMs) ? `${(t.durationMs / 1000).toFixed(1)} วินาที` : 'ยังไม่สิ้นสุด', escape(t.note)]))
  const interviewRows = participants.filter(p => p.interview).map(p => [escape(p.code), escape(p.interview?.currentWorkflow), escape(p.interview?.obstacle), escape(p.interview?.learningNeed), escape(p.interview?.observation)])
  const feedbackRows = participants.flatMap(p => p.feedback.map(f => [escape(p.code), escape(f.problem), escape(f.suggestion), escape(formatDate(f.createdAt))]))
  const actionRows = snapshot.data.actions.map(a => [escape(a.source), escape(a.issue), escape(a.action), escape(actionLabels[a.status] ?? a.status), escape(a.evidence)])
  return `<h3>ผู้เข้าร่วมและการตอบ SUS</h3>${table(['รหัส', 'กลุ่มผู้ใช้', 'ยินยอมเมื่อ', 'SUS 0–100'], participantRows, '')}
    <h3>ผลการทำงานและเวลา</h3>${table(['รหัส', 'งาน', 'ผลที่ผู้เก็บข้อมูลระบุ', 'เวลา', 'บันทึก'], taskRows, 'ยังไม่มีผลการทำงานที่บันทึก')}
    <h3>หลักฐาน Empathize จากการสัมภาษณ์</h3>${table(['รหัส', 'วิธีทำงานปัจจุบัน', 'อุปสรรค', 'ความต้องการเรียนรู้', 'สิ่งที่สังเกต'], interviewRows, 'ยังไม่ได้บันทึกสัมภาษณ์จริง')}
    <h3>Feedback จากผู้เข้าร่วม</h3>${table(['รหัส', 'ปัญหา', 'ข้อเสนอ', 'วันที่'], feedbackRows, 'ยังไม่มี Feedback จากผู้เข้าร่วม')}
    <h3>การปรับปรุงและหลักฐานหลังปรับ</h3>${table(['แหล่งที่มา', 'ประเด็น', 'การดำเนินงาน', 'สถานะ', 'หลักฐาน'], actionRows, 'ยังไม่มีการบันทึกการปรับปรุงที่เชื่อมกับ Feedback')}`
}
const baseStyle = `:root{font-family:Arial,'Noto Sans Thai',Tahoma,sans-serif;color:#172d30;background:#edf2f1}*{box-sizing:border-box}body{margin:0;line-height:1.75}h1,h2,h3{line-height:1.45;break-after:avoid}h1{font-size:30px}h2{font-size:23px;margin-top:36px;border-bottom:2px solid #317b69;padding-bottom:8px}h3{font-size:18px}p,li,td,dd{overflow-wrap:anywhere}a{color:#176452}main{max-width:1040px;margin:auto;background:white;padding:44px 54px}.toolbar{position:sticky;top:0;background:#123b34;color:white;padding:12px 20px;display:flex;align-items:center;justify-content:center;gap:16px;z-index:4}button{font:inherit;cursor:pointer;border:0;border-radius:6px;padding:8px 15px;background:#b5f2d8;color:#123b34}.cover{border-bottom:3px solid #317b69;padding-bottom:24px}.eyebrow{font-size:12px;letter-spacing:1px;color:#317b69}.notice,.pending{border-left:4px solid #bd8b2c;background:#fff8e7;padding:12px 16px}.muted,small,figcaption{color:#536b6c}.citation{font-size:.85em;white-space:nowrap;margin-left:4px}.cards{display:grid;gap:12px}.card{border:1px solid #d7e2df;padding:14px;break-inside:avoid}dl{display:grid;grid-template-columns:150px 1fr;gap:5px 12px;margin:0}dt{font-weight:bold;color:#42645e}dd{margin:0}ul{padding-left:24px;margin-top:6px}.table-wrap{max-width:100%;overflow:auto}table{width:100%;border-collapse:collapse;font-size:13px;margin:12px 0 24px}th,td{border:1px solid #d3dfdc;padding:9px;vertical-align:top;text-align:left}th{background:#e9f3ee}tr{break-inside:avoid}figure{margin:18px 0 30px;break-inside:avoid}figure img{width:100%;max-height:570px;object-fit:contain;border:1px solid #d5dfdb;background:#10191a}figcaption{font-size:12px;margin-top:8px}.references{font-size:12px}.references li{margin-bottom:14px}.references p{margin-bottom:4px}.references small{display:block}.metrics{display:flex;gap:18px;flex-wrap:wrap}.metric{background:#e8f5ee;padding:12px 18px;border-radius:8px;min-width:140px}.metric strong{display:block;font-size:30px}.two-column{display:grid;grid-template-columns:1fr 1fr;gap:18px}.footer{font-size:12px;margin-top:30px;border-top:1px solid #d3dfdc;padding-top:10px}@media(max-width:650px){main{padding:24px 18px}dl{grid-template-columns:1fr}dt{margin-top:8px}.two-column{grid-template-columns:1fr}.toolbar{flex-wrap:wrap}}@page{size:A4;margin:16mm}@media print{body{background:white;color:black;font-size:11pt;line-height:1.6}main{max-width:none;padding:0}.toolbar{display:none}a{color:inherit;text-decoration:none}h2{margin-top:24px}.table-wrap{overflow:visible}th{background:#eee!important}figure img{max-height:150mm}.references{font-size:9pt}.card{padding:10px}.notice,.pending{background:transparent}.cover{break-after:page}}`

function documentShell(title: string, body: string, extraStyle = '', script = ''): string {
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; object-src 'none'; base-uri 'none'; form-action 'none'"><title>${escape(title)}</title><style>${baseStyle}${extraStyle}</style></head><body>${body}${script ? `<script>${script}</script>` : ''}</body></html>`
}
function download(filename: string, html: string): void {
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; document.body.append(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 5_000)
}

export async function downloadProjectReport(input: ProjectExportInput): Promise<void> {
  const screens = await screenshots(), date = dateParts(), snapshot = snapshotOf(input.snapshot)
  const html = documentShell('HelpMinths — รายงานโครงงานและหลักฐาน', `<div class="toolbar"><button onclick="window.print()">พิมพ์ / บันทึก PDF</button><span>รายงานพร้อมภาพหน้าจอและเอกสารอ้างอิง · เก็บไฟล์นี้เปิดออฟไลน์ได้</span></div><main>
    <header class="cover"><span class="eyebrow">HELPMINTHS · PROJECT & EVIDENCE</span><h1>HelpMinths — มองเห็น เข้าใจ เรียนรู้</h1><h2>รายงานโครงงานและหลักฐานการทดสอบ</h2><p>จัดทำจากสถานะต้นแบบและข้อมูลที่บันทึก ณ ${escape(date.label)} (เวลาไทย)</p><p>กลุ่มผู้ใช้: นักศึกษาวิทยาศาสตร์สุขภาพ อาจารย์ และบุคลากรห้องปฏิบัติการ</p><p class="notice">รายงานนี้แยกสิ่งที่ทำได้แล้ว สมมติฐาน แผนการทดสอบ และผลที่บันทึกจริง ภาพในโหมดสาธิตไม่ใช่ผลจาก AI; SUS ประเมินการใช้งาน ไม่ใช่ความแม่นยำของโมเดล</p></header>
    <section><h2>1. ปัญหาและแนวคิดนวัตกรรม</h2><p>การสังเกตและจำแนกไข่พยาธิจากกล้องจุลทรรศน์ต้องใช้ทักษะและการฝึกซ้ำ นักศึกษาต้องเชื่อมภาพจริงกับลักษณะโครงสร้าง ขณะที่ผู้สอนและบุคลากรต้องทบทวนวัตถุคล้ายไข่และข้อจำกัดในการแยกชนิด แนวทางของ HelpMinths รวม Atlas เปรียบเทียบภาพจริง/โมเดล และส่วนเชื่อม object detection เพื่อช่วยสำรวจภาพ ${cite('cdc')}${cite('yolo')}</p>${structure(projectContent.projectIdentity)}<h3>How Might We — HMW</h3><div class="notice">${structure(projectContent.projectHmw)}</div><p>การลดการพึ่งผู้เชี่ยวชาญหมายถึงการฝึกเรียนรู้ด้วยตนเอง ส่วนผลที่เกี่ยวข้องกับการดูแลผู้ป่วยยังต้องผ่านการทบทวนและหลักฐานที่เหมาะสม ${cite('who-ai')}</p></section>
    <section><h2>2. ผู้ใช้และ Empathize</h2><p>Persona ต่อไปนี้เป็นสมมติฐานเพื่อออกแบบการทดสอบ ยังไม่แทนผลสัมภาษณ์จริง ข้อมูลสัมภาษณ์ที่มีการบันทึกแสดงแยกในส่วนผลการทดสอบ ${cite('design-thinking')}</p>${contentCards(projectContent.personas)}<h3>Journey Map: เส้นทางปัจจุบันและเส้นทางที่เสนอ</h3>${contentCards(projectContent.journeyStages)}</section>
    <section><h2>3. กระบวนการ Design Thinking</h2><p>ใช้ Empathize–Define–Ideate–Prototype–Test เป็นกรอบวนปรับต้นแบบ ไม่ถือว่ามีหลักฐานผู้ใช้เพียงเพราะมีแผนหรือแบบฟอร์ม ${cite('design-thinking')}</p>${contentCards(designStages(input.summary))}<h3>ทางเลือกที่พิจารณา</h3>${contentCards(projectContent.ideaAlternatives)}<h3>ขอบเขต MVP 1–3</h3>${contentCards(prototypeStages(input.summary))}</section>
    <section><h2>4. ต้นแบบและภาพหน้าจอจริง</h2><p>Atlas มี 12 กลุ่มอ้างอิง ได้แก่ 11 กลุ่มไข่และตัวอ่อน Strongyloides อีก 1 กลุ่ม รายการใน Atlas ไม่เท่ากับคลาสที่โมเดลตรวจได้แล้ว ชุดภาพเตรียมโมเดลรอบแรกมี 3 ภาพ/3 กลุ่มที่ผู้ใช้ส่งผลตรวจทานมา ไม่ใช่ผู้เข้าร่วม usability 3 คน</p><p>สถานะเชื่อมโมเดลจาก API ขณะส่งออก: <strong>${input.modelReady ? 'บริการรายงานว่าโมเดลพร้อมประมวลผล' : 'ยังไม่พร้อมประมวลผลด้วยโมเดล'}</strong> สถานะพร้อมโหลดไม่ใช่หลักฐานว่าผ่านการประเมินทางคลินิก</p>${screens.map(figure).join('')}</section>
    <section><h2>5. แผนการทดสอบและผลที่บันทึกจริง</h2><p>เป้าหมายเบื้องต้น: นักศึกษา 3–5 คนทดลอง Atlas และบันทึกเวลา; ทดลอง workflow อัปโหลดภาพกล้องจุลทรรศน์จริง 5–10 ภาพ; ตอบ SUS หลังใช้งานและเก็บ Feedback ให้ติดตามการปรับปรุงได้ ภาพต้องมีสิทธิ์ใช้และไม่มีข้อมูลระบุตัวผู้ป่วย การทดสอบเตรียม/อัปโหลดภาพไม่ใช่การวัดความไวหรือความจำเพาะของ AI</p>${table(['งานใน protocol', 'คำสั่งให้ผู้เข้าร่วม'], studyTasks.map(t => [escape(t.title), escape(t.instruction)]), '')}${summaryTable(input.summary)}${studyResults(snapshot)}<p class="notice">จำนวนครั้งอัปโหลดอาจรวมการทดลองซ้ำ ไม่ใช่จำนวนภาพอิสระหรือผู้ป่วย คะแนนเฉลี่ยจากกลุ่มเล็กใช้ค้นหาจุดปรับปรุง ไม่ใช่ข้อสรุปแทนผู้ใช้ทั้งหมด ${cite('sus-interpretation')}</p></section>
    <section><h2>6. วิธีคิดคะแนน SUS</h2><p>ตอบ 10 ข้อ ระดับ 1–5: ข้อคี่ใช้คำตอบลบ 1 ข้อคู่ใช้ 5 ลบคำตอบ รวมคะแนนทั้งสิบแล้วคูณ 2.5 ได้คะแนน 0–100 ซึ่งไม่ใช่ร้อยละ ไม่คำนวณเมื่อคำตอบไม่ครบหรือไม่อยู่ในช่วง ${cite('sus')}</p><p>ข้อความภาษาไทยในโครงการเป็นคำแปลเพื่อทดลองใช้ ยังไม่ได้อ้างว่าเป็นฉบับแปลผ่านการตรวจสอบ คะแนนนี้วัด perceived usability ไม่ใช่ความแม่นยำในการตรวจพยาธิ ${cite('sus-interpretation')}</p>${table(['ข้อ', 'ข้อความที่ใช้ในโครงการ'], susQuestions.map((q, i) => [String(i + 1), escape(q)]), '')}</section>
    <section><h2>7. การดูแลระบบ ความยั่งยืน และการขยายผล</h2><p>บทบาทด้านล่างเป็นข้อเสนอเพื่อให้สถาบันแต่งตั้งผู้รับผิดชอบก่อนใช้ต่อหลังจบโครงงาน ไม่อ้างว่ามีผู้รับตำแหน่งแล้ว ${cite('who-ai')}</p>${contentCards(projectContent.sustainabilityRoles)}<h3>Roadmap ตามหลักฐาน</h3>${contentCards(projectContent.projectRoadmap)}<h3>ค่าใช้จ่ายและข้อจำกัดบริการ</h3><p>ทบทวนการพักบริการ/cold start โควตา compute และข้อจำกัดพื้นที่ของ free tier กับผู้ให้บริการตามวันใช้งานจริง ไม่ถือว่า free hosting รับประกัน latency หรือรองรับโมเดลทุกขนาด ต้องวัด RAM เวลา CPU และภาระงานก่อนเลือกแผน ${cite('render-free')}${cite('render-pricing')}</p>${table(['รายการงบประมาณ', 'ฐานที่ควรใช้ประมาณ'], [['เว็บและ API', 'ใบเสนอราคาตามแผน/ภูมิภาคและภาระงานจริง'], ['การประมวลผลโมเดล', 'ขนาดโมเดล เวลาอนุมาน และจำนวนคำขอ'], ['พื้นที่ข้อมูลและสำรอง', 'ปริมาณภาพ สิทธิ์เข้าถึง รอบสำรอง และการกู้คืน'], ['การดูแลหลังจบโครงงาน', 'ชั่วโมงผู้ดูแล × ค่าแรงที่ตกลงจริง']], '')}${budgetTable(input.budget)}<p>ประมาณการนี้ต้องตรวจใบเสนอราคาและทรัพยากรจริงก่อนใช้งาน ไม่ใช่ราคายืนยันของ Render</p><h3>เกณฑ์ก่อนใช้ในสถานบริการจริง</h3>${contentCards(projectContent.readinessGates)}<p>ต้องแยกข้อมูลฝึก/ประเมินตามผู้ป่วยหรือสิ่งส่งตรวจ ใช้ reference standard และชุดทดสอบอิสระ ประเมินรายกลุ่มและอุปกรณ์พร้อมความไม่แน่นอน รวมสิทธิภาพ ข้อมูลสุขภาพ การกำกับโดยมนุษย์ และข้อกำหนดหน่วยงานที่เกี่ยวข้อง ${cite('ai-evaluation')}${cite('who-ai')}</p></section>
    <section><h2>8. การปรับปรุงและการสะท้อนการเรียนรู้</h2><p>รายการต่อไปเป็นการพัฒนาตามคำแนะนำโครงงาน แยกจาก Feedback ของผู้เข้าร่วมซึ่งแสดงในส่วนที่ 5</p>${contentCards(projectContent.projectChanges)}<p>ประเด็นสำหรับผู้จัดทำสะท้อนหลังทดสอบ: สมมติฐานใดได้รับหลักฐานสนับสนุน งานใดยังมีข้อผิดพลาด ข้อเสนอใดถูกนำไปปรับ และมีหลักฐานหลังปรับอะไรบ้าง ข้อที่ยังไม่ได้ทดสอบต้องคงสถานะรอข้อมูล</p></section>
    <section><h2>เอกสารอ้างอิงและขอบเขตการเข้าถึง</h2><p>คำแนะนำที่แนบกล่าวถึงบทความ 9 รายการ แต่ไม่มีบรรณานุกรมทั้งเก้ารวมมาด้วย จึงใช้รายการที่ระบุต้นทางได้ด้านล่างและแสดงข้อจำกัดการเปิดอ่าน ไม่สร้างรายละเอียดบทความขึ้นแทน</p>${bibliography()}</section><footer class="footer">HelpMinths · ส่งออก ${escape(date.label)} · ข้อมูลการศึกษาในรายงานมาจากการบันทึกในเครื่องนี้ ณ เวลาส่งออก${snapshot ? ` · snapshot ${escape(formatDate(snapshot.exportedAt))}` : ''}</footer></main>`)
  download(`HelpMinths-project-report-${date.file}.html`, html)
}

function flattened(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.map(flattened).filter(Boolean).join(' · ')
  if (typeof value === 'object') return Object.entries(value as Record<string, unknown>).filter(([key]) => !['id', 'key', 'sources', 'references'].includes(key)).map(([, v]) => flattened(v)).filter(Boolean).join(' · ')
  return String(value)
}
function slideCards(value: unknown, max = 5): string {
  const items = Array.isArray(value) ? value.slice(0, max) : [value]
  return `<div class="slide-cards">${items.map(item => {
    const record = typeof item === 'object' && item !== null ? item as Record<string, unknown> : {}
    const heading = record.title ?? record.name ?? record.stage ?? record.phase ?? record.role ?? record.option ?? record.area
    const text = flattened(item)
    return `<article><h3>${escape(heading ?? '')}</h3><p>${escape(text.length > 350 ? `${text.slice(0, 347)}…` : text)}</p></article>`
  }).join('')}</div>`
}

export async function downloadProjectSlides(input: ProjectExportInput): Promise<void> {
  const screens = await screenshots(), date = dateParts(), snapshot = snapshotOf(input.snapshot), s = input.summary
  const recentFeedback = snapshot?.data.participants.flatMap(p => p.feedback.map(f => ({ code: p.code, ...f }))).slice(-3) ?? []
  const slides: { title: string; body: string; sources: string }[] = [
    { title: 'HelpMinths — มองเห็น เข้าใจ เรียนรู้', body: `<p class="lead">พื้นที่ฝึกอ่านภาพกล้องจุลทรรศน์และสำรวจ morphology</p><div class="notice">${structure(projectContent.projectHmw)}</div><p>นักศึกษาวิทยาศาสตร์สุขภาพ · อาจารย์ · บุคลากรห้องปฏิบัติการ</p><p class="muted">สถานะต้นแบบและหลักฐาน ณ ${escape(date.label)}</p>`, sources: cite('design-thinking') },
    { title: 'ปัญหาและสิ่งที่ผู้ใช้ต้องการ', body: `<p class="lead">เชื่อมภาพจริงกับจุดสังเกต และฝึกอ่านอย่างมีขั้นตอน</p>${slideCards(projectContent.personas, 3)}<p class="notice">Persona เป็นสมมติฐานเพื่อออกแบบ จำนวนบันทึกสัมภาษณ์จริงในเครื่องนี้: ${finite(s.interviewCount)} คน</p>`, sources: cite('design-thinking') + cite('cdc') },
    { title: 'Journey Map', body: `${slideCards(projectContent.journeyStages, 5)}<p>ใช้เส้นทางนี้ตั้งงานสังเกตและวัดเวลา ก่อนปรับตามหลักฐานผู้ใช้จริง</p>`, sources: cite('design-thinking') },
    { title: 'Design Thinking Journey', body: `${slideCards(designStages(input.summary), 5)}<p class="notice">แผนและเครื่องมือพร้อมใช้งาน ไม่ถือว่าได้ผลทดสอบจนมีข้อมูลบันทึกจริง</p>`, sources: cite('design-thinking') },
    { title: 'จากทางเลือกสู่ MVP', body: `<div class="two-column"><div><h3>ทางเลือกที่พิจารณา</h3>${slideCards(projectContent.ideaAlternatives, 4)}</div><div><h3>ขอบเขตต้นแบบ</h3>${slideCards(prototypeStages(input.summary), 3)}</div></div>`, sources: cite('yolo') },
    { title: 'ต้นแบบที่ใช้งานได้', body: `<div class="screen-grid">${screens.slice(0, 3).map((screen, i) => `<figure><img src="${escape(screen.dataUrl)}" alt="${escape(screen.title)}"><figcaption>${i + 1}. ${escape(screen.title)}${screenCredit(screen)}</figcaption></figure>`).join('')}</div><p>Atlas: 12 กลุ่มอ้างอิง = 11 กลุ่มไข่ + ตัวอ่อน Strongyloides · โหมดสาธิตเป็นภาพจำลอง ไม่ใช่ผลโมเดล</p><p>API รายงานโมเดล${input.modelReady ? 'พร้อมประมวลผล' : 'ยังไม่พร้อม'}; ความพร้อมโหลดไม่ใช่การรับรองความแม่นยำ</p>`, sources: cite('yolo') + cite('cdc') },
    { title: 'ทดสอบกับผู้ใช้และภาพจริง', body: `<div class="two-column"><div><h3>Protocol</h3><ul><li>นักศึกษา 3–5 คน: ค้นหาใน Atlas และจับเวลา</li><li>ภาพกล้องจุลทรรศน์ 5–10 ภาพ: ทดลอง workflow อัปโหลด</li><li>SUS 10 ข้อหลังใช้งาน และ Feedback</li></ul></div><div>${figure(screens[4], 4)}</div></div><p class="notice">ภาพฝึกโมเดล 3 ภาพที่ผู้ใช้ส่งผลตรวจทานมา ไม่ใช่ผู้เข้าร่วม usability 3 คน และไม่ใช่ชุดทดสอบอิสระ</p>`, sources: cite('sus') + cite('ai-evaluation') },
    { title: 'ผลที่บันทึก ณ เวลาส่งออก', body: `${summaryTable(s)}<p>${s.participantCount ? 'สรุปจากข้อมูลที่ผู้เก็บบันทึกในเครื่องนี้เท่านั้น' : 'ยังไม่มีข้อมูลผู้เข้าร่วมจริง จึงยังไม่มีผล usability ให้สรุป'}</p>`, sources: cite('sus-interpretation') },
    { title: 'SUS และวงจร Feedback → ปรับ → ตรวจซ้ำ', body: `<p>ข้อคี่: คำตอบ − 1 · ข้อคู่: 5 − คำตอบ · รวม × 2.5 = 0–100 <strong>ไม่ใช่ร้อยละ</strong></p><p>ฉบับแปลไทยของโครงการยังไม่อ้างการตรวจสอบคำแปล</p><h3>Feedback ที่บันทึกจริง</h3>${recentFeedback.length ? table(['รหัส', 'ปัญหา', 'ข้อเสนอ'], recentFeedback.map(f => [escape(f.code), escape(f.problem), escape(f.suggestion)]), '') : '<p class="pending">ยังไม่มี Feedback จากผู้เข้าร่วม</p>'}<p>รายการติดตามการปรับปรุงที่บันทึก: ${snapshot?.data.actions.length ?? 0} รายการ ให้เชื่อมหลักฐานก่อนและหลังปรับ</p>`, sources: cite('sus') + cite('sus-interpretation') },
    { title: 'ดูแลต่อหลังจบโครงงาน', body: `${slideCards(projectContent.sustainabilityRoles, 4)}<p>บทบาทยังเป็นข้อเสนอเพื่อให้สถาบันแต่งตั้ง ไม่ใช่รายชื่อผู้รับผิดชอบที่ยืนยันแล้ว</p><p>วางรุ่นโค้ด/โมเดล/annotation รอบสำรองและทดสอบกู้คืน พร้อมส่งต่อคู่มือ</p>`, sources: cite('who-ai') },
    { title: 'ขยายตามหลักฐานและงบประมาณ', body: `${slideCards(projectContent.projectRoadmap, 4)}<p>งบต่อเดือน = เว็บ/API + compute โมเดล + พื้นที่/สำรอง + เวลาดูแล</p><p class="notice">ตรวจราคาจริงกับผู้ให้บริการ ค่าที่กรอกในเครื่องคำนวณเป็นสมมติฐาน; free tier ต้องทบทวน cold start โควตา และ RAM ก่อนขยาย</p>`, sources: cite('render-free') + cite('render-pricing') },
    { title: 'งบประมาณที่ใช้วางแผน', body: `${budgetTable(input.budget)}<p>ตรวจต้นทุนตามจำนวนผู้ใช้ ขนาดโมเดล RAM เวลา CPU และการสำรองข้อมูลจริงก่อนเลือกแผน</p>`, sources: cite('render-free') + cite('render-pricing') },
    { title: 'ก่อนนำไปใช้ในสถานบริการจริง', body: `${slideCards(projectContent.readinessGates, 5)}<p class="notice">Usability ไม่แทนการประเมินโมเดล และผลจากภาพเดียวไม่ยืนยันหรือตัดการติดเชื้อ</p>`, sources: cite('ai-evaluation') + cite('who-ai') },
    { title: 'เอกสารอ้างอิง', body: bibliography(), sources: 'ข้อจำกัดการเข้าถึงต้นทางแสดงไว้ในแต่ละรายการ รายงานฉบับเต็มมีภาพหน้าจอและรายละเอียดผลที่บันทึก' },
  ]
  const extra = `.slides-body{background:#101b1c}.slides-body main{padding:0;max-width:none;background:transparent}.slide{display:none;position:relative;width:1280px;min-height:720px;background:white;margin:22px auto;padding:36px 50px 66px;overflow:hidden}.slide.active{display:block}.slide h1{font-size:34px;margin:0 0 24px}.slide h3{font-size:17px}.slide p,.slide li{font-size:18px;line-height:1.55}.slide .lead{font-size:26px}.slide dl{grid-template-columns:1fr;font-size:15px}.slide .slide-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(175px,1fr));gap:12px}.slide .slide-cards article{background:#edf5f1;padding:12px;border-left:3px solid #317b69}.slide .slide-cards h3{margin:0 0 8px}.slide .slide-cards p{font-size:15px;margin:0}.slide .two-column .slide-cards{grid-template-columns:1fr}.slide .two-column .slide-cards article{padding:7px 10px}.slide .two-column .slide-cards p{font-size:13px}.slide .two-column .slide-cards h3{font-size:15px;margin:0}.slide table{font-size:15px}.slide figure{margin:0}.slide figure img{height:280px}.slide figcaption{font-size:13px}.screen-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.slide .references{columns:2;column-gap:28px;font-size:11px}.slide .references p,.slide .references small{font-size:11px;line-height:1.35}.slide .references li{break-inside:avoid;margin-bottom:9px}.slide-footer{position:absolute;bottom:18px;left:50px;right:50px;border-top:1px solid #d4e1db;padding-top:8px;font-size:12px;color:#536b6c;display:flex;justify-content:space-between;gap:16px}.slide-footer .sources{max-width:88%}.slide .notice,.slide .pending{font-size:16px;margin-top:14px}.slides-toolbar{position:sticky;top:0}@media screen and (max-width:1320px){.slide{width:calc(100vw - 28px);min-height:calc((100vw - 28px)*.5625);padding:26px 26px 65px}.slide h1{font-size:28px}.slide p,.slide li{font-size:16px}.slide .references{columns:1}.slide .references p,.slide .references small{font-size:11px}.slide-footer{left:26px;right:26px}.screen-grid{gap:8px}.slide figure img{height:200px}}@page{size:A4 landscape;margin:0}@media print{body.slides-body{background:white}.slide,.slide.active{display:block!important;width:297mm;min-height:210mm;height:210mm;margin:0;padding:14mm 15mm 21mm;break-after:page;overflow:hidden}.slide:last-child{break-after:auto}.slide h1{font-size:26pt}.slide p,.slide li{font-size:14pt}.slide .slide-cards p{font-size:11pt}.slide .two-column .slide-cards p{font-size:10pt}.slide .references{columns:2}.slide .references p,.slide .references small{font-size:8.4pt}.slide-footer{left:15mm;right:15mm;bottom:7mm;font-size:9pt}.slide figure img{height:72mm}.toolbar{display:none!important}}`
  const script = `document.body.classList.add('slides-body');const slides=[...document.querySelectorAll('.slide')];let current=0;function show(index){current=Math.max(0,Math.min(slides.length-1,index));slides.forEach((slide,i)=>slide.classList.toggle('active',i===current));document.getElementById('position').textContent=(current+1)+' / '+slides.length;document.getElementById('previous').disabled=current===0;document.getElementById('next').disabled=current===slides.length-1;window.scrollTo(0,0)}document.getElementById('previous').onclick=()=>show(current-1);document.getElementById('next').onclick=()=>show(current+1);document.getElementById('print').onclick=()=>window.print();document.addEventListener('keydown',event=>{if(event.key==='ArrowRight'||event.key==='PageDown'){event.preventDefault();show(current+1)}if(event.key==='ArrowLeft'||event.key==='PageUp'){event.preventDefault();show(current-1)}if(event.key==='Home')show(0);if(event.key==='End')show(slides.length-1)});document.querySelectorAll('.citation').forEach(link=>link.addEventListener('click',event=>{event.preventDefault();show(slides.length-1);document.querySelector(link.getAttribute('href'))?.scrollIntoView()}));show(0);`
  const body = `<div class="toolbar slides-toolbar"><button id="previous">ก่อนหน้า</button><span id="position"></span><button id="next">ถัดไป</button><button id="print">พิมพ์ / บันทึก PDF</button></div><main>${slides.map((slide, i) => `<section class="slide${i === 0 ? ' active' : ''}"><h1>${escape(slide.title)}</h1>${slide.body}<footer class="slide-footer"><span class="sources">${slide.sources}</span><span>HelpMinths · ${i + 1}/${slides.length}</span></footer></section>`).join('')}</main>`
  download(`HelpMinths-project-slides-${date.file}.html`, documentShell('HelpMinths — สไลด์โครงงาน', body, extra, script))
}
