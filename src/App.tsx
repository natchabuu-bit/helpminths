import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { ArrowDownToLine, ArrowRight, ArrowUpRight, BookOpen, Box, Camera, Check, ChevronRight, CircleHelp, ClipboardList, Clock3, FlaskConical, Focus, History, LayoutDashboard, LoaderCircle, Menu, Microscope, ScanLine, Search, ShieldCheck, Sparkles, Upload, X } from 'lucide-react'
import Scan from './components/Scan'
import type { AnalysisRecord } from './components/Scan'
import EggIllustration from './components/EggIllustration'
import OfflinePanel from './components/OfflinePanel'
import Evaluation, { StudyStatus } from './components/Evaluation'
import { useEvaluationStudy } from './hooks/useEvaluationStudy'
import type { ProjectBudget } from './data/project'
import { getSpeciesById, groupLabels, matchSpeciesLabel, species } from './data/species'
import './styles/project-shell.css'

const Atlas = lazy(() => import('./components/Atlas'))
const Project = lazy(() => import('./components/Project'))
type Page = 'home' | 'scan' | 'atlas' | 'history' | 'project' | 'evaluation'
const featuredSpecies = ['opisthorchis', 'mif', 'hymenolepis-nana'].map(getSpeciesById)
const pageNames: Record<Page, string> = { home: 'ภาพรวม', scan: 'ตรวจวิเคราะห์', atlas: 'Atlas 3D', history: 'ประวัติการตรวจ', project: 'โครงงานและหลักฐาน', evaluation: 'ทดสอบและ Feedback' }

function Brand({ small = false }: { small?: boolean }) {
  return <div className={`brand ${small ? 'brand-small' : ''}`}><div className="brand-symbol"><svg viewBox="0 0 40 40" aria-hidden="true"><ellipse cx="20" cy="20" rx="9" ry="13" transform="rotate(32 20 20)"/><ellipse cx="20" cy="20" rx="3.4" ry="6" transform="rotate(32 20 20)"/><circle cx="31" cy="8" r="2.5"/></svg></div><span>Help<span className="brand-light">Minths</span><small>PARASITOLOGY, REIMAGINED</small></span></div>
}

