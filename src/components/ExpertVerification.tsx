import { ArrowLeft, ArrowRight, CheckCheck, Download, Eye, EyeOff, Plus, RefreshCw, Save, ShieldCheck, Trash2, ZoomIn, ZoomOut } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import { APIError, apiRequest, buildQuery, downloadAPI, formatDate, imageURL } from '../platform/api'
import type { ExpertReview, Paged, PlatformAnalysis, PlatformDetection, PlatformSession, ReviewAnnotation } from '../platform/api'
import { AccessState, ConfirmDialog, ErrorNotice, LoadingNotice, PlatformHeading, QualitySummary, StatusBadge, usePlatformResource } from './PlatformShared'
import ReferralPanel, { PrivateReferralImage, ReferralConversation, ReferralStatusBadge, usePrivateImageURL } from './ReferralPanel'
import type { Referral } from './ReferralPanel'
import PasswordInput from './PasswordInput'
import DiagnosisComparison, { expertReviewIsFinal } from './DiagnosisComparison'

const actions = { '': 'ยังไม่ได้ทบทวน', confirm: 'ถูกต้อง', correct: 'แก้ชนิด', correct_class: 'แก้ชนิด', false_positive: 'ไม่ใช่ไข่พยาธิ', uncertain: 'ไม่แน่ใจ', request_review: 'ขอทบทวนเพิ่มเติม', missed: 'วัตถุที่ผู้ตรวจทานเพิ่ม', missed_detection: 'วัตถุที่ผู้ตรวจทานเพิ่ม' }
const objectDecisions = [{ value: 'confirm', label: 'ถูกต้อง' }, { value: 'correct', label: 'แก้ชนิด' }, { value: 'false_positive', label: 'ไม่ใช่ไข่พยาธิ' }, { value: 'uncertain', label: 'ไม่แน่ใจ' }] as const
type DraftAnnotation = ReviewAnnotation & { key: string; action: string; bbox: [number, number, number, number]; label: string; comment: string }
interface AuditEntry { id: string; actor_id?: string; action?: string; created_at?: string; before?: unknown; after?: unknown; before_data?: unknown; after_data?: unknown; actor_username?: string }

type ReviewDecision = 'in_review' | 'needs_additional_review' | 'verified'
const decisionMessages = { in_review: 'บันทึกร่างแล้ว', needs_additional_review: 'ส่งคำขอภาพเพิ่มเติมแล้ว', verified: 'ยืนยันผลและปิดรายการแล้ว' }

interface ExpertSession { verified: boolean; verified_until: string | null }
function expertExpired(failure: unknown) {
  return failure instanceof APIError && !!failure.detail && typeof failure.detail === 'object' && 'code' in failure.detail && failure.detail.code === 'expert_verification_required'
}

