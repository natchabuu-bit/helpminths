import { Bell, ChevronLeft, ChevronRight, LoaderCircle, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { apiRequest, buildQuery, formatDate } from '../platform/api'
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
export default function NotificationMenu({ session, onOpenCase }: { session: PlatformSession; onOpenCase: (target: NotificationTarget) => void }) {
  const enabled = session.configured && !!session.user && session.user.approval_status === 'approved'
  const identity = `${session.user?.id ?? ''}:${session.csrf_token ?? ''}`
  const identityRef = useRef(identity); identityRef.current = identity
  const [open, setOpen] = useState(false), [offset, setOffset] = useState(0)
  const [state, setState] = useState<{ key: string; value: NotificationPage | null; error: string; loading: boolean }>({ key: '', value: null, error: '', loading: false })
  const [reload, setReload] = useState(0)
  const container = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null)
  const writes = useRef(new Set<AbortController>())
  const panelId = useId()
  const key = `${identity}:${offset}`
  const current = enabled && state.key === key ? state : { value: null, error: '', loading: enabled }
  const unread = current.value?.unread_count ?? 0

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
        if (!controller.signal.aborted) setState({ key, value, error: '', loading: false })
      } catch (failure) {
        if (!controller.signal.aborted) setState(previous => ({ key, value: previous.key === key ? previous.value : null, error: failure instanceof Error ? failure.message : 'อ่านการแจ้งเตือนไม่ได้', loading: false }))
      } finally { inFlight = false }
    }
    void load()
    const refresh = () => { if (!document.hidden && navigator.onLine) void load() }
    const timer = window.setInterval(refresh, 30_000)
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh)
    return () => { controller.abort(); clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh) }
  }, [enabled, identity, key, offset, reload])

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
    <button ref={trigger} className="notification-trigger icon-button" type="button" aria-label={`การแจ้งเตือน${unread ? ` · ยังไม่อ่าน ${unread} รายการ` : ''}`} aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(value => !value)}><Bell size={20}/>{unread > 0 && <span className="notification-count" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}</button>
    {open && <section className="notification-popover" id={panelId} aria-label="การแจ้งเตือนคำตอบผู้เชี่ยวชาญ">
      <header><div><h2>การแจ้งเตือน</h2><span>{unread ? `ยังไม่อ่าน ${unread} รายการ` : 'คำตอบจากผู้เชี่ยวชาญ'}</span></div><button type="button" className="icon-button" aria-label="ปิดการแจ้งเตือน" onClick={() => { setOpen(false); trigger.current?.focus() }}><X size={18}/></button></header>
      {current.error && <div className="notification-error" role="alert"><span>{current.error}</span><button type="button" onClick={() => setReload(value => value + 1)}>ลองอีกครั้ง</button></div>}
      {current.loading ? <p className="notification-empty" role="status"><LoaderCircle size={18} className="spin"/>กำลังอ่านการแจ้งเตือน…</p> : !current.value?.items.length ? <p className="notification-empty">ยังไม่มีคำตอบใหม่</p> : <ol className="notification-list">{current.value.items.map(item => <li key={item.id}><button type="button" className={`notification-item ${item.read_at ? 'is-read' : 'is-unread'}`} onClick={() => choose(item)}><span className="notification-item-title">{notificationTitles[item.kind]}{!item.read_at && <i aria-label="ยังไม่อ่าน"/>}</span><strong>{item.sample_code || 'ภาพส่งตรวจ'}</strong>{item.comment && <p>{item.comment}</p>}<time dateTime={item.created_at}>{formatDate(item.created_at)}</time></button></li>)}</ol>}
      {!!current.value && current.value.total > 20 && <footer><button type="button" disabled={!offset} onClick={() => setOffset(value => Math.max(0, value - 20))}><ChevronLeft size={17}/>ก่อนหน้า</button><span>{offset + 1}–{Math.min(offset + current.value.items.length, current.value.total)} / {current.value.total}</span><button type="button" disabled={offset + current.value.items.length >= current.value.total} onClick={() => setOffset(value => value + 20)}>ถัดไป<ChevronRight size={17}/></button></footer>}
    </section>}
  </div>
}