export default function App() {
  const [page, setPage] = useState<Page>(() => {
    const initial = window.location.hash.slice(1)
    return Object.hasOwn(pageNames, initial) ? initial as Page : 'home'
  })
  const study = useEvaluationStudy()
  const [menuOpen, setMenuOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [records, setRecords] = useState<AnalysisRecord[]>([])
  const [selectedRecord, setSelectedRecord] = useState<AnalysisRecord | null>(null)
  const [initialSpecies, setInitialSpecies] = useState<string | undefined>()
  const [demo, setDemo] = useState(false)
  const [scanKey, setScanKey] = useState(0)
  const [modelReady, setModelReady] = useState(false)
  const [backendReady, setBackendReady] = useState(false)
  const [backendChecked, setBackendChecked] = useState(false)
  const [exporting, setExporting] = useState<'report' | 'slides' | null>(null)
  const [exportError, setExportError] = useState('')
  const [projectBudget, setProjectBudget] = useState<ProjectBudget | null>(null)
  const mainRef = useRef<HTMLElement>(null)
  const helpRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!helpOpen) return
    const previousFocus = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const panel = helpRef.current
    panel?.querySelector<HTMLButtonElement>('button')?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setHelpOpen(false)
      if (event.key !== 'Tab' || !panel) return
      const focusable = [...panel.querySelectorAll<HTMLElement>('button, a[href], input, select, [tabindex="0"]')]
      const first = focusable[0], last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
      previousFocus?.focus()
    }
  }, [helpOpen])

  useEffect(() => {
    let active = true
    let requestId = 0
    const health = async () => {
      const currentRequest = ++requestId
      try {
        const response = await fetch('/api/health', { cache: 'no-store', signal: AbortSignal.timeout(10_000) })
        if (!response.ok) throw new Error('health')
        const body = await response.json()
        if (active && currentRequest === requestId) { setBackendReady(true); setModelReady(body.model_ready === true) }
      } catch { if (active && currentRequest === requestId) { setBackendReady(false); setModelReady(false) } }
      finally { if (active && currentRequest === requestId) setBackendChecked(true) }
    }
    void health()
    const networkChanged = () => {
      setBackendReady(false); setModelReady(false)
      void health()
    }
    window.addEventListener('online', networkChanged)
    window.addEventListener('offline', networkChanged)
    const timer = window.setInterval(health, 30_000)
    return () => { active = false; clearInterval(timer); window.removeEventListener('online', networkChanged); window.removeEventListener('offline', networkChanged) }
  }, [])

  const navigate = (next: Page) => {
    setPage(next); setMenuOpen(false)
    setExportError('')
    window.history.replaceState(null, '', `#${next}`)
    mainRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const openScan = (showDemo = false, record: AnalysisRecord | null = null) => {
    setDemo(showDemo); setSelectedRecord(record); setScanKey(key => key + 1); navigate('scan')
  }
  const openAtlas = (id?: string) => {
    const match = species.find(item => item.id === id) ?? matchSpeciesLabel(id)
    setInitialSpecies(match?.id); navigate('atlas')
  }
  const saveRecord = (record: AnalysisRecord) => setRecords(old => [record, ...old.filter(item => item.id !== record.id)])
  const exportProject = async (kind: 'report' | 'slides') => {
    if (exporting) return
    setExporting(kind); setExportError('')
    try {
      const tools = await import('./utils/projectExports')
      const input = { summary: study.summary, snapshot: study.getSnapshot(), modelReady, budget: projectBudget }
      await (kind === 'report' ? tools.downloadProjectReport(input) : tools.downloadProjectSlides(input))
    } catch {
      setExportError('สร้างไฟล์ไม่สำเร็จ กรุณารอให้เว็บพร้อมใช้งานออฟไลน์หรือเชื่อมต่อแล้วลองอีกครั้ง')
    } finally { setExporting(null) }
  }

  return <div className="app-shell">
    {menuOpen && <button className="sidebar-backdrop" aria-label="ปิดเมนู" onClick={() => setMenuOpen(false)} />}
    <aside className={`sidebar ${menuOpen ? 'is-open' : ''}`}>
      <button className="brand-button" onClick={() => navigate('home')} aria-label="HelpMinths หน้าหลัก"><Brand /></button>
      <div className="sidebar-label">WORKSPACE</div>
      <nav aria-label="เมนูหลัก">
        {([{ id: 'home', icon: LayoutDashboard, label: 'ภาพรวม' }, { id: 'scan', icon: ScanLine, label: 'ตรวจวิเคราะห์', badge: 'AI' }, { id: 'atlas', icon: Box, label: 'Atlas 3D' }, { id: 'history', icon: History, label: 'ประวัติการตรวจ' }, { id: 'project', icon: ClipboardList, label: 'โครงงานและหลักฐาน' }, { id: 'evaluation', icon: FlaskConical, label: 'ทดสอบและ Feedback' }] as const).map(item => <button key={item.id} className={`nav-item ${page === item.id ? 'active' : ''}`} onClick={() => item.id === 'scan' ? openScan() : navigate(item.id)} aria-current={page === item.id ? 'page' : undefined}><item.icon size={19} /><span>{item.label}</span>{'badge' in item && <span className="nav-badge">{item.badge}</span>}{item.id === 'history' && records.length > 0 && <span className="nav-count">{records.length}</span>}</button>)}
      </nav>
      <div className="sidebar-learning"><div className="learning-icon"><Microscope size={22}/></div><span className="eyebrow">A CLOSER LOOK</span><h3>โลกใบเล็ก<br/>ที่รอให้คุณค้นพบ</h3><p>เรียนรู้โครงสร้างไข่พยาธิ<br/>ผ่านมุมมองใหม่ในแบบ 3D</p><button onClick={() => openAtlas()}>สำรวจ Atlas <ArrowUpRight size={16}/></button></div>
      <div className="sidebar-bottom"><button className="help-link" onClick={() => setHelpOpen(true)}><CircleHelp size={18}/><span>คู่มือการใช้งาน</span><ArrowUpRight size={14}/></button><div className="workspace-profile"><div className="profile-avatar">HM</div><div><strong>พื้นที่การเรียนรู้</strong><span>Education & Research</span></div><span className="profile-dot"/></div></div>
    </aside>

    <div className="main-layout">
      <header className="topbar"><div className="breadcrumb"><button className="mobile-menu icon-button" onClick={() => setMenuOpen(true)} aria-label="เปิดเมนู"><Menu size={21}/></button><span>พื้นที่ทำงาน</span><ChevronRight size={14}/><strong>{pageNames[page]}</strong></div><div className="topbar-right"><span className="education-badge"><ShieldCheck size={14}/> เพื่อการศึกษาและวิจัย</span><button className="topbar-help icon-button" onClick={() => setHelpOpen(true)} aria-label="คู่มือการใช้งาน"><CircleHelp size={19}/></button><div className="topbar-avatar">HM</div></div></header>
      <main ref={mainRef} className={`main-content page-${page}`}>
        <StudyStatus study={study} onReturn={() => navigate('evaluation')} />
        <OfflinePanel />
        {exporting && <div className="project-export-status" role="status"><LoaderCircle size={17} className="spin"/>กำลังเตรียม{exporting === 'report' ? 'รายงาน' : 'สไลด์'}พร้อมภาพหน้าจอและเอกสารอ้างอิง…</div>}
        {exportError && <div className="project-export-error" role="alert">{exportError}</div>}
        {page === 'home' && <>
          <div className="page-heading"><div><div className="section-kicker"><span/> YOUR MICROSCOPIC COMPANION</div><h1>มองเห็น เข้าใจ <span>เรียนรู้</span></h1><p>ผู้ช่วยสำรวจโลกของไข่พยาธิ ตั้งแต่ภาพใต้กล้องสู่ความเข้าใจที่ลึกขึ้น</p></div><div className={`connection-status ${modelReady ? 'ready' : ''}`} title={backendReady ? modelReady ? 'โมเดลพร้อมใช้งานผ่านบริการวิเคราะห์' : 'API พร้อมใช้งาน รอไฟล์โมเดลที่ฝึกแล้ว' : 'การตรวจ AI ต้องเชื่อมบริการวิเคราะห์'}><span/>{modelReady ? 'โมเดล AI พร้อมใช้งาน' : backendReady ? 'API พร้อม · รอเชื่อมโมเดล' : backendChecked ? 'ยังเชื่อมบริการตรวจภาพไม่ได้' : 'กำลังเชื่อมต่อบริการ'}</div></div>

          <section className="hero-card">
            <div className="hero-copy"><span className="hero-badge"><Sparkles size={14}/> A NEW PERSPECTIVE ON PARASITOLOGY</span><h2>เรื่องเล็กที่มองเห็น<br/>สร้างความเข้าใจ<span>ที่ยิ่งใหญ่</span></h2><p>อัปโหลดภาพจากกล้องจุลทรรศน์ เพื่อระบุตำแหน่ง<br className="desktop-break"/>และชนิดไข่พยาธิด้วยโมเดล AI ที่เชื่อมต่อไว้</p><div className="hero-actions"><button className="button-primary" onClick={() => openScan()}><ScanLine size={18}/> เริ่มตรวจวิเคราะห์ <ArrowRight size={17}/></button><button className="button-quiet" onClick={() => openScan(true)}>ดูตัวอย่าง <ArrowUpRight size={16}/></button></div><div className="hero-notes"><span><Check size={13}/> อัปโหลดหรือถ่ายภาพ</span><span><Check size={13}/> แสดงกรอบและชนิดไข่</span></div></div>
            <div className="hero-visual" aria-label="ภาพจำลองโครงสร้างไข่พยาธิเพื่อการศึกษา"><div className="orbital orbital-one"/><div className="orbital orbital-two"/><div className="orbital orbital-three"/><span className="visual-cross cross-one">+</span><span className="visual-cross cross-two">+</span><span className="visual-coordinate">MORPHOLOGY / 01</span><div className="hero-egg egg-main"><EggIllustration speciesId="ascaris"/></div><div className="hero-egg egg-secondary"><EggIllustration speciesId="trichuris"/></div><div className="hero-egg egg-tertiary"><EggIllustration speciesId="hookworm"/></div><div className="specimen-label"><span className="specimen-dot"/><div><strong>Ascaris lumbricoides</strong><span>ไข่พยาธิไส้เดือน · ภาพจำลอง</span></div><Focus size={19}/></div><div className="visual-scale"><span/>EXPLORE EVERY DETAIL</div></div>
          </section>

          <div className="capability-strip"><div><div className="capability-icon"><Focus size={21}/></div><span><strong>ตรวจจับเป็นรายฟอง</strong><small>ระบุตำแหน่งด้วย Bounding box</small></span></div><div><div className="capability-icon"><Box size={21}/></div><span><strong>เรียนรู้ในมุมมอง 3D</strong><small>หมุน ซูม และสำรวจโครงสร้าง</small></span></div><div><div className="capability-icon"><ShieldCheck size={21}/></div><span><strong>ภาพอยู่ในเซสชันของคุณ</strong><small>บริการไม่จัดเก็บภาพถาวร</small></span></div></div>

          <section className="workflow-section"><div className="section-heading"><div><h2>จากภาพ สู่การค้นพบ</h2><p>เริ่มต้นได้ง่าย ๆ ใน 3 ขั้นตอน</p></div><span className="small-caption">DESIGNED FOR A CLEARER VIEW</span></div><div className="workflow-grid">{[{ n: '01', icon: Upload, title: 'เพิ่มภาพที่ต้องการตรวจ', detail: 'เลือกภาพจากคลัง หรือถ่ายภาพผ่านกล้องมือถือ', link: 'อัปโหลดภาพ', action: () => openScan() }, { n: '02', icon: ScanLine, title: 'สำรวจผลวิเคราะห์', detail: 'ดูกรอบตำแหน่ง ชนิด และค่าความมั่นใจของโมเดล', link: 'ลองดูตัวอย่าง', action: () => openScan(true) }, { n: '03', icon: BookOpen, title: 'ต่อยอดความเข้าใจ', detail: 'เปรียบเทียบลักษณะสำคัญกับไข่พยาธิใน Atlas 3D', link: 'เปิด Atlas 3D', action: () => openAtlas() }].map(step => <article className="workflow-card" key={step.n}><div className="workflow-top"><step.icon size={22}/><span>{step.n}</span></div><h3>{step.title}</h3><p>{step.detail}</p><button onClick={step.action}>{step.link}<ArrowUpRight size={15}/></button></article>)}</div></section>

          <section className="atlas-preview"><div className="section-heading"><div><div className="section-kicker">THE MORPHOLOGY COLLECTION</div><h2>รู้จักให้ลึก มองเห็นให้ชัด</h2><p>คัดกลุ่มอ้างอิงสำหรับการเรียนรู้ในบริบทไทย</p></div><button className="text-button" onClick={() => openAtlas()}>สำรวจทั้ง {species.length} กลุ่ม <ArrowRight size={16}/></button></div><div className="specimen-grid">{featuredSpecies.map((item, i) => <button className="specimen-card" key={item.id} onClick={() => openAtlas(item.id)}><div className={`specimen-art specimen-art-${i}`}><EggIllustration speciesId={item.id}/><span className="specimen-number">SPECIMEN 0{i + 1}</span><span className="view-3d"><Box size={12}/> 3D</span></div><div className="specimen-info"><span>{groupLabels[item.group]}</span><h3>{item.name}</h3><div><p>{item.thaiName}</p><ArrowUpRight size={17}/></div></div></button>)}</div></section>

          <div className="research-note"><div><ShieldCheck size={20}/><p><strong>ออกแบบเพื่อการเรียนรู้และช่วยคัดกรอง</strong><span>ผลจาก AI ต้องได้รับการทบทวนโดยผู้เชี่ยวชาญ และไม่ใช้แทนการวินิจฉัยทางคลินิก</span></p></div><button onClick={() => setHelpOpen(true)}>เรียนรู้เพิ่มเติม <ArrowUpRight size={15}/></button></div>
          <section className="project-home-card"><div><span className="section-kicker">BUILD WITH EVIDENCE</span><h2>จากต้นแบบ สู่หลักฐานการเรียนรู้</h2><p>อ่านแนวคิดโครงงาน ทดลองจับเวลา เก็บ SUS และข้อเสนอแนะ แล้วสร้างรายงานพร้อมเอกสารอ้างอิง</p></div><div><button className="button-quiet" onClick={() => navigate('project')}><ClipboardList size={17}/> อ่านแนวคิดโครงงาน</button><button className="button-primary" onClick={() => navigate('evaluation')}><FlaskConical size={17}/> เริ่มทดสอบต้นแบบ</button></div></section>
        </>}
        {page === 'scan' && <Scan key={scanKey} startDemo={demo} initialRecord={selectedRecord} onResult={saveRecord} openAtlas={openAtlas} onUploadAttempt={study.recordUploadAttempt}/>}
        {page === 'atlas' && <Suspense fallback={<div className="loading-state"><LoaderCircle className="spin"/><p>กำลังเตรียม Atlas 3D…</p></div>}><Atlas initialSpecies={initialSpecies}/></Suspense>}
        {page === 'project' && <Suspense fallback={<div className="loading-state"><LoaderCircle className="spin"/><p>กำลังเตรียมข้อมูลโครงงาน…</p></div>}><Project summary={study.summary} modelReady={modelReady} initialBudget={projectBudget} onBudgetChange={setProjectBudget} onStartEvaluation={() => navigate('evaluation')} onOpenAtlas={() => openAtlas()} onOpenScan={() => openScan()} onExportReport={() => { void exportProject('report') }} onOpenSlides={() => { void exportProject('slides') }}/></Suspense>}
        {page === 'evaluation' && <Evaluation study={study} onOpenAtlas={() => openAtlas()} onOpenScan={() => openScan()}/>}
        {page === 'history' && <><div className="page-heading"><div><div className="section-kicker">YOUR DISCOVERIES</div><h1>ประวัติการตรวจ</h1><p>ผลวิเคราะห์ในเซสชันนี้ ภาพจะหายไปเมื่อรีเฟรชหรือปิดหน้าเว็บ</p></div><button className="button-primary" onClick={() => openScan()}><ScanLine size={17}/> ตรวจภาพใหม่</button></div>{records.length === 0 ? <div className="empty-state"><div className="empty-icon"><History size={32}/></div><h2>ทุกการค้นพบ จะอยู่ตรงนี้</h2><p>เริ่มตรวจภาพแรก หรือทดลองดูผลสาธิตเพื่อเรียนรู้วิธีใช้งาน</p><button className="button-primary" onClick={() => openScan()}>เริ่มตรวจวิเคราะห์ <ArrowRight size={17}/></button></div> : <div className="history-grid">{records.map(record => <button className="history-card" key={record.id} onClick={() => openScan(false, record)}><img src={record.imageUrl} alt={`ภาพ ${record.filename}`}/><div><span className={`record-mode ${record.mode}`}>{record.mode === 'demo' ? 'ข้อมูลสาธิต' : 'ผลจากโมเดล'}</span><h3>{record.filename}</h3><p><Clock3 size={13}/>{new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' }).format(new Date(record.createdAt))}</p><div className="history-card-bottom"><strong>{record.detections.length} ตำแหน่ง</strong><span>เปิดผลตรวจ <ArrowUpRight size={15}/></span></div></div></button>)}</div>}</>}
        <footer className="app-footer"><span>HelpMinths <span className="footer-dot">·</span> A little closer. A lot clearer.</span><span>สร้างเพื่อการศึกษาและวิจัย <span className="footer-version">v0.1</span></span></footer>
      </main>
    </div>

    {helpOpen && <div className="modal-backdrop" onClick={() => setHelpOpen(false)}><section ref={helpRef} className="help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={event => event.stopPropagation()}><button className="modal-close icon-button" onClick={() => setHelpOpen(false)} aria-label="ปิดคู่มือ"><X size={21}/></button><Brand small/><h2 id="help-title">เริ่มต้นกับ HelpMinths</h2><p className="help-intro">จากภาพจุลทรรศน์ สู่พื้นที่สำหรับเรียนรู้และสำรวจ</p><div className="help-steps"><div><Camera/><p><strong>1. เลือกภาพหรือถ่ายภาพ</strong><span>ใช้ภาพกล้องจุลทรรศน์ที่เห็นโครงสร้างชัดเจน รองรับ JPEG, PNG และ WebP ไม่เกิน 20 MB</span></p></div><div><Search/><p><strong>2. ตรวจภาพด้วยโมเดล</strong><span>ระบบต้องเชื่อมโมเดลที่ฝึกแล้วก่อนตรวจจริง เมื่อพร้อมจะแสดงกรอบ ชนิด และค่าความมั่นใจรายฟอง</span></p></div><div><Box/><p><strong>3. เปรียบเทียบกับ Atlas 3D</strong><span>หมุนและซูมแบบจำลองเพื่อดูจุดสังเกต แบบจำลองเป็นภาพอธิบายโครงสร้าง ไม่ใช่ภาพสแกนจริง</span></p></div><div><ArrowDownToLine/><p><strong>4. บันทึกผล</strong><span>ดาวน์โหลดรายงาน JSON ได้จากหน้าผลตรวจ ประวัติเก็บในหน่วยความจำเฉพาะเซสชันนี้</span></p></div></div><div className="help-note"><ShieldCheck size={18}/><p>ข้อมูลสาธิตไม่ใช่ผลตรวจ AI ผลวิเคราะห์จริงเป็นข้อมูลช่วยคัดกรองและต้องยืนยันโดยผู้เชี่ยวชาญ</p></div><button className="button-primary help-cta" onClick={() => { setHelpOpen(false); openScan() }}>เริ่มสำรวจ <ArrowRight size={17}/></button></section></div>}
  </div>
}
