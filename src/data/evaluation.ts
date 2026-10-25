export type ParticipantRole = 'student' | 'teacher' | 'laboratory' | 'other'
export type TaskOutcome = 'running' | 'success' | 'partial' | 'failed' | 'cancelled'
export type ActionStatus = 'proposed' | 'planned' | 'implemented' | 'verified'
export interface UploadAttempt { id: string; createdAt: string; success: boolean; width?: number; height?: number; sizeBytes?: number; mime?: string; elapsedMs?: number; reason?: string }
export interface StudyTask { id: string; taskId: string; title: string; kind: 'atlas' | 'upload'; startedAt: string; endedAt: string | null; durationMs: number | null; outcome: TaskOutcome; note: string; uploads: UploadAttempt[] }
export interface Interview { currentWorkflow: string; obstacle: string; learningNeed: string; observation: string; savedAt: string }
export interface StudyFeedback { id: string; problem: string; suggestion: string; createdAt: string }
export interface Participant { id: string; code: string; role: ParticipantRole; consentAt: string; createdAt: string; tasks: StudyTask[]; susAnswers: (number | null)[]; susCompletedAt: string | null; interview: Interview | null; feedback: StudyFeedback[] }
export interface FeedbackAction { id: string; source: string; issue: string; action: string; status: ActionStatus; evidence: string; createdAt: string; updatedAt: string }
export interface StudyData { version: 1; participants: Participant[]; activeParticipantId: string | null; actions: FeedbackAction[] }
export interface StudySummary { participantCount: number; interviewCount: number; atlasAttemptCount: number; completedAtlasCount: number; uploadAttemptCount: number; successfulUploadCount: number; completedSUSCount: number; meanSUS: number | null; feedbackCount: number }
export interface StudySnapshot { schema: 'helpminths-usability-study-v1'; exportedAt: string; purpose: string; susTranslation: string; protocol: { atlasParticipantsTarget: string; uploadImagesTarget: string }; summary: StudySummary; data: StudyData }
export const roleLabels: Record<ParticipantRole, string> = { student: 'นักศึกษา', teacher: 'อาจารย์', laboratory: 'นักเทคนิคการแพทย์ / บุคลากรห้องปฏิบัติการ', other: 'ผู้ใช้งานกลุ่มอื่น' }
export const actionLabels: Record<ActionStatus, string> = { proposed: 'ข้อเสนอ', planned: 'วางแผนแล้ว', implemented: 'ปรับแล้ว', verified: 'ตรวจผลหลังปรับแล้ว' }
export const studyTasks = [
  { id: 'atlas-hnana', kind: 'atlas' as const, title: 'ค้นหาไข่พยาธิตืดแคระ', instruction: 'ค้นหา Hymenolepis nana ใน Atlas เปิดภาพจริงเทียบโมเดล และชี้ตำแหน่ง polar filaments ที่แบบจำลองอธิบาย' },
  { id: 'atlas-strongyloides', kind: 'atlas' as const, title: 'ค้นหา genital primordium', instruction: 'ค้นหาตัวอ่อน Strongyloides ระยะ rhabditiform แล้วเปิดคำอธิบายและขยาย genital primordium' },
  { id: 'atlas-ascaris', kind: 'atlas' as const, title: 'เปรียบเทียบระยะไข่ Ascaris', instruction: 'ค้นหา Ascaris แล้วเปรียบเทียบ fertilized กับ embryonated และบอกความต่างที่เห็น' },
  { id: 'upload-microscopy', kind: 'upload' as const, title: 'อัปโหลดภาพกล้องจุลทรรศน์', instruction: 'เปิดหน้าตรวจวิเคราะห์และเลือกภาพจริงที่มีสิทธิ์ใช้ 5–10 ภาพ โดยไม่มีชื่อหรือข้อมูลผู้ป่วย บันทึกการเตรียมภาพสำเร็จ/ผิดพลาด ไม่ใช้ผลนี้ประเมินความแม่นยำ AI' },
]
export const susQuestions = [
  'ฉันคิดว่าฉันอยากใช้ระบบนี้บ่อย ๆ',
  'ฉันพบว่าระบบนี้ซับซ้อนโดยไม่จำเป็น',
  'ฉันคิดว่าระบบนี้ใช้งานง่าย',
  'ฉันคิดว่าฉันต้องได้รับความช่วยเหลือจากผู้มีความรู้ทางเทคนิคจึงจะใช้ระบบนี้ได้',
  'ฉันพบว่าฟังก์ชันต่าง ๆ ในระบบนี้ทำงานร่วมกันได้ดี',
  'ฉันคิดว่าระบบนี้มีความไม่สอดคล้องกันมากเกินไป',
  'ฉันคิดว่าคนส่วนใหญ่จะเรียนรู้การใช้ระบบนี้ได้อย่างรวดเร็ว',
  'ฉันพบว่าระบบนี้ใช้งานยุ่งยาก',
  'ฉันรู้สึกมั่นใจมากในการใช้ระบบนี้',
  'ฉันต้องเรียนรู้หลายสิ่งก่อนที่จะเริ่มใช้ระบบนี้ได้',
]
export function calculateSUS(answers: readonly (number | null)[]): number | null {
  if (answers.length !== 10 || answers.some(v => v === null || !Number.isInteger(v) || v < 1 || v > 5)) return null
  return answers.reduce<number>((sum, value, index) => sum + (index % 2 === 0 ? value! - 1 : 5 - value!), 0) * 2.5
}
export function summarizeStudy(data: StudyData): StudySummary {
  const tasks = data.participants.flatMap(p => p.tasks)
  const uploads = tasks.flatMap(t => t.uploads)
  const scores = data.participants.filter(p => p.susCompletedAt).map(p => calculateSUS(p.susAnswers)).filter((v): v is number => v !== null)
  return { participantCount: data.participants.length, interviewCount: data.participants.filter(p => p.interview).length, atlasAttemptCount: tasks.filter(t => t.kind === 'atlas' && t.outcome !== 'running' && t.outcome !== 'cancelled').length, completedAtlasCount: tasks.filter(t => t.kind === 'atlas' && t.outcome === 'success').length, uploadAttemptCount: uploads.length, successfulUploadCount: uploads.filter(u => u.success).length, completedSUSCount: scores.length, meanSUS: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null, feedbackCount: data.participants.reduce((sum, p) => sum + p.feedback.length, 0) }
}
export function formatStudyDate(value: string): string { return new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' }).format(new Date(value)) }
export function formatElapsed(milliseconds: number): string { const seconds = Math.max(0, Math.floor(milliseconds / 1000)); return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}` }