export default function ExpertVerification({ session, analysisId, referralId, messageId, onChooseAnalysis, onOpenSettings, onSessionChanged }: { session: PlatformSession; analysisId?: string; referralId?: string; messageId?: string; onChooseAnalysis?: (id: string, referralId?: string) => void; onOpenSettings?: () => void; onSessionChanged?: () => Promise<void> }) {
  const [selectedId, setSelectedId] = useState(analysisId ?? ''), [selectedReferralId, setSelectedReferralId] = useState(referralId ?? ''), [selectedMessageId, setSelectedMessageId] = useState(messageId ?? ''), [message, setMessage] = useState(''), [error, setError] = useState('')
  const [password, setPassword] = useState(''), [busy, setBusy] = useState(false), [checking, setChecking] = useState(true), [verifiedUntil, setVerifiedUntil] = useState<number | null>(null)
  const [answered, setAnswered] = useState(false), [offset, setOffset] = useState(0), [scope, setScope] = useState<'mine' | 'expert'>('expert')
  const manuallyLocked = useRef(false)
  const enabled = session.configured && !!session.user && session.user.role !== 'student'
  const isExpert = session.user?.role === 'admin' || session.user?.role === 'reviewer'
  const verified = verifiedUntil !== null && verifiedUntil > Date.now()
  const canOpen = enabled && (!isExpert || verified)
  const queue = usePlatformResource<Paged<Referral>>(`/referrals${buildQuery({ scope: isExpert ? scope : 'mine', state: answered ? 'completed' : 'pending', limit: 20, offset })}`, session, canOpen && !selectedId)
  const detail = usePlatformResource<PlatformAnalysis>(`/analyses/${encodeURIComponent(selectedId)}`, session, canOpen && !!selectedId)
  const referralPath = selectedReferralId ? `/referrals/${encodeURIComponent(selectedReferralId)}` : `/analyses/${encodeURIComponent(selectedId)}/referral`
  const selectedReferral = usePlatformResource<{ referral: Referral | null } | Referral>(referralPath, session, canOpen && !!selectedId)
  const receivedReferral = selectedReferral.value && ('referral' in selectedReferral.value ? selectedReferral.value.referral : selectedReferral.value)
  const referral = receivedReferral?.analysis_id === selectedId ? receivedReferral : undefined
  const historical = !!referral && !!detail.value?.referral_id && referral.id !== detail.value.referral_id
  const refresh = useRef(() => {})
  refresh.current = () => { queue.reload(); detail.reload(); selectedReferral.reload() }
  useEffect(() => { setSelectedId(analysisId ?? ''); setSelectedReferralId(referralId ?? ''); setSelectedMessageId(messageId ?? ''); if (analysisId) setMessage(''); setError('') }, [analysisId, referralId, messageId])
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
  const choose = (id: string, targetReferralId?: string) => { setSelectedId(id); setSelectedReferralId(targetReferralId ?? ''); setSelectedMessageId(''); setMessage(''); setError(''); onChooseAnalysis?.(id, targetReferralId) }
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
    manuallyLocked.current = true; setVerifiedUntil(null); setSelectedId(''); setSelectedReferralId(''); setSelectedMessageId(''); onChooseAnalysis?.(''); setBusy(true); setError(''); setMessage('')
    try { await apiRequest(session, '/expert-session', { method: 'DELETE' }) }
    catch (failure) { setError(`ซ่อนคลังภาพบนอุปกรณ์นี้แล้ว แต่ยังแจ้งเซิร์ฟเวอร์ไม่ได้: ${failure instanceof Error ? failure.message : 'กรุณาตรวจการเชื่อมต่อ'}`) }
    finally { setBusy(false) }
  }
  const relock = () => { manuallyLocked.current = true; setVerifiedUntil(null); setMessage('การยืนยันผู้เชี่ยวชาญหมดอายุ กรุณายืนยันรหัสผ่านอีกครั้ง') }
  const changeTab = (value: boolean) => { setAnswered(value); setOffset(0) }
  return <div className="platform-page expert-verification-page"><PlatformHeading kicker="EXPERT CONSULTATION" title="ทบทวนโดยผู้เชี่ยวชาญ" description="ติดตามภาพส่งตรวจและคำตอบของแต่ละรายการ"/>
    {message && <p className="platform-notice" role="status">{message}</p>}{error && <ErrorNotice message={error}/>}
    {!session.user && onOpenSettings && <button className="platform-button primary" onClick={onOpenSettings}>เข้าสู่ระบบผู้เชี่ยวชาญ / สมัครบัญชีผู้เชี่ยวชาญ</button>}
    <AccessState session={session} roles={['admin', 'reviewer', 'lab']}>
      {isExpert && checking ? <LoadingNotice>กำลังตรวจสิทธิ์ผู้เชี่ยวชาญ…</LoadingNotice> : isExpert && !verified ? <section className="platform-card expert-access-card"><h2>ยืนยันตัวตนผู้เชี่ยวชาญ</h2><p>บัญชีนี้ได้รับสิทธิ์ผู้เชี่ยวชาญแล้ว กรุณายืนยันรหัสผ่านอีกครั้งเพื่อเปิดคลังภาพและบันทึกคำตอบ การยืนยันมีอายุไม่เกิน 15 นาที</p><form onSubmit={event => { event.preventDefault(); void unlock() }}><label>บัญชีผู้เชี่ยวชาญ<input value={session.user?.username ?? ''} readOnly autoComplete="username"/></label><label>รหัสผ่านผู้เชี่ยวชาญ<PasswordInput aria-label="รหัสผ่านผู้เชี่ยวชาญ" toggleLabel="รหัสผ่านผู้เชี่ยวชาญ" required value={password} onChange={event => setPassword(event.target.value)} maxLength={1024} autoComplete="current-password" disabled={busy}/></label><button className="platform-button primary" type="submit" disabled={busy || !password}><ShieldCheck size={17}/>{busy ? 'กำลังยืนยัน…' : 'ยืนยันและเข้าคลังภาพ'}</button></form><p className="platform-muted">การยืนยันนี้ไม่เปลี่ยนสิทธิ์บัญชี และไม่ให้ผู้ใช้ทั่วไปเข้าถึงภาพของผู้อื่น</p></section> : <>
        {!selectedId ? <><div className="expert-queue-tools"><div className="expert-queue-tabs" role="tablist" aria-label="สถานะภาพส่งต่อ"><button role="tab" aria-selected={!answered} onClick={() => changeTab(false)}>รอตรวจ</button><button role="tab" aria-selected={answered} onClick={() => changeTab(true)}>เสร็จสิ้น</button></div><div className="expert-queue-access">{isExpert ? <><span><ShieldCheck size={15}/> ยืนยันถึง {verifiedUntil ? new Intl.DateTimeFormat('th-TH', { timeStyle: 'short', timeZone: 'Asia/Bangkok' }).format(verifiedUntil) : '—'}</span><button className="platform-button" disabled={busy} onClick={() => void lock()}>ล็อกคลังภาพ</button></> : <span>แสดงเฉพาะภาพที่คุณส่งต่อ</span>}<button className="platform-button" onClick={queue.reload}><RefreshCw size={16}/>รีเฟรช</button></div></div>
          {isExpert && <label>คลังภาพ<select value={scope} onChange={event => { setScope(event.target.value as 'mine' | 'expert'); setOffset(0) }}><option value="expert">ภาพส่งต่อที่ผู้เชี่ยวชาญมีสิทธิ์ตรวจ</option><option value="mine">ภาพที่ฉันส่งต่อ</option></select></label>}
          {queue.loading ? <LoadingNotice/> : queue.error ? <ErrorNotice message={queue.error} onRetry={queue.reload}/> : !queue.value?.items.length ? <div className="platform-empty"><ShieldCheck size={28}/><h2>{answered ? 'ยังไม่มีภาพที่ตรวจเสร็จสิ้น' : 'ไม่มีภาพส่งต่อที่รอตรวจ'}</h2><p>{isExpert ? 'ภาพจะปรากฏเมื่อเจ้าของผลตรวจกดส่งให้ผู้เชี่ยวชาญ' : 'เปิดผลจากประวัติการตรวจ แล้วกดส่งให้ผู้เชี่ยวชาญเมื่อมีภาพที่ยังไม่มั่นใจ'}</p></div> : <><div className="platform-record-grid" role="tabpanel" aria-label={answered ? 'ภาพที่ตรวจเสร็จสิ้น' : 'ภาพส่งต่อรอตรวจ'}>{queue.value.items.map(item => <article className="platform-record expert-referral-card" key={item.id}><div className="expert-referral-top"><ReferralThumbnail analysisId={item.analysis_id} session={session}/><div className="expert-referral-heading"><ReferralStatusBadge status={item.status}/><h2>{item.analysis?.sample_code ?? 'ภาพส่งต่อ'}</h2><p>{formatDate(item.submitted_at ?? item.created_at)}</p></div></div><p className="platform-preserve-text">{item.reason}</p>{item.response_comment && <div className="expert-referral-reply"><strong>คำตอบจาก {item.reviewer_username ?? 'ผู้เชี่ยวชาญ'}</strong><p className="platform-preserve-text">{item.response_comment}</p></div>}<button className="platform-button primary" onClick={() => choose(item.analysis_id, item.id)}>{isExpert && scope === 'expert' ? 'เปิดภาพและตรวจทาน' : 'เปิดภาพและคำตอบ'}<ArrowRight size={17}/></button></article>)}</div><div className="platform-pagination"><span>แสดง {offset + 1}–{offset + queue.value.items.length} จาก {queue.value.total} ภาพ</span><button className="platform-button" disabled={offset === 0} onClick={() => setOffset(value => Math.max(0, value - 20))}>ก่อนหน้า</button><button className="platform-button" disabled={offset + queue.value.items.length >= queue.value.total} onClick={() => setOffset(value => value + 20)}>ถัดไป</button></div></>}
        </> : <><div className="platform-actions"><button className="platform-button" onClick={() => choose('')}><ArrowLeft size={17}/>กลับคลังภาพส่งต่อ</button><button className="platform-button" onClick={() => refresh.current()}><RefreshCw size={16}/>รีเฟรชรายการ</button>{isExpert && <button className="platform-button" disabled={busy} onClick={() => void lock()}>ล็อกคลังภาพ</button>}</div>
          {isExpert && referral && <div className="expert-referral-note"><ReferralStatusBadge status={referral.status}/><p><strong>เจ้าของภาพขอให้ตรวจ:</strong> {referral.reason}</p></div>}
          {selectedReferral.error && <ErrorNotice message={selectedReferral.error} onRetry={selectedReferral.reload}/>}
          {detail.loading || selectedReferral.loading ? <LoadingNotice/> : selectedReferral.error ? null : detail.error ? <ErrorNotice message={detail.error} onRetry={detail.reload}/> : detail.value && <ReviewEditor key={`${detail.value.id}:${detail.value.revision}:${referral?.id ?? ''}:${referral?.latest_review?.id ?? ''}`} analysis={detail.value} referral={referral} selectedReferralId={selectedReferralId || undefined} selectedMessageId={selectedMessageId || undefined} session={session} canReview={isExpert && verified && !historical && !selectedReferral.loading && !selectedReferral.error} onExpertExpired={relock} onSaved={status => { choose(''); setMessage(decisionMessages[status]); queue.reload(); window.dispatchEvent(new Event('helpminths:expert-queue-changed')) }} onReferred={notice => { setSelectedReferralId(''); setSelectedMessageId(''); onChooseAnalysis?.(selectedId); setMessage(notice ?? 'อัปเดตรายการส่งต่อแล้ว'); refresh.current() }} onDeleted={() => { choose(''); setMessage('นำรายการออกจากประวัติแล้ว สำเนาภาพและผลตรวจยังอยู่ในคลังของ Super Admin'); queue.reload() }}/>}
        </>}
      </>}
    </AccessState>
  </div>
}

