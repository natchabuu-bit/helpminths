import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, ArrowUpRight, BookOpen, Check, ClipboardList, Download, ExternalLink, FileText, FlaskConical, Layers3, Lightbulb, Presentation, ShieldCheck, Target, Users, Wallet } from 'lucide-react'
import type { StudySummary } from '../data/evaluation'
import { projectReferences } from '../data/projectReferences'
import { designThinkingStages, ideaAlternatives, journeyStages, personas, projectChanges, projectHmw, projectIdentity, projectRoadmap, prototypeStages, readinessGates, sustainabilityRoles } from '../data/project'
import type { ProjectBudget } from '../data/project'
import '../styles/project.css'

interface ProjectProps {
  summary: StudySummary
  modelReady: boolean
  onStartEvaluation: () => void
  onOpenAtlas: () => void
  onOpenScan: () => void
  onExportReport: () => void
  onOpenSlides: () => void
  onBudgetChange?: (budget: ProjectBudget | null) => void
  initialBudget?: ProjectBudget | null
}

type ProjectTab = 'overview' | 'journey' | 'evidence' | 'sustainability' | 'references'
const tabs: { id: ProjectTab; label: string }[] = [
  { id: 'overview', label: 'โจทย์และผู้ใช้' }, { id: 'journey', label: 'กระบวนการพัฒนา' },
  { id: 'evidence', label: 'หลักฐานและการทดสอบ' }, { id: 'sustainability', label: 'ความยั่งยืน' }, { id: 'references', label: 'เอกสารอ้างอิง' },
]

function ReferenceLink({ id }: { id: string }) {
  const item = projectReferences.find((reference) => reference.id === id)
  return item ? <a className="project-source" href={item.url} target="_blank" rel="noreferrer">แหล่งอ้างอิง <ExternalLink size={12} /></a> : null
}

const baht = (value: number) => new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 }).format(value)

type BudgetInputs = { hosting: string; storage: string; compute: string; maintenanceHours: string; hourlyRate: string }

function calculateBudget(inputs: BudgetInputs): ProjectBudget | null {
  const values = Object.fromEntries(Object.entries(inputs).map(([key, value]) => [key, value.trim() === '' ? null : Number(value)])) as Record<keyof BudgetInputs, number | null>
  if (!Object.values(values).every((value) => value !== null && Number.isFinite(value) && value >= 0 && value <= 100_000_000)) return null
  const maintenance = values.maintenanceHours! * values.hourlyRate!
  const monthlyTotal = values.hosting! + values.storage! + values.compute! + maintenance
  if (!Number.isFinite(monthlyTotal) || !Number.isFinite(monthlyTotal * 12)) return null
  return { hosting: values.hosting!, storage: values.storage!, compute: values.compute!, maintenanceHours: values.maintenanceHours!, hourlyRate: values.hourlyRate!, maintenance, monthlyTotal, yearlyTotal: monthlyTotal * 12, assumptionOnly: true }
}

