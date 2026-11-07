import { ArrowLeft, ArrowRight, CheckCheck, Download, Eye, EyeOff, ImageOff, Plus, RefreshCw, Save, ShieldCheck, Trash2, ZoomIn, ZoomOut } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import { APIError, apiRequest, buildQuery, downloadAPI, formatDate, imageURL } from '../platform/api'
import type { ExpertReview, Paged, PlatformAnalysis, PlatformDetection, PlatformSession, ReviewAnnotation } from '../platform/api'
import { AccessState, AnalysisCounter, ConfirmDialog, ErrorNotice, LoadingNotice, PlatformHeading, QualitySummary, StatusBadge, usePlatformResource } from './PlatformShared'
import ReferralPanel, { ReferralStatusBadge } from './ReferralPanel'
import type { Referral } from './ReferralPanel'
import PasswordInput from './PasswordInput'

const actions = { '': 'ยังไม่ได้ทบทวน', confirm: 'ยืนยันผลเดิม', correct: 'แก้ชนิด / กรอบ', false_positive: 'ไม่ใช่วัตถุเป้าหมาย', uncertain: 'ยังไม่แน่ใจ', request_review: 'ขอทบทวนเพิ่มเติม' }
type DraftAnnotation = ReviewAnnotation & { key: string; action: string; bbox: [number, number, number, number]; label: string; comment: string }
interface AuditEntry { id: string; actor_id?: string; action?: string; created_at?: string; before?: unknown; after?: unknown; before_data?: unknown; after_data?: unknown; actor_username?: string }

interface ExpertSession { verified: boolean; verified_until: string | null }
function expertExpired(failure: unknown) {
  return failure instanceof APIError && !!failure.detail && typeof failure.detail === 'object' && 'code' in failure.detail && failure.detail.code === 'expert_verification_required'
}