function ReferralThumbnail({ analysisId, session }: { analysisId: string; session: PlatformSession }) {
  return <div className="expert-referral-thumb"><PrivateReferralImage session={session} path={imageURL(analysisId)} alt="ภาพกล้องจุลทรรศน์ที่ส่งต่อ"/></div>
}

function ReviewEditor({ analysis, referral, selectedReferralId, selectedMessageId, session, canReview, onSaved, onDeleted, onExpertExpired, onReferred }: { analysis: PlatformAnalysis; referral?: Referral; selectedReferralId?: string; selectedMessageId?: string; session: PlatformSession; canReview: boolean; onSaved: (status: ReviewDecision) => void; onDeleted: () => void; onExpertExpired: () => void; onReferred: (notice?: string) => void }) {
  const privateImage = usePrivateImageURL(imageURL(analysis.id), session)
  const prior = referral ? (referral.latest_review ?? null) : analysis.latest_review
  const finalReview = expertReviewIsFinal(prior, analysis.detections)
  const [imageSource, setImageSource] = useState<'ai' | 'expert'>(finalReview ? 'expert' : 'ai')
  const [drafts, setDrafts] = useState<DraftAnnotation[]>(() => analysis.detections.map(detection => {
    const reviewed = prior?.annotations.find(item => String(item.detection_id) === String(detection.id) && !['missed', 'missed_detection'].includes(item.action))
    // Confirmation must retain the exact AI coordinates; saved review boxes may be rounded.
    return { key: String(detection.id), detection_id: detection.id, action: reviewed?.action ?? '', bbox: reviewed?.action === 'confirm' ? detection.bbox : reviewed?.bbox ?? detection.bbox, label: reviewed?.action === 'confirm' ? detection.label : reviewed?.label ?? reviewed?.corrected_label ?? detection.label, comment: reviewed?.comment ?? '' }
  }))
  const [missed, setMissed] = useState<DraftAnnotation[]>(() => prior?.annotations.filter(item => ['missed', 'missed_detection'].includes(item.action)).map((item, index) => ({ key: `missed-${index}`, action: item.action, bbox: item.bbox ?? [0, 0, 1, 1], label: item.label ?? '', comment: item.comment ?? '' })) ?? [])
  const [selected, setSelected] = useState(drafts[0]?.key ?? ''), [comment, setComment] = useState(''), [fullImage, setFullImage] = useState(false)
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
  const remaining = drafts.filter(item => !item.action).length
  const uncertain = [...drafts, ...missed].filter(item => ['uncertain', 'request_review'].includes(item.action)).length
  const missing = [remaining ? `เหลือ ${remaining} วัตถุที่ยังไม่ตรวจ` : '', uncertain ? `มี ${uncertain} วัตถุที่ยังไม่แน่ใจ` : '', !fullImage ? 'ยังไม่ได้ยืนยันว่าตรวจภาพทั้งภาพแล้ว' : '', !comment.trim() ? 'กรอกข้อความถึงผู้ส่ง' : ''].filter(Boolean)
  const submit = async (status: ReviewDecision) => {
    setError('')
    if (working || !canReview) return
    if (status !== 'in_review' && !comment.trim()) { setError('กรอกข้อความถึงผู้ส่งก่อนบันทึก'); return }
    if (status === 'verified' && (!fullImage || drafts.some(item => !item.action) || [...drafts, ...missed].some(item => ['uncertain', 'request_review'].includes(item.action)))) { setError('ก่อนยืนยัน ต้องทบทวนทุกวัตถุ ตรวจภาพทั้งภาพ และไม่มีรายการที่ยังไม่แน่ใจ'); return }
    const annotations = [...drafts.filter(item => item.action), ...missed].map(({ key: _key, ...item }) => item)
    setWorking(true)
    try { await apiRequest(session, `/analyses/${encodeURIComponent(analysis.id)}/reviews`, { json: { expected_revision: analysis.revision, full_image_reviewed: fullImage, status, comments: comment.trim(), annotations } }); onSaved(status) }
    catch (failure) { if (expertExpired(failure)) onExpertExpired(); setError(failure instanceof Error ? failure.message : 'บันทึกผลตรวจทานไม่ได้') }
    finally { setWorking(false) }
  }
  const download = async (kind: 'pdf' | 'csv') => { setWorking(true); setError(''); try { await downloadAPI(`/analyses/${encodeURIComponent(analysis.id)}/${kind === 'pdf' ? 'report.pdf' : 'export.csv'}`, `HelpMinths-${analysis.id}.${kind}`, session, kind === 'pdf' ? { method: 'POST' } : {}) } catch (failure) { setError(failure instanceof Error ? failure.message : 'ดาวน์โหลดไม่ได้') } finally { setWorking(false) } }
  const remove = async () => { setWorking(true); setError(''); try { await apiRequest(session, `/analyses/${encodeURIComponent(analysis.id)}${buildQuery({ expected_revision: analysis.revision })}`, { method: 'DELETE' }); onDeleted() } catch (failure) { setError(failure instanceof Error ? failure.message : 'ลบภาพไม่ได้'); setConfirmDelete(false) } finally { setWorking(false) } }
  const displayedObjects: DraftAnnotation[] = canReview ? [...drafts, ...missed] : imageSource === 'expert' && finalReview ? (prior?.annotations ?? []).filter(item => ['confirm', 'correct', 'correct_class', 'missed', 'missed_detection'].includes(item.action) && item.bbox).map((item, index) => ({ key: String(item.detection_id ?? `expert-${index}`), detection_id: item.detection_id, action: item.action, bbox: item.bbox!, label: item.label || item.corrected_label || analysis.detections.find(detection => String(detection.id) === String(item.detection_id))?.label || 'วัตถุที่ผู้เชี่ยวชาญยืนยัน', comment: item.comment || '' })) : analysis.detections.map(item => ({ key: String(item.id), detection_id: item.id, action: 'ai', bbox: item.bbox, label: item.label, comment: '' }))
  return <>
    <section className="platform-card review-case-heading"><div className="platform-card-heading"><div><h2>{analysis.sample_code}</h2><p>{formatDate(analysis.created_at)}</p></div><StatusBadge value={analysis.status}/></div></section>
    {session.user?.id === analysis.owner_id ? <ReferralPanel session={session} analysisId={analysis.id} referralId={selectedReferralId} messageId={selectedMessageId} onReferred={onReferred}/> : <DiagnosisComparison analysis={analysis} review={prior} reviewState={referral?.status} expertComment={referral?.response_comment} expertName={referral?.reviewer_username} respondedAt={referral?.responded_at} historical={!!selectedReferralId && selectedReferralId !== analysis.referral_id}/>}
    {analysis.error_message && <ErrorNotice message={analysis.error_message}/>}
    {error && <ErrorNotice message={error}/>}
    {referral && analysis.owner_id !== session.user?.id && <section className="platform-card"><ReferralConversation key={referral.id} referral={referral} session={session}/></section>}
    {!canReview && <div className="review-image-source" role="group" aria-label="เลือกผลที่แสดงบนภาพ"><button type="button" className={`platform-button ${imageSource === 'ai' ? 'primary' : ''}`} aria-pressed={imageSource === 'ai'} onClick={() => setImageSource('ai')}>กรอบที่ AI ทำนาย</button>{finalReview && <button type="button" className={`platform-button ${imageSource === 'expert' ? 'primary' : ''}`} aria-pressed={imageSource === 'expert'} onClick={() => setImageSource('expert')}>กรอบที่ผู้เชี่ยวชาญยืนยัน</button>}</div>}
    <div className={`platform-review-grid ${canReview ? '' : 'review-readonly-grid'}`}><section className="platform-card platform-review-image"><div className="platform-image-tools"><button className="platform-button" onClick={() => setZoom(value => Math.max(1, value - .25))} aria-label="ย่อภาพตรวจทาน"><ZoomOut size={18}/></button><output>{Math.round(zoom * 100)}%</output><button className="platform-button" onClick={() => setZoom(value => Math.min(4, value + .25))} aria-label="ขยายภาพตรวจทาน"><ZoomIn size={18}/></button><button className="platform-button" onClick={() => setBoxes(value => !value)}>{boxes ? <EyeOff size={17}/> : <Eye size={17}/>} {boxes ? 'ดูภาพต้นฉบับ' : 'แสดงกรอบ'}</button>{canReview && <button className={`platform-button ${drawing ? 'primary' : ''}`} onClick={() => { setDrawing(value => !value); setStart(null); setPreview(null) }}><Plus size={17}/>{drawing ? 'ยกเลิกการลากกรอบ' : 'เพิ่มวัตถุที่ตกหล่น'}</button>}</div>
      <p className="review-image-legend"><strong>{canReview ? 'กรอบสำหรับตรวจทาน · ร่างที่กำลังแก้ไข' : imageSource === 'expert' && finalReview ? 'กำลังแสดง: ผลยืนยันจากผู้เชี่ยวชาญ' : 'กำลังแสดง: ผลทำนายเดิมของ AI'}</strong></p>
      <p className="platform-muted">{drawing ? 'ลากกรอบบนภาพรอบวัตถุที่ AI ไม่พบ แล้วระบุชนิดและเหตุผล' : 'เลือกกรอบหรือรายการวัตถุ ซูมแล้วเลื่อนแถบภาพเพื่อสำรวจรายละเอียด'}</p>
      {imageFailed || privateImage.error ? <ErrorNotice message={privateImage.error || "เปิดภาพไม่ได้ ภาพอาจถูกลบหรือบัญชีไม่มีสิทธิ์เข้าถึง"}/> : privateImage.loading || !privateImage.url ? <LoadingNotice>กำลังเปิดภาพส่วนตัว…</LoadingNotice> : <div className="platform-image-scroll"><svg ref={svgRef} viewBox={`0 0 ${analysis.width} ${analysis.height}`} style={{ width: `${zoom * 100}%`, touchAction: drawing ? 'none' : 'pan-x pan-y' }} aria-label={canReview ? 'ภาพต้นฉบับและกรอบสำหรับตรวจทาน' : imageSource === 'expert' && finalReview ? 'ภาพและกรอบที่ผู้เชี่ยวชาญยืนยัน' : 'ภาพและกรอบที่ AI ทำนาย'} role="img" onPointerDown={event => { if (!drawing || !canReview) return; event.preventDefault(); setStart(point(event)); event.currentTarget.setPointerCapture(event.pointerId) }} onPointerMove={event => { if (start) { const end = point(event); setPreview([Math.min(start[0], end[0]), Math.min(start[1], end[1]), Math.max(start[0], end[0]), Math.max(start[1], end[1])]) } }} onPointerUp={endDraw} onPointerCancel={() => { setStart(null); setPreview(null) }}>
        <image href={privateImage.url} width={analysis.width} height={analysis.height} onError={() => setImageFailed(true)}/>
        {boxes && displayedObjects.map((item, index) => <g key={item.key} role="button" tabIndex={drawing ? -1 : 0} aria-label={`เลือกวัตถุ ${index + 1} ${item.label}`} onClick={() => { if (!drawing) setSelected(item.key) }} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelected(item.key) } }}><rect x={item.bbox[0]} y={item.bbox[1]} width={item.bbox[2] - item.bbox[0]} height={item.bbox[3] - item.bbox[1]} fill="transparent" stroke={selected === item.key ? 'var(--color-accent)' : item.action === 'missed' ? 'var(--color-success)' : 'var(--color-warning)'} strokeWidth={selected === item.key ? 4 : 2} vectorEffect="non-scaling-stroke" strokeDasharray={item.action === 'false_positive' ? '6 4' : undefined}/><title>{item.label} · {canReview ? (actions[item.action as keyof typeof actions] || 'วัตถุที่ผู้ตรวจทานเพิ่ม') : imageSource === 'expert' && finalReview ? 'ผลยืนยันของผู้เชี่ยวชาญ' : 'ผลทำนายของ AI'}</title></g>)}
        {preview && <rect x={preview[0]} y={preview[1]} width={preview[2] - preview[0]} height={preview[3] - preview[1]} stroke="var(--color-accent)" strokeWidth="3" fill="var(--color-surface-2)" vectorEffect="non-scaling-stroke"/>}
      </svg></div>}
      <details className="review-quality-details"><summary>คุณภาพภาพและข้อมูลโมเดล</summary><p className="platform-muted">โมเดล {analysis.model ?? 'ไม่ระบุ'} · รุ่น {analysis.model_version ?? 'ไม่ระบุ'}</p><QualitySummary quality={analysis.quality}/><p className="platform-muted">จำนวนตำแหน่งในภาพไม่ใช่ค่า EPG และไม่ใช้ระบุความรุนแรงของการติดเชื้อ</p></details>
    </section>{canReview && <section className="platform-card"><h2>วัตถุในภาพ</h2>{canReview && drafts.some(item => !item.action) && <button className="platform-button" onClick={() => setDrafts(previous => previous.map(item => item.action ? item : { ...item, action: 'confirm' }))}><CheckCheck size={17}/>ยืนยันกรอบที่ยังไม่ทบทวนทั้งหมด</button>}<div className="platform-object-list">{analysis.detections.map((item: PlatformDetection, index) => <button className={`platform-object ${selected === String(item.id) ? 'selected' : ''}`} key={item.id} aria-pressed={selected === String(item.id)} onClick={() => setSelected(String(item.id))}><span>{index + 1}</span><div><strong>{item.label}</strong><small>ความเชื่อมั่น AI {(item.confidence * 100).toFixed(1)}%</small><small>{actions[drafts.find(draft => draft.key === String(item.id))?.action as keyof typeof actions] ?? 'ยังไม่ได้ทบทวน'}</small></div></button>)}{missed.map((item, index) => <button className={`platform-object ${selected === item.key ? 'selected' : ''}`} key={item.key} aria-pressed={selected === item.key} onClick={() => setSelected(item.key)}><span>+</span><div><strong>{item.label || `วัตถุที่เพิ่ม ${index + 1}`}</strong><small>เพิ่มโดยผู้ตรวจทาน ไม่ใช่ผล AI</small></div></button>)}</div>
      {!analysis.detections.length && !missed.length && <p className="platform-muted">ไม่มีวัตถุที่ AI ตรวจพบ การไม่ตรวจพบไม่ยืนยันว่าไม่มีพยาธิ</p>}
      {active && <div className="platform-object-editor"><h3>{['missed', 'missed_detection'].includes(active.action) ? 'วัตถุที่ผู้ตรวจทานเพิ่ม' : 'ตรวจทานวัตถุที่เลือก'}</h3>{currentDetection && <p>ผลเดิม: <strong>{currentDetection.label}</strong> · {(currentDetection.confidence * 100).toFixed(1)}% ความเชื่อมั่น AI</p>}
        {canReview ? <>{!['missed', 'missed_detection'].includes(active.action) && <div className="review-object-decisions" role="group" aria-label="ผลตรวจวัตถุที่เลือก">{objectDecisions.map(decision => <button type="button" key={decision.value} className="platform-button" aria-pressed={active.action === decision.value || (decision.value === 'correct' && active.action === 'correct_class')} onClick={() => update(active.key, { action: decision.value, ...(decision.value === 'confirm' && currentDetection ? { label: currentDetection.label, bbox: currentDetection.bbox } : {}) })}>{decision.label}</button>)}</div>}
          {(active.action === 'correct' || ['missed', 'missed_detection'].includes(active.action)) && <><label>ชนิดที่ตรวจทาน<input value={active.label} onChange={event => update(active.key, { label: event.target.value })} maxLength={150}/></label><details className="review-coordinate-details"><summary>ปรับพิกัด (ขั้นสูง)</summary><div className="platform-coordinate-grid">{['x1', 'y1', 'x2', 'y2'].map((name, index) => <label key={name}>{name}<input type="number" value={Number(active.bbox[index].toFixed(2))} min={0} max={index % 2 === 0 ? analysis.width : analysis.height} step="0.1" onChange={event => { const value = Number(event.target.value); if (Number.isFinite(value)) { const bbox = [...active.bbox] as [number, number, number, number]; bbox[index] = value; update(active.key, { bbox }) } }}/></label>)}</div></details></>}
          <details className="review-object-notes" key={active.key}><summary>หมายเหตุสำหรับวัตถุนี้{active.comment ? ' (มีข้อความ)' : ''}</summary><label>หมายเหตุสำหรับวัตถุนี้<textarea value={active.comment} onChange={event => update(active.key, { comment: event.target.value })} maxLength={2000} rows={3}/></label></details>
          {['missed', 'missed_detection'].includes(active.action) && <button className="platform-button danger" onClick={() => { setMissed(previous => previous.filter(item => item.key !== active.key)); setSelected(drafts[0]?.key ?? '') }}><Trash2 size={16}/>นำกรอบนี้ออกจากร่าง</button>}
        </> : <p>บัญชีผู้ปฏิบัติงานดูข้อมูลได้ ผู้ตรวจสอบหรือผู้ดูแลเท่านั้นที่บันทึกผลตรวจทานได้</p>}
      </div>}
    </section>}</div>
    {canReview && <section className="platform-card review-decision-bar" aria-label="ตัดสินใจผลตรวจ"><label>ข้อความถึงผู้ส่ง<textarea value={comment} onChange={event => setComment(event.target.value)} rows={2} maxLength={4000} disabled={working}/></label><label className="platform-check"><input type="checkbox" checked={fullImage} onChange={event => setFullImage(event.target.checked)} disabled={working}/>ตรวจภาพทั้งภาพแล้ว</label><div className="review-decision-actions"><button type="button" className="platform-button" disabled={working || analysis.status !== 'completed'} onClick={() => void submit('in_review')}><Save size={17}/>บันทึกร่าง</button><button type="button" className="platform-button" disabled={working || !comment.trim() || analysis.status !== 'completed'} onClick={() => void submit('needs_additional_review')}>ขอภาพเพิ่มเติม</button><button type="button" className="platform-button primary" aria-describedby="review-decision-missing" disabled={working || missing.length > 0 || analysis.status !== 'completed'} onClick={() => void submit('verified')}>ยืนยันผลและปิดรายการ</button></div><p id="review-decision-missing" className="platform-muted" aria-live="polite">{missing.join(' · ') || 'พร้อมยืนยันผลและปิดรายการ'}</p><p className="platform-muted">ผล AI ต้องได้รับการทบทวนโดยผู้เชี่ยวชาญ</p></section>}
    <section className="platform-card"><div className="platform-card-heading"><h2>รายงานและประวัติ</h2><div className="platform-actions"><button className="platform-button" disabled={working} onClick={() => void download('pdf')}><Download size={17}/>รายงาน PDF</button><button className="platform-button" disabled={working} onClick={() => void download('csv')}><Download size={17}/>ข้อมูล CSV</button>{(session.user?.role === 'admin' || session.user?.id === analysis.owner_id) && <button className="platform-button danger" disabled={working} onClick={() => setConfirmDelete(true)}><Trash2 size={17}/>นำออกจากประวัติ</button>}</div></div><p>ผลลัพธ์จาก HelpMinths AI ควรได้รับการตรวจสอบโดยผู้เชี่ยวชาญก่อนนำไปใช้ประกอบการตัดสินใจทางคลินิก</p></section>
    <details className="platform-card expert-technical-history"><summary>ประวัติการตรวจทานและบันทึกระบบ</summary><h2>ประวัติการตรวจทาน</h2>{reviews.loading ? <LoadingNotice/> : reviews.error ? <ErrorNotice message={reviews.error}/> : !reviews.value?.items.length ? <p className="platform-muted">ยังไม่มีการตรวจทานที่บันทึกไว้</p> : reviews.value.items.map((item, index) => <details key={item.id ?? index}><summary>{formatDate(item.created_at)} · ผู้ตรวจ {item.reviewer_id ?? 'ไม่ระบุ'} · {item.status}</summary><p>{item.comment ?? item.comments}</p><pre>{JSON.stringify(item.annotations, null, 2)}</pre></details>)}<h3>Audit trail</h3>{audit.error ? <ErrorNotice message={audit.error}/> : !audit.value?.items.length ? <p className="platform-muted">ยังไม่มีประวัติที่อ่านได้</p> : audit.value.items.map(item => <details key={item.id}><summary>{formatDate(item.created_at)} · {item.action} · {item.actor_username ?? item.actor_id}</summary><pre>{JSON.stringify({ before: item.before_data ?? item.before, after: item.after_data ?? item.after }, null, 2)}</pre></details>)}</details>
    {confirmDelete && <ConfirmDialog title="นำรายการออกจากประวัติของคุณ?" busy={working} onCancel={() => setConfirmDelete(false)} onConfirm={() => void remove()}><p>รายการจะหายจากประวัติและคลังส่งต่อของคุณ สำเนาภาพและผลตรวจยังคงอยู่ในคลังภาพหลังบ้านที่เฉพาะ Super Admin เปิดดูได้</p><p>คุณจะเปิดรายการนี้จากประวัติของตนเองไม่ได้หลังยืนยัน</p></ConfirmDialog>}
  </>
}