export default function Project({ summary, modelReady, onStartEvaluation, onOpenAtlas, onOpenScan, onExportReport, onOpenSlides, onBudgetChange, initialBudget }: ProjectProps) {
  const [tab, setTab] = useState<ProjectTab>('overview')
  const [budget, setBudget] = useState<BudgetInputs>(() => initialBudget ? {
    hosting: String(initialBudget.hosting), storage: String(initialBudget.storage), compute: String(initialBudget.compute),
    maintenanceHours: String(initialBudget.maintenanceHours), hourlyRate: String(initialBudget.hourlyRate),
  } : { hosting: '', storage: '', compute: '', maintenanceHours: '', hourlyRate: '' })
  const calculatedBudget = useMemo(() => calculateBudget(budget), [budget])
  const budgetValid = calculatedBudget !== null
  const maintenance = calculatedBudget?.maintenance ?? 0
  const total = calculatedBudget?.monthlyTotal ?? 0
  useEffect(() => { onBudgetChange?.(calculatedBudget) }, [calculatedBudget, onBudgetChange])
  const exportBudget = () => {
    const values = calculatedBudget
    if (!values) return
    const url = URL.createObjectURL(new Blob([JSON.stringify({ schema: 'helpminths-budget-assumptions-v1', exported_at: new Date().toISOString(), currency: 'THB', ...values }, null, 2)], { type: 'application/json;charset=utf-8' }))
    const link = document.createElement('a'); link.href = url; link.download = 'HelpMinths-budget-assumptions.json'; link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return <div className="project-page">
    <div className="page-heading"><div><div className="section-kicker">FROM IDEA TO EVIDENCE</div><h1>โครงงานและหลักฐาน</h1><p>โจทย์ วิธีพัฒนา ผลที่เก็บจริง และแผนดูแล HelpMinths ต่อไป</p></div><div className="project-export-actions"><button className="button-quiet" onClick={onExportReport}><FileText size={16} /> ดาวน์โหลดรายงาน HTML</button><button className="button-quiet" onClick={onOpenSlides}><Presentation size={16} /> ดาวน์โหลดสไลด์ HTML</button></div></div>
    <section className="project-intro"><div><span className="project-label">EDUCATION & RESEARCH</span><h2>{projectIdentity.name} <span>— {projectIdentity.tagline}</span></h2><p>{projectIdentity.purpose}</p></div><button className="button-primary" onClick={onStartEvaluation}><ClipboardList size={17} /> เริ่มทดสอบกับผู้ใช้ <ArrowRight size={16} /></button></section>
    <nav className="project-tabs" aria-label="หัวข้อโครงงาน">{tabs.map((item) => <button key={item.id} onClick={() => setTab(item.id)} aria-current={tab === item.id ? 'page' : undefined} className={tab === item.id ? 'is-active' : ''}>{item.label}</button>)}</nav>

    {tab === 'overview' && <div className="project-content">
      <section className="project-card"><div className="project-section-title"><Target size={21} /><div><span className="project-label">DEFINE</span><h2>ปัญหาที่ต้องการศึกษา</h2></div></div><p>{projectIdentity.problem}</p><div className="project-callout"><strong>สิ่งที่ต้องตรวจสอบกับผู้ใช้</strong><span>ความยากเกิดในขั้นใด ใช้ตัวช่วยอะไรอยู่ และเครื่องมือนี้ช่วยให้ทำงานหรือเรียนรู้ได้ดีขึ้นเพียงใด ต้องเก็บจากการสัมภาษณ์และการทดลองจริง</span></div></section>
      <section className="project-hmw"><span className="project-label">HOW MIGHT WE</span><h2>{projectHmw}</h2><p>ขอบเขตนี้ใช้กับการฝึกเรียนรู้ด้วยตนเอง การยืนยัน label และการตัดสินใจทางคลินิกยังต้องมีผู้เชี่ยวชาญ</p><ReferenceLink id="design-thinking" /></section>
      <section><div className="project-section-heading"><div><h2>เราออกแบบให้ใคร</h2><p>Persona ต่อไปนี้เป็นสมมติฐานสำหรับใช้สัมภาษณ์ ไม่ใช่ผลวิจัยจากผู้ใช้จริง</p></div><span className="project-status hypothesis">สมมติฐาน · รอยืนยัน</span></div><div className="project-three-grid">{personas.map((person) => <article className="project-card project-persona" key={person.role}><Users size={23} /><h3>{person.role}</h3><dl><dt>เป้าหมาย</dt><dd>{person.goal}</dd><dt>อุปสรรคที่คาดไว้</dt><dd>{person.friction}</dd><dt>สิ่งที่ต้นแบบเสนอ</dt><dd>{person.support}</dd></dl></article>)}</div></section>
      <section className="project-card"><div className="project-section-title"><Layers3 size={21} /><h2>สิ่งที่มีแล้ว และสิ่งที่ยังต้องพิสูจน์</h2></div><div className="project-status-grid"><div><strong>12 กลุ่มอ้างอิง</strong><p>Atlas: ไข่ 11 กลุ่ม + Strongyloides ระยะตัวอ่อน</p><button onClick={onOpenAtlas}>เปิด Atlas <ArrowUpRight size={14} /></button></div><div><strong>3 ภาพ / 3 กลุ่ม</strong><p>ชุดทดลองที่ผู้ใช้ส่งผลรับรองการตรวจกลับมา ข้อมูลภาพเก็บแยกจากเว็บสาธารณะ</p><span className="project-status">ป้ายกำกับสำหรับรอบทดลอง</span></div><div><strong>{modelReady ? 'เชื่อมโมเดลได้' : 'ยังไม่ยืนยันโมเดลพร้อม'}</strong><p>สถานะบริการขณะนี้ไม่ใช่หลักฐานความแม่นยำ ยังต้องมีรายงานทดสอบภาพใหม่แยกต่างหาก</p><button onClick={onOpenScan}>ดูสถานะตรวจภาพ <ArrowUpRight size={14} /></button></div></div><p className="project-footnote">{projectIdentity.scope}</p><ReferenceLink id="yolo" /></section>
    </div>}

    {tab === 'journey' && <div className="project-content">
      <section><div className="project-section-heading"><div><h2>Design Thinking Journey</h2><p>แยกสิ่งที่ต้นแบบทำได้ออกจากหลักฐานผู้ใช้ที่ยังต้องเก็บ</p></div><ReferenceLink id="design-thinking" /></div><div className="project-thinking-list">{designThinkingStages.map((stage, index) => <article className="project-card" key={stage.key}><span className="project-stage-number">0{index + 1}</span><div><h3>{stage.title} <span>· {stage.thai}</span></h3><span className={`project-status ${stage.key === 'empathize' && summary.interviewCount === 0 ? 'hypothesis' : ''}`}>{stage.key === 'empathize' && summary.interviewCount > 0 ? `มีบันทึกสัมภาษณ์ ${summary.interviewCount} รายการ` : stage.state}</span><p>{stage.detail}</p><small>หลักฐานที่ต้องได้: {stage.output}</small></div></article>)}</div></section>
      <section className="project-card"><div className="project-section-title"><Users size={21} /><h2>เส้นทางผู้ใช้ก่อนและหลังมีต้นแบบ</h2></div><p>เป็นแผนที่สมมติฐานเพื่อใช้ถามและสังเกตผู้ใช้ ต้องปรับตามข้อมูลที่เก็บได้จริง</p><div className="project-table-wrap"><table><thead><tr><th>ช่วงงาน</th><th>แนวทางปัจจุบันที่คาดไว้</th><th>จุดติดขัดที่คาดไว้</th><th>ประสบการณ์ที่เสนอ</th><th>วิธีตรวจสอบ</th></tr></thead><tbody>{journeyStages.map((stage) => <tr key={stage.stage}><th scope="row">{stage.stage}</th><td>{stage.current}</td><td>{stage.friction}</td><td>{stage.proposed}</td><td>{stage.evidence}</td></tr>)}</tbody></table></div></section>
      <section className="project-card"><div className="project-section-title"><Lightbulb size={21} /><h2>ทำไมจึงเลือก Web App</h2></div><div className="project-table-wrap"><table><thead><tr><th>ทางเลือก</th><th>จุดเด่น</th><th>ข้อแลกเปลี่ยน</th></tr></thead><tbody>{ideaAlternatives.map((item) => <tr key={item.option}><th scope="row">{item.option}</th><td>{item.strength}</td><td>{item.tradeoff}</td></tr>)}</tbody></table></div></section>
      <section><div className="project-section-heading"><h2>ต้นแบบแต่ละระยะ</h2></div><div className="project-three-grid">{prototypeStages.map((stage) => <article className="project-card" key={stage.title}><h3>{stage.title}</h3><span className="project-status">{stage.status}</span><p>{stage.detail}</p></article>)}</div></section>
    </div>}

    {tab === 'evidence' && <div className="project-content">
      <section className="project-card"><div className="project-section-title"><FlaskConical size={21} /><div><span className="project-label">ACTUAL LOCAL RECORDS</span><h2>ผลที่บันทึกในอุปกรณ์นี้</h2></div></div><p>ตัวเลขต่อไปนี้มาจากข้อมูลที่บันทึกผ่านหน้าทดสอบ ไม่มีการเติมผลผู้เข้าร่วมอัตโนมัติ หากยังไม่มีข้อมูลจะแสดง 0 หรือยังไม่มีคะแนน</p><div className="project-metrics"><div><strong>{summary.participantCount}</strong><span>ผู้ร่วมทดสอบทุกบทบาท</span><small>เป้าหมายหลัก: นักศึกษา 3–5 คน</small></div><div><strong>{summary.completedAtlasCount}/{summary.atlasAttemptCount}</strong><span>งาน Atlas สำเร็จ / งานที่บันทึก</span><small>ดูเวลาและผลรายงานในหน้าทดสอบ</small></div><div><strong>{summary.successfulUploadCount}/{summary.uploadAttemptCount}</strong><span>อัปโหลดสำเร็จ / ครั้งที่บันทึก</span><small>แผน: ภาพจริง 5–10 ภาพ</small></div><div><strong>{summary.meanSUS === null ? '—' : summary.meanSUS.toFixed(1)}</strong><span>SUS เฉลี่ย · ช่วงคะแนน 0–100</span><small>ตอบครบ 10 ข้อ: {summary.completedSUSCount} ชุด</small></div></div><p className="project-footnote">จำนวนอัปโหลดเป็นจำนวนครั้ง ไม่ยืนยันว่าเป็นภาพไม่ซ้ำ ต้องตรวจชุดภาพและสัดส่วนผู้ร่วมทดสอบก่อนสรุปตามแผน SUS วัดการรับรู้ด้านการใช้งาน ไม่ใช่ความถูกต้องในการตรวจไข่พยาธิ</p><ReferenceLink id="sus" /><div className="project-inline-actions"><button className="button-primary" onClick={onStartEvaluation}>เก็บผลหรือดูรายละเอียด <ArrowRight size={16} /></button></div></section>
      <div className="project-two-grid"><section className="project-card"><h3>หลักฐานเข้าใจผู้ใช้</h3><p>บันทึกสัมภาษณ์ {summary.interviewCount} รายการ และ feedback {summary.feedbackCount} รายการ ต้องอ่านเนื้อหาและเชื่อมกับสิ่งที่เปลี่ยนในต้นแบบก่อนสรุปผล</p><button className="project-text-action" onClick={onStartEvaluation}>บันทึกสัมภาษณ์และข้อเสนอแนะ <ArrowUpRight size={14} /></button></section><section className="project-card"><h3>แยกการทดสอบสองเรื่อง</h3><p><strong>การใช้งาน:</strong> ค้นหา ซูม อัปโหลด สำเร็จหรือไม่ เวลาและ SUS</p><p><strong>โมเดล:</strong> ต้องมีภาพและ reference standard พร้อมชุดทดสอบอิสระ จึงวัด recall, precision และผลระดับสิ่งส่งตรวจได้</p><ReferenceLink id="ai-evaluation" /></section></div>
      <section className="project-card"><h2>สิ่งที่ปรับตามคำแนะนำที่ปรึกษา</h2><p>รายการนี้เป็นการเปลี่ยนต้นแบบตามเอกสารคำแนะนำ ไม่ใช่ผล feedback จากนักศึกษาที่ทำการทดสอบแล้ว</p><div className="project-change-list">{projectChanges.map((item) => <div key={item.change}><Check size={17} /><div><strong>{item.change}</strong><p>{item.evidence}</p><small>25 ตุลาคม 2569 · {item.source}</small></div></div>)}</div></section>
    </div>}

    {tab === 'sustainability' && <div className="project-content">
      <section className="project-card"><div className="project-section-title"><ShieldCheck size={21} /><h2>ใครดูแลเมื่อจบโครงงาน</h2></div><p>บทบาทต่อไปนี้เป็นข้อเสนอเพื่อให้หน่วยงานตกลงและแต่งตั้งผู้รับผิดชอบ ยังไม่มีการยืนยันบุคคลหรือการส่งมอบบัญชีบริการ</p><div className="project-role-grid">{sustainabilityRoles.map((role) => <article key={role.area}><h3>{role.area}</h3><strong>{role.proposedOwner}</strong><p>{role.duties}</p><span className="project-status hypothesis">รอแต่งตั้งและรับส่งงาน</span></article>)}</div></section>
      <section className="project-card"><h2>โรดแมปจากข้อมูลที่มี ไปสู่ความครอบคลุมที่พิสูจน์ได้</h2><p>เริ่มจาก 3 กลุ่มที่มีภาพทดลอง แยกจาก Atlas 12 กลุ่ม ไม่กำหนดว่าทุกรายการใน Atlas ตรวจด้วย AI ได้แล้ว</p><ol className="project-roadmap">{projectRoadmap.map((item) => <li key={item.stage}><h3>{item.stage}</h3><p>{item.goal}</p><small>เงื่อนไขก่อนขยับระยะ: {item.gate}</small></li>)}</ol></section>
      <section className="project-card"><div className="project-section-title"><Wallet size={21} /><h2>ทดลองวางงบดูแลระบบ</h2></div><p>กรอกสมมติฐานเป็นบาทต่อเดือน ช่องว่างหมายถึงยังไม่ได้ประเมิน ตัวเลขนี้ไม่ใช่ใบเสนอราคาหรือราคาปัจจุบันของ Render และยังไม่ถูกบันทึกเป็นงบประมาณยืนยัน</p><div className="project-budget-grid">{([
        ['hosting', 'เว็บ / hosting ต่อเดือน', 'บาท'], ['storage', 'พื้นที่ข้อมูลและสำรองต่อเดือน', 'บาท'], ['compute', 'ประมวลผลโมเดลต่อเดือน', 'บาท'], ['maintenanceHours', 'เวลาบำรุงรักษาต่อเดือน', 'ชั่วโมง'], ['hourlyRate', 'ต้นทุนเวลาบำรุงรักษา', 'บาท/ชั่วโมง'],
      ] as const).map(([key, label, unit]) => <label key={key}>{label}<div><input aria-label={label} type="number" min="0" max="100000000" step="any" value={budget[key]} placeholder="ยังไม่ประเมิน" onChange={(event) => { setBudget((previous) => ({ ...previous, [key]: event.target.value })) }} /><span>{unit}</span></div></label>)}</div><div className="project-budget-result" aria-live="polite"><div><span>ค่าดูแลตามเวลาที่กรอก</span><strong>{budgetValid ? `${baht(maintenance)} บาท/เดือน` : 'ยังกรอกไม่ครบ'}</strong></div><div><span>รวมตามสมมติฐาน</span><strong>{budgetValid ? `${baht(total)} บาท/เดือน` : 'ยังไม่มีประมาณการ'}</strong><small>{budgetValid ? `${baht(total * 12)} บาท/ปี` : 'กรอกทุกช่อง รวมค่า 0 หากไม่มีค่าใช้จ่ายส่วนนั้น'}</small></div><button className="button-quiet" disabled={!budgetValid} onClick={exportBudget}><Download size={15} /> บันทึกสมมติฐาน JSON</button></div><p className="project-footnote">ยังไม่รวมภาษี อัตราแลกเปลี่ยน หรือค่าใช้จ่ายอื่นที่ไม่ได้กรอก ประมาณการนี้อยู่ในเซสชันและแนบในรายงานเมื่อกรอกครบ ดาวน์โหลดเพื่อเก็บไว้ก่อนปิดหรือรีเฟรชหน้าเว็บ</p></section>
      <div className="project-two-grid"><section className="project-card"><h3>Render และแผนขยายบริการ</h3><p>ตรวจเงื่อนไข free tier เรื่องการพักบริการและเวลาเริ่มใหม่ CPU/RAM พื้นที่เก็บข้อมูล และความพร้อมใช้งานจากผู้ให้บริการก่อนใช้ทดสอบจริง หากภาระงานเพิ่ม ให้ประเมินแผนที่มีทรัพยากรเพียงพอและวัดเวลา infer บนอุปกรณ์ที่ใช้จริง</p><p>แยกไฟล์ที่ต้องเก็บถาวรออกจากพื้นที่ชั่วคราวของบริการ เก็บเวอร์ชัน code/weights/data และทดสอบการกู้คืนเป็นระยะ</p><ReferenceLink id="render-free" /> <ReferenceLink id="render-pricing" /></section><section className="project-card"><h3>ก่อนใช้ในหน่วยบริการจริง</h3><ul className="project-check-list">{readinessGates.map((gate) => <li key={gate}>{gate}</li>)}</ul><ReferenceLink id="who-ai" /></section></div>
    </div>}

    {tab === 'references' && <section className="project-card project-references"><div className="project-section-title"><BookOpen size={21} /><h2>เอกสารอ้างอิงสำหรับรายงานและสไลด์</h2></div><p>ใช้แหล่งอ้างอิงประกอบวิธีพัฒนาและการทดสอบ โดยแยกสถานะการเข้าถึงไว้ตามจริง คะแนนประสิทธิภาพของแหล่งอื่นไม่ใช่ผลของ HelpMinths</p><ol>{projectReferences.map((reference) => <li key={reference.id} id={`project-reference-${reference.id}`}><p>{reference.citation}</p><a href={reference.url} target="_blank" rel="noreferrer">เปิดเอกสารต้นทาง <ExternalLink size={13} /></a>{reference.accessNote && <small>{reference.accessNote}</small>}</li>)}</ol><div className="project-inline-actions"><button className="button-primary" onClick={onExportReport}><FileText size={16} /> ดาวน์โหลดรายงาน HTML</button><button className="button-quiet" onClick={onOpenSlides}><Presentation size={16} /> ดาวน์โหลดสไลด์ HTML</button></div></section>}
  </div>
}