export default function ExpertVerification({ session, analysisId, onChooseAnalysis, onOpenSettings, onSessionChanged }: { session: PlatformSession; analysisId?: string; onChooseAnalysis?: (id: string) => void; onOpenSettings?: () => void; onSessionChanged?: () => Promise<void> }) {
  const [selectedId, setSelectedId] = useState(analysisId ?? ''), [message, setMessage] = useState(''), [error, setError] = useState('')
  const [password, setPassword] = useState(''), [busy, setBusy] = useState(false), [checking, setChecking] = useState(true), [verifiedUntil, setVerifiedUntil] = useState<number | null>(null)
  const [answered, setAnswered] = useState(false), [offset, setOffset] = useState(0), [scope, setScope] = useState<'mine' | 'expert'>('expert')
  const manuallyLocked = useRef(false)
  const enabled = session.configured && !!session.user && session.user.role !== 'student'
  const isExpert = session.user?.role === 'admin' || session.user?.role === 'reviewer'
  const verified = verifiedUntil !== null && verifiedUntil > Date.now()
  const canOpen = enabled && (!isExpert || verified)
  const queue = usePlatformResource<Paged<Referral>>(`/referrals${buildQuery({ scope: isExpert ? scope : 'mine', status: answered ? 'confirmed' : undefined, limit: 20, offset })}`, session, canOpen && !selectedId)
  const detail = usePlatformResource<PlatformAnalysis>(`/analyses/${encodeURIComponent(selectedId)}`, session, canOpen && !!selectedId)
  const selectedReferral = usePlatformResource<{ referral: Referral | null }>(`/analyses/${encodeURIComponent(selectedId)}/referral`, session, canOpen && isExpert && !!selectedId)
  const refresh = useRef(() => {})
  refresh.current = () => { queue.reload(); detail.reload(); selectedReferral.reload() }
  useEffect(() => { setSelectedId(analysisId ?? ''); setMessage(''); setError('') }, [analysisId])
  useEffect(() => {
    if (!enabled || !isExpert) { setChecking(false); setVerifiedUntil(null); return }
    const controller = new AbortController()
    const check = async () => {
      try {
        const result = await apiRequest<ExpertSession>(session, '/expert-session', { signal: controller.signal })
        if (controller.signal.aborted) return
        const expiry = result.verified_until ? Date.parse(result.verified_until) : NaN
        setVerifiedUntil(!manuallyLocked.current && result.verified && Number.isFinite(expiry) && expiry > Date.now() ? expiry : null)
      } catch (failure) { if (!controller.signal.aborted) { setVerifiedUntil(null); setError(failure instanceof Error ? failure.message : 'ตรวจสถานะผู้เชี่ยวชาญไม่ได้') } }
      finally { if (!controller.signal.aborted) setChecking(false) }
    }
    setChecking(true); void check()
    const timer = window.setInterval(() => { if (!document.hidden && navigator.onLine) void check() }, 30_000)
    const recheck = () => { if (!document.hidden && navigator.onLine) void check() }
    window.addEventListener('focus', recheck); document.addEventListener('visibilitychange', recheck)
    return () => { controller.abort(); clearInterval(timer); window.removeEventListener('focus', recheck); document.removeEventListener('visibilitychange', recheck) }
  }, [enabled, isExpert, session.user?.id, session.csrf_token])
  useEffect(() => {
    if (verifiedUntil === null) return
    const timer = window.setTimeout(() => { manuallyLocked.current = true; setVerifiedUntil(null); setMessage('การยืนยันผู้เชี่ยวชาญหมดอายุ กรุณายืนยันรหัสผ่านอีกครั้ง ร่างที่ยังไม่ได้บันทึกจะไม่ถูกเก็บ') }, Math.max(0, verifiedUntil - Date.now()))
    return () => clearTimeout(timer)
  }, [verifiedUntil])
  useEffect(() => {
    if (!canOpen || selectedId) return
    const timer = window.setInterval(() => { if (!document.hidden && navigator.onLine) queue.reload() }, 30_000)
    return () => clearInterval(timer)
  }, [canOpen, selectedId, answered, offset, scope])
  const choose = (id: string) => { setSelectedId(id); setMessage(''); setError(''); onChooseAnalysis?.(id) }
  const unlock = async () => {
    setBusy(true); setError(''); setMessage('')
    try {
      const result = await apiRequest<ExpertSession>(session, '/expert-login', { json: { username: session.user?.username, password } })
      const expiry = result.verified_until ? Date.parse(result.verified_until) : NaN
      if (!result.verified || !Number.isFinite(expiry) || expiry <= Date.now()) throw new Error('บริการยังไม่ยืนยันสิทธิ์ผู้เชี่ยวชาญ กรุณาลองอีกครั้ง')
      manuallyLocked.current = false; setPassword(''); setVerifiedUntil(expiry); await onSessionChanged?.()
    } catch (failure) { setPassword(''); setVerifiedUntil(null); setError(failure instanceof Error ? failure.message : 'ยืนยันผู้เชี่ยวชาญไม่ได้') }
    finally { setBusy(false) }
  }
  const lock = async () => {
    manuallyLocked.current = true; setVerifiedUntil(null); setSelectedId(''); onChooseAnalysis?.(''); setBusy(true); setError(''); setMessage('')
    try { await apiRequest(session, '/expert-session', { method: 'DELETE' }) }
    catch (failure) { setError(`ซ่อนคลังภาพบนอุปกรณ์นี้แล้ว แต่ยังแจ้งเซิร์ฟเวอร์ไม่ได้: ${failure instanceof Error ? failure.message : 'กรุณาตรวจการเชื่อมต่อ'}`) }
    finally { setBusy(false) }
  }
  const relock = () => { manuallyLocked.current = true; setVerifiedUntil(null); setMessage('การยืนยันผู้เชี่ยวชาญหมดอายุ กรุณายืนยันรหัสผ่านอีกครั้ง') }
  const changeTab = (value: boolean) => { setAnswered(value); setOffset(0) }
  return <div className="platform-page expert-verification-page"><PlatformHeading kicker="EXPERT CONSULTATION" title="ทบทวนโดยผู้เชี่ยวชาญ" description="ส่งภาพที่ยังไม่มั่นใจ ติดตามสถานะ และรับคำตอบจากผู้เชี่ยวชาญ คลังภาพส่งต่อนี้แยกจากประวัติผลตรวจรายวัน"/>
    {message && <p className="platform-notice" role="status">{message}</p>}{error && <ErrorNotice message={error}/>}
    {!session.user && onOpenSettings && <button className="platform-button primary" onClick={onOpenSettings}>เข้าสู่ระบบ / สมัครสมาชิก</button>}
    <AccessState session={session} roles={['admin', 'reviewer', 'lab']}>
      {isExpert && checking ? <LoadingNotice>กำลังตรวจสิทธิ์ผู้เชี่ยวชาญ…</LoadingNotice> : isExpert && !verified ? <section className="platform-card expert-access-card"><h2>ยืนยันตัวตนผู้เชี่ยวชาญ</h2><p>บัญชีนี้ได้รับสิทธิ์ผู้เชี่ยวชาญแล้ว กรุณายืนยันรหัสผ่านอีกครั้งเพื่อเปิดคลังภาพและบันทึกคำตอบ การยืนยันมีอายุไม่เกิน 15 นาที</p><form onSubmit={event => { event.preventDefault(); void unlock() }}><label>บัญชีผู้เชี่ยวชาญ<input value={session.user?.username ?? ''} readOnly autoComplete="username"/></label><label>รหัสผ่านผู้เชี่ยวชาญ<PasswordInput aria-label="รหัสผ่านผู้เชี่ยวชาญ" toggleLabel="รหัสผ่านผู้เชี่ยวชาญ" required value={password} onChange={event => setPassword(event.target.value)} maxLength={1024} autoComplete="current-password" disabled={busy}/></label><button className="platform-button primary" type="submit" disabled={busy || !password}><ShieldCheck size={17}/>{busy ? 'กำลังยืนยัน…' : 'ยืนยันและเข้าคลังภาพ'}</button></form><p className="platform-muted">การยืนยันนี้ไม่เปลี่ยนสิทธิ์บัญชี และไม่ให้ผู้ใช้ทั่วไปเข้าถึงภาพของผู้อื่น</p></section> : <>
        {!selectedId ? <><div className="expert-queue-tools"><div className="expert-queue-tabs" role="tablist" aria-label="สถานะภาพส่งต่อ"><button role="tab" aria-selected={!answered} onClick={() => changeTab(false)}>ภาพรอผู้เชี่ยวชาญ</button><button role="tab" aria-selected={answered} onClick={() => changeTab(true)}>ตอบกลับแล้ว</button></div><div className="expert-queue-access">{isExpert ? <><span><ShieldCheck size={15}/> ยืนยันถึง {verifiedUntil ? new Intl.DateTimeFormat('th-TH', { timeStyle: 'short', timeZone: 'Asia/Bangkok' }).format(verifiedUntil) : '—'}</span><button className="platform-button" disabled={busy} onClick={() => void lock()}>ล็อกคลังภาพ</button></> : <span>แสดงเฉพาะภาพที่คุณส่งต่อ</span>}<button className="platform-button" onClick={queue.reload}><RefreshCw size={16}/>รีเฟรช</button></div></div>
          {isExpert && <label>คลังภาพ<select value={scope} onChange={event => { setScope(event.target.value as 'mine' | 'expert'); setOffset(0) }}><option value="expert">ภาพส่งต่อที่ผู้เชี่ยวชาญมีสิทธิ์ตรวจ</option><option value="mine">ภาพที่ฉันส่งต่อ</option></select></label>}
          {queue.loading ? <LoadingNotice/> : queue.error ? <ErrorNotice message={queue.error} onRetry={queue.reload}/> : !queue.value?.items.length ? <div className="platform-empty"><ShieldCheck size={28}/><h2>{answered ? 'ยังไม่มีภาพที่ตอบกลับแล้ว' : 'ไม่มีภาพส่งต่อที่รอตรวจ'}</h2><p>{isExpert ? 'ภาพจะปรากฏเมื่อเจ้าของผลตรวจกดส่งให้ผู้เชี่ยวชาญ' : 'เปิดผลจากประวัติการตรวจ แล้วกดส่งให้ผู้เชี่ยวชาญเมื่อมีภาพที่ยังไม่มั่นใจ'}</p></div> : <><div className="platform-record-grid" role="tabpanel" aria-label={answered ? 'ภาพที่ตอบกลับแล้ว' : 'ภาพส่งต่อรอตรวจ'}>{queue.value.items.map(item => <article className="platform-record expert-referral-card" key={item.id}><div className="expert-referral-top"><ReferralThumbnail analysisId={item.analysis_id}/><div className="expert-referral-heading"><ReferralStatusBadge status={item.status}/><h2>{item.analysis?.sample_code ?? 'ภาพส่งต่อ'}</h2><p>{formatDate(item.submitted_at ?? item.created_at)}</p></div></div><p className="platform-preserve-text">{item.reason}</p>{item.response_comment && <div className="expert-referral-reply"><strong>คำตอบจาก {item.reviewer_username ?? 'ผู้เชี่ยวชาญ'}</strong><p className="platform-preserve-text">{item.response_comment}</p></div>}<button className="platform-button primary" onClick={() => choose(item.analysis_id)}>{isExpert && scope === 'expert' ? 'เปิดภาพและตรวจทาน' : 'เปิดภาพและคำตอบ'}<ArrowRight size={17}/></button></article>)}</div><div className="platform-pagination"><span>แสดง {offset + 1}–{offset + queue.value.items.length} จาก {queue.value.total} ภาพ</span><button className="platform-button" disabled={offset === 0} onClick={() => setOffset(value => Math.max(0, value - 20))}>ก่อนหน้า</button><button className="platform-button" disabled={offset + queue.value.items.length >= queue.value.total} onClick={() => setOffset(value => value + 20)}>ถัดไป</button></div></>}
        </> : <><div className="platform-actions"><button className="platform-button" onClick={() => choose('')}><ArrowLeft size={17}/>กลับคลังภาพส่งต่อ</button>{isExpert && <button className="platform-button" disabled={busy} onClick={() => void lock()}>ล็อกคลังภาพ</button>}</div>
          {selectedReferral.value?.referral && <div className="expert-referral-note"><ReferralStatusBadge status={selectedReferral.value.referral.status}/><p><strong>เจ้าของภาพขอให้ตรวจ:</strong> {selectedReferral.value.referral.reason}</p></div>}
          {detail.loading ? <LoadingNotice/> : detail.error ? <ErrorNotice message={detail.error} onRetry={detail.reload}/> : detail.value && <ReviewEditor key={detail.value.id + ':' + detail.value.revision} analysis={detail.value} session={session} canReview={isExpert && verified} onExpertExpired={relock} onSaved={() => { setMessage('บันทึกผลตรวจทานแล้ว ผลเดิมและประวัติยังคงตรวจสอบย้อนหลังได้'); refresh.current() }} onReferred={() => { setMessage('ส่งภาพเข้าคลังรอผู้เชี่ยวชาญแล้ว'); refresh.current() }} onDeleted={() => { choose(''); setMessage('ลบภาพและนำรายการออกจากประวัติแล้ว ประวัติ audit ยังคงอยู่'); queue.reload() }}/>}
        </>}
      </>}
    </AccessState>
  </div>
}

