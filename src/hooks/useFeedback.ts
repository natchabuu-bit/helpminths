import { useState } from 'react'
import { calculateSUS } from '../data/feedback'

export const FEEDBACK_STORAGE_KEY = 'helpminths.feedback.v1'
export interface SavedFeedback {
  version: 1
  answers: number[]
  feedback: string
  susScore: number
  savedAt: string
}
function readSaved(): SavedFeedback | null {
  try {
    const raw = window.localStorage.getItem(FEEDBACK_STORAGE_KEY)
    if (!raw || raw.length > 16000) return null
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object') return null
    const record = value as Partial<SavedFeedback>
    if (record.version !== 1 || !Array.isArray(record.answers) || typeof record.feedback !== 'string' || record.feedback.length > 2000 || typeof record.savedAt !== 'string' || !Number.isFinite(Date.parse(record.savedAt))) return null
    const score = calculateSUS(record.answers)
    if (score === null) return null
    return { version: 1, answers: record.answers, feedback: record.feedback.replace(/\0/g, ''), susScore: score, savedAt: record.savedAt }
  } catch { return null }
}

export function useFeedback() {
  const [initial] = useState(readSaved)
  const [answers, setAnswers] = useState<(number | null)[]>(() => initial ? [...initial.answers] : Array(10).fill(null))
  const [feedbackText, setFeedbackText] = useState(initial?.feedback ?? '')
  const [attempted, setAttempted] = useState(false)
  const [message, setMessage] = useState('')
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle')
  const [savedAt, setSavedAt] = useState<string | null>(initial?.savedAt ?? null)
  const answeredCount = answers.filter(value => value !== null).length
  const changed = () => { setMessage(''); setStatus('idle') }
  const answer = (index: number, value: number) => {
    if (!Number.isInteger(index) || index < 0 || index >= 10 || !Number.isInteger(value) || value < 1 || value > 5) return
    setAnswers(previous => previous.map((current, i) => i === index ? value : current))
    changed()
  }
  const setFeedback = (value: string) => { setFeedbackText(value.slice(0, 2000)); changed() }
  const save = (): { ok: boolean; firstUnanswered: number | null } => {
    setAttempted(true)
    const susScore = calculateSUS(answers)
    if (susScore === null) {
      setStatus('error'); setMessage('เลือกคำตอบให้ครบทั้ง 10 ข้อก่อนบันทึก')
      return { ok: false, firstUnanswered: answers.findIndex(value => value === null) }
    }
    const now = new Date().toISOString()
    const record: SavedFeedback = { version: 1, answers: answers as number[], feedback: feedbackText.replace(/\0/g, '').trim(), susScore, savedAt: now }
    try {
      window.localStorage.setItem(FEEDBACK_STORAGE_KEY, JSON.stringify(record))
      setSavedAt(now); setAttempted(false); setStatus('saved')
      setMessage('บันทึกคำตอบบนอุปกรณ์นี้แล้ว ขอบคุณที่ช่วยประเมินการใช้งาน')
      return { ok: true, firstUnanswered: null }
    } catch {
      setStatus('error'); setMessage('อุปกรณ์นี้บันทึกคำตอบไม่ได้ คำตอบยังอยู่ในหน้านี้ โปรดตรวจการตั้งค่าพื้นที่จัดเก็บของเบราว์เซอร์แล้วลองอีกครั้ง')
      return { ok: false, firstUnanswered: null }
    }
  }
  return { answers, feedbackText, answer, setFeedback, save, answeredCount, attempted, message, status, savedAt }
}
export type FeedbackForm = ReturnType<typeof useFeedback>
