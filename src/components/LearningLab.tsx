import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, BookOpen, CheckCircle2, ClipboardCheck, ExternalLink, GraduationCap, LoaderCircle, RefreshCw, ShieldCheck } from 'lucide-react'
import { atlasPhotos } from '../data/atlasPhotos'
import { getSpeciesById, species } from '../data/species'
import { apiRequest } from '../platform/api'
import type { PlatformSession } from '../platform/api'
import '../styles/learning-lab.css'

type Approval = { revision: number; approved: boolean; reviewer_id: string; reviewed_at: string; notes: string; status: string }
interface Reference {
  id: string; species_id: string; scientific_name: string; thai_name: string; specimen_type: string; src: string; source_taxon: string
  caption: string; credit: string; license: string; license_url: string; source_url: string; source_image_url: string; changes: string
  limitations: string; clinical_note: string; morphology: string; features: string[]; approval?: Approval | null
}
interface Catalog { configured: boolean; items: Reference[]; approved_count: number; notice: string }
interface Choice { id: string; label: string; thai_name: string }
interface Question { id: string; image_url: string; credit: string; license: string; license_url: string; choices: Choice[] }
interface Quiz { id: string; mode: string; status: string; created_at: string; notice: string; questions: Question[] }
interface Result { question_id: string; reference_id: string; species_id: string | null; correct_species_id: string; correct: boolean; reference: Reference; reviewer_notes: string; reviewer_id: string; approval_revision: number }
interface Attempt { id: string; quiz_id: string; mode: string; correct: number; total: number; percentage_correct: number; submitted_at: string; results: Result[]; notice: string }
interface Progress { attempt_count: number; modes: { mode: string; attempts: number; correct: number; total: number; percentage_correct: number | null }[]; recent: Attempt[]; notice: string }
type Tab = 'library' | 'practice' | 'quiz' | 'progress'
const modeNames: Record<string, string> = { practice: 'ฝึกทำแบบทดสอบ', pretest: 'ก่อนเรียน', posttest: 'หลังเรียน' }
const localReferences: Reference[] = atlasPhotos.map(photo => {
  const specimen = getSpeciesById(photo.speciesId)
  return { id: photo.id, species_id: specimen.id, scientific_name: specimen.name, thai_name: specimen.thaiName, specimen_type: specimen.specimenType ?? 'egg', src: photo.src, source_taxon: photo.sourceTaxon, caption: photo.caption, credit: photo.credit, license: photo.license, license_url: photo.licenseUrl, source_url: photo.sourceUrl, source_image_url: photo.sourceImageUrl, changes: photo.changes, limitations: photo.stageNote ?? '', clinical_note: specimen.clinicalNote ?? '', morphology: specimen.description, features: specimen.features, approval: null }
})
function href(value: string) { try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : '#' } catch { return '#' } }
function failureMessage(error: unknown) { return error instanceof Error ? error.message : 'ดำเนินการไม่สำเร็จ กรุณาลองอีกครั้ง' }
function date(value: string) { const parsed = new Date(value); return Number.isFinite(parsed.getTime()) ? new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' }).format(parsed) : 'ไม่ระบุ' }
function Sources({ reference }: { reference: Reference }) {
  return <div className="learning-sources"><p>{reference.credit} · <a href={href(reference.license_url)} target="_blank" rel="noopener noreferrer">{reference.license}</a></p><a href={href(reference.source_url)} target="_blank" rel="noopener noreferrer">แหล่งภาพและคำบรรยายต้นทาง <ExternalLink size={14}/></a><p>{reference.changes}</p></div>
}
function ReferenceDetail({ reference, onOpenAtlas }: { reference: Reference; onOpenAtlas: (id?: string) => void }) {
  return <div className="learning-reference-detail"><div className="learning-detail-title"><div><h3>{reference.scientific_name}</h3><p>{reference.thai_name}</p></div><button className="learning-button" onClick={() => onOpenAtlas(reference.species_id)}>เปิด Atlas 3D <ArrowRight size={16}/></button></div><p>{reference.caption}</p><p>{reference.morphology}</p><ul>{reference.features.map(feature => <li key={feature}>{feature}</li>)}</ul><p className="learning-limitation">{reference.limitations} {reference.clinical_note}</p><p className="learning-muted">ลักษณะทั่วไปของกลุ่มอาจไม่ปรากฏครบในภาพนี้ ต้องพิจารณาจุดที่เห็นจริงร่วมกับข้อจำกัดของแหล่งภาพ</p><Sources reference={reference}/></div>
}

export default function LearningLab({ session, onOpenAtlas }: { session: PlatformSession; onOpenAtlas: (id?: string) => void }) {
  const [tab, setTab] = useState<Tab>('library')
  const [catalog, setCatalog] = useState<Catalog>({ configured: false, items: localReferences, approved_count: 0, notice: '' })
  const [loadingCatalog, setLoadingCatalog] = useState(false)
  const [catalogError, setCatalogError] = useState('')
  const [filter, setFilter] = useState('')
  const [selectedId, setSelectedId] = useState(localReferences[0]?.id ?? '')
  const [reveal, setReveal] = useState(false)
  const [mode, setMode] = useState('practice')
  const [questionCount, setQuestionCount] = useState(5)
  const [quiz, setQuiz] = useState<Quiz | null>(null)
  const [questionIndex, setQuestionIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string | null>>({})
  const [attempt, setAttempt] = useState<Attempt | null>(null)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [loadingProgress, setLoadingProgress] = useState(false)
  const [history, setHistory] = useState<Attempt[]>([])
  const [historyOffset, setHistoryOffset] = useState(0)
  const [moreHistory, setMoreHistory] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [notes, setNotes] = useState('')
  const [confirmations, setConfirmations] = useState([false, false, false])
  const [wrongOnly, setWrongOnly] = useState(false)
  const [catalogRefresh, setCatalogRefresh] = useState(0)
  const [progressRefresh, setProgressRefresh] = useState(0)
  const generation = useRef(0)
  const actionAbort = useRef<AbortController | null>(null)
  const isReviewer = session.user?.role === 'admin' || session.user?.role === 'reviewer'
  const selected = catalog.items.find(item => item.id === selectedId) ?? catalog.items[0]
  const filtered = useMemo(() => catalog.items.filter(item => `${item.scientific_name} ${item.thai_name} ${item.caption}`.toLowerCase().includes(filter.toLowerCase())), [catalog.items, filter])
  const question = quiz?.questions[questionIndex]

  useEffect(() => {
    generation.current += 1; actionAbort.current?.abort(); setQuiz(null); setAnswers({}); setAttempt(null); setProgress(null); setHistory([]); setHistoryOffset(0); setMoreHistory(false); setBusy(false); setMessage(''); setError('')
    return () => { generation.current += 1; actionAbort.current?.abort() }
  }, [session.user?.id])
  useEffect(() => {
    const controller = new AbortController()
    setLoadingCatalog(true); setCatalogError('')
    void apiRequest<Catalog>('/learning/catalog', { signal: controller.signal }, session).then(value => { if (!controller.signal.aborted) setCatalog(value) }).catch(error => {
      if (!controller.signal.aborted) { setCatalog({ configured: false, items: localReferences, approved_count: 0, notice: '' }); setCatalogError(failureMessage(error)) }
    }).finally(() => { if (!controller.signal.aborted) setLoadingCatalog(false) })
    return () => controller.abort()
  }, [session.configured, session.user?.id, catalogRefresh])
  useEffect(() => {
    if (tab !== 'progress' || !session.configured || !session.user) return
    const controller = new AbortController()
    setLoadingProgress(true); setError('')
    void apiRequest<Progress>('/learning/progress', { signal: controller.signal }, session).then(value => { if (!controller.signal.aborted) { setProgress(value); setHistory(value.recent); setHistoryOffset(value.recent.length); setMoreHistory(value.recent.length === 20) } }).catch(error => { if (!controller.signal.aborted) setError(failureMessage(error)) }).finally(() => { if (!controller.signal.aborted) setLoadingProgress(false) })
    return () => controller.abort()
  }, [tab, session.configured, session.user?.id, progressRefresh])
  useEffect(() => { setNotes(''); setConfirmations([false, false, false]); setReveal(false) }, [selectedId])

  const action = async <T,>(operation: (signal: AbortSignal) => Promise<T>, success: (value: T) => void) => {
    if (busy) return
    const current = generation.current, controller = new AbortController()
    actionAbort.current?.abort(); actionAbort.current = controller
    setBusy(true); setError(''); setMessage('')
    try { const value = await operation(controller.signal); if (current === generation.current) success(value) }
    catch (error) { if (current === generation.current && !controller.signal.aborted) setError(failureMessage(error)) }
    finally { if (current === generation.current) setBusy(false) }
  }
  const startQuiz = () => { void action(signal => apiRequest<Quiz>('/learning/quizzes', { json: { mode, question_count: questionCount }, signal }, session), value => { setQuiz(value); setAnswers({}); setQuestionIndex(0); setAttempt(null); setWrongOnly(false) }) }
  const submit = () => {
    if (!quiz) return
    if (quiz.questions.some(item => !Object.hasOwn(answers, item.id))) { setError('เลือกคำตอบให้ครบทุกภาพ หรือเลือกว่ายังระบุไม่ได้'); return }
    void action(signal => apiRequest<Attempt>(`/learning/quizzes/${quiz.id}/submit`, { json: { answers: quiz.questions.map(item => ({ question_id: item.id, species_id: answers[item.id] })) }, signal }, session), value => { setAttempt(value); setQuiz(null); setProgressRefresh(old => old + 1); setMessage('บันทึกคำตอบและคะแนนการเรียนรู้แล้ว') })
  }
  const approve = (approved: boolean) => {
    if (!selected) return
    if (!confirmations.every(Boolean) || notes.trim().length < 10) { setError('ตรวจทั้ง 3 รายการและเขียนสิ่งที่ตรวจหรือข้อจำกัดอย่างน้อย 10 ตัวอักษร'); return }
    if (!approved && !window.confirm('ถอนการยืนยันภาพนี้จากแบบฝึกหัดใหม่หรือไม่? ชุดคำถามที่อ้างอิงรุ่นนี้จะต้องเริ่มใหม่')) return
    void action(signal => apiRequest('/learning/approvals', { json: { reference_id: selected.id, expected_revision: selected.approval?.revision ?? null, approved, rights_confirmed: true, label_reviewed: true, limitations_reviewed: true, notes: notes.trim() }, signal }, session), () => { setCatalogRefresh(old => old + 1); setConfirmations([false, false, false]); setNotes(''); setMessage(approved ? 'บันทึกการตรวจยืนยันภาพสำหรับการเรียนรู้แล้ว' : 'ถอนการยืนยันภาพนี้แล้ว') })
  }
  const loadMoreHistory = () => { void action(signal => apiRequest<{ items: Attempt[]; has_more: boolean }>(`/learning/attempts?limit=20&offset=${historyOffset}`, { signal }, session), value => { setHistory(previous => [...previous, ...value.items.filter(item => !previous.some(existing => existing.id === item.id))]); setHistoryOffset(offset => offset + value.items.length); setMoreHistory(value.has_more) }) }
  const chooseReference = (offset: number) => {
    const position = catalog.items.findIndex(item => item.id === selected?.id)
    const next = catalog.items[(position + offset + catalog.items.length) % catalog.items.length]
    if (next) { setSelectedId(next.id); setReveal(false) }
  }
  const answerLabel = (id: string | null) => id === null ? 'ยังไม่สามารถระบุได้' : species.find(item => item.id === id)?.name ?? id
  const accessNote = !session.configured ? 'แบบทดสอบและประวัติยังไม่พร้อม: ต้องตั้งค่าฐานข้อมูลก่อน (Not configured)' : !session.user ? 'เข้าสู่ระบบในหน้าตั้งค่าเพื่อบันทึกแบบฝึกหัดและความก้าวหน้าของคุณ' : ''

  return <div className="learning-page">
    <header className="learning-heading"><span className="learning-eyebrow"><GraduationCap size={18}/> PARASITE LEARNING LAB</span><h1>ห้องเรียนไข่และตัวอ่อนพยาธิ</h1><p>เริ่มจากภาพที่มีแหล่งอ้างอิง ฝึกสังเกตลักษณะสำคัญ และทบทวนคำตอบของตัวเอง</p></header>
    <div className="learning-inventory"><span><BookOpen size={18}/><strong>{catalog.items.length}</strong> ภาพอ้างอิง</span><span><ShieldCheck size={18}/><strong>{catalog.approved_count}</strong> ภาพที่มีบันทึกผู้ตรวจยืนยัน</span><p>คะแนนแบบฝึกหัดเป็นคะแนนการเรียนรู้ แยกจากความแม่นยำของ AI</p></div>
    <nav className="learning-tabs" aria-label="ส่วนห้องเรียน">{([{ id: 'library', label: 'คลังภาพอ้างอิง' }, { id: 'practice', label: 'ฝึกสังเกต' }, { id: 'quiz', label: 'แบบฝึกหัดมีคะแนน' }, { id: 'progress', label: 'ความก้าวหน้าของฉัน' }] as const).map(item => <button key={item.id} className={tab === item.id ? 'is-active' : ''} aria-current={tab === item.id ? 'page' : undefined} onClick={() => { setTab(item.id); setError(''); setMessage('') }}>{item.label}</button>)}</nav>
    {loadingCatalog && <p className="learning-loading" role="status"><LoaderCircle className="spin" size={17}/>กำลังอ่านสถานะคลังภาพ…</p>}
    {catalogError && <div className="learning-notice">คลังอ้างอิงที่รวมมากับแอพยังเปิดอ่านได้ แต่ยืนยันสถานะภาพจากเซิร์ฟเวอร์ไม่ได้: {catalogError}</div>}
    {error && <p className="learning-error" role="alert">{error}</p>}
    {message && <p className="learning-success" role="status"><CheckCircle2 size={18}/>{message}</p>}
    {tab === 'library' && <>
      <section className="learning-notice"><strong>อ่านได้จากต้นทาง ≠ ผ่านผู้ตรวจของแอพแล้ว</strong><p>ชื่อภาพอ้างตามผู้ถ่ายและคำบรรยายต้นทาง ภาพ {catalog.approved_count ? 'ที่ระบุสถานะยืนยันแล้วเท่านั้นใช้ในแบบฝึกหัดมีคะแนน' : 'ยังไม่ถูกใช้สร้างเฉลยแบบทดสอบจนกว่าจะมีผู้ตรวจยืนยันจริง'} ภาพมีเงื่อนไขสิทธิ์ตามที่แสดงแต่ละรายการ</p></section>
      <label className="learning-search">ค้นหาชื่อหรือคำอธิบายภาพ<input maxLength={200} value={filter} onChange={event => setFilter(event.target.value)} placeholder="เช่น Hookworm, ตืดแคระ, ตัวอ่อน"/></label>
      <div className="learning-library">{filtered.map(item => <button className={`learning-image-card ${selected?.id === item.id ? 'is-selected' : ''}`} key={item.id} onClick={() => setSelectedId(item.id)} aria-pressed={selected?.id === item.id}><img src={item.src} alt={item.caption} loading="lazy"/><div><span className={`learning-validation ${item.approval?.approved ? 'is-approved' : ''}`}>{item.approval?.approved ? 'มีบันทึกผู้ตรวจยืนยัน' : 'อ้างอิงต้นทาง · รอผู้ตรวจ'}</span><h2>{item.scientific_name}</h2><p>{item.thai_name}</p><small>{item.license}</small></div></button>)}</div>
      {!filtered.length && <p className="learning-empty">ไม่พบภาพที่ตรงกับคำค้น</p>}
      {selected && <section className="learning-card"><ReferenceDetail reference={selected} onOpenAtlas={onOpenAtlas}/>{selected.approval?.approved && <p className="learning-reviewed"><ShieldCheck size={18}/>ผู้ตรวจรหัส {selected.approval.reviewer_id} · {date(selected.approval.reviewed_at)} · รุ่น {selected.approval.revision}</p>}
        {isReviewer && <form className="learning-approval" onSubmit={event => { event.preventDefault(); approve(true) }}><h3><ClipboardCheck size={20}/>ตรวจยืนยันเพื่อใช้ในแบบฝึกหัด</h3><p>การยืนยันนี้ใช้ป้ายกำกับกลุ่ม <strong>{selected.scientific_name}</strong> ตามขอบเขตของคลังภาพ ไม่ได้ยืนยันชนิดทางคลินิกจากภาพเพียงภาพเดียว</p>{['ตรวจสิทธิ์และแหล่งที่มาของภาพสำหรับการใช้เพื่อการเรียนรู้ตามเงื่อนไขใบอนุญาตแล้ว', 'ตรวจภาพและป้ายกำกับกลุ่มสำหรับคำถามการเรียนรู้แล้ว', 'ตรวจข้อจำกัด ความคล้ายกันของไข่ และจุดที่มองเห็นจริงในภาพแล้ว'].map((label, index) => <label className="learning-check" key={label}><input type="checkbox" checked={confirmations[index]} onChange={event => setConfirmations(values => values.map((value, i) => i === index ? event.target.checked : value))}/>{label}</label>)}<label>คำอธิบายการตรวจสำหรับผู้เรียน (แสดงร่วมกับภาพ)<textarea value={notes} minLength={10} maxLength={2000} rows={3} onChange={event => setNotes(event.target.value)} required/></label><div className="learning-actions"><button className="learning-button primary" type="submit" disabled={busy}>บันทึกการตรวจยืนยัน</button>{selected.approval && <button className="learning-button danger" type="button" disabled={busy} onClick={() => approve(false)}>ถอนการยืนยัน</button>}</div></form>}
      </section>}
    </>}
    {tab === 'practice' && selected && <section className="learning-card learning-practice"><div className="learning-section-title"><div><h2>ลองสังเกต ก่อนเปิดคำอธิบาย</h2><p>โหมดนี้ไม่ให้คะแนน ใช้ภาพอ้างอิงจากต้นทางเพื่อฝึกสังเกต</p></div><span>{catalog.items.findIndex(item => item.id === selected.id) + 1} / {catalog.items.length}</span></div><img className="learning-practice-image" src={selected.src} alt="ภาพกล้องจุลทรรศน์สำหรับฝึกสังเกต"/><div className="learning-actions"><button className="learning-button" onClick={() => chooseReference(-1)}><ArrowLeft size={17}/>ภาพก่อนหน้า</button><button className="learning-button primary" onClick={() => setReveal(value => !value)}>{reveal ? 'ซ่อนคำอธิบาย' : 'เปิดชื่อและคำอธิบาย'}</button><button className="learning-button" onClick={() => chooseReference(1)}>ภาพถัดไป<ArrowRight size={17}/></button></div>{reveal ? <ReferenceDetail reference={selected} onOpenAtlas={onOpenAtlas}/> : <p className="learning-muted">สังเกตเปลือก รูปร่าง เนื้อภายใน และสิ่งที่มองเห็นจริง ไม่ใช้ขนาดบนจอแทนขนาดไมโครเมตร</p>}<Sources reference={selected}/></section>}
    {tab === 'quiz' && <>
      {accessNote && <p className="learning-notice">{accessNote}</p>}
      {!quiz && !attempt && <section className="learning-card"><h2>เริ่มแบบฝึกหัด</h2><p>ใช้เฉพาะภาพที่มีบันทึกผู้ตรวจยืนยันจริง คำตอบ “ยังไม่สามารถระบุได้” จะเก็บไว้สำหรับทบทวน ภาพในชุดนี้เผยแพร่ใน Atlas อยู่แล้ว จึงไม่ใช่การสอบรับรองหรือการทดสอบแบบป้องกันการเปิดเฉลย</p><div className="learning-form-row"><label>รูปแบบ<select value={mode} onChange={event => setMode(event.target.value)}><option value="practice">ฝึกทำแบบทดสอบ</option><option value="pretest">ก่อนเรียน (Pre-test)</option><option value="posttest">หลังเรียน (Post-test)</option></select></label><label>จำนวนภาพสูงสุด<select value={questionCount} onChange={event => setQuestionCount(Number(event.target.value))}>{[1, 3, 5, 10].map(value => <option key={value} value={value}>{value} ภาพ</option>)}</select></label></div>{!catalog.approved_count && <p className="learning-empty">ยังไม่มีภาพที่ผู้ตรวจยืนยันสำหรับแบบฝึกหัด เปิดคลังอ้างอิงเพื่อเรียนรู้ได้ก่อน ระบบไม่สร้างเฉลยหรือคะแนนตัวอย่างขึ้นแทน</p>}<button className="learning-button primary" onClick={startQuiz} disabled={busy || !!accessNote || !catalog.approved_count}>{busy ? 'กำลังเตรียมคำถาม…' : 'เริ่มทำแบบฝึกหัด'}</button></section>}
      {quiz && question && <section className="learning-card"><div className="learning-section-title"><h2>{modeNames[quiz.mode]} · ภาพที่ {questionIndex + 1} / {quiz.questions.length}</h2><span>ตอบแล้ว {Object.keys(answers).length} ภาพ</span></div><img className="learning-quiz-image" src={question.image_url} alt={`ภาพกล้องจุลทรรศน์ข้อ ${questionIndex + 1}`}/><p className="learning-muted">{question.credit} · <a href={href(question.license_url)} target="_blank" rel="noopener noreferrer">{question.license}</a> · ที่มาและคำอธิบายจะปรากฏหลังตอบ</p><fieldset className="learning-answer-options"><legend>ภาพนี้ตรงกับกลุ่มใด?</legend>{question.choices.map(choice => <label key={choice.id} className={answers[question.id] === choice.id ? 'is-selected' : ''}><input type="radio" name={question.id} checked={answers[question.id] === choice.id} onChange={() => setAnswers(values => ({ ...values, [question.id]: choice.id }))}/><span><strong>{choice.label}</strong><small>{choice.thai_name}</small></span></label>)}<label className={Object.hasOwn(answers, question.id) && answers[question.id] === null ? 'is-selected' : ''}><input type="radio" name={question.id} checked={Object.hasOwn(answers, question.id) && answers[question.id] === null} onChange={() => setAnswers(values => ({ ...values, [question.id]: null }))}/><span>ยังไม่สามารถระบุได้</span></label></fieldset><div className="learning-actions"><button className="learning-button" disabled={busy} onClick={() => { if (window.confirm('เลิกชุดคำถามนี้และเริ่มใหม่หรือไม่? คำตอบที่ยังไม่ส่งจะไม่ถูกนับเป็นคะแนน')) { setQuiz(null); setAnswers({}); setQuestionIndex(0); setCatalogRefresh(value => value + 1); setError('') } }}>เริ่มชุดใหม่</button><button className="learning-button" disabled={!questionIndex || busy} onClick={() => setQuestionIndex(value => value - 1)}><ArrowLeft size={17}/>ก่อนหน้า</button>{questionIndex + 1 < quiz.questions.length ? <button className="learning-button primary" disabled={busy} onClick={() => setQuestionIndex(value => value + 1)}>ภาพถัดไป<ArrowRight size={17}/></button> : <button className="learning-button primary" disabled={busy} onClick={submit}>{busy ? 'กำลังบันทึก…' : 'บันทึกคำตอบและดูผล'}</button>}</div></section>}
    </>}
    {tab === 'progress' && <>
      {accessNote && <p className="learning-notice">{accessNote}</p>}
      {loadingProgress && <p className="learning-loading" role="status"><LoaderCircle size={18} className="spin"/>กำลังอ่านผลการเรียนรู้…</p>}
      {session.user && session.configured && progress && <section className="learning-card"><div className="learning-section-title"><div><h2>ความก้าวหน้าของบัญชีนี้</h2><p>มีคำตอบที่บันทึกจริง {progress.attempt_count} ชุด</p></div><button className="learning-button" onClick={() => setProgressRefresh(value => value + 1)}><RefreshCw size={16}/>โหลดใหม่</button></div>{!progress.attempt_count ? <p className="learning-empty">ยังไม่มีผลแบบฝึกหัดที่บันทึกไว้ เริ่มจากแบบฝึกหัดเมื่อมีภาพที่ผู้ตรวจยืนยันแล้ว</p> : <><div className="learning-mode-summary">{progress.modes.map(item => <article key={item.mode}><h3>{modeNames[item.mode]}</h3><strong>{item.percentage_correct?.toFixed(1)}%</strong><p>ตอบถูก {item.correct} จาก {item.total} ภาพ · {item.attempts} ชุด</p></article>)}</div><h3>ประวัติแบบฝึกหัด</h3><div className="learning-attempts">{history.map(item => <article key={item.id}><div><h3>{modeNames[item.mode]}</h3><p>{date(item.submitted_at)} · ถูก {item.correct}/{item.total}</p><meter min={0} max={100} value={item.percentage_correct} aria-label={`คะแนนการเรียนรู้ ${item.percentage_correct} เปอร์เซ็นต์`}/></div><strong>{item.percentage_correct.toFixed(1)}%</strong><button className="learning-button" onClick={() => { setAttempt(item); setWrongOnly(true) }}>ทบทวนคำตอบ</button></article>)}</div>{moreHistory && <button className="learning-button" disabled={busy} onClick={loadMoreHistory}>{busy ? 'กำลังอ่าน…' : 'โหลดประวัติเพิ่ม'}</button>}</>}<p className="learning-muted">{progress.notice}</p></section>}
    </>}
    {attempt && (tab === 'quiz' || tab === 'progress') && <section className="learning-card learning-results"><div className="learning-section-title"><div><h2>ผลแบบฝึกหัด: {attempt.correct} / {attempt.total}</h2><p>ตอบถูก {attempt.percentage_correct.toFixed(1)}% · {modeNames[attempt.mode]}</p></div><button className="learning-button" onClick={() => { setAttempt(null); setQuiz(null); setAnswers({}) }}>กลับไปเริ่มชุดใหม่</button></div><p className="learning-notice">{attempt.notice}</p><label className="learning-check"><input type="checkbox" checked={wrongOnly} onChange={event => setWrongOnly(event.target.checked)}/>แสดงเฉพาะข้อที่ตอบผิดหรือยังระบุไม่ได้</label>{attempt.results.filter(result => !wrongOnly || !result.correct).map(result => <article className={`learning-result-item ${result.correct ? 'is-correct' : ''}`} key={result.question_id}><img src={result.reference.src} alt={result.reference.caption}/><div><span className="learning-validation">{result.correct ? 'ตอบตรงกับป้ายกำกับที่ผู้ตรวจยืนยัน' : 'ทบทวนคำตอบ'}</span><p>คำตอบของคุณ: <strong>{answerLabel(result.species_id)}</strong></p><p>ป้ายกำกับของภาพ: <strong>{result.reference.scientific_name}</strong></p><p>{result.reference.caption}</p><p>{result.reference.morphology}</p><ul>{result.reference.features.map(feature => <li key={feature}>{feature}</li>)}</ul><p>{result.reviewer_notes}</p><p className="learning-limitation">{result.reference.limitations} {result.reference.clinical_note}</p><p className="learning-muted">คำตอบอ้างตามภาพที่ผู้ตรวจยืนยันเพื่อการเรียนรู้ ไม่ใช่การยืนยันผลทางคลินิกจากภาพเดียว</p><Sources reference={result.reference}/><button className="learning-button" onClick={() => onOpenAtlas(result.correct_species_id)}>ทบทวนใน Atlas 3D <ArrowRight size={16}/></button></div></article>)}{wrongOnly && attempt.results.every(result => result.correct) && <p className="learning-empty">ไม่มีข้อที่ตอบผิดในชุดนี้</p>}</section>}
  </div>
}
