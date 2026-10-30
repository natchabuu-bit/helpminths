import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { ArrowDownToLine, ArrowRight, ArrowUpRight, BookOpen, Box, Camera, Check, CircleHelp, Clock3, FileText, Focus, GraduationCap, History, LayoutDashboard, LoaderCircle, Menu, MessageCircle, Microscope, ScanLine, Search, ShieldCheck, Settings, Sparkles, Upload, X } from 'lucide-react'
import Scan from './components/Scan'
import type { AnalysisRecord } from './components/Scan'
import EggIllustration from './components/EggIllustration'
import OfflinePanel from './components/OfflinePanel'
import Evaluation from './components/Evaluation'
import { useFeedback } from './hooks/useFeedback'
import { usePlatformSession, roleNames } from './platform/api'
import './styles/platform-shell.css'
import { getSpeciesById, groupLabels, matchSpeciesLabel, species } from './data/species'

const Atlas = lazy(() => import('./components/Atlas'))
const PlatformDashboard = lazy(() => import('./components/PlatformDashboard'))
const AnalysisHistory = lazy(() => import('./components/AnalysisHistory'))
const ExpertVerification = lazy(() => import('./components/ExpertVerification'))
const LearningLab = lazy(() => import('./components/LearningLab'))
const PlatformReports = lazy(() => import('./components/PlatformReports'))
const ModelPerformance = lazy(() => import('./components/ModelPerformance'))
const PlatformSettings = lazy(() => import('./components/PlatformSettings'))
const pendingPage = <div className="loading-state"><LoaderCircle className="spin"/><p>กำลังเตรียมหน้าที่เลือก…</p></div>
type Page = 'home' | 'scan' | 'atlas' | 'history' | 'evaluation' | 'verification' | 'learning' | 'reports' | 'performance' | 'settings'
const featuredSpecies = ['opisthorchis', 'mif', 'hymenolepis-nana'].map(getSpeciesById)
const pageNames: Record<Page, string> = { home: 'ภาพรวม', scan: 'ตรวจวิเคราะห์', atlas: 'Atlas 3D', history: 'ประวัติการตรวจ', evaluation: 'แบบประเมิน SUS', verification: 'ทบทวนโดยผู้เชี่ยวชาญ', learning: 'ห้องเรียนพยาธิ', reports: 'รายงาน', performance: 'ประเมินและข้อเสนอแนะ', settings: 'ตั้งค่าและบัญชี' }

function Brand({ small = false }: { small?: boolean }) {
  return <div className={`brand ${small ? 'brand-small' : ''}`}><div className="brand-symbol"><svg viewBox="0 0 40 40" aria-hidden="true"><ellipse cx="20" cy="20" rx="9" ry="13" transform="rotate(32 20 20)"/><ellipse cx="20" cy="20" rx="3.4" ry="6" transform="rotate(32 20 20)"/><circle cx="31" cy="8" r="2.5"/></svg></div><span>Help<span className="brand-light">Minths</span><small>PARASITOLOGY AI PLATFORM</small></span></div>
}

