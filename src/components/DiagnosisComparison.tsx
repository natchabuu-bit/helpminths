import { Bot, CheckCircle2, Clock3, MessageCircle, ShieldCheck } from 'lucide-react'
import { formatDate } from '../platform/api'
import type { ExpertReview, PlatformAnalysis, PlatformDetection } from '../platform/api'
import '../styles/diagnosis-comparison.css'

interface ComparisonProps {
  analysis: PlatformAnalysis
  /** Pass null when this referral has no review; undefined uses the analysis review. */
  review?: ExpertReview | null
  reviewState?: string
  expertComment?: string | null
  expertName?: string | null
  respondedAt?: string | null
  historical?: boolean
  compact?: boolean
}

function countLabels(labels: string[]) {
  const counts = new Map<string, number>()
  for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1)
  return [...counts].map(([label, count]) => ({ label, count }))
}

const rowActions: Record<string, string> = { confirm: 'ยืนยันผลเดิม', correct: 'แก้ไขชนิด / กรอบ', correct_class: 'แก้ไขชนิด / กรอบ', false_positive: 'ตัดออกจากผลตรวจ', missed: 'ผู้เชี่ยวชาญพบเพิ่มเติม', missed_detection: 'ผู้เชี่ยวชาญพบเพิ่มเติม', uncertain: 'ยังไม่แน่ใจ', request_review: 'ต้องตรวจเพิ่มเติม' }

export function expertReviewIsFinal(review?: ExpertReview | null, detections?: PlatformDetection[]) {
  if (review?.status !== 'verified' || review.full_image_reviewed !== true || review.annotations.some(item => ['uncertain', 'request_review'].includes(item.action))) return false
  if (review.annotations.some(item => !['confirm', 'correct', 'correct_class', 'false_positive', 'missed', 'missed_detection'].includes(item.action))) return false
  const originalLabels = new Map((detections ?? []).map(item => [String(item.id), item.label]))
  if (review.annotations.some(item => item.action !== 'false_positive' && !(item.label || item.corrected_label || (item.action === 'confirm' && originalLabels.get(String(item.detection_id)))))) return false
  if (!detections) return true
  const linked = review.annotations.filter(item => item.detection_id !== undefined && !['missed', 'missed_detection'].includes(item.action))
  const reviewed = new Set(linked.map(item => String(item.detection_id)))
  return linked.length === reviewed.size && reviewed.size === detections.length && detections.every(item => reviewed.has(String(item.id)))
}

export function deriveExpertOutcome(review: ExpertReview | null | undefined, detections: PlatformDetection[]) {
  const final = expertReviewIsFinal(review, detections)
  const originals = new Map(detections.map(item => [String(item.id), item]))
  const annotations = new Map((review?.annotations ?? []).filter(item => !['missed', 'missed_detection'].includes(item.action)).map(item => [String(item.detection_id), item]))
  const rows = detections.map((detection, index) => {
    const annotation = annotations.get(String(detection.id))
    const action = annotation?.action ?? ''
    const label = annotation?.label || annotation?.corrected_label || (action === 'confirm' ? detection.label : '')
    return { key: String(detection.id), position: index + 1, aiLabel: detection.label, aiConfidence: detection.confidence as number | undefined, expertLabel: action === 'false_positive' ? 'ไม่ใช่วัตถุเป้าหมาย' : ['uncertain', 'request_review'].includes(action) ? 'ยังไม่ยืนยันชนิด' : label || 'ยังไม่ได้ยืนยัน', action, comment: annotation?.comment ?? '' }
  })
  for (const annotation of review?.annotations ?? []) {
    if (!['missed', 'missed_detection'].includes(annotation.action)) continue
    rows.push({ key: `missed-${rows.length}`, position: rows.length + 1, aiLabel: 'AI ไม่พบตำแหน่งนี้', aiConfidence: undefined, expertLabel: annotation.label || annotation.corrected_label || 'ยังไม่ระบุชนิด', action: annotation.action, comment: annotation.comment ?? '' })
  }
  const labels = (review?.annotations ?? []).flatMap(annotation => {
    if (!['confirm', 'correct', 'correct_class', 'missed', 'missed_detection'].includes(annotation.action)) return []
    const original = originals.get(String(annotation.detection_id))
    const label = annotation.label || annotation.corrected_label || (annotation.action === 'confirm' ? original?.label : '')
    return label ? [label] : []
  })
  return { final, rows, groups: countLabels(labels), falsePositives: rows.filter(row => row.action === 'false_positive').length, missed: rows.filter(row => ['missed', 'missed_detection'].includes(row.action)).length }
}

