import { useEffect, useMemo, useState } from 'react'
import { calculateSUS, roleLabels, studyTasks, summarizeStudy } from '../data/evaluation'
import type { ActionStatus, FeedbackAction, Interview, Participant, ParticipantRole, StudyData, StudySnapshot, TaskOutcome, UploadAttempt } from '../data/evaluation'

export const EVALUATION_STORAGE_KEY = 'helpminths.evaluation.v1'
const emptyData = (): StudyData => ({ version: 1, participants: [], activeParticipantId: null, actions: [] })
const id = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
const timestamp = () => new Date().toISOString()
const text = (value: unknown, maximum = 2000) => typeof value === 'string' ? value.replace(/\0/g, '').replace(/(?:data:image\/|blob:)[^\s]+/gi, '[ข้อมูลภาพถูกตัดออก]').slice(0, maximum).trim() : ''
const date = (value: unknown): string => { if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error('Invalid saved study date'); return value }
function loadSaved(): { data: StudyData; persisted: boolean } {
  if (typeof window === 'undefined') return { data: emptyData(), persisted: false }
  try {
    const stored = localStorage.getItem(EVALUATION_STORAGE_KEY)
    if (!stored) return { data: emptyData(), persisted: false }
    const source = JSON.parse(stored) as { consentToLocalStorage?: boolean; data?: StudyData }
    if (source.consentToLocalStorage !== true || source.data?.version !== 1 || !Array.isArray(source.data.participants) || !Array.isArray(source.data.actions)) return { data: emptyData(), persisted: false }
    const participants: Participant[] = source.data.participants.slice(0, 100).map(p => ({
      id: text(p.id, 80), code: text(p.code, 20), role: Object.prototype.hasOwnProperty.call(roleLabels, p.role) ? p.role : 'other', consentAt: date(p.consentAt), createdAt: date(p.createdAt),
      tasks: Array.isArray(p.tasks) ? p.tasks.slice(0, 200).map(t => ({ id: text(t.id, 80), taskId: text(t.taskId, 80), title: text(t.title, 200), kind: t.kind === 'upload' ? 'upload' : 'atlas', startedAt: date(t.startedAt), endedAt: t.outcome === 'running' ? timestamp() : t.endedAt ? date(t.endedAt) : null, durationMs: t.outcome !== 'running' && Number.isFinite(t.durationMs) && Number(t.durationMs) >= 0 ? Number(t.durationMs) : null, outcome: ['success', 'partial', 'failed', 'cancelled'].includes(t.outcome) ? t.outcome : 'cancelled', note: t.outcome === 'running' ? 'หยุดเมื่อโหลดหน้าใหม่ ไม่นำเวลาไปสรุปผล' : text(t.note), uploads: Array.isArray(t.uploads) ? t.uploads.slice(0, 200).map(u => ({ id: text(u.id, 80), createdAt: date(u.createdAt), success: u.success === true, ...cleanUploadMetadata(u) })) : [] })) : [],
      susAnswers: Array.from({ length: 10 }, (_, i) => Number.isInteger(p.susAnswers?.[i]) && Number(p.susAnswers[i]) >= 1 && Number(p.susAnswers[i]) <= 5 ? p.susAnswers[i] : null), susCompletedAt: p.susCompletedAt ? date(p.susCompletedAt) : null,
      interview: p.interview ? { currentWorkflow: text(p.interview.currentWorkflow), obstacle: text(p.interview.obstacle), learningNeed: text(p.interview.learningNeed), observation: text(p.interview.observation), savedAt: date(p.interview.savedAt) } : null,
      feedback: Array.isArray(p.feedback) ? p.feedback.slice(0, 100).map(f => ({ id: text(f.id, 80), problem: text(f.problem), suggestion: text(f.suggestion), createdAt: date(f.createdAt) })) : [],
    }))
    const actions: FeedbackAction[] = source.data.actions.slice(0, 200).map(a => ({ id: text(a.id, 80), source: text(a.source, 100), issue: text(a.issue), action: text(a.action), status: ['proposed', 'planned', 'implemented', 'verified'].includes(a.status) ? a.status : 'proposed', evidence: text(a.evidence), createdAt: date(a.createdAt), updatedAt: date(a.updatedAt) }))
    return { data: { version: 1, participants, actions, activeParticipantId: participants.some(p => p.id === source.data?.activeParticipantId) ? source.data.activeParticipantId : null }, persisted: true }
  } catch { return { data: emptyData(), persisted: false } }
}
export interface UploadAttemptInput { success: boolean; width?: number; height?: number; sizeBytes?: number; mime?: string; elapsedMs?: number; reason?: string }
function cleanUploadMetadata(input: UploadAttemptInput): Omit<UploadAttempt, 'id' | 'createdAt' | 'success'> {
  const positive = (n?: number) => typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.round(n) : undefined
  return { width: positive(input.width), height: positive(input.height), sizeBytes: positive(input.sizeBytes), elapsedMs: positive(input.elapsedMs), mime: ['image/jpeg', 'image/png', 'image/webp'].includes(input.mime ?? '') ? input.mime : 'other', reason: input.success ? undefined : ['format', 'size', 'decode', 'dimensions', 'unsupported_type', 'too_large', 'decode_error'].includes(input.reason ?? '') ? input.reason : 'unknown' }
}
interface StudyFormDraft { note: string; interview: Omit<Interview, 'savedAt'>; problem: string; suggestion: string; actionSource: string; actionIssue: string; actionText: string; actionStatus: ActionStatus; actionEvidence: string }
const emptyFormDraft = (): StudyFormDraft => ({ note: '', interview: { currentWorkflow: '', obstacle: '', learningNeed: '', observation: '' }, problem: '', suggestion: '', actionSource: '', actionIssue: '', actionText: '', actionStatus: 'proposed', actionEvidence: '' })
export function useEvaluationStudy() {
  const [initial] = useState(loadSaved)
  const [data, setData] = useState<StudyData>(initial.data)
  const [formDraft, setFormDraft] = useState<StudyFormDraft>(() => ({ ...emptyFormDraft(), interview: initial.data.participants.find(p => p.id === initial.data.activeParticipantId)?.interview ?? emptyFormDraft().interview }))
  const [persisted, setPersisted] = useState(initial.persisted)
  const [message, setMessage] = useState('')
  const [now, setNow] = useState(Date.now())
  const activeParticipant = data.participants.find(p => p.id === data.activeParticipantId) ?? null
  const activeTask = activeParticipant?.tasks.find(t => t.outcome === 'running') ?? null
  const summary = useMemo(() => summarizeStudy(data), [data])
  useEffect(() => {
    if (!activeTask) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [activeTask?.id])
  useEffect(() => {
    try {
      if (persisted) localStorage.setItem(EVALUATION_STORAGE_KEY, JSON.stringify({ consentToLocalStorage: true, data }))
      else localStorage.removeItem(EVALUATION_STORAGE_KEY)
    } catch { setPersisted(false); setMessage('บันทึกบนเครื่องไม่ได้ ใช้หน่วยความจำแทน โปรดดาวน์โหลดผลก่อนปิดหน้า') }
  }, [data, persisted])
  const updateParticipant = (change: (participant: Participant) => Participant) => setData(old => ({ ...old, participants: old.participants.map(p => p.id === old.activeParticipantId ? change(p) : p) }))
  const addParticipant = (code: string, role: ParticipantRole, consent: boolean) => {
    if (activeTask) { setMessage('จบงานที่กำลังจับเวลาก่อนเปลี่ยนผู้เข้าร่วม'); return false }
    if (!consent) { setMessage('ต้องได้รับความยินยอมก่อนเริ่มบันทึกผล'); return false }
    if (!/^[A-Za-z0-9_-]{1,20}$/.test(code.trim())) { setMessage('ใช้รหัส 1–20 ตัว เช่น P01 ไม่ใช้ชื่อหรือเลขผู้ป่วย'); return false }
    if (data.participants.some(p => p.code.toLowerCase() === code.trim().toLowerCase())) { setMessage('รหัสนี้มีอยู่แล้ว ให้เลือกผู้เข้าร่วมเดิมหรือใช้รหัสใหม่'); return false }
    const createdAt = timestamp(), participant: Participant = { id: id(), code: code.trim(), role, consentAt: createdAt, createdAt, tasks: [], susAnswers: Array(10).fill(null), susCompletedAt: null, interview: null, feedback: [] }
    setData(old => ({ ...old, activeParticipantId: participant.id, participants: [...old.participants, participant] })); setFormDraft(old => ({ ...old, note: '', interview: emptyFormDraft().interview, problem: '', suggestion: '' })); setMessage(`เริ่มบันทึกผู้เข้าร่วม ${participant.code} แล้ว`); return true
  }
  const selectParticipant = (participantId: string) => { if (activeTask) { setMessage('จบงานที่กำลังจับเวลาก่อนเปลี่ยนผู้เข้าร่วม'); return } setData(old => ({ ...old, activeParticipantId: old.participants.some(p => p.id === participantId) ? participantId : null })); setFormDraft(old => ({ ...old, note: '', interview: data.participants.find(p => p.id === participantId)?.interview ?? emptyFormDraft().interview, problem: '', suggestion: '' })); setMessage('') }
  const startTask = (taskId: string) => {
    if (!activeParticipant || activeTask) { setMessage('เลือกผู้เข้าร่วมที่ยินยอมแล้ว และจบงานเดิมก่อนเริ่มงานใหม่'); return false }
    const task = studyTasks.find(t => t.id === taskId); if (!task) return false
    updateParticipant(p => ({ ...p, tasks: [...p.tasks, { id: id(), taskId, title: task.title, kind: task.kind, startedAt: timestamp(), endedAt: null, durationMs: null, outcome: 'running', note: '', uploads: [] }] })); setNow(Date.now()); setMessage('เริ่มจับเวลาแล้ว กลับหน้านี้เพื่อบันทึกผลเมื่อทำงานเสร็จ'); return true
  }
  const finishTask = (outcome: Exclude<TaskOutcome, 'running'>, note: string) => { if (!activeTask) return; const endedAt = timestamp(); updateParticipant(p => ({ ...p, tasks: p.tasks.map(t => t.id === activeTask.id ? { ...t, endedAt, durationMs: outcome === 'cancelled' ? null : Math.max(0, Date.parse(endedAt) - Date.parse(t.startedAt)), outcome, note: text(note) } : t) })); setMessage('บันทึกผลการทำงานแล้ว') }
  const recordUploadAttempt = (input: UploadAttemptInput) => {
    if (!activeParticipant?.consentAt || !activeTask || activeTask.kind !== 'upload') return
    const attempt: UploadAttempt = { id: id(), createdAt: timestamp(), success: input.success === true, ...cleanUploadMetadata(input) }
    updateParticipant(p => ({ ...p, tasks: p.tasks.map(t => t.id === activeTask.id && t.outcome === 'running' ? { ...t, uploads: [...t.uploads, attempt] } : t) }))
  }
  const setSUSAnswer = (index: number, value: number) => { if (!activeParticipant || index < 0 || index > 9 || !Number.isInteger(value) || value < 1 || value > 5) return; updateParticipant(p => ({ ...p, susCompletedAt: null, susAnswers: p.susAnswers.map((old, i) => i === index ? value : old) })) }
  const saveSUS = () => { if (!activeParticipant || calculateSUS(activeParticipant.susAnswers) === null) { setMessage('ตอบ SUS ให้ครบทั้ง 10 ข้อก่อนบันทึก'); return false } updateParticipant(p => ({ ...p, susCompletedAt: timestamp() })); setMessage('บันทึก SUS ครบ 10 ข้อแล้ว คะแนนเป็น 0–100 ไม่ใช่ร้อยละ'); return true }
  const saveInterview = (input: Omit<Interview, 'savedAt'>) => { if (!activeParticipant) return false; const interview = { currentWorkflow: text(input.currentWorkflow), obstacle: text(input.obstacle), learningNeed: text(input.learningNeed), observation: text(input.observation), savedAt: timestamp() }; if (!interview.currentWorkflow && !interview.obstacle && !interview.learningNeed && !interview.observation) { setMessage('กรอกสิ่งที่สัมภาษณ์หรือสังเกตจริงอย่างน้อย 1 ช่อง'); return false } updateParticipant(p => ({ ...p, interview })); setMessage('บันทึกสัมภาษณ์จริงแล้ว'); return true }
  const addFeedback = (problem: string, suggestion: string) => { if (!activeParticipant || !text(problem)) { setMessage('เลือกผู้เข้าร่วมและกรอกข้อสังเกตจากการใช้จริง'); return false } updateParticipant(p => ({ ...p, feedback: [...p.feedback, { id: id(), problem: text(problem), suggestion: text(suggestion), createdAt: timestamp() }] })); setMessage('บันทึกข้อเสนอแนะแล้ว'); return true }
  const addAction = (input: Pick<FeedbackAction, 'source' | 'issue' | 'action' | 'status' | 'evidence'>) => { if (!text(input.issue) || !text(input.action)) { setMessage('กรอกปัญหาและสิ่งที่จะปรับปรุง'); return false } if ((input.status === 'implemented' || input.status === 'verified') && !text(input.evidence)) { setMessage('ระบุหลักฐานก่อนบันทึกว่าปรับแล้วหรือผ่านการตรวจแล้ว'); return false } const createdAt = timestamp(); setData(old => ({ ...old, actions: [...old.actions, { id: id(), source: text(input.source, 100), issue: text(input.issue), action: text(input.action), status: input.status, evidence: text(input.evidence), createdAt, updatedAt: createdAt }] })); setMessage('เพิ่มรายการปรับปรุงแล้ว'); return true }
  const updateAction = (actionId: string, status: ActionStatus, evidence: string) => { if ((status === 'implemented' || status === 'verified') && !text(evidence)) { setMessage('ระบุหลักฐานการปรับปรุงหรือผลตรวจจริงก่อน'); return false } setData(old => ({ ...old, actions: old.actions.map(a => a.id === actionId ? { ...a, status, evidence: text(evidence), updatedAt: timestamp() } : a) })); setMessage('อัปเดตสถานะการปรับปรุงแล้ว'); return true }
  const clearAll = () => { try { localStorage.removeItem(EVALUATION_STORAGE_KEY) } catch { /* memory-only remains available */ } setData(emptyData()); setPersisted(false); setFormDraft(emptyFormDraft()); setMessage('ล้างข้อมูลประเมินทั้งหมดแล้ว') }
  const getSnapshot = (): StudySnapshot => JSON.parse(JSON.stringify({ schema: 'helpminths-usability-study-v1', exportedAt: timestamp(), purpose: 'บันทึกการใช้งานจริง ไม่ใช่การทดสอบความแม่นยำโมเดล', susTranslation: 'คำแปลไทยสำหรับโครงงาน ยังไม่อ้างฉบับแปลที่ผ่านการตรวจสอบ', protocol: { atlasParticipantsTarget: '3–5', uploadImagesTarget: '5–10' }, summary, data }))
  return { data, formDraft, setFormDraft, summary, activeParticipant, activeTask, elapsedMs: activeTask ? Math.max(0, now - Date.parse(activeTask.startedAt)) : 0, persisted, setPersisted, message, addParticipant, selectParticipant, startTask, finishTask, recordUploadAttempt, setSUSAnswer, saveSUS, saveInterview, addFeedback, addAction, updateAction, clearAll, getSnapshot }
}
export type EvaluationStudy = ReturnType<typeof useEvaluationStudy>
