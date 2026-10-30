import { AlertCircle, Database, LoaderCircle, LockKeyhole, RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { apiRequest, labelStatus } from '../platform/api'
import type { PlatformAnalysis, PlatformRole, PlatformSession, QualityAssessment } from '../platform/api'
import '../styles/platform.css'

export function PlatformHeading({ kicker, title, description, children }: { kicker: string; title: string; description: string; children?: ReactNode }) {
  return <div className="platform-heading"><div><span>{kicker}</span><h1>{title}</h1><p>{description}</p></div>{children && <div className="platform-heading-actions">{children}</div>}</div>
}
export function AccessState({ session, roles, children }: { session: PlatformSession; roles?: PlatformRole[]; children: ReactNode }) {
  if (session.connection_error) return <div className="platform-empty"><AlertCircle/><h2>เชื่อมต่อระบบข้อมูลไม่ได้</h2><p>{session.connection_error}</p><p>Atlas และเนื้อหาเรียนรู้ที่บันทึกไว้อาจยังใช้งานออฟไลน์ได้</p></div>
  if (!session.configured) return <div className="platform-empty"><Database/><span className="platform-badge warning">Not configured</span><h2>ระบบบันทึกข้อมูลยังไม่พร้อมใช้งาน</h2><p>ผู้ดูแลต้องตั้งค่าฐานข้อมูลและพื้นที่เก็บภาพก่อน ส่วนนี้จะใช้ข้อมูลจริงเมื่อเปิดใช้งานแล้ว</p><p>เปิดเมนูตั้งค่าเพื่อดูสถานะและวิธีเริ่มต้น</p></div>
  if (!session.user) return <div className="platform-empty"><LockKeyhole/><h2>เข้าสู่ระบบเพื่อดูข้อมูล</h2><p>ภาพ ผลวิเคราะห์ และการตรวจทานถูกจำกัดตามสิทธิ์ของบัญชี เปิดเมนูตั้งค่าเพื่อเข้าสู่ระบบ</p></div>
  if (roles && !roles.includes(session.user.role)) return <div className="platform-empty"><LockKeyhole/><h2>บัญชีนี้ไม่มีสิทธิ์ในส่วนนี้</h2><p>ขอสิทธิ์ที่เหมาะสมจากผู้ดูแลระบบ ข้อมูลที่คุณเข้าถึงได้ยังใช้ผ่านเมนูอื่นได้ตามปกติ</p></div>
  return <>{children}</>
}
export function ErrorNotice({ message, onRetry }: { message: string; onRetry?: () => void }) { return <div className="platform-error" role="alert"><AlertCircle size={20}/><p>{message}</p>{onRetry && <button className="platform-button" onClick={onRetry}><RefreshCw size={16}/>ลองอีกครั้ง</button>}</div> }
export function LoadingNotice({ children = 'กำลังอ่านข้อมูล…' }: { children?: ReactNode }) { return <div className="platform-loading" role="status"><LoaderCircle className="spin" size={20}/>{children}</div> }
export function StatusBadge({ value }: { value?: string | null }) { const style = value && ['completed', 'verified', 'pass', 'resolved'].includes(value) ? 'success' : value && ['failed', 'cancelled', 'verified_error'].includes(value) ? 'danger' : 'warning'; return <span className={`platform-badge ${style}`}>{labelStatus(value)}</span> }
export function usePlatformResource<T>(path: string, session: PlatformSession, enabled = true) {
  const [version, setVersion] = useState(0)
  const key = `${session.user?.id ?? 'public'}:${session.user?.role ?? 'public'}:${path}:${version}`
  const [state, setState] = useState<{ key: string; value: T | null; error: string; loading: boolean }>({ key: '', value: null, error: '', loading: false })
  useEffect(() => {
    if (!enabled) { setState({ key, value: null, error: '', loading: false }); return }
    const controller = new AbortController()
    setState({ key, value: null, error: '', loading: true })
    apiRequest<T>(path, { signal: controller.signal }, session).then(value => {
      if (!controller.signal.aborted) setState({ key, value, error: '', loading: false })
    }).catch(failure => {
      if (!controller.signal.aborted) setState({ key, value: null, error: failure instanceof Error ? failure.message : 'อ่านข้อมูลไม่ได้', loading: false })
    })
    return () => controller.abort()
  }, [key, session.csrf_token, enabled])
  const current = state.key === key
  return { value: current && enabled ? state.value : null, error: current && enabled ? state.error : '', loading: enabled && (!current || state.loading), reload: () => setVersion(previous => previous + 1) }
}

export const emptyFilters = { analysis_id: '', date_from: '', date_to: '', predicted_class: '', status: '', review_status: '', model_version: '', site_code: '' }
export type AnalysisFilters = typeof emptyFilters
export function AnalysisFilterForm({ onApply, includeId = true }: { onApply: (filters: AnalysisFilters) => void; includeId?: boolean }) {
  const [draft, setDraft] = useState(emptyFilters)
  const field = (key: keyof AnalysisFilters, value: string) => setDraft(previous => ({ ...previous, [key]: value }))
  return <form className="platform-filter" onSubmit={event => { event.preventDefault(); onApply(draft) }}>
    {includeId && <label>Analysis ID<input value={draft.analysis_id} onChange={event => field('analysis_id', event.target.value)} maxLength={80}/></label>}
    <label>ตั้งแต่วันที่<input type="date" value={draft.date_from} onChange={event => field('date_from', event.target.value)}/></label><label>ถึงวันที่<input type="date" value={draft.date_to} min={draft.date_from || undefined} onChange={event => field('date_to', event.target.value)}/></label>
    <label>ชนิดที่ AI ระบุ<input value={draft.predicted_class} onChange={event => field('predicted_class', event.target.value)} maxLength={150}/></label>
    <label>สถานะวิเคราะห์<select value={draft.status} onChange={event => field('status', event.target.value)}><option value="">ทุกสถานะ</option><option value="processing">กำลังวิเคราะห์</option><option value="completed">วิเคราะห์แล้ว</option><option value="failed">ไม่สำเร็จ</option><option value="cancelled">ยกเลิก</option></select></label>
    <label>สถานะตรวจทาน<select value={draft.review_status} onChange={event => field('review_status', event.target.value)}><option value="">ทุกสถานะ</option><option value="pending">รอทบทวน</option><option value="in_review">กำลังทบทวน</option><option value="verified">ทบทวนแล้ว</option><option value="needs_additional_review">ขอทบทวนเพิ่มเติม</option></select></label>
    <label>รุ่นโมเดล<input value={draft.model_version} onChange={event => field('model_version', event.target.value)} maxLength={100}/></label><label>รหัสสถานที่<input value={draft.site_code} onChange={event => field('site_code', event.target.value)} maxLength={40}/></label>
    <div className="platform-filter-actions"><button className="platform-button primary" type="submit">ใช้ตัวกรอง</button><button className="platform-button" type="button" onClick={() => { setDraft(emptyFilters); onApply(emptyFilters) }}>ล้างตัวกรอง</button></div>
  </form>
}
export function QualitySummary({ quality }: { quality?: QualityAssessment }) {
  if (!quality) return <p className="platform-muted">ไม่มีข้อมูลคุณภาพภาพในรายการนี้</p>
  return <section className="platform-quality"><div><h3>คุณภาพภาพเบื้องต้น</h3><StatusBadge value={quality.status}/></div><ul>{quality.checks.map((check, index) => <li key={check.id ?? check.key ?? index}><span><strong>{check.label ?? check.name ?? check.key ?? 'รายการตรวจ'}</strong><small>{check.message ?? check.description}</small></span><StatusBadge value={check.status}/></li>)}</ul><p>เป็นการประเมินด้วย heuristic ไม่ยืนยันว่าภาพเหมาะสำหรับวินิจฉัย</p></section>
}
export function AnalysisCounter({ analysis }: { analysis: PlatformAnalysis }) {
  const counts = analysis.counts
  const classes = [...new Set([...Object.keys(counts?.by_predicted_class ?? {}), ...Object.keys(counts?.by_confirmed_class ?? {})])]
  return <><div className="platform-count-grid"><div><span>AI ตรวจพบ</span><strong>{counts?.predicted_total ?? analysis.detections.length}</strong></div><div><span>ผู้ตรวจทานยืนยัน</span><strong>{counts?.confirmed_total ?? '—'}</strong></div><div><span>ยังไม่แน่ใจ</span><strong>{counts?.uncertain_total ?? '—'}</strong></div><div><span>ยังไม่ทบทวน</span><strong>{counts?.unreviewed_original_objects ?? '—'}</strong></div></div>{counts && classes.length > 0 && <div className="platform-table-wrap"><table><thead><tr><th>ชนิดวัตถุ</th><th>จำนวนที่ AI คาดการณ์</th><th>จำนวนที่ผู้ตรวจทานยืนยัน</th></tr></thead><tbody>{classes.map(label => <tr key={label}><td>{label}</td><td>{counts.by_predicted_class[label] ?? 0}</td><td>{counts.by_confirmed_class[label] ?? 0}</td></tr>)}</tbody></table></div>}</>
}

export function ConfirmDialog({ title, children, busy = false, onCancel, onConfirm }: { title: string; children: ReactNode; busy?: boolean; onCancel: () => void; onConfirm: () => void }) {
  const panel = useRef<HTMLElement>(null)
  useEffect(() => {
    const prior = document.activeElement as HTMLElement | null, overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'; panel.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onCancel()
      if (event.key !== 'Tab') return
      const list = [...(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,textarea,[tabindex="0"]') ?? [])], first = list[0], last = list[list.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    window.addEventListener('keydown', key)
    return () => { document.body.style.overflow = overflow; window.removeEventListener('keydown', key); prior?.focus() }
  }, [busy, onCancel])
  return <div className="platform-modal-backdrop" onClick={() => { if (!busy) onCancel() }}><section ref={panel} className="platform-modal" role="alertdialog" aria-modal="true" aria-label={title} onClick={event => event.stopPropagation()}><h2>{title}</h2>{children}<div className="platform-actions"><button className="platform-button" disabled={busy} onClick={onCancel}>ยกเลิก</button><button className="platform-button danger" disabled={busy} onClick={onConfirm}>{busy ? 'กำลังดำเนินการ…' : 'ยืนยัน'}</button></div></section></div>
}
