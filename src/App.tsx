import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { ArrowRight, ArrowUpRight, BookOpen, Box, Camera, History, LoaderCircle, ScanLine, Search, ShieldCheck, Upload, X } from 'lucide-react'
import Scan from './components/Scan'
import AppNavigation from './components/AppNavigation'
import AccountMenu from './components/AccountMenu'
import NotificationMenu from './components/NotificationMenu'
import type { NotificationTarget } from './components/NotificationMenu'
import type { AnalysisRecord } from './components/Scan'
import EggIllustration from './components/EggIllustration'
import Evaluation from './components/Evaluation'
import FieldOverview from './components/FieldOverview'
import { useFeedback } from './hooks/useFeedback'
import { usePlatformSession } from './platform/api'
import { getSpeciesById, groupLabels, matchSpeciesLabel, species } from './data/species'

const Atlas = lazy(() => import('./components/Atlas'))
const PlatformDashboard = lazy(() => import('./components/PlatformDashboard'))
const HealthSurveyDashboard = lazy(() => import('./components/HealthSurveyDashboard'))
const MyWork = lazy(() => import('./components/MyWork'))
const ExpertVerification = lazy(() => import('./components/ExpertVerification'))
const PlatformReports = lazy(() => import('./components/PlatformReports'))
const ModelPerformance = lazy(() => import('./components/ModelPerformance'))
const PlatformSettings = lazy(() => import('./components/PlatformSettings'))
const pendingPage = <div className="loading-state"><LoaderCircle className="spin"/><p>กำลังเตรียมหน้าที่เลือก…</p></div>
type Page = 'home' | 'dashboard' | 'scan' | 'atlas' | 'work' | 'evaluation' | 'verification' | 'reports' | 'performance' | 'settings'
const featuredSpecies = ['opisthorchis', 'mif', 'hymenolepis-nana'].map(getSpeciesById)
const pageNames: Record<Page, string> = { home: 'ภาพรวม', dashboard: 'สถิติโรค', scan: 'ตรวจวิเคราะห์', atlas: 'Atlas 3D', work: 'งานของฉัน', evaluation: 'แบบประเมิน SUS', verification: 'ทบทวนโดยผู้เชี่ยวชาญ', reports: 'รายงาน', performance: 'ประเมินโมเดล', settings: 'ตั้งค่าและบัญชี' }

function Brand({ small = false }: { small?: boolean }) {
  return <div className={`brand ${small ? 'brand-small' : ''}`}><div className="brand-symbol"><svg viewBox="0 0 40 40" aria-hidden="true"><ellipse cx="20" cy="20" rx="9" ry="13" transform="rotate(32 20 20)"/><ellipse cx="20" cy="20" rx="3.4" ry="6" transform="rotate(32 20 20)"/><circle cx="31" cy="8" r="2.5"/></svg></div><span>Help<span className="brand-light">Minths</span></span></div>
}

