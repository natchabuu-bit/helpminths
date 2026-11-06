import { ArrowRight, CalendarDays, ChevronLeft, ChevronRight, RefreshCw, Search, Send } from 'lucide-react'
import { useState } from 'react'
import { buildQuery, formatDate } from '../platform/api'
import type { Paged, PlatformAnalysis, PlatformSession } from '../platform/api'
import { AccessState, AnalysisFilterForm, emptyFilters, ErrorNotice, LoadingNotice, PlatformHeading, StatusBadge, usePlatformResource } from './PlatformShared'
import type { AnalysisFilters } from './PlatformShared'
import '../styles/history.css'

interface HistoryDay { date: string; total: number; completed: number; failed: number }
interface HistoryDays { items: HistoryDay[]; total_days: number; total_analyses: number; timezone: string }
const thaiDay = (value: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value)
const dayName = (value: string) => new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'long' }).format(new Date(`${value}T12:00:00+07:00`))

export default function AnalysisHistory({ session, onOpenAnalysis, onOpenReferrals }: { session: PlatformSession; onOpenAnalysis: (id: string) => void; onOpenReferrals?: () => void }) {
  const [filters, setFilters] = useState<AnalysisFilters>(emptyFilters)
  const [day, setDay] = useState(() => thaiDay(new Date()))
  const [offset, setOffset] = useState(0)
  const enabled = session.configured && !!session.user && session.user.role !== 'student'
  const query = { ...filters, ...(day ? { date_from: day, date_to: day } : {}), scope: 'mine', referral_state: 'not_pending', limit: 20, offset }
  const resource = usePlatformResource<Paged<PlatformAnalysis>>(`/analyses${buildQuery(query)}`, session, enabled)
  const days = usePlatformResource<HistoryDays>('/history/days?limit=31&offset=0', session, enabled)
  const groups = new Map<string, PlatformAnalysis[]>()
  for (const item of resource.value?.items ?? []) {
    const key = thaiDay(new Date(item.created_at))
    groups.set(key, [...(groups.get(key) ?? []), item])
  }
  const chooseDay = (value: string) => { setDay(value); setOffset(0) }
  const refresh = () => { resource.reload(); days.reload() }
  return <div className="platform-page history-page"><PlatformHeading kicker="DAILY ANALYSIS HISTORY" title="ประวัติการตรวจรายวัน" description="ผลตรวจของบัญชีคุณ แยกตามวันที่ในประเทศไทย และคงผล AI เดิมไว้คู่กับคำตอบจากผู้เชี่ยวชาญ"><button className="platform-button" onClick={refresh}><RefreshCw size={17}/>รีเฟรชประวัติ</button></PlatformHeading>
    <AccessState session={session} roles={['admin', 'reviewer', 'lab']}>
      <section className="history-referral-note"><div><Send size={20}/><p><strong>ภาพที่ส่งต่อและยังรอตรวจอยู่ในคลังผู้เชี่ยวชาญ</strong><span>เมื่อผู้เชี่ยวชาญยืนยันแล้ว ผลจะกลับมาแสดงในประวัติของวันเดิม ไม่สร้างรายการตรวจซ้ำ</span></p></div><button className="platform-button" onClick={onOpenReferrals}>ดูภาพส่งต่อ <ArrowRight size={16}/></button></section>
      <section className="platform-card history-date-picker" aria-label="เลือกวันในประวัติการตรวจ">
        <div className="history-date-row"><label><CalendarDays size={18}/>วันที่ตรวจ (เวลาไทย)<input type="date" value={day} onChange={event => chooseDay(event.target.value)}/></label><button className="platform-button" onClick={() => chooseDay(thaiDay(new Date()))}>วันนี้</button><button className={`platform-button ${!day ? 'primary' : ''}`} onClick={() => chooseDay('')}>ทุกวัน</button></div>
        {days.error ? <ErrorNotice message={days.error} onRetry={days.reload}/> : <div className="history-day-list" aria-label="วันที่มีผลตรวจ">{days.value?.items.map(item => <button key={item.date} aria-pressed={day === item.date} onClick={() => chooseDay(item.date)}><span>{dayName(item.date)}</span><strong>{item.total} รายการ</strong></button>)}</div>}
        <p className="platform-muted">{days.loading ? 'กำลังอ่านวันที่มีผลตรวจ…' : `มีผลตรวจ ${days.value?.total_analyses ?? 0} รายการ ใน ${days.value?.total_days ?? 0} วัน · ปุ่มวันที่แสดง 31 วันล่าสุดที่มีข้อมูล`}</p>
      </section>
      <details className="history-advanced"><summary>ค้นหาด้วยรหัสตัวอย่าง ชนิด หรือช่วงวันที่</summary><AnalysisFilterForm onApply={value => { setFilters(value); setDay(''); setOffset(0) }}/></details>
      {resource.loading ? <LoadingNotice/> : resource.error ? <ErrorNotice message={resource.error} onRetry={resource.reload}/> : !resource.value?.items.length ? <div className="platform-empty"><Search/><h2>{day ? 'ยังไม่มีผลตรวจในวันที่เลือก' : 'ยังไม่มีรายการที่ตรงกับตัวกรอง'}</h2><p>ผลที่วิเคราะห์สำเร็จจะบันทึกอัตโนมัติเมื่อเข้าสู่ระบบ รายการที่กำลังรอผู้เชี่ยวชาญให้เปิดจากคลังภาพส่งต่อ</p><button className="platform-button" onClick={onOpenReferrals}>เปิดคลังภาพส่งต่อ <ArrowRight size={16}/></button></div> : <>
        {[...groups].map(([date, items]) => <section key={date} className="history-day-group"><h2><CalendarDays size={19}/>{dayName(date)}</h2><div className="platform-record-grid">{items.map(item => <article className="platform-record" key={item.id}>
          <div className="platform-record-top"><span className="platform-mono">{item.id}</span><StatusBadge value={item.status}/></div>
          {item.image_url && <img className="history-record-image" src={item.image_url} alt={`ภาพผลตรวจ ${item.sample_code}`} loading="lazy"/>}
          <h3>{item.sample_code || 'ไม่ระบุรหัสตัวอย่าง'}</h3><p>{formatDate(item.created_at)}{item.site_code ? ` · ${item.site_code}` : ''}</p>
          <div className="platform-record-metrics"><span>AI ตรวจพบ <b>{item.counts?.predicted_total ?? item.detections?.length ?? 0}</b> วัตถุ</span><StatusBadge value={item.review_status}/></div>
          {item.latest_review?.status === 'verified' && <p className="history-confirmed">ผู้เชี่ยวชาญยืนยันแล้ว{item.latest_review.comment ? ` · ${item.latest_review.comment}` : ''}</p>}
          <p className="platform-muted">โมเดล: {item.model || 'ไม่มีข้อมูล'} · รุ่น {item.model_version ?? 'ไม่ระบุ'}</p><button className="platform-button primary" onClick={() => onOpenAnalysis(item.id)}>เปิดรายการ <ArrowRight size={17}/></button>
        </article>)}</div></section>)}
        <div className="platform-pagination"><span>แสดง {offset + 1}–{offset + resource.value.items.length} จาก {resource.value.total} รายการ</span><button className="platform-button" disabled={offset === 0} onClick={() => setOffset(value => Math.max(0, value - 20))}><ChevronLeft size={17}/>ก่อนหน้า</button><button className="platform-button" disabled={offset + resource.value.items.length >= resource.value.total} onClick={() => setOffset(value => value + 20)}>ถัดไป<ChevronRight size={17}/></button></div>
      </>}
    </AccessState>
  </div>
}
