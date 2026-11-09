import { useEffect, useId, useRef, useState } from 'react'
import { ChevronDown, LogIn, LogOut, Settings, UserRound } from 'lucide-react'
import { roleNames } from '../platform/api'
import type { PlatformSession } from '../platform/api'
import '../styles/account-menu.css'

export default function AccountMenu({ session, onSettings, onLogout }: { session: PlatformSession; onSettings: () => void; onLogout: () => Promise<void> }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const container = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null)
  const id = useId(), user = session.user
  const name = user?.full_name || user?.username || 'ผู้เยี่ยมชม'
  const role = user ? (user.is_super_admin ? 'Super Admin' : roleNames[user.role]) : 'ยังไม่ได้เข้าสู่ระบบ'
  useEffect(() => { setOpen(false); setError('') }, [user?.id])
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => { if (!container.current?.contains(event.target as Node)) setOpen(false) }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); trigger.current?.focus() }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', key) }
  }, [open])
  const settings = () => { setOpen(false); onSettings() }
  const logout = async () => {
    setBusy(true); setError('')
    try { await onLogout(); setOpen(false) }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'ออกจากระบบไม่ได้ กรุณาลองอีกครั้ง') }
    finally { setBusy(false) }
  }
  return <div className="account-menu" ref={container} onBlur={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false) }}>
    <button ref={trigger} type="button" className="topbar-account" aria-label={user ? 'บัญชีของฉัน' : 'เข้าสู่ระบบหรือสมัครสมาชิก'} aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>
      {user ? <UserRound size={18}/> : <LogIn size={18}/>}<span>{user ? 'บัญชีของฉัน' : 'เข้าสู่ระบบ'}</span><ChevronDown size={14}/>
    </button>
    {open && <section className="account-dropdown" id={id} aria-label="เมนูบัญชี">
      <div className="account-dropdown-identity"><strong>{name}</strong><span>{role}{user?.approval_status === 'approved' ? ' · อนุมัติแล้ว' : ''}</span></div>
      <button type="button" onClick={settings}><Settings size={18}/><span>ตั้งค่า</span></button>
      {!user && <button type="button" onClick={settings}><LogIn size={18}/><span>เข้าสู่ระบบ / สมัครสมาชิก</span></button>}
      {user && <button type="button" className="account-dropdown-logout" onClick={() => void logout()} disabled={busy}><LogOut size={18}/><span>{busy ? 'กำลังออกจากระบบ…' : 'ออกจากระบบ'}</span></button>}
      {error && <p role="alert">{error}</p>}
    </section>}
  </div>
}
