import { Bell, ShieldCheck, ChevronLeft, ChevronRight, LoaderCircle, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { APIError, apiRequest, buildQuery, formatDate } from '../platform/api'
import type { PlatformSession } from '../platform/api'
import '../styles/account.css'

export interface NotificationTarget { analysis_id: string; referral_id: string; message_id: string }
interface CaseNotification extends NotificationTarget {
  id: string
  sample_code: string
  kind: 'reply' | 'request_more' | 'confirmed' | 'review'
  comment: string
  expert_name: string
  created_at: string
  read_at: string | null
}
interface NotificationPage { items: CaseNotification[]; total: number; unread_count: number; limit: number; offset: number }
const notificationTitles = { reply: 'ผู้เชี่ยวชาญตอบกลับ', request_more: 'ผู้เชี่ยวชาญขอภาพเพิ่มเติม', confirmed: 'ผู้เชี่ยวชาญยืนยันผลแล้ว', review: 'มีผลทบทวนจากผู้เชี่ยวชาญ' }

/** Only the signed-in recipient can fetch or mark these case notices as read. */
export default function NotificationMenu({ session, onOpenCase, onOpenQueue }: { session: PlatformSession; onOpenCase: (target: NotificationTarget) => void; onOpenQueue: () => void }) {
  const enabled = session.configured && !!session.user && session.user.approval_status === 'approved' && session.user.active && !session.connection_error
  const identity = `${session.user?.id ?? ''}:${session.user?.role ?? ''}:${session.csrf_token ?? ''}`
  const identityRef = useRef(identity); identityRef.current = identity
  const [open, setOpen] = useState(false), [offset, setOffset] = useState(0)
  const [state, setState] = useState<{ key: string; value: NotificationPage | null; error: string; loading: boolean }>({ key: '', value: null, error: '', loading: false })
  const [reload, setReload] = useState(0)
  // A global unread count is independent of the currently displayed page.
  const [unreadState, setUnreadState] = useState({ identity: '', count: 0 })
  const isExpert = enabled && ['admin', 'reviewer'].includes(session.user!.role)
  const expiry = Date.parse(session.expert_verified_until ?? '')
  const grantKey = `${identity}:${session.expert_verified_until ?? ''}`
  const [lockedGrant, setLockedGrant] = useState('')
  const queueEnabled = isExpert && Number.isFinite(expiry) && expiry > Date.now() && lockedGrant !== grantKey
  const [queueState, setQueueState] = useState<{ key: string; total: number | null; error: string }>({ key: '', total: null, error: '' })
  const pending = queueEnabled && queueState.key === grantKey ? queueState.total ?? 0 : 0
  const queueError = queueEnabled && queueState.key === grantKey ? queueState.error : ''
  const container = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null)
  const writes = useRef(new Set<AbortController>())
  const panelId = useId()
  const key = `${identity}:${offset}`
  const current = enabled && state.key === key ? state : { value: null, error: '', loading: enabled }
  const unread = enabled && unreadState.identity === identity ? unreadState.count : 0
  const alertCount = unread + pending
  const alertSummary = [pending > 0 ? `ภาพรอตรวจ ${pending} ภาพ` : '', unread > 0 ? `คำตอบใหม่ ${unread} รายการ` : ''].filter(Boolean).join(' · ')

  useEffect(() => {
    setOpen(false); setOffset(0)
    return () => { for (const controller of writes.current) controller.abort(); writes.current.clear() }
  }, [identity, enabled])

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    let inFlight = false
    const load = async () => {
      if (inFlight || document.hidden || !navigator.onLine) return
      inFlight = true
      setState(previous => previous.key === key ? { ...previous, loading: !previous.value } : { key, value: null, error: '', loading: true })
      try {
        const value = await apiRequest<NotificationPage>(session, `/notifications${buildQuery({ limit: 20, offset })}`, { signal: controller.signal })
        if (!controller.signal.aborted && identityRef.current === identity) {
          setState({ key, value, error: '', loading: false })
          setUnreadState({ identity, count: value.unread_count })
        }
      } catch (failure) {
        if (!controller.signal.aborted) setState(previous => ({ key, value: previous.key === key ? previous.value : null, error: failure instanceof Error ? failure.message : 'อ่านการแจ้งเตือนไม่ได้', loading: false }))
      } finally { inFlight = false }
    }
    void load()
    const refresh = () => { if (!document.hidden && navigator.onLine) void load() }
    const timer = window.setInterval(refresh, 30_000)
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh); window.addEventListener('online', refresh)
    return () => { controller.abort(); clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); window.removeEventListener('online', refresh) }
  }, [enabled, identity, key, offset, reload])

  useEffect(() => {
    if (!isExpert) return
    const lock = () => {
      setLockedGrant(grantKey)
      setQueueState({ key: grantKey, total: null, error: '' })
    }
    window.addEventListener('helpminths:expert-session-locked', lock)
    const timer = Number.isFinite(expiry) ? window.setTimeout(lock, Math.max(0, expiry - Date.now())) : undefined
    return () => { clearTimeout(timer); window.removeEventListener('helpminths:expert-session-locked', lock) }
  }, [isExpert, expiry, grantKey])

  useEffect(() => {
    if (!queueEnabled) return
    const controller = new AbortController()
    let inFlight = false
    const load = async () => {
      if (inFlight || document.hidden || !navigator.onLine || Date.now() >= expiry) return
      inFlight = true
      try {
        // Fetch only one row and retain only the total. Never use analysis totals,
        // which also include private cases that have not been referred.
        const value = await apiRequest<{ total: number }>(session, `/referrals${buildQuery({ scope: 'expert', state: 'pending', limit: 1, offset: 0 })}`, { signal: controller.signal })
        if (!controller.signal.aborted && identityRef.current === identity && Date.now() < expiry) setQueueState({ key: grantKey, total: value.total, error: '' })
      } catch (failure) {
        if (controller.signal.aborted || identityRef.current !== identity) return
        if (failure instanceof APIError && [401, 403].includes(failure.status)) {
          setLockedGrant(grantKey)
          setQueueState({ key: grantKey, total: null, error: '' })
        } else setQueueState(previous => ({ key: grantKey, total: previous.key === grantKey ? previous.total : null, error: 'อัปเดตจำนวนภาพรอตรวจไม่ได้ กรุณาลองอีกครั้ง' }))
      } finally { inFlight = false }
    }
    const refresh = () => { void load() }
    const lock = () => controller.abort()
    void load()
    const timer = window.setInterval(refresh, 30_000)
    window.addEventListener('focus', refresh); window.addEventListener('online', refresh); document.addEventListener('visibilitychange', refresh)
    window.addEventListener('helpminths:expert-queue-changed', refresh); window.addEventListener('helpminths:expert-session-locked', lock)
    return () => {
      controller.abort(); clearInterval(timer)
      window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh); document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('helpminths:expert-queue-changed', refresh); window.removeEventListener('helpminths:expert-session-locked', lock)
    }
  }, [queueEnabled, identity, grantKey, expiry, reload])

  useEffect(() => {
    if (!open) return
    container.current?.querySelector<HTMLButtonElement>('.notification-popover button')?.focus()
    const outside = (event: Event) => { if (event.target instanceof Node && !container.current?.contains(event.target)) setOpen(false) }
    const keyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus() } }
    document.addEventListener('pointerdown', outside); document.addEventListener('focusin', outside); document.addEventListener('keydown', keyDown)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside); document.removeEventListener('keydown', keyDown) }
  }, [open])

  const choose = (item: CaseNotification) => {
    setOpen(false)
    onOpenCase({ analysis_id: item.analysis_id, referral_id: item.referral_id, message_id: item.message_id })
    if (item.read_at) return
    const controller = new AbortController(), requestedIdentity = identity
    writes.current.add(controller)
    void apiRequest<CaseNotification>(session, `/notifications/${encodeURIComponent(item.id)}/read`, { method: 'POST', signal: controller.signal }).then(() => {
      if (!controller.signal.aborted && identityRef.current === requestedIdentity) setReload(value => value + 1)
    }).catch(failure => {
      if (!controller.signal.aborted && identityRef.current === requestedIdentity) setState(previous => previous.key === key ? { ...previous, error: failure instanceof Error ? failure.message : 'อัปเดตการแจ้งเตือนไม่ได้' } : previous)
    }).finally(() => writes.current.delete(controller))
  }

  if (!enabled) return null
  return <div className="notification-menu" ref={container}>
    <button ref={trigger} className={`notification-trigger icon-button ${alertCount ? 'has-alert' : ''}`} type="button" aria-label={`การแจ้งเตือน${alertSummary ? ` · ${alertSummary}` : ''}`} aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(value => !value)}><Bell className="notification-bell-icon" size={20}/>{alertCount > 0 && <span className="notification-count" aria-hidden="true">{alertCount > 99 ? '99+' : alertCount}</span>}</button>
    <span className="notification-announcement" aria-live="polite" aria-atomic="true">{alertSummary}</span>
    {open && <section className="notification-popover" id={panelId} aria-label="การแจ้งเตือนคำตอบผู้เชี่ยวชาญ">
      <header><div><h2>การแจ้งเตือน</h2><span>{unread ? `ยังไม่อ่าน ${unread} รายการ` : 'คำตอบจากผู้เชี่ยวชาญ'}</span></div><button type="button" className="icon-button" aria-label="ปิดการแจ้งเตือน" onClick={() => { setOpen(false); trigger.current?.focus() }}><X size={18}/></button></header>
      {isExpert && <div className="notification-queue"><p>{!queueEnabled ? 'ยืนยันรหัสผ่านเพื่อดูภาพรอตรวจ' : queueState.key !== grantKey || queueState.total === null ? 'กำลังตรวจจำนวนภาพรอตรวจ…' : pending ? `มีภาพรอตรวจ ${pending} ภาพ` : 'ไม่มีภาพรอตรวจ'}</p><button type="button" onClick={() => { setOpen(false); onOpenQueue() }}><ShieldCheck size={17}/>{queueEnabled ? 'เปิดภาพรอตรวจ' : 'ยืนยันตัวตนผู้เชี่ยวชาญ'}</button>{queueError && <div className="notification-queue-error" role="alert">{queueError}<button type="button" onClick={() => setReload(value => value + 1)}>ลองอีกครั้ง</button></div>}</div>}
      {current.error && <div className="notification-error" role="alert"><span>{current.error}</span><button type="button" onClick={() => setReload(value => value + 1)}>ลองอีกครั้ง</button></div>}
      {current.loading ? <p className="notification-empty" role="status"><LoaderCircle size={18} className="spin"/>กำลังอ่านการแจ้งเตือน…</p> : !current.value?.items.length ? <p className="notification-empty">ยังไม่มีคำตอบใหม่</p> : <ol className="notification-list">{current.value.items.map(item => <li key={item.id}><button type="button" className={`notification-item ${item.read_at ? 'is-read' : 'is-unread'}`} onClick={() => choose(item)}><span className="notification-item-title">{notificationTitles[item.kind]}{!item.read_at && <i aria-label="ยังไม่อ่าน"/>}</span><strong>{item.sample_code || 'ภาพส่งตรวจ'}</strong>{item.comment && <p>{item.comment}</p>}<time dateTime={item.created_at}>{formatDate(item.created_at)}</time></button></li>)}</ol>}
      {!!current.value && current.value.total > 20 && <footer><button type="button" disabled={!offset} onClick={() => setOffset(value => Math.max(0, value - 20))}><ChevronLeft size={17}/>ก่อนหน้า</button><span>{offset + 1}–{Math.min(offset + current.value.items.length, current.value.total)} / {current.value.total}</span><button type="button" disabled={offset + current.value.items.length >= current.value.total} onClick={() => setOffset(value => value + 20)}>ถัดไป<ChevronRight size={17}/></button></footer>}
    </section>}
  </div>
}
