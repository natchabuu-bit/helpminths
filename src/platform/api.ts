import { useCallback, useEffect, useRef, useState } from 'react'

export type PlatformRole = 'admin' | 'reviewer' | 'lab' | 'student'
export interface PlatformUser { id: string; username: string; role: PlatformRole; active: boolean; created_at: string }
export interface PlatformSession { configured: boolean; user: PlatformUser | null; csrf_token: string | null; bootstrap_required?: boolean; connection_error?: string | null }
export interface APIRequestOptions extends RequestInit { json?: unknown; timeoutMs?: number }
export const emptyPlatformSession: PlatformSession = { configured: false, user: null, csrf_token: null }
const sessionExpiredEvent = 'helpminths:session-expired'
export const roleNames: Record<PlatformRole, string> = { admin: 'ผู้ดูแลระบบ', reviewer: 'ผู้ตรวจสอบ', lab: 'ผู้ปฏิบัติงาน', student: 'ผู้เรียน' }
export const statusNames: Record<string, string> = { processing: 'กำลังวิเคราะห์', completed: 'วิเคราะห์แล้ว', failed: 'ไม่สำเร็จ', cancelled: 'ยกเลิก', pending: 'รอทบทวน', not_available: 'ยังไม่มีผลให้ทบทวน', unavailable: 'ยังไม่มีข้อมูล', fail: 'ไม่ผ่านเกณฑ์เบื้องต้น', unreviewed: 'รอทบทวน', in_review: 'กำลังทบทวน', verified: 'ผู้เชี่ยวชาญทบทวนแล้ว', needs_additional_review: 'ขอทบทวนเพิ่มเติม', pass: 'ผ่านเกณฑ์เบื้องต้น', warning: 'มีข้อจำกัด', submitted: 'รับข้อเสนอแนะแล้ว', open: 'รอพิจารณา', verified_error: 'ยืนยันข้อผิดพลาดแล้ว', resolved: 'ดำเนินการแล้ว', rejected: 'ไม่ยืนยันข้อเสนอแนะ' }
export function labelStatus(value?: string | null) { return value ? statusNames[value] ?? value : 'ยังไม่มีข้อมูล' }
function detailMessage(detail: unknown): string {
  if (typeof detail === 'string' && detail.trim()) return detail
  if (Array.isArray(detail)) return detail.map(item => item && typeof item === 'object' && 'msg' in item ? String(item.msg) : '').filter(Boolean).join(' · ') || 'ข้อมูลที่ส่งไม่ถูกต้อง'
  if (detail && typeof detail === 'object' && 'message' in detail) return String(detail.message)
  return 'ไม่สามารถดำเนินการได้ กรุณาลองอีกครั้ง'
}
export class APIError extends Error {
  status: number
  detail: unknown
  constructor(status: number, detail: unknown) { super(detailMessage(detail)); this.name = 'APIError'; this.status = status; this.detail = detail }
}
export function apiPath(path: string) {
  const value = path.startsWith('/api/platform') ? path : `/api/platform/${path.replace(/^\/+/, '')}`
  if (!/^\/api\/platform(?:\/|\?|$)/.test(value) || value.includes('://')) throw new APIError(400, 'ปลายทาง API ไม่ถูกต้อง')
  return value
}
async function requestResponse(path: string, options: APIRequestOptions, session?: PlatformSession): Promise<Response> {
  const { json, timeoutMs = 30000, ...input } = options
  const controller = new AbortController()
  const abort = () => controller.abort(input.signal?.reason)
  if (input.signal?.aborted) abort(); else input.signal?.addEventListener('abort', abort, { once: true })
  const timer = window.setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), timeoutMs)
  const headers = new Headers(input.headers)
  const method = (input.method ?? (json !== undefined ? 'POST' : 'GET')).toUpperCase()
  if (json !== undefined) headers.set('Content-Type', 'application/json')
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && session?.csrf_token) headers.set('X-CSRF-Token', session.csrf_token)
  try {
    const endpoint = apiPath(path)
    const response = await fetch(endpoint, { ...input, method, headers, body: json !== undefined ? JSON.stringify(json) : input.body, credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
    if (!response.ok) {
      // A rejected password is not an expired session. Other 401 responses must
      // promptly remove private views, including when the cookie expired remotely.
      if (response.status === 401 && endpoint.split('?')[0] !== '/api/platform/login') window.dispatchEvent(new CustomEvent(sessionExpiredEvent, { detail: { userId: session?.user?.id ?? null } }))
      let detail: unknown = `บริการตอบกลับด้วยสถานะ ${response.status}`
      try { const value = await response.json(); detail = value.detail ?? value.message ?? detail } catch { /* non-JSON response is not a successful API result */ }
      throw new APIError(response.status, detail)
    }
    return response
  } catch (error) {
    if (error instanceof APIError) throw error
    if (controller.signal.aborted) throw new APIError(408, input.signal?.aborted ? 'ยกเลิกคำขอแล้ว' : 'บริการใช้เวลานานเกินไป กรุณาลองอีกครั้ง')
    throw new APIError(0, 'เชื่อมต่อบริการไม่ได้ โปรดตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง')
  } finally { clearTimeout(timer); input.signal?.removeEventListener('abort', abort) }
}
export function apiRequest<T>(session: PlatformSession, path: string, options?: APIRequestOptions): Promise<T>
export function apiRequest<T>(path: string, options?: APIRequestOptions, session?: PlatformSession): Promise<T>
export async function apiRequest<T>(first: PlatformSession | string, second?: string | APIRequestOptions, third?: APIRequestOptions | PlatformSession): Promise<T> {
  const path = typeof first === 'string' ? first : second as string
  const options = (typeof first === 'string' ? second : third) as APIRequestOptions | undefined
  const session = (typeof first === 'string' ? third : first) as PlatformSession | undefined
  const response = await requestResponse(path, options ?? {}, session)
  if (response.status === 204) return undefined as T
  if (!response.headers.get('content-type')?.includes('json')) throw new APIError(502, 'บริการส่งข้อมูลในรูปแบบที่อ่านไม่ได้')
  return response.json() as Promise<T>
}
export async function downloadAPI(path: string, filename: string, session: PlatformSession, options: APIRequestOptions = {}) {
  const response = await requestResponse(path, { timeoutMs: 90000, ...options }, session)
  const blob = await response.blob()
  if (!blob.size) throw new APIError(502, 'ไฟล์ที่ได้รับว่างเปล่า')
  const url = URL.createObjectURL(blob), link = document.createElement('a')
  link.href = url; link.download = filename.replace(/[^A-Za-z0-9_.-]/g, '_'); document.body.appendChild(link); link.click(); link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 30000)
}
export function buildQuery(values: Record<string, string | number | boolean | null | undefined>) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== null && value !== '') params.set(key, String(value))
  return params.size ? `?${params}` : ''
}
export function usePlatformSession() {
  const [session, setSession] = useState<PlatformSession>(emptyPlatformSession)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const latestSession = useRef(session)
  latestSession.current = session
  const requestVersion = useRef(0)
  const refresh = useCallback(async () => {
    const version = ++requestVersion.current
    setLoading(true)
    try { const value = await apiRequest<PlatformSession>('/session'); if (requestVersion.current === version) { setSession({ ...value, connection_error: null }); setError('') } }
    catch (failure) { if (requestVersion.current === version) { const message = failure instanceof Error ? failure.message : 'อ่านสถานะบัญชีไม่ได้'; setError(message); setSession({ ...emptyPlatformSession, connection_error: message }) } }
    finally { if (requestVersion.current === version) setLoading(false) }
  }, [])
  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    const expired = (event: Event) => {
      const userId = (event as CustomEvent<{ userId: string | null }>).detail?.userId
      if (userId && latestSession.current.user?.id !== userId) return
      setSession(previous => ({ ...previous, user: null, csrf_token: null }))
      setError('เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง')
      void refresh()
    }
    window.addEventListener(sessionExpiredEvent, expired)
    return () => { window.removeEventListener(sessionExpiredEvent, expired); requestVersion.current += 1 }
  }, [refresh])
  const login = async (username: string, password: string) => {
    const version = ++requestVersion.current
    try { const value = await apiRequest<PlatformSession>('/login', { json: { username, password } }); if (requestVersion.current === version) { setSession({ ...value, connection_error: null }); setError(''); setLoading(false) } }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'เข้าสู่ระบบไม่ได้'); throw failure }
  }
  const logout = async () => { await apiRequest(session, '/logout', { method: 'POST' }); await refresh() }
  return { session, loading, error, refresh, login, logout }
}

