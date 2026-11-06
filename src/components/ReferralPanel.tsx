import { ArrowRight, CheckCircle2, Clock3, MessageCircle, RefreshCw, Send, ShieldCheck } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { apiRequest, formatDate } from '../platform/api'
import type { PlatformAnalysis, PlatformSession } from '../platform/api'
import { ErrorNotice, LoadingNotice, usePlatformResource } from './PlatformShared'
import '../styles/referrals.css'

export type ReferralStatus = 'pending' | 'in_review' | 'needs_more' | 'confirmed'
export interface Referral {
  id: string
  analysis_id: string
  status: ReferralStatus
  reason: string
  response_comment?: string
  reviewer_username?: string | null
  submitted_at?: string
  responded_at?: string | null
  created_at: string
  updated_at: string
  revision: number
  analysis_revision_at_referral?: number
  analysis?: Pick<PlatformAnalysis, 'id' | 'sample_code' | 'created_at' | 'revision' | 'status' | 'review_status' | 'image_url' | 'model_version' | 'counts'>
}

export const referralStatusNames: Record<ReferralStatus, string> = {
  pending: 'รอผู้เชี่ยวชาญ', in_review: 'กำลังตรวจทาน', needs_more: 'รอตรวจเพิ่มเติม', confirmed: 'ผู้เชี่ยวชาญตอบกลับแล้ว',
}

export function ReferralStatusBadge({ status }: { status: ReferralStatus }) {
  return <span className={`referral-status referral-status-${status}`}>{status === 'confirmed' ? <CheckCircle2 size={15}/> : <Clock3 size={15}/>} {referralStatusNames[status] ?? status}</span>
}

/** A referral points to the private saved image; it never republishes its bytes. */
export default function ReferralPanel({ session, analysisId, onReferred }: { session: PlatformSession; analysisId: string; onReferred?: () => void }) {
  const enabled = session.configured && !!session.user && session.user.role !== 'student' && !!analysisId
  const detail = usePlatformResource<PlatformAnalysis>(`/analyses/${encodeURIComponent(analysisId)}`, session, enabled)
  const resource = usePlatformResource<{ referral: Referral | null }>(`/analyses/${encodeURIComponent(analysisId)}/referral`, session, enabled)
  const [reason, setReason] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const referral = resource.value?.referral
  const active = !!referral && referral.status !== 'confirmed'
  const reload = useRef(() => {})
  reload.current = () => { detail.reload(); resource.reload() }
  useEffect(() => {
    if (!enabled || !active) return
    const timer = window.setInterval(() => { if (!document.hidden && navigator.onLine) reload.current() }, 30_000)
    return () => window.clearInterval(timer)
  }, [enabled, active, analysisId])
  useEffect(() => { setReason(''); setError(''); setNotice('') }, [analysisId])
  const submit = async () => {
    if (!detail.value || !reason.trim() || busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      await apiRequest(session, `/analyses/${encodeURIComponent(analysisId)}/referrals`, { json: { reason: reason.trim(), expected_revision: detail.value.revision } })
      setReason(''); setNotice('ส่งภาพเข้าคลังรอผู้เชี่ยวชาญแล้ว คุณเปิดดูสถานะและคำตอบได้ในเมนูทบทวนโดยผู้เชี่ยวชาญ')
      reload.current(); onReferred?.()
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'ส่งต่อภาพไม่ได้ กรุณาลองอีกครั้ง'); reload.current() }
    finally { setBusy(false) }
  }
  if (!enabled) return null
  const own = detail.value?.owner_id === session.user?.id
  return <section className="platform-card referral-panel" aria-labelledby={`referral-title-${analysisId}`}>
    <div className="platform-card-heading"><div><span className="referral-eyebrow">EXPERT CONSULTATION</span><h2 id={`referral-title-${analysisId}`}><ShieldCheck size={21}/> ส่งภาพที่ยังไม่มั่นใจให้ผู้เชี่ยวชาญ</h2><p>คลังภาพส่งต่อแยกจากประวัติผลตรวจรายวัน ผู้เชี่ยวชาญที่ได้รับสิทธิ์จะตรวจและตอบกลับในระบบ</p></div><button className="platform-button" onClick={() => reload.current()} disabled={busy} aria-label="รีเฟรชสถานะภาพส่งต่อ"><RefreshCw size={16}/>รีเฟรช</button></div>
    {error && <ErrorNotice message={error}/>} {notice && <p className="platform-notice" role="status">{notice}</p>}
    {detail.loading || resource.loading ? <LoadingNotice/> : detail.error || resource.error ? <ErrorNotice message={detail.error || resource.error} onRetry={() => reload.current()}/> : !own ? <p className="platform-muted">เฉพาะเจ้าของผลตรวจสามารถส่งต่อภาพนี้ได้</p> : <>
      {referral && <div className="referral-current"><div className="referral-current-heading"><ReferralStatusBadge status={referral.status}/><span>{formatDate(referral.submitted_at ?? referral.created_at)}</span></div><p><strong>เหตุผลที่ส่งต่อ</strong><span className="platform-preserve-text">{referral.reason}</span></p>
        {referral.response_comment || referral.status === 'confirmed' ? <div className="referral-response"><MessageCircle size={19}/><div><strong>{referral.status === 'confirmed' ? 'คำตอบจากผู้เชี่ยวชาญ' : 'ข้อเสนอแนะจากผู้เชี่ยวชาญ'}</strong><p className="platform-preserve-text">{referral.response_comment || 'ผู้เชี่ยวชาญตรวจทานและยืนยันผลแล้ว เปิดรายละเอียดผลตรวจเพื่อดูชนิดและกรอบที่ยืนยัน'}</p><span>{referral.reviewer_username ? `ผู้ตรวจ: ${referral.reviewer_username} · ` : ''}{formatDate(referral.responded_at ?? referral.updated_at)}</span></div></div> : <p className="referral-waiting"><Clock3 size={16}/>ยังไม่มีคำตอบจากผู้เชี่ยวชาญ ระบบจะตรวจสถานะใหม่ขณะเปิดหน้านี้</p>}
      </div>}
      {!active && detail.value?.status === 'completed' && <form className="referral-form" onSubmit={event => { event.preventDefault(); void submit() }}><label>สิ่งที่ต้องการให้ผู้เชี่ยวชาญช่วยตรวจ<textarea required value={reason} onChange={event => setReason(event.target.value)} maxLength={4000} rows={3} placeholder="เช่น ไม่แน่ใจชนิดของไข่ หรือพบวัตถุที่ AI ยังไม่ได้ตีกรอบ" disabled={busy}/></label><p className="platform-muted">ส่งภาพที่บันทึกไว้ในบัญชีนี้พร้อมผลเดิมให้ผู้มีสิทธิ์ตรวจ ไม่ส่งภาพออกสู่สาธารณะ</p><button className="platform-button primary" type="submit" disabled={busy || !reason.trim()}><Send size={17}/>{busy ? 'กำลังส่งภาพ…' : referral ? 'ส่งให้ตรวจเพิ่มเติม' : 'ส่งให้ผู้เชี่ยวชาญ'}<ArrowRight size={16}/></button></form>}
      {!active && detail.value?.status !== 'completed' && <p className="platform-muted">ส่งต่อได้เมื่อการวิเคราะห์เสร็จและบันทึกภาพสำเร็จแล้ว</p>}
    </>}
  </section>
}
