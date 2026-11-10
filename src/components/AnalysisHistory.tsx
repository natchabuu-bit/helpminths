import { ArrowRight, CalendarDays, ChevronLeft, ChevronRight, RefreshCw, Search, Send, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { apiRequest, buildQuery, formatDate, imageURL } from '../platform/api'
import type { Paged, PlatformAnalysis, PlatformSession } from '../platform/api'
import { AccessState, AnalysisFilterForm, ConfirmDialog, emptyFilters, ErrorNotice, LoadingNotice, PlatformHeading, StatusBadge, usePlatformResource } from './PlatformShared'
import type { AnalysisFilters } from './PlatformShared'
import { PrivateReferralImage, ReferralStatusBadge } from './ReferralPanel'
import type { ReferralStatus } from './ReferralPanel'
import '../styles/platform.css'

interface HistoryDay { date: string; total: number; completed: number; failed: number }
interface HistoryDays { items: HistoryDay[]; total_days: number; total_analyses: number; timezone: string }
const thaiDay = (value: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value)
const dayName = (value: string) => new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'long' }).format(new Date(`${value}T12:00:00+07:00`))

export default function AnalysisHistory({ session, onOpenAnalysis, onOpenReferrals, embedded = false }: { session: PlatformSession; onOpenAnalysis: (id: string) => void; onOpenReferrals?: () => void; embedded?: boolean }) {
  const [filters, setFilters] = useState<AnalysisFilters>(emptyFilters)
  const [day, setDay] = useState('')
  const [referralState, setReferralState] = useState<'all' | 'pending' | 'not_pending'>('all')
  const [offset, setOffset] = useState(0)
  const [deleteTarget, setDeleteTarget] = useState<PlatformAnalysis | null>(null)
  const [removing, setRemoving] = useState(false), [deleteError, setDeleteError] = useState(''), [notice, setNotice] = useState('')
  const enabled = session.configured && !!session.user && session.user.role !== 'student'
  const query = { ...filters, ...(day ? { date_from: day, date_to: day } : {}), scope: 'mine', referral_state: referralState, limit: 20, offset }
  const resource = usePlatformResource<Paged<PlatformAnalysis>>(`/analyses${buildQuery(query)}`, session, enabled)
  const days = usePlatformResource<HistoryDays>(`/history/days${buildQuery({ limit: 31, offset: 0, referral_state: referralState, date_from: filters.date_from, date_to: filters.date_to })}`, session, enabled)
  const groups = new Map<string, PlatformAnalysis[]>()
  for (const item of resource.value?.items ?? []) {
    const key = thaiDay(new Date(item.created_at))
    groups.set(key, [...(groups.get(key) ?? []), item])
  }
  const chooseDay = (value: string) => { setDay(value); setOffset(0) }
  const refresh = () => { resource.reload(); days.reload() }
  const remove = async () => {
    if (!deleteTarget || removing || deleteTarget.owner_id !== session.user?.id) return
    setRemoving(true); setDeleteError(''); setNotice('')
    try {
      await apiRequest(session, `/analyses/${encodeURIComponent(deleteTarget.id)}${buildQuery({ expected_revision: deleteTarget.revision })}`, { method: 'DELETE' })
      setDeleteTarget(null); setNotice('นำรายการออกจากประวัติแล้ว')
      if (resource.value?.items.length === 1 && offset > 0) setOffset(value => Math.max(0, value - 20))
      refresh()
    } catch (failure) {
      setDeleteTarget(null)
      setDeleteError(failure instanceof Error ? failure.message : 'นำรายการออกจากประวัติไม่ได้')
    } finally { setRemoving(false) }
  }
  return <div className="platform-page history-page">{embedded ? <div className="my-work-history-toolbar"><p>รายการในบัญชี แยกตามวันตรวจและสถานะผู้เชี่ยวชาญ</p><button className="platform-button" onClick={refresh}><RefreshCw size={17}/>รีเฟรชประวัติ</button></div> : <PlatformHeading kicker="DAILY ANALYSIS HISTORY" title="ประวัติการตรวจรายวัน" description="ภาพที่คุณส่งทั้งหมดตั้งแต่เริ่มใช้งาน แยกตามวันที่และเวลาไทย พร้อมสถานะและคำตอบจากผู้เชี่ยวชาญ"><button className="platform-button" onClick={refresh}><RefreshCw size={17}/>รีเฟรชประวัติ</button></PlatformHeading>}
    <AccessState session={session} roles={['admin', 'reviewer', 'lab']}>
      {notice && <p className="platform-notice" role="status">{notice}</p>}
      {deleteError && <ErrorNotice message={deleteError} onRetry={refresh}/>}
      <section className="history-referral-note"><div><Send size={20}/><p><strong>ภาพทุกสถานะอยู่ในประวัติของบัญชีคุณ</strong><span>เปิดดูภาพที่รอตรวจหรือเสร็จสิ้นได้ตามวันที่เดิม รวมคำตอบและภาพเพิ่มเติมในรายการส่งต่อ</span></p></div><button className="platform-button" onClick={onOpenReferrals}>ดูภาพส่งต่อ <ArrowRight size={16}/></button></section>
      <div className="history-state-tabs expert-queue-tabs" role="tablist" aria-label="สถานะประวัติการตรวจ">{([{ value: 'all', label: 'ทั้งหมด' }, { value: 'pending', label: 'รอตรวจ' }, { value: 'not_pending', label: 'เสร็จสิ้น' }] as const).map(item => <button key={item.value} role="tab" aria-selected={referralState === item.value} onClick={() => { setReferralState(item.value); setOffset(0) }}>{item.label}</button>)}</div>
      <section className="platform-card history-date-picker" aria-label="เลือกวันในประวัติการตรวจ">
        <div className="history-date-row"><label><CalendarDays size={18}/>วันที่ตรวจ (เวลาไทย)<input type="date" value={day} onChange={event => chooseDay(event.target.value)}/></label><button className="platform-button" onClick={() => chooseDay(thaiDay(new Date()))}>วันนี้</button><button className={`platform-button ${!day ? 'primary' : ''}`} onClick={() => chooseDay('')}>ทุกวัน</button></div>
        {days.error ? <ErrorNotice message={days.error} onRetry={days.reload}/> : <div className="history-day-list" aria-label="วันที่มีผลตรวจ">{days.value?.items.map(item => <button key={item.date} aria-pressed={day === item.date} onClick={() => chooseDay(item.date)}><span>{dayName(item.date)}</span><strong>{item.total} รายการ</strong></button>)}</div>}
        <p className="platform-muted">{days.loading ? 'กำลังอ่านวันที่มีผลตรวจ…' : `มีผลตรวจ ${days.value?.total_analyses ?? 0} รายการ ใน ${days.value?.total_days ?? 0} วัน · ปุ่มวันที่แสดง 31 วันล่าสุดที่มีข้อมูล`}</p>
      </section>
      <details className="history-advanced"><summary>ค้นหาด้วยรหัสตัวอย่าง ชนิด หรือช่วงวันที่</summary><AnalysisFilterForm onApply={value => { setFilters(value); setDay(''); setOffset(0) }}/></details>
      {resource.loading ? <LoadingNotice/> : resource.error ? <ErrorNotice message={resource.error} onRetry={resource.reload}/> : !resource.value?.items.length ? <div className="platform-empty"><Search/><h2>{day ? 'ยังไม่มีผลตรวจในวันที่เลือก' : 'ยังไม่มีรายการที่ตรงกับตัวกรอง'}</h2><p>ภาพที่ส่งและผลตรวจจะบันทึกไว้ในบัญชีคุณ เลือกทุกวันหรือเปลี่ยนสถานะเพื่อดูรายการอื่น</p><button className="platform-button" onClick={onOpenReferrals}>เปิดคลังภาพส่งต่อ <ArrowRight size={16}/></button></div> : <>
        {[...groups].map(([date, items]) => <section key={date} className="history-day-group"><h2><CalendarDays size={19}/>{dayName(date)}</h2><div className="platform-record-grid">{items.map(item => <article className="platform-record" key={item.id}>
          <div className="platform-record-top"><span className="platform-mono">{item.id}</span><StatusBadge value={item.status}/></div>
          {item.image_url && <PrivateReferralImage session={session} className="history-record-image" path={imageURL(item.id)} alt={`ภาพผลตรวจ ${item.sample_code}`}/>}
          <h3>{item.sample_code || 'ไม่ระบุรหัสตัวอย่าง'}</h3><p>{formatDate(item.created_at)}{item.site_code ? ` · ${item.site_code}` : ''}</p>
          <div className="platform-record-metrics"><span>AI ตรวจพบ <b>{item.counts?.predicted_total ?? item.detections?.length ?? 0}</b> วัตถุ</span>{item.referral_status ? <ReferralStatusBadge status={item.referral_status as ReferralStatus}/> : <StatusBadge value={item.review_status}/>}</div>
          {item.latest_review?.status === 'verified' && <p className="history-confirmed">ผู้เชี่ยวชาญยืนยันแล้ว{item.latest_review.comment ? ` · ${item.latest_review.comment}` : ''}</p>}
          <p className="platform-muted">โมเดล: {item.model || 'ไม่มีข้อมูล'} · รุ่น {item.model_version ?? 'ไม่ระบุ'}</p><div className="platform-actions"><button className="platform-button primary" disabled={removing} onClick={() => onOpenAnalysis(item.id)}>เปิดรายการ <ArrowRight size={17}/></button>{item.owner_id === session.user?.id && <button className="platform-button danger" disabled={removing || item.status === 'processing'} onClick={() => { setDeleteTarget(item); setDeleteError(''); setNotice('') }}><Trash2 size={16}/>นำออกจากประวัติ</button>}</div>
        </article>)}</div></section>)}
        <div className="platform-pagination"><span>แสดง {offset + 1}–{offset + resource.value.items.length} จาก {resource.value.total} รายการ</span><button className="platform-button" disabled={offset === 0} onClick={() => setOffset(value => Math.max(0, value - 20))}><ChevronLeft size={17}/>ก่อนหน้า</button><button className="platform-button" disabled={offset + resource.value.items.length >= resource.value.total} onClick={() => setOffset(value => value + 20)}>ถัดไป<ChevronRight size={17}/></button></div>
      </>}
      {deleteTarget && <ConfirmDialog title="นำรายการออกจากประวัติของคุณ?" busy={removing} onCancel={() => setDeleteTarget(null)} onConfirm={() => void remove()}><p>รายการจะหายจากประวัติและคลังส่งต่อของคุณ สำเนาภาพและผลตรวจยังคงอยู่ในคลังภาพหลังบ้านที่เฉพาะ Super Admin เปิดดูได้</p><p>คุณจะเปิดรายการนี้จากประวัติของตนเองไม่ได้หลังยืนยัน</p></ConfirmDialog>}
    </AccessState>
  </div>
}