export default function App() {
  const [page, setPage] = useState<Page>(() => {
    const initial = window.location.hash.slice(1)
    if (initial === 'history') return 'work'
    return Object.hasOwn(pageNames, initial) ? initial as Page : 'home'
  })
  const feedback = useFeedback()
  const platform = usePlatformSession()
  const [platformAnalysisId, setPlatformAnalysisId] = useState<string | undefined>()
  const [notificationTarget, setNotificationTarget] = useState<NotificationTarget | undefined>()
  const [accountPortal, setAccountPortal] = useState<'user' | 'expert'>('user')
  const [workTab, setWorkTab] = useState<'saved' | 'session' | undefined>()
  const [helpOpen, setHelpOpen] = useState(false)
  const [records, setRecords] = useState<AnalysisRecord[]>([])
  const [selectedRecord, setSelectedRecord] = useState<AnalysisRecord | null>(null)
  const [initialSpecies, setInitialSpecies] = useState<string | undefined>()
  const [demo, setDemo] = useState(false)
  const [scanKey, setScanKey] = useState(0)
  const [systemOverviewOpen, setSystemOverviewOpen] = useState(false)
  const canManage = platform.session.configured && !platform.session.connection_error && platform.session.user?.active === true && platform.session.user.approval_status === 'approved' && ['admin', 'reviewer', 'lab'].includes(platform.session.user.role)
  const managingPage = page === 'verification' || page === 'reports' || page === 'performance'
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
    setSelectedRecord(null); setPlatformAnalysisId(undefined); setNotificationTarget(undefined); setWorkTab(undefined); setSystemOverviewOpen(false); setDemo(false); setScanKey(previous => previous + 1)
  }, [authIdentity, platform.loading])

  useEffect(() => {
    const initial = window.location.hash.slice(1)
    if (initial === 'history') window.history.replaceState(null, '', '#work')
    else if (initial && initial !== 'admin' && !Object.hasOwn(pageNames, initial)) window.history.replaceState(null, '', '#home')
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

  const navigate = (next: Page) => {
    setPage(next)
    window.history.replaceState(null, '', `#${next}`)
    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
    mainRef.current?.scrollTo({ top: 0, behavior })
    window.scrollTo({ top: 0, behavior })
  }
  const openSettings = (portal: 'user' | 'expert' = 'user') => { setAccountPortal(portal); navigate('settings') }
  const openAdmin = () => { window.location.assign('/admin/') }
  const openWork = (tab?: 'saved' | 'session') => { setWorkTab(tab); navigate('work') }
  const openAnalysis = (id: string) => { setNotificationTarget(undefined); setPlatformAnalysisId(id); navigate('verification') }
  const openNotification = (target: NotificationTarget) => { setNotificationTarget(target); setPlatformAnalysisId(target.analysis_id); navigate('verification') }
  useEffect(() => {
    const routeChanged = () => {
      const target = window.location.hash.slice(1)
      if (target === 'admin') { window.location.replace('/admin/'); return }
      if (target === 'history') { setPage('work'); window.history.replaceState(null, '', '#work'); return }
      if (Object.hasOwn(pageNames, target)) setPage(target as Page)
    }
    window.addEventListener('hashchange', routeChanged)
    return () => window.removeEventListener('hashchange', routeChanged)
  }, [])
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

  return <div className="app-shell platform-shell instrument-shell minimal-navigation-shell">
    <a className="skip-navigation" href="#main-content" onClick={event => { event.preventDefault(); mainRef.current?.focus(); mainRef.current?.scrollIntoView({ block: 'start' }) }}>ข้ามไปเนื้อหาหลัก</a>
    <AppNavigation page={page} session={platform.session} brand={<Brand/>} onHome={() => navigate('home')} onNavigate={target => target === 'scan' ? openScan() : target === 'work' ? openWork() : navigate(target)} onHelp={() => setHelpOpen(true)}>
      <NotificationMenu key={authIdentity} session={platform.session} onOpenCase={openNotification} onOpenQueue={() => { setPlatformAnalysisId(undefined); setNotificationTarget(undefined); navigate('verification') }}/>
      <AccountMenu session={platform.session} onSettings={() => openSettings()} onLogout={platform.logout}/>
    </AppNavigation>
    <div className="main-layout">
      <main ref={mainRef} id="main-content" tabIndex={-1} className={`main-content page-${page}`}>
        {page === 'home' && <div className="home-sections">
          <FieldOverview onScan={() => openScan()} onDemo={() => openScan(true)}/>

          <section className="workflow-section" aria-labelledby="workflow-title"><div className="section-heading"><div><h2 id="workflow-title">เริ่มใช้งานใน 3 ขั้นตอน</h2></div></div><div className="workflow-grid">{[{ n: '01', icon: Upload, title: 'เพิ่มภาพที่ต้องการตรวจ', detail: 'เลือกภาพจากคลัง หรือถ่ายภาพผ่านกล้องมือถือ', link: 'อัปโหลดภาพ', action: () => openScan() }, { n: '02', icon: ScanLine, title: 'สำรวจผลวิเคราะห์', detail: 'ดูกรอบตำแหน่ง ชนิด และค่าความมั่นใจของโมเดล', link: 'ลองดูตัวอย่าง', action: () => openScan(true) }, { n: '03', icon: BookOpen, title: 'ต่อยอดความเข้าใจ', detail: 'เปรียบเทียบลักษณะสำคัญกับไข่พยาธิใน Atlas 3D', link: 'เปิด Atlas 3D', action: () => openAtlas() }].map(step => <article className="workflow-card" key={step.n}><div className="workflow-top"><step.icon size={22}/><span>{step.n}</span></div><h3>{step.title}</h3><p>{step.detail}</p><button onClick={step.action}>{step.link}<ArrowUpRight size={15}/></button></article>)}</div></section>

          <section className="atlas-preview" aria-labelledby="atlas-preview-title"><div className="section-heading"><div><h2 id="atlas-preview-title">ตัวอย่างจาก Atlas 3D</h2><p>เปรียบเทียบลักษณะไข่และตัวอ่อนพยาธิ</p></div><button className="text-button" onClick={() => openAtlas()}>สำรวจทั้ง {species.length} กลุ่ม <ArrowRight size={16}/></button></div><div className="specimen-grid">{featuredSpecies.map((item, i) => <button className="specimen-card" key={item.id} onClick={() => openAtlas(item.id)}><div className={`specimen-art specimen-art-${i}`}><EggIllustration speciesId={item.id}/><span className="view-3d"><Box size={12}/> 3D</span></div><div className="specimen-info"><span>{groupLabels[item.group]}</span><h3>{item.name}</h3><div><p>{item.thaiName}</p><ArrowUpRight size={17}/></div></div></button>)}</div></section>

        </div>}
        {page === 'dashboard' && <Suspense fallback={pendingPage}><HealthSurveyDashboard key={authIdentity} session={platform.session}/></Suspense>}
        {page === 'scan' && <Scan key={`${scanKey}:${authIdentity}`} startDemo={demo} initialRecord={safeSelectedRecord} onResult={saveRecord} openAtlas={openAtlas} platformSession={platform.session} onOpenSettings={() => openSettings()} onOpenHistory={() => openWork(demo || safeSelectedRecord?.mode === 'demo' || !platform.session.user ? 'session' : 'saved')} onOpenReview={openAnalysis}/>}
        {page === 'atlas' && <Suspense fallback={<div className="loading-state"><LoaderCircle className="spin"/><p>กำลังเตรียม Atlas 3D…</p></div>}><Atlas initialSpecies={initialSpecies}/></Suspense>}
        {page === 'verification' && canManage && <Suspense fallback={pendingPage}><ExpertVerification key={authIdentity} session={platform.session} analysisId={platformAnalysisId} referralId={notificationTarget?.referral_id} messageId={notificationTarget?.message_id} onChooseAnalysis={(id, referralId) => { setPlatformAnalysisId(id); setNotificationTarget(referralId ? { analysis_id: id, referral_id: referralId, message_id: '' } : undefined) }} onOpenSettings={() => openSettings('expert')} onSessionChanged={platform.refresh}/></Suspense>}
        {page === 'reports' && canManage && <Suspense fallback={pendingPage}><PlatformReports key={authIdentity} session={platform.session} analysisId={platformAnalysisId}/><details className="reports-system-overview" open={systemOverviewOpen} onToggle={event => setSystemOverviewOpen(event.currentTarget.open)}><summary>ภาพรวมการดำเนินงาน</summary>{systemOverviewOpen && <Suspense fallback={pendingPage}><PlatformDashboard key={authIdentity} embedded session={platform.session} onNavigate={target => target === 'history' ? openWork('saved') : navigate(target)}/></Suspense>}</details></Suspense>}
        {page === 'performance' && canManage && <Suspense fallback={pendingPage}><ModelPerformance key={authIdentity} session={platform.session} analysisId={platformAnalysisId}/></Suspense>}
        {page === 'settings' && <Suspense fallback={pendingPage}><PlatformSettings key={authIdentity} session={platform.session} onSessionChanged={platform.refresh} initialPortal={accountPortal} onExpertSignedIn={() => navigate('verification')} onOpenAdmin={openAdmin}/></Suspense>}
        {page === 'evaluation' && <Evaluation feedback={feedback}/>}
        {page === 'work' && <Suspense fallback={pendingPage}><MyWork key={authIdentity} session={platform.session} records={visibleRecords} initialTab={workTab} onOpenAnalysis={openAnalysis} onOpenSession={record => openScan(false, record)} onNewScan={() => openScan()} onOpenReferrals={() => { setPlatformAnalysisId(undefined); setNotificationTarget(undefined); navigate('verification') }} onOpenSettings={() => openSettings()}/></Suspense>}
        {managingPage && (platform.loading ? pendingPage : !canManage && <section className="empty-state management-access-state"><ShieldCheck size={30}/><h1>{platform.session.user ? 'ส่วนนี้สำหรับผู้ปฏิบัติงาน' : 'เข้าสู่ระบบเพื่อใช้งานส่วนนี้'}</h1><p>{platform.session.user ? 'บัญชีของคุณยังใช้ตรวจภาพ เรียนรู้ และดูงานของตนเองได้จากเมนูหลัก' : 'เปิดเมนูบัญชีเพื่อเข้าสู่ระบบด้วยบัญชีที่ได้รับอนุมัติ'}</p><button type="button" className="button-primary" onClick={() => openSettings()}>{platform.session.user ? 'เปิดบัญชีของฉัน' : 'เข้าสู่ระบบ'}</button></section>)}
        <footer className="app-footer minimal-footer"><div><span><b>HelpMinths</b> · เพื่อการศึกษาและวิจัย</span><a href="#evaluation" onClick={event => { event.preventDefault(); navigate('evaluation') }}>ประเมินและเสนอแนะ</a></div><p>ผล AI ต้องได้รับการทบทวนโดยผู้เชี่ยวชาญ</p></footer>
      </main>
    </div>

    {helpOpen && <div className="modal-backdrop" onClick={() => setHelpOpen(false)}><section ref={helpRef} className="help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={event => event.stopPropagation()}><button className="modal-close icon-button" onClick={() => setHelpOpen(false)} aria-label="ปิดคู่มือ"><X size={21}/></button><Brand small/><h2 id="help-title">เริ่มต้นกับ HelpMinths</h2><p className="help-intro">จากภาพจุลทรรศน์ สู่พื้นที่สำหรับเรียนรู้และสำรวจ</p><div className="help-steps"><div><Camera/><p><strong>1. เลือกภาพหรือถ่ายภาพ</strong><span>ใช้ภาพกล้องจุลทรรศน์ที่เห็นโครงสร้างชัดเจน รองรับภาพราสเตอร์หลายรูปแบบ เช่น JPEG, PNG, HEIC, TIFF และ WebP ไม่เกิน 20 MB ไฟล์หลายหน้าจะใช้ภาพแรก</span></p></div><div><Search/><p><strong>2. ตรวจภาพด้วยโมเดล</strong><span>ระบบต้องเชื่อมโมเดลที่ฝึกแล้วก่อนตรวจจริง เมื่อพร้อมจะแสดงกรอบ ชนิด และค่าความมั่นใจรายฟอง</span></p></div><div><Box/><p><strong>3. เปรียบเทียบกับ Atlas 3D</strong><span>หมุนและซูมแบบจำลองเพื่อดูจุดสังเกต แบบจำลองเป็นภาพอธิบายโครงสร้าง ไม่ใช่ภาพสแกนจริง</span></p></div><div><History/><p><strong>4. บันทึกและส่งต่อ</strong><span>เข้าสู่ระบบเพื่อเก็บผลในประวัติรายวัน หรือส่งภาพที่ยังไม่มั่นใจให้ผู้เชี่ยวชาญตรวจยืนยัน โดยเปิดดูคำตอบได้ในคลังภาพส่งต่อ</span></p></div></div><div className="help-note"><ShieldCheck size={18}/><p>ข้อมูลสาธิตไม่ใช่ผลตรวจ AI ผลวิเคราะห์จริงเป็นข้อมูลช่วยคัดกรองและต้องยืนยันโดยผู้เชี่ยวชาญ</p></div><button className="button-primary help-cta" onClick={() => { setHelpOpen(false); openScan() }}>เริ่มสำรวจ <ArrowRight size={17}/></button></section></div>}
  </div>
}
