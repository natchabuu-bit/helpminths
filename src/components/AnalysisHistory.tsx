import { ArrowRight, ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { useState } from 'react'
import { buildQuery, formatDate } from '../platform/api'
import type { Paged, PlatformAnalysis, PlatformSession } from '../platform/api'
import { AccessState, AnalysisFilterForm, emptyFilters, ErrorNotice, LoadingNotice, PlatformHeading, StatusBadge, usePlatformResource } from './PlatformShared'
import type { AnalysisFilters } from './PlatformShared'

export default function AnalysisHistory({ session, onOpenAnalysis }: { session: PlatformSession; onOpenAnalysis: (id: string) => void }) {
  const [filters, setFilters] = useState<AnalysisFilters>(emptyFilters), [offset, setOffset] = useState(0)
  const resource = usePlatformResource<Paged<PlatformAnalysis>>(`/analyses${buildQuery({ ...filters, limit: 20, offset })}`, session, session.configured && !!session.user && session.user.role !== 'student')
  return <div className="platform-page"><PlatformHeading kicker="ANALYSIS HISTORY" title="ประวัติการวิเคราะห์" description="ค้นหารายการที่บันทึกไว้ เปิดภาพ ผลจากโมเดล และประวัติการตรวจทานตามสิทธิ์ของคุณ"/>
    <AccessState session={session} roles={['admin', 'reviewer', 'lab']}><AnalysisFilterForm onApply={value => { setFilters(value); setOffset(0) }}/>
      {resource.loading ? <LoadingNotice/> : resource.error ? <ErrorNotice message={resource.error} onRetry={resource.reload}/> : !resource.value?.items.length ? <div className="platform-empty"><Search/><h2>ยังไม่มีรายการที่ตรงกับตัวกรอง</h2><p>รายการจะปรากฏเมื่อบันทึกการวิเคราะห์จริง ลองล้างตัวกรองหรือตรวจภาพใหม่</p></div> : <>
        <div className="platform-record-grid">{resource.value.items.map(item => <article className="platform-record" key={item.id}><div className="platform-record-top"><span className="platform-mono">{item.id}</span><StatusBadge value={item.status}/></div><h2>{item.sample_code || 'ไม่ระบุรหัสตัวอย่าง'}</h2><p>{formatDate(item.created_at)}{item.site_code ? ` · ${item.site_code}` : ''}</p><div className="platform-record-metrics"><span>AI ตรวจพบ <b>{item.counts?.predicted_total ?? item.detections?.length ?? 0}</b> วัตถุ</span><StatusBadge value={item.review_status}/></div><p className="platform-muted">โมเดล: {item.model || 'ไม่มีข้อมูล'} · รุ่น {item.model_version ?? 'ไม่ระบุ'}</p><button className="platform-button primary" onClick={() => onOpenAnalysis(item.id)}>เปิดรายการ <ArrowRight size={17}/></button></article>)}</div>
        <div className="platform-pagination"><span>แสดง {offset + 1}–{offset + resource.value.items.length} จาก {resource.value.total} รายการ</span><button className="platform-button" disabled={offset === 0} onClick={() => setOffset(value => Math.max(0, value - 20))}><ChevronLeft size={17}/>ก่อนหน้า</button><button className="platform-button" disabled={offset + resource.value.items.length >= resource.value.total} onClick={() => setOffset(value => value + 20)}>ถัดไป<ChevronRight size={17}/></button></div>
      </>}
    </AccessState>
  </div>
}
