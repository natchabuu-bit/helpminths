import { AlertTriangle, CheckCircle2, ClipboardCheck, LoaderCircle, ShieldCheck } from 'lucide-react'
import type { QualityAssessment } from '../platform/api'
import '../styles/image-quality.css'

export default function ImageQualityPanel({ quality, checking, disabled, acknowledged, comment, onCheck, onAcknowledge, onComment }: {
  quality: (QualityAssessment & { notice?: string }) | null; checking: boolean; disabled: boolean;
  acknowledged: boolean; comment: string; onCheck: () => void; onAcknowledge: (value: boolean) => void; onComment: (value: string) => void;
}) {
  return <section className="image-quality-panel" aria-labelledby="image-quality-title">
    <div className="image-quality-heading"><div><ClipboardCheck size={22}/><h2 id="image-quality-title">ตรวจคุณภาพภาพก่อนวิเคราะห์</h2></div><button type="button" className="scan-button scan-button-secondary" disabled={disabled || checking} onClick={onCheck}>{checking ? <LoaderCircle size={17} className="scan-spin"/> : <ShieldCheck size={17}/>} {checking ? 'กำลังตรวจคุณภาพ…' : quality ? 'ตรวจคุณภาพอีกครั้ง' : 'ตรวจคุณภาพภาพ'}</button></div>
    {!quality && <p>ตรวจความละเอียด โฟกัส แสง และความต่างระดับสี โดยส่งภาพให้บริการตรวจคุณภาพชั่วคราว การตรวจนี้ยังไม่เรียกโมเดล AI และไม่บันทึกภาพ</p>}
    {quality && <><div className={`image-quality-summary ${quality.status === 'pass' ? 'is-pass' : 'is-warning'}`} role="status">{quality.status === 'pass' ? <CheckCircle2 size={20}/> : <AlertTriangle size={20}/>}<strong>{quality.status === 'pass' ? 'ผ่านเกณฑ์คุณภาพเบื้องต้น' : 'ภาพมีข้อจำกัดที่ควรทบทวน'}</strong></div><ul className="image-quality-checks">{quality.checks.map((check, index) => <li key={check.id ?? check.key ?? index}>{check.status === 'pass' ? <CheckCircle2 size={18}/> : <AlertTriangle size={18}/>}<div><strong>{check.label ?? check.name ?? check.key}</strong><span>{check.message ?? check.description}</span></div><b>{check.status === 'pass' ? 'ผ่าน' : 'ควรปรับ'}</b></li>)}</ul>
      {quality.status !== 'pass' && (quality.can_override ? <div className="image-quality-override"><label><input type="checkbox" checked={acknowledged} onChange={event => onAcknowledge(event.target.checked)} disabled={disabled}/>ฉันรับทราบข้อจำกัด และต้องการดำเนินการต่อเพื่อให้ผู้เชี่ยวชาญทบทวน</label><label htmlFor="quality-override-note">เหตุผลที่ใช้ภาพนี้ต่อ<textarea id="quality-override-note" value={comment} onChange={event => onComment(event.target.value)} maxLength={1000} rows={2} placeholder="เช่น ไม่สามารถถ่ายใหม่ได้ และจะให้ผู้เชี่ยวชาญตรวจภาพร่วมด้วย" disabled={disabled}/></label></div> : <p className="image-quality-blocked">นโยบายที่ตั้งไว้ไม่อนุญาตให้ใช้ภาพนี้ต่อ กรุณาปรับโฟกัส แสง หรือถ่ายภาพใหม่</p>)}
      <p className="image-quality-notice">{quality.notice ?? 'การตรวจนี้ใช้เกณฑ์ภาพเบื้องต้น ไม่ใช่การยืนยันว่าภาพเหมาะสำหรับวินิจฉัย และไม่ใช่ผลตรวจพยาธิ'}</p></>}
  </section>
}
