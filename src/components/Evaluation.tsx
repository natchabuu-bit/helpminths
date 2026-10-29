import { Check, CheckCircle2, ClipboardCheck, Heart, MessageCircle, Save } from 'lucide-react'
import type { FormEvent } from 'react'
import { susOptions, susQuestions } from '../data/feedback'
import type { FeedbackForm } from '../hooks/useFeedback'
import '../styles/evaluation.css'

export default function Evaluation({ feedback }: { feedback: FeedbackForm }) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const result = feedback.save()
    if (result.firstUnanswered !== null) {
      const input = event.currentTarget.querySelector<HTMLInputElement>(`input[name="sus-${result.firstUnanswered + 1}"]`)
      input?.focus()
      input?.closest('fieldset')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }
  return <div className="feedback-page" data-testid="evaluation-page">
    <div className="feedback-heading">
      <span className="feedback-eyebrow"><Heart size={17} aria-hidden="true"/> เสียงของคุณมีความหมาย</span>
      <h1>ประเมินการใช้งาน</h1>
      <p>HelpMinths ใช้งานเป็นอย่างไรบ้าง?<br className="feedback-mobile-break"/> เลือกคำตอบและบอกสิ่งที่อยากให้เราปรับปรุงได้เลย</p>
    </div>
    <form onSubmit={submit} noValidate>
      <section className="feedback-card feedback-sus" aria-labelledby="feedback-sus-title">
        <div className="feedback-section-heading">
          <span className="feedback-section-icon"><ClipboardCheck size={23} aria-hidden="true"/></span>
          <div><h2 id="feedback-sus-title">แบบประเมินการใช้งาน (SUS)</h2><p>ให้คะแนนจาก 1–5 ตามประสบการณ์การใช้ HelpMinths ของคุณ</p></div>
          <span className="feedback-question-count">10 ข้อ</span>
        </div>
        <div className="feedback-scale-guide" id="feedback-scale-guide">
          {susOptions.map(option => <span key={option.value}><b>{option.value}</b>{option.label}</span>)}
        </div>
        <div className="feedback-progress">
          <span id="feedback-progress-label">ตอบแล้ว <strong>{feedback.answeredCount}</strong> จาก 10 ข้อ</span>
          <progress value={feedback.answeredCount} max={10} aria-labelledby="feedback-progress-label"/>
        </div>
        <div className="feedback-questions">
          {susQuestions.map((question, index) => {
            const invalid = feedback.attempted && feedback.answers[index] === null
            return <fieldset className={`feedback-question ${invalid ? 'is-unanswered' : ''}`} key={question} aria-describedby="feedback-scale-guide">
              <legend><span className="feedback-question-number">{String(index + 1).padStart(2, '0')}</span><span>{question}</span>{feedback.answers[index] !== null && <Check className="feedback-answered-check" size={18} aria-label="ตอบแล้ว"/>}</legend>
              <div className="feedback-choices">
                {susOptions.map(option => <label className="feedback-choice" key={option.value}>
                  <input type="radio" name={`sus-${index + 1}`} value={option.value} checked={feedback.answers[index] === option.value} onChange={() => feedback.answer(index, option.value)} aria-label={`SUS ข้อ ${index + 1} คะแนน ${option.value}: ${option.label}`} aria-invalid={invalid}/>
                  <span className="feedback-choice-tile"><strong>{option.value}</strong><span className="feedback-choice-description">{option.label}</span></span>
                </label>)}
              </div>
              <div className="feedback-mobile-scale" aria-hidden="true"><span>ไม่เห็นด้วยอย่างยิ่ง</span><span>เห็นด้วยอย่างยิ่ง</span></div>
            </fieldset>
          })}
        </div>
      </section>
      <section className="feedback-card feedback-comments" aria-labelledby="feedback-comments-title">
        <div className="feedback-section-heading">
          <span className="feedback-section-icon is-violet"><MessageCircle size={23} aria-hidden="true"/></span>
          <div><h2 id="feedback-comments-title">อยากบอกอะไรเพิ่มเติมไหม?</h2><p>ส่วนที่ชอบ จุดที่ติดขัด หรือสิ่งที่อยากให้มีเพิ่ม เขียนได้เต็มที่</p></div>
          <span className="feedback-optional">ไม่บังคับ</span>
        </div>
        <label className="feedback-text-label" htmlFor="feedback-comment">ข้อเสนอแนะของคุณ</label>
        <textarea id="feedback-comment" value={feedback.feedbackText} onChange={event => feedback.setFeedback(event.target.value)} maxLength={2000} rows={5} placeholder="เช่น อยากให้ค้นหาชื่อพยาธิได้สะดวกขึ้น หรือชอบการเทียบภาพจริงกับ 3D…" aria-describedby="feedback-comment-note"/>
        <div className="feedback-comment-footer"><p id="feedback-comment-note">ไม่ต้องระบุชื่อหรือข้อมูลผู้ป่วย</p><span>{feedback.feedbackText.length.toLocaleString('th-TH')} / 2,000</span></div>
      </section>
      <div className="feedback-submit-row">
        <div className="feedback-storage-note"><p>คำตอบบันทึกในเบราว์เซอร์บนอุปกรณ์นี้ ไม่มีการส่งไปยังเซิร์ฟเวอร์</p>{feedback.savedAt && feedback.status !== 'saved' && <small>มีคำตอบที่บันทึกไว้แล้ว คุณแก้ไขและบันทึกใหม่ได้</small>}</div>
        <button className="feedback-submit" type="submit"><Save size={19} aria-hidden="true"/> บันทึกคำตอบ</button>
      </div>
      {feedback.message && <div className={`feedback-result ${feedback.status === 'error' ? 'is-error' : ''}`} role={feedback.status === 'error' ? 'alert' : 'status'}>{feedback.status === 'saved' && <CheckCircle2 size={21} aria-hidden="true"/>}<p>{feedback.message}</p></div>}
    </form>
    <p className="feedback-method-note">SUS ใช้ประเมินความสะดวกในการใช้งาน · คำถามเป็นคำแปลไทยสำหรับ HelpMinths</p>
  </div>
}