export default function App() {
  const [page, setPage] = useState<Page>(() => {
    const initial = window.location.hash.slice(1)
    return Object.hasOwn(pageNames, initial) ? initial as Page : 'home'
  })
  const feedback = useFeedback()
  const platform = usePlatformSession()
  const [platformAnalysisId, setPlatformAnalysisId] = useState<string | undefined>()
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
  const authIdentity = platform.session.user ? `${platform.session.user.id}:${platform.session.user.role}` : 'public'
  const lastIdentity = useRef(authIdentity)
  const visibleRecords = records.filter(record => record.mode === 'demo' || (!platform.session.configured && !platform.session.user && record.storage !== 'private'))
  const safeSelectedRecord = selectedRecord?.mode === 'demo' || (!platform.session.configured && !platform.session.user && selectedRecord?.storage !== 'private') ? selectedRecord : null
  const mainRef = useRef<HTMLElement>(null)
  const helpRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (platform.loading || lastIdentity.current === authIdentity) return
    lastIdentity.current = authIdentity
    setRecords(previous => previous.filter(record => record.mode === 'demo'))
    setSelectedRecord(null); setPlatformAnalysisId(undefined); setDemo(false); setScanKey(previous => previous + 1)
  }, [authIdentity, platform.loading])

  useEffect(() => {
    const initial = window.location.hash.slice(1)
    if (initial && !Object.hasOwn(pageNames, initial)) window.history.replaceState(null, '', '#home')
  }, [])

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
  const saveRecord = (record: AnalysisRecord) => {
    if (record.mode === 'real' && record.storage === 'private') { setPlatformAnalysisId(record.id); return }
    setRecords(old => [record, ...old.filter(item => item.id !== record.id)])
  }

  const dashboard = <Suspense fallback={pendingPage}><PlatformDashboard key={authIdentity} session={platform.session} onNavigate={navigate} onOpenAnalysis={id => { setPlatformAnalysisId(id); navigate('verification') }}/></Suspense>

  return <div className="app-shell platform-shell">
    {menuOpen && <button className="sidebar-backdrop" aria-label="ปิดเมนู" onClick={() => setMenuOpen(false)} />}
    <aside className={`sidebar ${menuOpen ? 'is-open' : ''}`}>
      <button className="brand-button" onClick={() => navigate('home')} aria-label="HelpMinths หน้าหลัก"><Brand /></button>
      <nav id="primary-navigation" aria-label="เมนูหลัก">
        {([{ id: 'home', icon: LayoutDashboard, label: 'ภาพรวม' }, { id: 'scan', icon: ScanLine, label: 'ตรวจวิเคราะห์', badge: 'AI' }, { id: 'atlas', icon: Box, label: 'Atlas 3D' }, { id: 'history', icon: History, label: 'ประวัติการตรวจ' }, { id: 'verification', icon: ShieldCheck, label: 'ทบทวนโดยผู้เชี่ยวชาญ' }, { id: 'learning', icon: GraduationCap, label: 'ห้องเรียนพยาธิ' }, { id: 'reports', icon: FileText, label: 'รายงาน' }, { id: 'performance', icon: MessageCircle, label: 'ประเมินและข้อเสนอแนะ' }, { id: 'settings', icon: Settings, label: 'ตั้งค่าและบัญชี' }] as const).map(item => <button key={item.id} className={`nav-item ${page === item.id || (page === 'evaluation' && item.id === 'performance') ? 'active' : ''}`} onClick={() => item.id === 'scan' ? openScan() : navigate(item.id)} aria-current={page === item.id || (page === 'evaluation' && item.id === 'performance') ? 'page' : undefined}><item.icon size={19} /><span>{item.label}</span>{'badge' in item && <span className="nav-badge">{item.badge}</span>}{item.id === 'history' && visibleRecords.length > 0 && <span className="nav-count">{visibleRecords.length}</span>}</button>)}
      </nav>
      <div className="sidebar-learning"><div className="learning-icon"><Microscope size={22}/></div><span className="eyebrow">A CLOSER LOOK</span><h3>โลกใบเล็ก<br/>ที่รอให้คุณค้นพบ</h3><p>เรียนรู้โครงสร้างไข่พยาธิ<br/>ผ่านมุมมองใหม่ในแบบ 3D</p><button onClick={() => openAtlas()}>สำรวจ Atlas <ArrowUpRight size={16}/></button></div>
      <div className="sidebar-bottom"><button className="help-link" onClick={() => setHelpOpen(true)}><CircleHelp size={18}/><span>คู่มือการใช้งาน</span><ArrowUpRight size={14}/></button><div className="workspace-profile"><div className="profile-avatar">HM</div><div><strong>{platform.session.user?.username ?? 'ผู้เยี่ยมชม'}</strong><span>{platform.session.user ? roleNames[platform.session.user.role] : 'Atlas และการเรียนรู้เปิดให้ใช้งาน'}</span></div><span className="profile-dot"/></div></div>
    </aside>

    <div className="main-layout">
      <header className="topbar"><div className="breadcrumb"><button className="mobile-menu icon-button" onClick={() => setMenuOpen(true)} aria-label="เปิดเมนู" aria-expanded={menuOpen} aria-controls="primary-navigation"><Menu size={21}/></button><strong>{pageNames[page]}</strong></div><div className="topbar-right"><span className="education-badge"><ShieldCheck size={14}/> เพื่อการศึกษาและวิจัย</span><button className="topbar-help icon-button" onClick={() => setHelpOpen(true)} aria-label="คู่มือการใช้งาน"><CircleHelp size={19}/></button><button className="topbar-avatar" aria-label="บัญชีและการตั้งค่า" onClick={() => navigate('settings')} title={platform.session.user?.username ?? 'เข้าสู่ระบบ'}>HM</button></div></header>
      <main ref={mainRef} className={`main-content page-${page}`}>
        <OfflinePanel />
        {page === 'home' && <>
          <div className="page-heading"><div><div className="section-kicker"><span/> ผู้ช่วยเรียนรู้ไข่พยาธิ ใกล้ตัวคุณ</div><h1>มองเห็น เข้าใจ <span>เรียนรู้</span></h1><p>ผู้ช่วยสำรวจโลกของไข่พยาธิ ตั้งแต่ภาพใต้กล้องสู่ความเข้าใจที่ลึกขึ้น</p></div><div className={`connection-status ${modelReady ? 'ready' : ''}`} title={backendReady ? modelReady ? 'โมเดลพร้อมใช้งานผ่านบริการวิเคราะห์' : 'บริการพร้อมแล้ว กำลังเตรียมโมเดลสำหรับการตรวจภาพจริง' : 'การตรวจ AI ต้องเชื่อมบริการวิเคราะห์'}><span/>{modelReady ? 'โมเดล AI พร้อมใช้งาน' : backendReady ? 'ยังไม่พร้อมตรวจด้วย AI' : backendChecked ? 'ยังเชื่อมบริการตรวจภาพไม่ได้' : 'กำลังเชื่อมต่อบริการ'}</div></div>

          {platform.session.user && dashboard}
          <section className="hero-card">
            <div className="hero-copy"><span className="hero-badge"><Sparkles size={14}/> เปิดมุมมองใหม่ให้ทุกการเรียนรู้</span><h2>เรื่องเล็กที่มองเห็น<br/>สร้างความเข้าใจ<span>ที่ยิ่งใหญ่</span></h2><p>อัปโหลดภาพจากกล้องจุลทรรศน์ เพื่อระบุตำแหน่ง<br className="desktop-break"/>และชนิดไข่พยาธิด้วยโมเดล AI ที่เชื่อมต่อไว้</p><div className="hero-actions"><button className="button-primary" onClick={() => openScan()}><ScanLine size={18}/> เริ่มตรวจวิเคราะห์ <ArrowRight size={17}/></button><button className="button-quiet" onClick={() => openScan(true)}>ดูตัวอย่าง <ArrowUpRight size={16}/></button></div><div className="hero-notes"><span><Check size={13}/> อัปโหลดหรือถ่ายภาพ</span><span><Check size={13}/> แสดงกรอบและชนิดไข่</span></div></div>
            <div className="hero-visual" aria-label="ภาพจำลองโครงสร้างไข่พยาธิเพื่อการศึกษา"><div className="orbital orbital-one"/><div className="orbital orbital-two"/><div className="orbital orbital-three"/><span className="visual-cross cross-one">+</span><span className="visual-cross cross-two">+</span><span className="visual-coordinate">MORPHOLOGY / 01</span><div className="hero-egg egg-main"><EggIllustration speciesId="ascaris"/></div><div className="hero-egg egg-secondary"><EggIllustration speciesId="trichuris"/></div><div className="hero-egg egg-tertiary"><EggIllustration speciesId="hookworm"/></div><div className="specimen-label"><span className="specimen-dot"/><div><strong>Ascaris lumbricoides</strong><span>ไข่พยาธิไส้เดือน · ภาพจำลอง</span></div><Focus size={19}/></div><div className="visual-scale"><span/>EXPLORE EVERY DETAIL</div></div>
          </section>

          {!platform.session.user && dashboard}
          <div className="capability-strip"><div><div className="capability-icon"><Focus size={21}/></div><span><strong>ตรวจจับเป็นรายฟอง</strong><small>ดูกรอบตำแหน่งและชนิดของไข่</small></span></div><div><div className="capability-icon"><Box size={21}/></div><span><strong>เรียนรู้ในมุมมอง 3D</strong><small>หมุน ซูม และสำรวจโครงสร้าง</small></span></div><div><div className="capability-icon"><ShieldCheck size={21}/></div><span><strong>{platform.session.configured ? 'เก็บภาพตามสิทธิ์บัญชี' : 'ภาพอยู่ในเซสชันนี้'}</strong><small>{platform.session.configured ? 'เฉพาะผู้มีสิทธิ์เข้าถึงรายการได้' : 'โหมดนี้ไม่เก็บภาพถาวร'}</small></span></div></div>

          <section className="workflow-section"><div className="section-heading"><div><h2>จากภาพ สู่การค้นพบ</h2><p>เริ่มต้นได้ง่าย ๆ ใน 3 ขั้นตอน</p></div><span className="small-caption">DESIGNED FOR A CLEARER VIEW</span></div><div className="workflow-grid">{[{ n: '01', icon: Upload, title: 'เพิ่มภาพที่ต้องการตรวจ', detail: 'เลือกภาพจากคลัง หรือถ่ายภาพผ่านกล้องมือถือ', link: 'อัปโหลดภาพ', action: () => openScan() }, { n: '02', icon: ScanLine, title: 'สำรวจผลวิเคราะห์', detail: 'ดูกรอบตำแหน่ง ชนิด และค่าความมั่นใจของโมเดล', link: 'ลองดูตัวอย่าง', action: () => openScan(true) }, { n: '03', icon: BookOpen, title: 'ต่อยอดความเข้าใจ', detail: 'เปรียบเทียบลักษณะสำคัญกับไข่พยาธิใน Atlas 3D', link: 'เปิด Atlas 3D', action: () => openAtlas() }].map(step => <article className="workflow-card" key={step.n}><div className="workflow-top"><step.icon size={22}/><span>{step.n}</span></div><h3>{step.title}</h3><p>{step.detail}</p><button onClick={step.action}>{step.link}<ArrowUpRight size={15}/></button></article>)}</div></section>

          <section className="atlas-preview"><div className="section-heading"><div><div className="section-kicker">คลังความรู้ไข่และตัวอ่อนพยาธิ</div><h2>รู้จักให้ลึก มองเห็นให้ชัด</h2><p>สำรวจชนิดที่เกี่ยวข้องกับการเรียนรู้ในไทย</p></div><button className="text-button" onClick={() => openAtlas()}>สำรวจทั้ง {species.length} กลุ่ม <ArrowRight size={16}/></button></div><div className="specimen-grid">{featuredSpecies.map((item, i) => <button className="specimen-card" key={item.id} onClick={() => openAtlas(item.id)}><div className={`specimen-art specimen-art-${i}`}><EggIllustration speciesId={item.id}/><span className="specimen-number">SPECIMEN 0{i + 1}</span><span className="view-3d"><Box size={12}/> 3D</span></div><div className="specimen-info"><span>{groupLabels[item.group]}</span><h3>{item.name}</h3><div><p>{item.thaiName}</p><ArrowUpRight size={17}/></div></div></button>)}</div></section>

          <div className="research-note"><div><ShieldCheck size={20}/><p><strong>ออกแบบเพื่อการเรียนรู้และช่วยคัดกรอง</strong><span>ผลจาก AI ต้องได้รับการทบทวนโดยผู้เชี่ยวชาญ และไม่ใช้แทนการวินิจฉัยทางคลินิก</span></p></div><button onClick={() => setHelpOpen(true)}>เรียนรู้เพิ่มเติม <ArrowUpRight size={15}/></button></div>
          <section className="feedback-invite"><div><span className="section-kicker"><MessageCircle size={16}/> เสียงของคุณช่วยเราได้</span><h2>ช่วยให้ HelpMinths ดีขึ้นไปด้วยกัน</h2><p>ตอบแบบประเมินสั้น ๆ หรือบอกสิ่งที่อยากให้เราปรับปรุง</p></div><button className="button-primary" onClick={() => navigate('evaluation')}>ประเมินและเสนอแนะ <ArrowRight size={17}/></button></section>
        </>}
        {page === 'scan' && <Scan key={`${scanKey}:${authIdentity}`} startDemo={demo} initialRecord={safeSelectedRecord} onResult={saveRecord} openAtlas={openAtlas} platformSession={platform.session} onOpenSettings={() => navigate('settings')} onOpenReview={id => { setPlatformAnalysisId(id); navigate('verification') }}/>}
        {page === 'atlas' && <><div className="atlas-learning-entry"><span>เรียนรู้โครงสร้างใน Atlas แล้วฝึกจำแนกจากภาพจริง</span><button className="button-quiet" onClick={() => navigate('learning')}><GraduationCap size={18}/> เปิดห้องเรียน <ArrowRight size={16}/></button></div><Suspense fallback={<div className="loading-state"><LoaderCircle className="spin"/><p>กำลังเตรียม Atlas 3D…</p></div>}><Atlas initialSpecies={initialSpecies}/></Suspense></>}
        {page === 'verification' && <Suspense fallback={pendingPage}><ExpertVerification key={authIdentity} session={platform.session} analysisId={platformAnalysisId} onChooseAnalysis={setPlatformAnalysisId}/></Suspense>}
        {page === 'learning' && <Suspense fallback={pendingPage}><LearningLab key={authIdentity} session={platform.session} onOpenAtlas={openAtlas}/></Suspense>}
        {page === 'reports' && <Suspense fallback={pendingPage}><PlatformReports key={authIdentity} session={platform.session} analysisId={platformAnalysisId}/></Suspense>}
        {page === 'performance' && <Suspense fallback={pendingPage}><ModelPerformance key={authIdentity} session={platform.session} analysisId={platformAnalysisId}><Evaluation feedback={feedback}/></ModelPerformance></Suspense>}
        {page === 'settings' && <Suspense fallback={pendingPage}><PlatformSettings key={authIdentity} session={platform.session} onSessionChanged={platform.refresh}/></Suspense>}
        {page === 'evaluation' && <Evaluation feedback={feedback}/>}
        {page === 'history' && <><Suspense fallback={pendingPage}><AnalysisHistory key={authIdentity} session={platform.session} onOpenAnalysis={id => { setPlatformAnalysisId(id); navigate('verification') }}/></Suspense><section className="session-history"><div className="page-heading"><div><div className="section-kicker">YOUR DISCOVERIES</div><h2>ผลในเซสชันนี้</h2><p>ผลวิเคราะห์ในเซสชันนี้ ภาพจะหายไปเมื่อรีเฟรชหรือปิดหน้าเว็บ</p></div><button className="button-primary" onClick={() => openScan()}><ScanLine size={17}/> ตรวจภาพใหม่</button></div>{visibleRecords.length === 0 ? <div className="empty-state"><div className="empty-icon"><History size={32}/></div><h2>ยังไม่มีผลในเซสชันนี้</h2><p>เริ่มตรวจภาพแรก หรือทดลองดูผลสาธิตเพื่อเรียนรู้วิธีใช้งาน</p><button className="button-primary" onClick={() => openScan()}>เริ่มตรวจวิเคราะห์ <ArrowRight size={17}/></button></div> : <div className="history-grid">{visibleRecords.map(record => <button className="history-card" key={record.id} onClick={() => openScan(false, record)}><img src={record.imageUrl} alt={`ภาพ ${record.filename}`}/><div><span className={`record-mode ${record.mode}`}>{record.mode === 'demo' ? 'ข้อมูลสาธิต' : 'ผลจากโมเดล'}</span><h3>{record.filename}</h3><p><Clock3 size={13}/>{new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' }).format(new Date(record.createdAt))}</p><div className="history-card-bottom"><strong>{record.detections.length} ตำแหน่ง</strong><span>เปิดผลตรวจ <ArrowUpRight size={15}/></span></div></div></button>)}</div>}</section></>}
        <footer className="app-footer"><span>HelpMinths <span className="footer-dot">·</span> A little closer. A lot clearer.</span><span>สร้างเพื่อการศึกษาและวิจัย <span className="footer-version">v0.1</span></span></footer>
      </main>
    </div>

    {helpOpen && <div className="modal-backdrop" onClick={() => setHelpOpen(false)}><section ref={helpRef} className="help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={event => event.stopPropagation()}><button className="modal-close icon-button" onClick={() => setHelpOpen(false)} aria-label="ปิดคู่มือ"><X size={21}/></button><Brand small/><h2 id="help-title">เริ่มต้นกับ HelpMinths</h2><p className="help-intro">จากภาพจุลทรรศน์ สู่พื้นที่สำหรับเรียนรู้และสำรวจ</p><div className="help-steps"><div><Camera/><p><strong>1. เลือกภาพหรือถ่ายภาพ</strong><span>ใช้ภาพกล้องจุลทรรศน์ที่เห็นโครงสร้างชัดเจน รองรับ JPEG, PNG และ WebP ไม่เกิน 20 MB</span></p></div><div><Search/><p><strong>2. ตรวจภาพด้วยโมเดล</strong><span>ระบบต้องเชื่อมโมเดลที่ฝึกแล้วก่อนตรวจจริง เมื่อพร้อมจะแสดงกรอบ ชนิด และค่าความมั่นใจรายฟอง</span></p></div><div><Box/><p><strong>3. เปรียบเทียบกับ Atlas 3D</strong><span>หมุนและซูมแบบจำลองเพื่อดูจุดสังเกต แบบจำลองเป็นภาพอธิบายโครงสร้าง ไม่ใช่ภาพสแกนจริง</span></p></div><div><ArrowDownToLine/><p><strong>4. บันทึกผล</strong><span>โหมดบัญชีบันทึกรายการในระบบและดาวน์โหลด PDF/CSV ตามสิทธิ์ได้ ส่วนผลสาธิตและโหมดไม่บันทึกอยู่เฉพาะเซสชันนี้</span></p></div></div><div className="help-note"><ShieldCheck size={18}/><p>ข้อมูลสาธิตไม่ใช่ผลตรวจ AI ผลวิเคราะห์จริงเป็นข้อมูลช่วยคัดกรองและต้องยืนยันโดยผู้เชี่ยวชาญ</p></div><button className="button-primary help-cta" onClick={() => { setHelpOpen(false); openScan() }}>เริ่มสำรวจ <ArrowRight size={17}/></button></section></div>}
  </div>
}
