import { Activity, ArrowRight, BarChart3, RefreshCw, ScanLine } from 'lucide-react'
import { useState } from 'react'
import { buildQuery, formatDate } from '../platform/api'
import type { PlatformSession } from '../platform/api'
import { AccessState, AnalysisFilterForm, emptyFilters, ErrorNotice, LoadingNotice, PlatformHeading, usePlatformResource } from './PlatformShared'
import type { AnalysisFilters } from './PlatformShared'

interface DashboardData { sample_size: number; scope: string; summary: { total_analyses: number; successful_analyses: number; failed_analyses: number; total_detected_objects: number; confirmed_objects: number; uncertain_objects: number; pending_expert_reviews: number; completed_expert_reviews: number; images_failing_quality: number; average_inference_ms: number | null }; charts: { analyses_by_date: { date: string; count: number; successful: number; failed: number }[]; predicted_classes: { label: string; count: number }[]; confirmed_classes: { label: string; count: number }[]; review_statuses: { status: string; count: number }[]; quality_statuses: { status: string; count: number }[]; latency_by_date: { date: string; mean_ms: number; sample_size: number }[]; review_errors: { action: string; count: number; label?: string }[] }; disclaimer?: string }
const number = (value: number | null | undefined) => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('th-TH', { maximumFractionDigits: 1 }) : '—'
function Bars({ title, rows, unit = 'รายการ' }: { title: string; rows: { label: string; value: number }[]; unit?: string }) {
  const maximum = Math.max(1, ...rows.map(item => item.value))
  return <section className="platform-card platform-chart"><h2>{title}</h2>{!rows.length ? <p className="platform-muted">ยังไม่มีข้อมูลในช่วงที่เลือก</p> : <ul>{rows.slice(0, 30).map((row, index) => <li key={row.label + index}><div><span>{row.label}</span><strong>{number(row.value)} {unit}</strong></div><span className="platform-chart-track"><span style={{ width: `${Math.max(0, row.value) / maximum * 100}%` }}/></span></li>)}</ul>}</section>
}
export default function PlatformDashboard({ session, onNavigate }: { session: PlatformSession; onOpenAnalysis?: (id: string) => void; onNavigate?: (page: 'scan' | 'history' | 'settings') => void }) {
  const [filters, setFilters] = useState<AnalysisFilters>(emptyFilters)
  const { status, analysis_id: _analysisId, ...remaining } = filters
  const resource = usePlatformResource<DashboardData>(`/dashboard${buildQuery({ ...remaining, analysis_status: status })}`, session, session.configured && !!session.user && session.user.role !== 'student')
  const data = resource.value
  return <div className="platform-page"><PlatformHeading kicker="HELPMINTHS AI · DASHBOARD" title="ภาพรวมระบบวิเคราะห์" description="ติดตามรายการจริง คุณภาพภาพ และสถานะการตรวจทาน แยกผลคาดการณ์ของ AI ออกจากผลของผู้เชี่ยวชาญ"><button className="platform-button primary" onClick={() => onNavigate?.('scan')}><ScanLine size={18}/>วิเคราะห์ภาพ</button></PlatformHeading>
    <AccessState session={session} roles={['admin', 'reviewer', 'lab']}><AnalysisFilterForm includeId={false} onApply={setFilters}/>{resource.loading ? <LoadingNotice/> : resource.error ? <ErrorNotice message={resource.error} onRetry={resource.reload}/> : data && <>
      <div className="platform-dashboard-context"><span><Activity size={17}/> ข้อมูลจริง {number(data.sample_size)} รายการ · {data.scope === 'all' ? 'ตามสิทธิ์ผู้ตรวจสอบ' : 'เฉพาะบัญชีของคุณ'}</span><button className="platform-button" onClick={resource.reload}><RefreshCw size={16}/>รีเฟรช</button></div>
      <div className="platform-stat-grid">{[
        ['การวิเคราะห์ทั้งหมด', data.summary.total_analyses], ['วิเคราะห์สำเร็จ', data.summary.successful_analyses], ['วิเคราะห์ไม่สำเร็จ', data.summary.failed_analyses], ['วัตถุที่ AI ตรวจพบ', data.summary.total_detected_objects], ['วัตถุที่ผู้ตรวจทานยืนยัน', data.summary.confirmed_objects], ['รอผู้ตรวจทาน', data.summary.pending_expert_reviews], ['ตรวจทานแล้ว', data.summary.completed_expert_reviews], ['ภาพที่มีข้อจำกัดคุณภาพ', data.summary.images_failing_quality],
      ].map(([label, value]) => <article key={label as string}><BarChart3 size={20}/><span>{label}</span><strong>{number(value as number)}</strong></article>)}</div>
      <div className="platform-metric-note"><span>เวลา inference เฉลี่ย <strong>{number(data.summary.average_inference_ms)} ms</strong></span><span>วัตถุที่ยังไม่แน่ใจ <strong>{number(data.summary.uncertain_objects)}</strong></span></div>
      {data.sample_size === 0 && <div className="platform-empty"><BarChart3/><h2>ยังไม่มีข้อมูลการวิเคราะห์จริง</h2><p>ไม่มีข้อมูลตัวอย่างเติมให้ Dashboard จะคำนวณเมื่อมีรายการบันทึกจากการตรวจจริง</p><button className="platform-button primary" onClick={() => onNavigate?.('scan')}>เริ่มตรวจภาพ <ArrowRight size={17}/></button></div>}
      <div className="platform-chart-grid"><Bars title="จำนวนการวิเคราะห์ตามวัน" rows={data.charts.analyses_by_date.map(item => ({ label: formatDate(item.date).split(' เวลา')[0], value: item.count }))}/><Bars title="ชนิดที่ AI คาดการณ์" rows={data.charts.predicted_classes.map(item => ({ label: item.label, value: item.count }))} unit="วัตถุ"/><Bars title="ชนิดที่ผู้ตรวจทานยืนยัน" rows={data.charts.confirmed_classes.map(item => ({ label: item.label, value: item.count }))} unit="วัตถุ"/><Bars title="สถานะการตรวจทาน" rows={data.charts.review_statuses.map(item => ({ label: item.status, value: item.count }))}/><Bars title="คุณภาพภาพเบื้องต้น" rows={data.charts.quality_statuses.map(item => ({ label: item.status, value: item.count }))}/><Bars title="เวลา inference เฉลี่ยตามวัน" rows={data.charts.latency_by_date.map(item => ({ label: item.date, value: item.mean_ms }))} unit="ms"/><Bars title="การแก้ไขจากการตรวจทาน" rows={data.charts.review_errors.map(item => ({ label: item.label ? `${item.label} · ${item.action}` : item.action, value: item.count }))}/></div>
      <p className="platform-footnote">{data.disclaimer ?? 'ข้อมูลนี้สะท้อนรายการที่บันทึกในระบบ ไม่ใช่อัตราความชุกหรืออุบัติการณ์โรค และไม่ใช่การประเมินความแม่นยำโมเดล'}</p>
    </>}</AccessState>
  </div>
}
