import { ArrowRight, CheckCircle2, ChevronLeft, ChevronRight, Clock3, ImageOff, MessageCircle, RefreshCw, Send, ShieldCheck, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { apiPath, apiRequest, buildQuery, formatDate } from '../platform/api'
import type { ExpertReview, Paged, PlatformAnalysis, PlatformSession } from '../platform/api'
import { ErrorNotice, LoadingNotice, usePlatformResource } from './PlatformShared'
import '../styles/referrals.css'
import DiagnosisComparison from './DiagnosisComparison'

export type ReferralStatus = 'pending' | 'in_review' | 'needs_more' | 'confirmed'
export interface Referral {
  id: string
  analysis_id: string
  status: ReferralStatus
  reason: string
  response_comment?: string
  latest_review?: ExpertReview | null
  reviewer_username?: string | null
  submitted_at?: string
  responded_at?: string | null
  created_at: string
  updated_at: string
  revision: number
  analysis_revision_at_referral?: number
  analysis?: Pick<PlatformAnalysis, 'id' | 'sample_code' | 'created_at' | 'revision' | 'status' | 'review_status' | 'image_url' | 'model_version' | 'counts'>
}
interface ReferralMessage { id: string; action: string; comment: string; author_id: string; author_username?: string; author_name?: string; author_role?: string; created_at: string; attachment_id?: string; review_id?: string }
interface ReferralAttachment { id: string; created_at: string; uploaded_at?: string; uploaded_by_username?: string; width: number; height: number; comment?: string; image_url: string }

export const referralStatusNames: Record<ReferralStatus, string> = {
  pending: 'รอผู้เชี่ยวชาญ', in_review: 'กำลังตรวจทาน', needs_more: 'รอภาพเพิ่มเติมจากผู้ส่ง', confirmed: 'ผู้เชี่ยวชาญยืนยันแล้ว',
}

export function ReferralStatusBadge({ status }: { status: ReferralStatus }) {
  return <span className={`referral-status referral-status-${status}`}>{status === 'confirmed' ? <CheckCircle2 size={15}/> : <Clock3 size={15}/>} {referralStatusNames[status] ?? status}</span>
}

/** Keep private image bytes out of browser caches and release them on account changes. */
export function usePrivateImageURL(path: string, session: PlatformSession) {
  const key = `${session.user?.id ?? ''}:${session.csrf_token ?? ''}:${path}`
  const [state, setState] = useState({ key: '', url: '', error: '', loading: false })
  const enabled = session.configured && !!session.user && !!path
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    let objectURL = ''
    let disposed = false
    setState({ key, url: '', error: '', loading: true })
    const timer = window.setTimeout(() => controller.abort(), 30_000)
    const read = async () => {
      try {
        const response = await fetch(apiPath(path), { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
        if (!response.ok) {
          if (response.status === 401) window.dispatchEvent(new CustomEvent('helpminths:session-expired', { detail: { userId: session.user?.id ?? null } }))
          throw new Error('เปิดภาพไม่ได้ ภาพอาจถูกลบหรือบัญชีไม่มีสิทธิ์เข้าถึง')
        }
        const blob = await response.blob()
        if (!blob.size || !blob.type.startsWith('image/')) throw new Error('บริการส่งภาพในรูปแบบที่แสดงไม่ได้')
        if (controller.signal.aborted) return
        objectURL = URL.createObjectURL(blob)
        setState({ key, url: objectURL, error: '', loading: false })
      } catch (failure) {
        if (!disposed) setState({ key, url: '', error: controller.signal.aborted ? 'เปิดภาพนานเกินไป กรุณารีเฟรชแล้วลองอีกครั้ง' : failure instanceof Error ? failure.message : 'เปิดภาพไม่ได้', loading: false })
      } finally { window.clearTimeout(timer) }
    }
    void read()
    return () => { disposed = true; controller.abort(); window.clearTimeout(timer); if (objectURL) URL.revokeObjectURL(objectURL) }
  }, [key, enabled])
  const current = enabled && state.key === key
  return { url: current ? state.url : '', error: current ? state.error : '', loading: enabled && (!current || state.loading) }
}

export function PrivateReferralImage({ path, session, alt, className }: { path: string; session: PlatformSession; alt: string; className?: string }) {
  const image = usePrivateImageURL(path, session)
  const [failedURL, setFailedURL] = useState('')
  if (image.error || (image.url && failedURL === image.url)) return <div className={`${className ?? ''} referral-image-fallback`} role="img" aria-label={`${alt} · เปิดภาพไม่ได้`}><ImageOff size={24}/><span>เปิดภาพไม่ได้</span></div>
  if (!image.url) return <div className={`${className ?? ''} referral-image-fallback`} role="status">กำลังเปิดภาพ…</div>
  return <img className={className} src={image.url} alt={alt} loading="lazy" onError={() => setFailedURL(image.url)}/>
}

const messageActions: Record<string, string> = { request: 'ส่งให้ผู้เชี่ยวชาญ', reply: 'คำตอบจากผู้เชี่ยวชาญ', request_more: 'ขอภาพเพิ่มเติมจากผู้ส่ง', attachment: 'ส่งภาพเพิ่มเติม', review: 'บันทึกการทบทวน', confirmed: 'ยืนยันผลและส่งคำตอบ' }

export function ReferralConversation({ session, referral, allowUpload = false, onChanged }: { session: PlatformSession; referral: Referral; allowUpload?: boolean; onChanged?: () => void }) {
  const [messageOffset, setMessageOffset] = useState(0), [imageOffset, setImageOffset] = useState(0)
  const [image, setImage] = useState<File | null>(null), [preview, setPreview] = useState(''), [comment, setComment] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const endpoint = `/referrals/${encodeURIComponent(referral.id)}`
  const messages = usePlatformResource<Paged<ReferralMessage>>(`${endpoint}/messages${buildQuery({ limit: 20, offset: messageOffset })}`, session)
  const attachments = usePlatformResource<Paged<ReferralAttachment>>(`${endpoint}/attachments${buildQuery({ limit: 20, offset: imageOffset })}`, session)
  const revision = useRef(referral.revision)
  useEffect(() => {
    if (revision.current === referral.revision) return
    revision.current = referral.revision; messages.reload(); attachments.reload()
  }, [referral.revision])
  useEffect(() => {
    if (!image) { setPreview(''); return }
    const url = URL.createObjectURL(image); setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [image])
  const upload = async () => {
    if (!image || busy || !allowUpload || referral.status !== 'needs_more') return
    if (image.size > 20 * 1024 * 1024) { setError('ภาพต้องมีขนาดไม่เกิน 20 MB'); return }
    setBusy(true); setError('')
    const form = new FormData()
    form.set('expected_revision', String(referral.revision)); form.set('image', image)
    if (comment.trim()) form.set('comment', comment.trim())
    try {
      await apiRequest<{ attachment: ReferralAttachment; referral: Referral }>(session, `${endpoint}/attachments`, { method: 'POST', body: form, timeoutMs: 90_000 })
      setImage(null); setComment(''); if (fileInput.current) fileInput.current.value = ''
      messages.reload(); attachments.reload(); onChanged?.()
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'ส่งภาพเพิ่มเติมไม่ได้ กรุณาลองอีกครั้ง') }
    finally { setBusy(false) }
  }
  return <div className="referral-conversation">
    <details className="referral-history"><summary><MessageCircle size={18}/>ประวัติคำตอบและภาพเพิ่มเติม</summary><div>
    <div className="platform-card-heading"><h3><MessageCircle size={18}/> ประวัติคำตอบและการส่งภาพ</h3><button className="platform-button" onClick={() => { messages.reload(); attachments.reload() }} disabled={busy} aria-label="รีเฟรชประวัติคำตอบ"><RefreshCw size={16}/>รีเฟรช</button></div>
    {messages.loading ? <LoadingNotice>กำลังอ่านประวัติคำตอบ…</LoadingNotice> : messages.error ? <ErrorNotice message={messages.error} onRetry={messages.reload}/> : !messages.value?.items.length ? <p className="platform-muted">ยังไม่มีข้อความในรายการนี้</p> : <><ol className="referral-message-list">{messages.value.items.map(item => <li key={item.id} className={`referral-message referral-message-${item.action}`}><div><strong>{messageActions[item.action] ?? 'ข้อความในรายการส่งต่อ'}</strong><time dateTime={item.created_at}>{formatDate(item.created_at)}</time></div><span className="platform-muted">{item.author_name ?? item.author_username ?? (item.author_id === session.user?.id ? 'คุณ' : 'ผู้ใช้ในระบบ')}{item.author_role === 'admin' || item.author_role === 'reviewer' ? ' · ผู้เชี่ยวชาญ' : ' · ผู้ส่งภาพ'}</span>{item.comment && <p className="platform-preserve-text">{item.comment}</p>}</li>)}</ol>{messages.value.total > 20 && <div className="platform-pagination"><span>ข้อความ {messageOffset + 1}–{messageOffset + messages.value.items.length} จาก {messages.value.total}</span><button className="platform-button" disabled={!messageOffset} onClick={() => setMessageOffset(value => Math.max(0, value - 20))}><ChevronLeft size={16}/>ก่อนหน้า</button><button className="platform-button" disabled={messageOffset + messages.value.items.length >= messages.value.total} onClick={() => setMessageOffset(value => value + 20)}>ถัดไป<ChevronRight size={16}/></button></div>}</>}
    {attachments.error ? <ErrorNotice message={attachments.error} onRetry={attachments.reload}/> : !!attachments.value?.items.length && <section className="referral-attachments" aria-label="ภาพเพิ่มเติมที่ส่งแล้ว"><h3>ภาพเพิ่มเติม</h3><div className="referral-attachment-grid">{attachments.value.items.map(item => <figure key={item.id}><PrivateReferralImage session={session} path={`${endpoint}/attachments/${encodeURIComponent(item.id)}/image`} alt={`ภาพเพิ่มเติม ${formatDate(item.uploaded_at ?? item.created_at)}`}/><figcaption><time dateTime={item.uploaded_at ?? item.created_at}>{formatDate(item.uploaded_at ?? item.created_at)}</time>{item.uploaded_by_username && <span>ผู้ส่ง: {item.uploaded_by_username}</span>}{item.comment && <p className="platform-preserve-text">{item.comment}</p>}</figcaption></figure>)}</div>{attachments.value.total > 20 && <div className="platform-pagination"><span>ภาพ {imageOffset + 1}–{imageOffset + attachments.value.items.length} จาก {attachments.value.total}</span><button className="platform-button" disabled={!imageOffset} onClick={() => setImageOffset(value => Math.max(0, value - 20))}>ก่อนหน้า</button><button className="platform-button" disabled={imageOffset + attachments.value.items.length >= attachments.value.total} onClick={() => setImageOffset(value => value + 20)}>ถัดไป</button></div>}</section>}
    </div></details>
    {allowUpload && referral.status === 'needs_more' && <form className="referral-upload" onSubmit={event => { event.preventDefault(); void upload() }}><h3><Upload size={18}/> ส่งภาพเพิ่มเติมให้ผู้เชี่ยวชาญ</h3><p>แนบภาพตามคำขอด้านบนเพื่อส่งกลับเข้าคิวรอตรวจ</p>{error && <ErrorNotice message={error}/>}<label>ภาพเพิ่มเติม<input ref={fileInput} type="file" required accept="image/*,.heic,.heif,.tif,.tiff" disabled={busy} onChange={event => { setImage(event.target.files?.[0] ?? null); setError('') }}/></label>{preview && <img className="referral-upload-preview" src={preview} alt="ตัวอย่างภาพเพิ่มเติมก่อนส่ง"/>}<label>ข้อความประกอบภาพ (ไม่บังคับ)<textarea value={comment} onChange={event => setComment(event.target.value)} rows={3} maxLength={2000} disabled={busy}/></label><p className="platform-muted">ขนาดภาพไม่เกิน 20 MB</p><button className="platform-button primary" type="submit" disabled={busy || !image}><Upload size={17}/>{busy ? 'กำลังส่งภาพเพิ่มเติม…' : 'ส่งภาพเพิ่มเติม'}</button></form>}
  </div>
}

/** A referral points to the private saved image; it never republishes its bytes. */
export default function ReferralPanel({ session, analysisId, referralId, messageId, onReferred }: { session: PlatformSession; analysisId: string; referralId?: string; messageId?: string; onReferred?: (notice?: string) => void }) {
  const enabled = session.configured && !!session.user && session.user.role !== 'student' && !!analysisId
  const detail = usePlatformResource<PlatformAnalysis>(`/analyses/${encodeURIComponent(analysisId)}`, session, enabled)
  const referralPath = referralId ? `/referrals/${encodeURIComponent(referralId)}` : `/analyses/${encodeURIComponent(analysisId)}/referral`
  const resource = usePlatformResource<{ referral: Referral | null } | Referral>(referralPath, session, enabled)
  const [reason, setReason] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const receivedReferral = resource.value && ('referral' in resource.value ? resource.value.referral : resource.value)
  const referral = receivedReferral?.analysis_id === analysisId ? receivedReferral : null
  const historical = !!referral && !!detail.value?.referral_id && referral.id !== detail.value.referral_id
  const selectedMessage = usePlatformResource<ReferralMessage>(`/referrals/${encodeURIComponent(referral?.id ?? '')}/messages/${encodeURIComponent(messageId ?? '')}`, session, enabled && !!referral && !!messageId)
  const answerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!selectedMessage.value?.id) return
    // Start with the authoritative comparison even when an old reply was opened.
    // The exact selected message remains separately labelled just below it.
    const target = answerRef.current?.closest('.referral-panel')?.querySelector<HTMLElement>('.diagnosis-comparison') ?? answerRef.current
    target?.focus({ preventScroll: true })
    target?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' })
  }, [selectedMessage.value?.id])
  const active = !!referral && referral.status !== 'confirmed'
  const reload = useRef(() => {})
  reload.current = () => { detail.reload(); resource.reload() }
  useEffect(() => {
    if (!enabled || !active) return
    const controller = new AbortController()
    const timer = window.setInterval(() => {
      if (!document.hidden && navigator.onLine) void apiRequest<{ referral: Referral | null } | Referral>(session, referralPath, { signal: controller.signal }).then(value => { const updated = 'referral' in value ? value.referral : value; if (!controller.signal.aborted && updated?.revision !== referral?.revision) reload.current() }).catch(() => { /* The manual refresh presents connection errors without interrupting an image draft. */ })
    }, 30_000)
    return () => { controller.abort(); window.clearInterval(timer) }
  }, [enabled, active, referralPath, referral?.revision, session.user?.id, session.csrf_token])
  useEffect(() => { setReason(''); setError(''); setNotice('') }, [analysisId])
  const submit = async () => {
    if (!detail.value || !reason.trim() || busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      await apiRequest(session, `/analyses/${encodeURIComponent(analysisId)}/referrals`, { json: { reason: reason.trim(), expected_revision: detail.value.revision } })
      setReason(''); setNotice('ส่งภาพเข้าคลังรอผู้เชี่ยวชาญแล้ว คุณเปิดดูสถานะและคำตอบได้ในเมนูทบทวนโดยผู้เชี่ยวชาญ')
      reload.current(); onReferred?.('ส่งภาพเข้าคลังรอผู้เชี่ยวชาญแล้ว')
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'ส่งต่อภาพไม่ได้ กรุณาลองอีกครั้ง'); reload.current() }
    finally { setBusy(false) }
  }
  if (!enabled) return null
  const own = detail.value?.owner_id === session.user?.id
  return <section className="platform-card referral-panel" data-referral-id={referral?.id} aria-labelledby={`referral-title-${analysisId}`}>
    <div className="platform-card-heading"><div><h2 id={`referral-title-${analysisId}`}><ShieldCheck size={21}/>{referral ? 'ผลตรวจและคำตอบจากผู้เชี่ยวชาญ' : 'ผลตรวจและการส่งต่อ'}</h2></div><button className="platform-button" onClick={() => { reload.current(); selectedMessage.reload() }} disabled={busy} aria-label="รีเฟรชสถานะภาพส่งต่อ"><RefreshCw size={16}/>รีเฟรช</button></div>
    {error && <ErrorNotice message={error}/>} {notice && <p className="platform-notice" role="status">{notice}</p>}
    {detail.loading || resource.loading ? <LoadingNotice/> : detail.error || resource.error ? <ErrorNotice message={detail.error || resource.error} onRetry={() => reload.current()}/> : !own ? <p className="platform-muted">เฉพาะเจ้าของผลตรวจสามารถส่งต่อภาพนี้ได้</p> : <>
      <DiagnosisComparison analysis={detail.value!} review={referral ? (referral.latest_review ?? null) : detail.value?.latest_review} reviewState={referral?.status} expertComment={referral?.response_comment} expertName={referral?.reviewer_username} respondedAt={referral?.responded_at} historical={historical}/>
      {referral && <><div className="referral-current"><div className="referral-current-heading"><ReferralStatusBadge status={referral.status}/><span>{formatDate(referral.submitted_at ?? referral.created_at)}</span></div>
        {messageId && (selectedMessage.loading ? <LoadingNotice>กำลังเปิดข้อความที่เลือก…</LoadingNotice> : selectedMessage.error ? <ErrorNotice message={selectedMessage.error} onRetry={selectedMessage.reload}/> : selectedMessage.value && <div className="referral-response referral-response-selected referral-response-history" ref={answerRef} tabIndex={-1} data-message-id={selectedMessage.value.id} role="region" aria-label="คำตอบที่เลือกจากการแจ้งเตือน"><MessageCircle size={22}/><div><strong>ข้อความที่เปิดจากการแจ้งเตือน</strong><span className="referral-answer-action">{messageActions[selectedMessage.value.action] ?? 'ข้อความจากผู้เชี่ยวชาญ'} · {formatDate(selectedMessage.value.created_at)}</span><p className="platform-preserve-text">{selectedMessage.value.comment || 'ผู้เชี่ยวชาญบันทึกผลทบทวนแล้ว'}</p><span>{selectedMessage.value.author_name ?? selectedMessage.value.author_username ?? 'ผู้เชี่ยวชาญ'}</span><p className="referral-history-guidance">ข้อความนี้เป็นประวัติการสนทนา อ่านผลยืนยันล่าสุดของรอบนี้ในช่อง “ผู้เชี่ยวชาญ” ด้านบน</p></div></div>)}
        <details className="referral-reason"><summary>รายละเอียดที่ส่งให้ผู้เชี่ยวชาญ{historical ? ' · รายการก่อนหน้า' : ''}</summary><p className="platform-preserve-text">{referral.reason}</p></details>
      </div><ReferralConversation key={referral.id} session={session} referral={referral} allowUpload={!historical} onChanged={() => { setNotice('ส่งภาพเพิ่มเติมแล้ว รายการกลับเข้าคิวรอตรวจ'); reload.current(); onReferred?.('ส่งภาพเพิ่มเติมแล้ว รายการกลับเข้าคิวรอตรวจ') }}/></>}
      {!active && !historical && detail.value?.status === 'completed' && <form className="referral-form" onSubmit={event => { event.preventDefault(); void submit() }}><label>สิ่งที่ต้องการให้ผู้เชี่ยวชาญช่วยตรวจ<textarea required value={reason} onChange={event => setReason(event.target.value)} maxLength={4000} rows={3} placeholder="เช่น ไม่แน่ใจชนิดของไข่ หรือพบวัตถุที่ AI ยังไม่ได้ตีกรอบ" disabled={busy}/></label><button className="platform-button primary" type="submit" disabled={busy || !reason.trim()}><Send size={17}/>{busy ? 'กำลังส่งภาพ…' : referral ? 'ส่งให้ตรวจเพิ่มเติม' : 'ส่งให้ผู้เชี่ยวชาญ'}<ArrowRight size={16}/></button></form>}
      {!active && detail.value?.status !== 'completed' && <p className="platform-muted">ส่งต่อได้เมื่อการวิเคราะห์เสร็จและบันทึกภาพสำเร็จแล้ว</p>}
    </>}
  </section>
}
