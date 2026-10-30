import { Download, FileText } from 'lucide-react'
import { useEffect, useState } from 'react'
import { buildQuery, downloadAPI, formatDate } from '../platform/api'
import type { Paged, PlatformSession } from '../platform/api'
import { AccessState, AnalysisFilterForm, emptyFilters, ErrorNotice, LoadingNotice, PlatformHeading, usePlatformResource } from './PlatformShared'
import type { AnalysisFilters } from './PlatformShared'

interface ReportMetadata { id: string; analysis_id?: string; created_at: string; generated_at?: string; format?: string; analysis_revision?: number; review_status?: string; generated_by?: string }
export default function PlatformReports({ session, analysisId }: { session: PlatformSession; analysisId?: string }) {
  const [id, setId] = useState(analysisId ?? ''), [filters, setFilters] = useState<AnalysisFilters>(emptyFilters), [busy, setBusy] = useState(''), [error, setError] = useState('')
  useEffect(() => { setId(analysisId ?? '') }, [analysisId])
  const metadata = usePlatformResource<Paged<ReportMetadata>>('/reports?limit=20&offset=0', session, session.configured && !!session.user && session.user.role !== 'student')
  const exportFile = async (kind: 'pdf' | 'csv' | 'bulk') => {
    setError(''); if (kind !== 'bulk' && !id.trim()) { setError('ระบุ Analysis ID ที่คุณมีสิทธิ์เข้าถึงก่อน'); return }
    setBusy(kind)
    try {
      if (kind === 'bulk') { const { status, ...remaining } = filters; await downloadAPI(`/exports.csv${buildQuery({ ...remaining, analysis_status: status })}`, 'HelpMinths-analysis-export.csv', session) }
      else await downloadAPI(`/analyses/${encodeURIComponent(id.trim())}/${kind === 'pdf' ? 'report.pdf' : 'export.csv'}`, `HelpMinths-${id.trim()}.${kind}`, session, kind === 'pdf' ? { method: 'POST' } : {})
      metadata.reload()
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'สร้างรายงานไม่ได้') } finally { setBusy('') }
  }
  return <div className="platform-page"><PlatformHeading kicker="REPORTS" title="รายงานและส่งออกข้อมูล" description="ดาวน์โหลดผลรายภาพหรือ CSV หลายรายการ ข้อมูลภาพและรายงานตรวจสิทธิ์ที่เซิร์ฟเวอร์ทุกครั้ง"/>
    <AccessState session={session} roles={['admin', 'reviewer', 'lab']}>
      {error && <ErrorNotice message={error}/>}
      <section className="platform-card"><div className="platform-card-heading"><div><h2>รายงานรายภาพ</h2><p>PDF มีภาพต้นฉบับ กรอบผลวิเคราะห์ คุณภาพภาพ และสถานะผู้ตรวจทาน โดยใช้ข้อมูลที่บันทึกจริง</p></div><FileText size={25}/></div><label>Analysis ID<input value={id} maxLength={80} onChange={event => setId(event.target.value)} placeholder="เลือกจากประวัติหรือวางรหัสรายการ"/></label><div className="platform-actions"><button className="platform-button primary" disabled={!!busy} onClick={() => void exportFile('pdf')}><Download size={18}/>{busy === 'pdf' ? 'กำลังสร้าง PDF…' : 'ดาวน์โหลด PDF'}</button><button className="platform-button" disabled={!!busy} onClick={() => void exportFile('csv')}><Download size={18}/>ดาวน์โหลด CSV รายภาพ</button></div><p className="platform-muted">รายงานระบุชัดเจนว่าเป็นผล AI หรือผลที่ผู้ตรวจทานได้ทบทวนแล้ว เวลาและรุ่นข้อมูลอ้างตามรายการจริง</p></section>
      <section className="platform-card"><h2>ส่งออกหลายรายการตามตัวกรอง</h2><p>CSV ใช้ UTF-8 พร้อม BOM สำหรับภาษาไทย และแยก label เดิมออกจาก label ที่ผู้ตรวจทานแก้</p><AnalysisFilterForm includeId={false} onApply={setFilters}/><button className="platform-button primary" disabled={!!busy} onClick={() => void exportFile('bulk')}><Download size={18}/>{busy === 'bulk' ? 'กำลังส่งออก…' : 'ดาวน์โหลด CSV ตามตัวกรอง'}</button><p className="platform-muted">ใช้เฉพาะรายการที่บัญชีของคุณมีสิทธิ์ การส่งออกไม่มีข้อมูลผู้ป่วยเติมให้ และไม่มีค่า EPG ที่คำนวณจากภาพทั่วไป</p></section>
      <section className="platform-card"><h2>รายงานที่เคยสร้าง</h2>{metadata.loading ? <LoadingNotice/> : metadata.error ? <ErrorNotice message={metadata.error} onRetry={metadata.reload}/> : !metadata.value?.items.length ? <p className="platform-muted">ยังไม่มีรายงานที่สร้างไว้ รายการจะแสดงหลังส่งออกรายงานจริง</p> : <div className="platform-table-wrap"><table><thead><tr><th>Report ID</th><th>Analysis ID</th><th>สร้างเมื่อ</th><th>รุ่นข้อมูล</th></tr></thead><tbody>{metadata.value.items.map(item => <tr key={item.id}><td className="platform-mono">{item.id}</td><td><button className="platform-link" onClick={() => setId(item.analysis_id ?? '')}>{item.analysis_id ?? 'ไม่ระบุ'}</button></td><td>{formatDate(item.generated_at ?? item.created_at)}</td><td>{item.analysis_revision ?? 'ไม่ระบุ'}</td></tr>)}</tbody></table></div>}</section>
    </AccessState>
  </div>
}