export default function DiagnosisComparison({ analysis, review: selectedReview, reviewState, expertComment, expertName, respondedAt, historical = false, compact = false }: ComparisonProps) {
  const review = selectedReview === undefined ? analysis.latest_review : selectedReview
  const outcome = deriveExpertOutcome(review, analysis.detections)
  const aiGroups = countLabels(analysis.detections.map(item => item.label))
  const comment = expertComment ?? review?.comment ?? review?.comments ?? ''
  const reviewer = expertName || review?.reviewer_name || review?.reviewer_username || ''
  const reviewedAt = respondedAt || review?.reviewed_at || review?.created_at
  const state = reviewState || review?.status || analysis.referral_status || ''
  const awaitingImages = state === 'needs_more' || state === 'needs_additional_review'
  const provisional = !!review || !!comment
  const expertTitle = outcome.final ? 'ผลยืนยันจากผู้เชี่ยวชาญ' : awaitingImages ? 'ผู้เชี่ยวชาญขอภาพเพิ่มเติม' : provisional ? 'ผลทบทวนยังไม่สิ้นสุด' : 'รอผู้เชี่ยวชาญยืนยัน'
  return <section className={`diagnosis-comparison ${outcome.final ? 'has-final-result' : 'is-awaiting-result'} ${compact ? 'is-compact' : ''}`} aria-label="เปรียบเทียบผล AI และผู้เชี่ยวชาญ" tabIndex={-1} data-status={outcome.final ? 'verified' : state || 'pending'} data-review-id={review?.id}>
    <div className="diagnosis-comparison-heading"><h2>ผล AI และผลจากผู้เชี่ยวชาญ</h2>{historical && <span>รอบส่งต่อก่อนหน้า</span>}</div>
    <div className="diagnosis-panels">
      <section className="diagnosis-panel diagnosis-ai" data-diagnosis-source="ai" aria-label="ผลที่ AI ทำนาย">
        <header><span className="diagnosis-source"><Bot size={20}/>AI ทำนาย</span><span className="diagnosis-state">ผลอัตโนมัติ</span></header>
        {analysis.status !== 'completed' ? <p className="diagnosis-empty">ยังไม่มีผลวิเคราะห์สำเร็จจาก AI</p> : aiGroups.length ? <ul className="diagnosis-species-list">{aiGroups.map(item => <li key={item.label}><strong>{item.label}</strong><span>{item.count} ตำแหน่ง</span></li>)}</ul> : <p className="diagnosis-empty">AI ไม่พบวัตถุเป้าหมายในภาพนี้</p>}
        <p className="diagnosis-caption">ผลเดิมที่ AI ทำนายไว้ ก่อนผู้เชี่ยวชาญตรวจทาน</p>
      </section>
      <section className={`diagnosis-panel diagnosis-expert ${outcome.final ? 'is-final' : ''}`} data-diagnosis-source="expert" aria-label="ผลจากผู้เชี่ยวชาญ">
        <header><span className="diagnosis-source"><ShieldCheck size={20}/>ผู้เชี่ยวชาญ</span><span className="diagnosis-state">{outcome.final ? <CheckCircle2 size={15}/> : <Clock3 size={15}/>}{outcome.final ? 'ยืนยันผลแล้ว' : 'ยังไม่ใช่ผลยืนยัน'}</span></header>
        <h3>{expertTitle}</h3>
        {outcome.final ? outcome.groups.length ? <ul className="diagnosis-species-list">{outcome.groups.map(item => <li key={item.label}><strong>{item.label}</strong><span>{item.count} ตำแหน่ง</span></li>)}</ul> : <p className="diagnosis-final-empty">ยืนยัน 0 ตำแหน่ง · ไม่พบไข่หรือตัวอ่อนพยาธิในภาพนี้</p> : <p className="diagnosis-empty">{awaitingImages ? 'ส่งภาพเพิ่มเติมตามคำขอ เพื่อให้ผู้เชี่ยวชาญตรวจยืนยันต่อ' : provisional ? 'คำตอบระหว่างตรวจแสดงด้านล่าง ผลชนิดและจำนวนยังรอการยืนยันทั้งภาพ' : 'ยังไม่มีผลยืนยันชนิดและจำนวนจากผู้เชี่ยวชาญ'}</p>}
        {outcome.final && (outcome.falsePositives > 0 || outcome.missed > 0) && <p className="diagnosis-corrections">{outcome.falsePositives > 0 && <span>ตัดผล AI ออก {outcome.falsePositives} ตำแหน่ง</span>}{outcome.missed > 0 && <span>พบเพิ่มจาก AI {outcome.missed} ตำแหน่ง</span>}</p>}
        {(reviewer || reviewedAt) && <p className="diagnosis-reviewer">{reviewer && <span>ผู้ตรวจ: {reviewer}</span>}{reviewedAt && <time dateTime={reviewedAt}>{formatDate(reviewedAt)}</time>}</p>}
      </section>
    </div>
    {comment.trim() && <section className={`diagnosis-expert-comment ${outcome.final ? 'is-final' : ''}`} aria-label={outcome.final ? 'คำอธิบายผลยืนยันจากผู้เชี่ยวชาญ' : 'ข้อความตอบกลับระหว่างตรวจ'}><h3><MessageCircle size={19}/>{outcome.final ? 'คำอธิบายจากผู้เชี่ยวชาญ' : 'ข้อความตอบกลับจากผู้เชี่ยวชาญ'}</h3>{!outcome.final && <span>ข้อความระหว่างตรวจ · ยังไม่ยืนยันผลทั้งภาพ</span>}<p className="platform-preserve-text">{comment}</p></section>}
    {outcome.rows.length > 0 && <details className="diagnosis-object-details" open={!!review && !compact && outcome.rows.length <= 6}><summary>{outcome.final ? 'ดูว่าแต่ละตำแหน่งยืนยันหรือแก้ไขอย่างไร' : review ? 'ดูผลทบทวนรายตำแหน่งที่ยังไม่สิ้นสุด' : 'ดูผลที่ AI ทำนายรายตำแหน่ง'} ({outcome.rows.length})</summary><ol className="diagnosis-object-list">{outcome.rows.map(row => <li key={row.key}><div className="diagnosis-object-heading"><strong>ตำแหน่งที่ {row.position}</strong><span>{!outcome.final && row.action ? 'ร่าง · ' : ''}{rowActions[row.action] || 'ยังไม่ได้ทบทวน'}</span></div><div className="diagnosis-object-columns"><div><span>AI ทำนาย</span><strong>{row.aiLabel}</strong>{row.aiConfidence !== undefined && <small>ความมั่นใจ AI {(row.aiConfidence * 100).toFixed(1)}%</small>}</div><div><span>{outcome.final ? 'ผู้เชี่ยวชาญยืนยัน' : 'ผู้เชี่ยวชาญทบทวนเบื้องต้น'}</span><strong>{row.expertLabel}</strong></div></div>{row.comment && <p className="platform-preserve-text">{row.comment}</p>}</li>)}</ol></details>}
  </section>
}