function ReferralThumbnail({ analysisId }: { analysisId: string }) {
  const [failed, setFailed] = useState(false)
  return <div className="expert-referral-thumb">{failed ? <ImageOff size={23}/> : <img src={imageURL(analysisId)} alt="ภาพกล้องจุลทรรศน์ที่ส่งต่อ" loading="lazy" onError={() => setFailed(true)}/>}</div>
}

function ReviewEditor({ analysis, session, canReview, onSaved, onDeleted, onExpertExpired, onReferred }: { analysis: PlatformAnalysis; session: PlatformSession; canReview: boolean; onSaved: () => void; onDeleted: () => void; onExpertExpired: () => void; onReferred: () => void }) {
  const prior = analysis.latest_review
  const [drafts, setDrafts] = useState<DraftAnnotation[]>(() => analysis.detections.map(detection => {
    const reviewed = prior?.annotations.find(item => String(item.detection_id) === String(detection.id) && !['missed', 'missed_detection'].includes(item.action))
    return { key: String(detection.id), detection_id: detection.id, action: reviewed?.action ?? '', bbox: reviewed?.bbox ?? detection.bbox, label: reviewed?.label ?? reviewed?.corrected_label ?? detection.label, comment: reviewed?.comment ?? '' }
  }))
  const [missed, setMissed] = useState<DraftAnnotation[]>(() => prior?.annotations.filter(item => ['missed', 'missed_detection'].includes(item.action)).map((item, index) => ({ key: `missed-${index}`, action: 'missed', bbox: item.bbox ?? [0, 0, 1, 1], label: item.label ?? '', comment: item.comment ?? '' })) ?? [])
  const [selected, setSelected] = useState(drafts[0]?.key ?? ''), [status, setStatus] = useState('in_review'), [comment, setComment] = useState(''), [fullImage, setFullImage] = useState(false)
  const [zoom, setZoom] = useState(1), [boxes, setBoxes] = useState(true), [drawing, setDrawing] = useState(false), [start, setStart] = useState<[number, number] | null>(null), [preview, setPreview] = useState<[number, number, number, number] | null>(null)
  const [working, setWorking] = useState(false), [error, setError] = useState(''), [confirmDelete, setConfirmDelete] = useState(false), [imageFailed, setImageFailed] = useState(false)
  const svgRef = useRef<SVGSVGElement>(null)
  const reviews = usePlatformResource<Paged<ExpertReview>>(`/analyses/${encodeURIComponent(analysis.id)}/reviews`, session, true)
  const audit = usePlatformResource<Paged<AuditEntry>>(`/analyses/${encodeURIComponent(analysis.id)}/audit`, session, true)
  const active = [...drafts, ...missed].find(item => item.key === selected)
  const currentDetection = analysis.detections.find(item => String(item.id) === selected)
  const update = (key: string, change: Partial<DraftAnnotation>) => { setDrafts(previous => previous.map(item => item.key === key ? { ...item, ...change } : item)); setMissed(previous => previous.map(item => item.key === key ? { ...item, ...change } : item)) }
  const point = (event: PointerEvent<SVGSVGElement>): [number, number] => { const rect = event.currentTarget.getBoundingClientRect(); return [Math.max(0, Math.min(analysis.width, (event.clientX - rect.left) / rect.width * analysis.width)), Math.max(0, Math.min(analysis.height, (event.clientY - rect.top) / rect.height * analysis.height))] }
  const endDraw = (event: PointerEvent<SVGSVGElement>) => {
    if (!start) return
    const end = point(event), bbox: [number, number, number, number] = [Math.min(start[0], end[0]), Math.min(start[1], end[1]), Math.max(start[0], end[0]), Math.max(start[1], end[1])]
    setStart(null); setPreview(null); setDrawing(false)
    if (bbox[2] - bbox[0] < 2 || bbox[3] - bbox[1] < 2) { setError('กรอบเล็กเกินไป กรุณาลากให้ครอบวัตถุ'); return }
    const key = `missed-${crypto.randomUUID()}`; setMissed(previous => [...previous, { key, action: 'missed', bbox, label: '', comment: '' }]); setSelected(key)
  }
  const submit = async () => {
    setError('')
    if (status === 'verified' && (!fullImage || drafts.some(item => !item.action) || [...drafts, ...missed].some(item => ['uncertain', 'request_review'].includes(item.action)))) { setError('ก่อนยืนยัน ต้องทบทวนทุกวัตถุ ตรวจภาพทั้งภาพ และไม่มีรายการที่ยังไม่แน่ใจ'); return }
    const annotations = [...drafts.filter(item => item.action), ...missed].map(({ key: _key, ...item }) => item)
    setWorking(true)
    try { await apiRequest(session, `/analyses/${encodeURIComponent(analysis.id)}/reviews`, { json: { expected_revision: analysis.revision, full_image_reviewed: fullImage, status, comments: comment, annotations } }); onSaved() }
    catch (failure) { if (expertExpired(failure)) onExpertExpired(); setError(failure instanceof Error ? failure.message : 'บันทึกผลตรวจทานไม่ได้') }
    finally { setWorking(false) }
  }
  const download = async (kind: 'pdf' | 'csv') => { setWorking(true); setError(''); try { await downloadAPI(`/analyses/${encodeURIComponent(analysis.id)}/${kind === 'pdf' ? 'report.pdf' : 'export.csv'}`, `HelpMinths-${analysis.id}.${kind}`, session, kind === 'pdf' ? { method: 'POST' } : {}) } catch (failure) { setError(failure instanceof Error ? failure.message : 'ดาวน์โหลดไม่ได้') } finally { setWorking(false) } }
  const remove = async () => { setWorking(true); setError(''); try { await apiRequest(session, `/analyses/${encodeURIComponent(analysis.id)}${buildQuery({ expected_revision: analysis.revision })}`, { method: 'DELETE' }); onDeleted() } catch (failure) { setError(failure instanceof Error ? failure.message : 'ลบภาพไม่ได้'); setConfirmDelete(false) } finally { setWorking(false) } }
  return <>
    <section className="platform-card"><div className="platform-card-heading"><div><span className="platform-mono">{analysis.id}</span><h2>{analysis.sample_code}</h2><p>{formatDate(analysis.created_at)} · โมเดล {analysis.model ?? 'ไม่ระบุ'} · รุ่น {analysis.model_version ?? 'ไม่มีข้อมูลรุ่น'}</p></div><div className="platform-actions"><StatusBadge value={analysis.status}/><StatusBadge value={analysis.review_status}/></div></div><AnalysisCounter analysis={analysis}/><p className="platform-muted">จำนวนในภาพไม่ใช่ค่า EPG และไม่ใช้สรุปความรุนแรงของการติดเชื้อ ไม่มีข้อมูลวิธีตรวจและปริมาณสิ่งส่งตรวจที่ผ่านการตรวจสอบสำหรับคำนวณ EPG</p></section>
    {analysis.error_message && <ErrorNotice message={analysis.error_message}/>}
    {error && <ErrorNotice message={error}/>}
    <div className="platform-review-grid"><section className="platform-card platform-review-image"><div className="platform-image-tools"><button className="platform-button" onClick={() => setZoom(value => Math.max(1, value - .25))} aria-label="ย่อภาพตรวจทาน"><ZoomOut size={18}/></button><output>{Math.round(zoom * 100)}%</output><button className="platform-button" onClick={() => setZoom(value => Math.min(4, value + .25))} aria-label="ขยายภาพตรวจทาน"><ZoomIn size={18}/></button><button className="platform-button" onClick={() => setBoxes(value => !value)}>{boxes ? <EyeOff size={17}/> : <Eye size={17}/>} {boxes ? 'ดูภาพต้นฉบับ' : 'แสดงกรอบ'}</button>{canReview && <button className={`platform-button ${drawing ? 'primary' : ''}`} onClick={() => { setDrawing(value => !value); setStart(null); setPreview(null) }}><Plus size={17}/>{drawing ? 'ยกเลิกการลากกรอบ' : 'เพิ่มวัตถุที่ตกหล่น'}</button>}</div>
      <p className="platform-muted">{drawing ? 'ลากกรอบบนภาพรอบวัตถุที่ AI ไม่พบ แล้วระบุชนิดและเหตุผล' : 'เลือกกรอบหรือรายการวัตถุ ซูมแล้วเลื่อนแถบภาพเพื่อสำรวจรายละเอียด'}</p>
      {imageFailed ? <ErrorNotice message="เปิดภาพไม่ได้ ภาพอาจถูกลบหรือบัญชีไม่มีสิทธิ์เข้าถึง"/> : <div className="platform-image-scroll"><svg ref={svgRef} viewBox={`0 0 ${analysis.width} ${analysis.height}`} style={{ width: `${zoom * 100}%`, touchAction: drawing ? 'none' : 'pan-x pan-y' }} aria-label="ภาพต้นฉบับและกรอบสำหรับตรวจทาน" role="img" onPointerDown={event => { if (!drawing || !canReview) return; event.preventDefault(); setStart(point(event)); event.currentTarget.setPointerCapture(event.pointerId) }} onPointerMove={event => { if (start) { const end = point(event); setPreview([Math.min(start[0], end[0]), Math.min(start[1], end[1]), Math.max(start[0], end[0]), Math.max(start[1], end[1])]) } }} onPointerUp={endDraw} onPointerCancel={() => { setStart(null); setPreview(null) }}>
        <image href={imageURL(analysis.id)} width={analysis.width} height={analysis.height} onError={() => setImageFailed(true)}/>
        {boxes && [...drafts, ...missed].map((item, index) => <g key={item.key} role="button" tabIndex={drawing ? -1 : 0} aria-label={`เลือกวัตถุ ${index + 1} ${item.label}`} onClick={() => { if (!drawing) setSelected(item.key) }} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelected(item.key) } }}><rect x={item.bbox[0]} y={item.bbox[1]} width={item.bbox[2] - item.bbox[0]} height={item.bbox[3] - item.bbox[1]} fill="transparent" stroke={selected === item.key ? '#215eac' : item.action === 'missed' ? '#168452' : '#b87915'} strokeWidth={selected === item.key ? 4 : 2} vectorEffect="non-scaling-stroke" strokeDasharray={item.action === 'false_positive' ? '6 4' : undefined}/><title>{item.label} · {item.action || 'ยังไม่ทบทวน'}</title></g>)}
        {preview && <rect x={preview[0]} y={preview[1]} width={preview[2] - preview[0]} height={preview[3] - preview[1]} stroke="#168452" strokeWidth="3" fill="#16845222" vectorEffect="non-scaling-stroke"/>}
      </svg></div>}
      <QualitySummary quality={analysis.quality}/>
    </section><section className="platform-card"><h2>วัตถุในภาพ</h2>{canReview && drafts.some(item => !item.action) && <button className="platform-button" onClick={() => setDrafts(previous => previous.map(item => item.action ? item : { ...item, action: 'confirm' }))}><CheckCheck size={17}/>ยืนยันกรอบที่ยังไม่ทบทวน</button>}<div className="platform-object-list">{analysis.detections.map((item: PlatformDetection, index) => <button className={`platform-object ${selected === String(item.id) ? 'selected' : ''}`} key={item.id} aria-pressed={selected === String(item.id)} onClick={() => setSelected(String(item.id))}><span>{index + 1}</span><div><strong>{item.label}</strong><small>Model confidence {(item.confidence * 100).toFixed(1)}%</small><small>{actions[drafts.find(draft => draft.key === String(item.id))?.action as keyof typeof actions] ?? 'ยังไม่ได้ทบทวน'}</small></div></button>)}{missed.map((item, index) => <button className={`platform-object ${selected === item.key ? 'selected' : ''}`} key={item.key} aria-pressed={selected === item.key} onClick={() => setSelected(item.key)}><span>+</span><div><strong>{item.label || `วัตถุที่เพิ่ม ${index + 1}`}</strong><small>เพิ่มโดยผู้ตรวจทาน ไม่ใช่ผล AI</small></div></button>)}</div>
      {!analysis.detections.length && !missed.length && <p className="platform-muted">ไม่มีวัตถุที่ AI ตรวจพบ การไม่ตรวจพบไม่ยืนยันว่าไม่มีพยาธิ</p>}
      {active && <div className="platform-object-editor"><h3>{active.action === 'missed' ? 'วัตถุที่ผู้ตรวจทานเพิ่ม' : 'ตรวจทานวัตถุที่เลือก'}</h3>{currentDetection && <p>ผลเดิม: <strong>{currentDetection.label}</strong> · {(currentDetection.confidence * 100).toFixed(1)}% model confidence</p>}
        {canReview ? <>{active.action !== 'missed' && <label>การดำเนินการ<select value={active.action} onChange={event => update(active.key, { action: event.target.value, ...(event.target.value === 'confirm' && currentDetection ? { label: currentDetection.label, bbox: currentDetection.bbox } : {}) })}>{Object.entries(actions).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
          {(active.action === 'correct' || active.action === 'missed') && <><label>ชนิดที่ตรวจทาน<input value={active.label} onChange={event => update(active.key, { label: event.target.value })} maxLength={150}/></label><div className="platform-coordinate-grid">{['x1', 'y1', 'x2', 'y2'].map((name, index) => <label key={name}>{name}<input type="number" value={Number(active.bbox[index].toFixed(2))} min={0} max={index % 2 === 0 ? analysis.width : analysis.height} step="0.1" onChange={event => { const value = Number(event.target.value); if (Number.isFinite(value)) { const bbox = [...active.bbox] as [number, number, number, number]; bbox[index] = value; update(active.key, { bbox }) } }}/></label>)}</div></>}
          <label>หมายเหตุสำหรับวัตถุนี้<textarea value={active.comment} onChange={event => update(active.key, { comment: event.target.value })} maxLength={2000} rows={3}/></label>
          {active.action === 'missed' && <button className="platform-button danger" onClick={() => { setMissed(previous => previous.filter(item => item.key !== active.key)); setSelected(drafts[0]?.key ?? '') }}><Trash2 size={16}/>นำกรอบนี้ออกจากร่าง</button>}
        </> : <p>บัญชีผู้ปฏิบัติงานดูข้อมูลได้ ผู้ตรวจสอบหรือผู้ดูแลเท่านั้นที่บันทึกผลตรวจทานได้</p>}
      </div>}
    </section></div>
    {canReview && <section className="platform-card"><h2>บันทึกผลตรวจทาน</h2><div className="platform-form-grid"><label>สถานะการทบทวน<select value={status} onChange={event => setStatus(event.target.value)}><option value="in_review">กำลังทบทวน / บันทึกร่าง</option><option value="verified">ทบทวนครบแล้ว</option><option value="needs_additional_review">ขอทบทวนเพิ่มเติม</option></select></label><label>ความคิดเห็นรวม<textarea value={comment} onChange={event => setComment(event.target.value)} rows={3} maxLength={2000}/></label></div><label className="platform-check"><input type="checkbox" checked={fullImage} onChange={event => setFullImage(event.target.checked)}/>ตรวจภาพทั้งภาพแล้ว รวมวัตถุที่ AI อาจตรวจตกหล่น</label><p className="platform-muted">บันทึกนี้ไม่เปลี่ยนผลคาดการณ์เดิมหรือฝึกโมเดลใหม่ ผลที่ยังไม่แน่ใจต้องขอทบทวนเพิ่มเติม</p><button className="platform-button primary" disabled={working || analysis.status !== 'completed'} onClick={() => void submit()}><Save size={17}/>{working ? 'กำลังบันทึก…' : 'บันทึกผลตรวจทาน'}</button></section>}
    {session.user?.id === analysis.owner_id && <ReferralPanel session={session} analysisId={analysis.id} onReferred={onReferred}/>}
    <section className="platform-card"><div className="platform-card-heading"><h2>รายงานและการเก็บรักษา</h2><div className="platform-actions"><button className="platform-button" disabled={working} onClick={() => void download('pdf')}><Download size={17}/>รายงาน PDF</button><button className="platform-button" disabled={working} onClick={() => void download('csv')}><Download size={17}/>ข้อมูล CSV</button>{(session.user?.role === 'admin' || session.user?.id === analysis.owner_id) && <button className="platform-button danger" disabled={working} onClick={() => setConfirmDelete(true)}><Trash2 size={17}/>ลบภาพและรายการ</button>}</div></div><p>ผลลัพธ์จาก HelpMinths AI ควรได้รับการตรวจสอบโดยผู้เชี่ยวชาญก่อนนำไปใช้ประกอบการตัดสินใจทางคลินิก</p></section>
    <section className="platform-card"><h2>ประวัติการตรวจทาน</h2>{reviews.loading ? <LoadingNotice/> : reviews.error ? <ErrorNotice message={reviews.error}/> : !reviews.value?.items.length ? <p className="platform-muted">ยังไม่มีการตรวจทานที่บันทึกไว้</p> : reviews.value.items.map((item, index) => <details key={item.id ?? index}><summary>{formatDate(item.created_at)} · ผู้ตรวจ {item.reviewer_id ?? 'ไม่ระบุ'} · {item.status}</summary><p>{item.comment ?? item.comments}</p><pre>{JSON.stringify(item.annotations, null, 2)}</pre></details>)}<h3>Audit trail</h3>{audit.error ? <ErrorNotice message={audit.error}/> : !audit.value?.items.length ? <p className="platform-muted">ยังไม่มีประวัติที่อ่านได้</p> : audit.value.items.map(item => <details key={item.id}><summary>{formatDate(item.created_at)} · {item.action} · {item.actor_username ?? item.actor_id}</summary><pre>{JSON.stringify({ before: item.before_data ?? item.before, after: item.after_data ?? item.after }, null, 2)}</pre></details>)}</section>
    {confirmDelete && <ConfirmDialog title="ลบภาพและนำรายการออกจากประวัติ?" busy={working} onCancel={() => setConfirmDelete(false)} onConfirm={() => void remove()}><p>ภาพจะถูกลบตามนโยบายของระบบ ส่วนข้อมูลเดิมและ audit ที่จำเป็นยังคงอยู่เพื่อการตรวจสอบย้อนหลัง</p><p>การลบนี้ไม่สามารถเรียกภาพกลับจากหน้าเว็บได้</p></ConfirmDialog>}
  </>
}