export interface PlatformDetection { id: string | number; class_id: number; label: string; confidence: number; bbox: [number, number, number, number] }
export interface QualityCheck { id?: string; key?: string; name?: string; label?: string; status: string; message?: string; description?: string; value?: number | string }
export interface QualityAssessment { status: string; checks: QualityCheck[]; assessment_type?: string; metrics?: Record<string, number>; thresholds?: Record<string, number>; can_override?: boolean; disclaimer?: string; message?: string }
export interface AnalysisCounts { predicted_total: number; by_predicted_class: Record<string, number>; confirmed_total: number; by_confirmed_class: Record<string, number>; uncertain_total: number; reviewed_original_objects: number; unreviewed_original_objects: number; false_positive_total: number; missed_detection_total: number }
export interface ReviewAnnotation { detection_id?: string | number; action: string; label?: string; corrected_label?: string; bbox?: [number, number, number, number]; comment?: string }
export interface ExpertReview { id?: string; reviewer_id?: string; created_at?: string; status: string; comment?: string; comments?: string; annotations: ReviewAnnotation[]; full_image_reviewed?: boolean }
export interface PlatformAnalysis { id: string; owner_id?: string; sample_code: string; site_code?: string; filename?: string; width: number; height: number; status: string; review_status?: string; created_at: string; updated_at?: string; revision: number; model?: string; model_version?: string | null; duration_ms?: number | null; inference_ms?: number | null; detections: PlatformDetection[]; quality?: QualityAssessment; counts?: AnalysisCounts; latest_review?: ExpertReview | null; error?: string; error_message?: string | null; error_code?: string | null; image_url?: string | null; confidence_threshold?: number }
export interface Paged<T> { items: T[]; total: number; limit: number; offset: number }
export function imageURL(id: string) { return apiPath(`/analyses/${encodeURIComponent(id)}/image`) }
export function formatDate(value?: string | null) { if (!value || !Number.isFinite(Date.parse(value))) return 'ไม่ระบุ'; return new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' }).format(new Date(value)) }
