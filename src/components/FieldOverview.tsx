import { ArrowRight, Play, ScanLine } from 'lucide-react'
import IntroVideo from './IntroVideo'

interface FieldOverviewProps {
  onScan: () => void
  onDemo: () => void
}

export default function FieldOverview({ onScan, onDemo }: FieldOverviewProps) {
  return <section className="field-overview" aria-labelledby="field-title">
    <h1 id="field-title">ตรวจภาพไข่พยาธิ</h1>
    <p className="field-intro">อัปโหลดภาพจากกล้องจุลทรรศน์ ให้ AI ช่วยคัดกรองและส่งต่อผู้เชี่ยวชาญยืนยันผล</p>
    <div className="field-actions">
      <button type="button" className="field-scan-button" onClick={onScan}><ScanLine size={20} aria-hidden="true"/><span>เริ่มตรวจวิเคราะห์</span><ArrowRight size={18} aria-hidden="true"/></button>
      <button type="button" className="field-demo-button" onClick={onDemo}><Play size={18} aria-hidden="true"/>ดูตัวอย่าง</button>
    </div>
    <p className="research-note">ผล AI ต้องได้รับการทบทวนโดยผู้เชี่ยวชาญ</p>
    <IntroVideo/>
  </section>
}
