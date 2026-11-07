import { CheckCircle2, Database, LogIn, LogOut, RefreshCw, Save, ShieldCheck, UserPlus, Users } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { apiRequest, formatDate } from '../platform/api'
import type { Paged, PlatformRole, PlatformSession, PlatformUser } from '../platform/api'
import { ConfirmDialog, ErrorNotice, LoadingNotice, PlatformHeading, usePlatformResource } from './PlatformShared'
import PasswordInput from './PasswordInput'
import '../styles/account.css'

const USERNAME_PATTERN = '[A-Za-z0-9][A-Za-z0-9_.\\-]*'
type AccountTab = 'login' | 'register' | 'adminSetup'
export default function PlatformSettings({ session, onSessionChanged }: { session: PlatformSession; onSessionChanged?: () => Promise<void> }) {
  const [username, setUsername] = useState(''), [password, setPassword] = useState(''), [passwordConfirm, setPasswordConfirm] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [accountTab, setAccountTab] = useState<AccountTab>('login'), [setupToken, setSetupToken] = useState('')
  const [rechecking, setRechecking] = useState(false)
  const loginTab = useRef<HTMLButtonElement>(null), registerTab = useRef<HTMLButtonElement>(null), adminSetupTab = useRef<HTMLButtonElement>(null)
  const sessionRefresh = useRef(onSessionChanged)
  sessionRefresh.current = onSessionChanged
  // The parent session may have been read while the backend was starting.
  // Reopening Settings must obtain actual current readiness, not retain false.
  useEffect(() => {
    if (!sessionRefresh.current) return
    let active = true
    setRechecking(true)
    void sessionRefresh.current().catch(failure => { if (active) setError(failure instanceof Error ? failure.message : 'ตรวจสอบบัญชีไม่ได้') }).finally(() => { if (active) setRechecking(false) })
    return () => { active = false }
  }, [])
  const refresh = async () => { if (onSessionChanged) await onSessionChanged(); else window.location.reload() }
  const recheck = async () => {
    setRechecking(true); setError('')
    try { await refresh() }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'ตรวจสอบระบบบัญชีไม่ได้') }
    finally { setRechecking(false) }
  }
  const changeTab = (tab: AccountTab) => { setAccountTab(tab); setPassword(''); setPasswordConfirm(''); setSetupToken(''); setError(''); setNotice('') }
  const tabKeys = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const tabs: AccountTab[] = session.admin_setup_available ? ['login', 'register', 'adminSetup'] : ['login', 'register']
    const current = Math.max(0, tabs.indexOf(accountTab))
    const next = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[tabs.length - 1] : tabs[(current + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]
    changeTab(next)
    const nextTab = next === 'login' ? loginTab : next === 'register' ? registerTab : adminSetupTab
    nextTab.current?.focus()
  }
  const authenticate = async () => {
    if (accountTab !== 'login' && password !== passwordConfirm) { setError('รหัสผ่านและการยืนยันรหัสผ่านไม่ตรงกัน'); return }
    setBusy(true); setError(''); setNotice('')
    try {
      const endpoint = accountTab === 'register' ? '/register' : accountTab === 'adminSetup' ? '/admin-setup' : '/login'
      await apiRequest(endpoint, { json: { username: username.trim(), password, ...(accountTab === 'adminSetup' ? { setup_token: setupToken } : {}) } })
      setPassword(''); setPasswordConfirm(''); setSetupToken('')
      await refresh()
      setNotice(accountTab === 'register' ? 'สมัครสมาชิกและเข้าสู่ระบบแล้ว' : accountTab === 'adminSetup' ? 'สร้างบัญชีผู้ดูแลและเข้าสู่ระบบแล้ว' : 'เข้าสู่ระบบแล้ว')
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'ดำเนินการเกี่ยวกับบัญชีไม่ได้') }
    finally { setBusy(false) }
  }
  const logout = async () => { setBusy(true); setError(''); try { await apiRequest(session, '/logout', { method: 'POST' }); await refresh(); setNotice('ออกจากระบบแล้ว') } catch (failure) { setError(failure instanceof Error ? failure.message : 'ออกจากระบบไม่ได้') } finally { setBusy(false) } }
  const accountReady = session.configured && !session.connection_error
  const registrationUnavailable = !accountReady || session.registration_enabled === false
  const creatingAccount = accountTab !== 'login'
  const adminSetup = accountTab === 'adminSetup'
  const authUnavailable = !accountReady || (accountTab === 'register' && registrationUnavailable) || (adminSetup && !session.admin_setup_available)
  const checkingConnection = !accountReady && rechecking
  return <div className="platform-page account-page"><PlatformHeading kicker="SETTINGS & ACCESS" title="ตั้งค่าและบัญชีผู้ใช้" description="สมัครสมาชิก เข้าสู่ระบบ และเปลี่ยนชื่อบัญชีหรือรหัสผ่านของคุณได้ที่นี่"/>
    {error && <ErrorNotice message={error}/>} {notice && <p className="platform-notice" role="status">{notice}</p>}
    <section className={`account-readiness ${accountReady ? 'is-ready' : 'is-unavailable'}`} aria-label="ความพร้อมระบบบัญชี"><div className="account-readiness-main">{accountReady ? <CheckCircle2 size={23}/> : <Database size={23}/>}<div><h2>{accountReady ? 'ระบบบัญชีพร้อมใช้งาน' : checkingConnection ? 'กำลังตรวจสอบระบบบัญชี…' : 'ยังเชื่อมต่อระบบบัญชีไม่ได้'}</h2><p>{accountReady ? session.user ? 'เข้าสู่ระบบแล้ว ประวัติผลตรวจและภาพส่งต่อจะผูกกับบัญชีของคุณ' : 'สมัครสมาชิกหรือเข้าสู่ระบบจากหน้านี้ เพื่อบันทึกผลตรวจและติดตามภาพที่ส่งต่อได้' : 'ตรวจสอบการเชื่อมต่ออีกครั้งเมื่อเซิร์ฟเวอร์พร้อม แบบฟอร์มจะเปิดใช้ตามสถานะจริงของบริการ'}</p></div></div><button className="platform-button" disabled={busy || rechecking} onClick={() => void recheck()}><RefreshCw size={16} className={rechecking ? 'spin' : ''}/>{rechecking ? 'กำลังตรวจสอบ…' : 'ตรวจสอบระบบอีกครั้ง'}</button></section>
    <section className="platform-card account-access-card" aria-labelledby="account-access-title"><div className="platform-card-heading"><h2 id="account-access-title">{session.user ? 'บัญชีปัจจุบัน' : 'เข้าใช้งาน HelpMinths'}</h2></div>{session.user ? <><div className="platform-definition-grid"><div><span>บัญชี</span><strong>{session.user.username}</strong></div><div><span>บทบาท</span><strong>{accountRoleNames[session.user.role]}</strong></div></div><div className="account-current-actions"><p>ประวัติผลตรวจและภาพส่งต่อจะผูกกับบัญชีนี้</p><button className="platform-button" disabled={busy} onClick={() => void logout()}><LogOut size={17}/>ออกจากระบบ</button></div></> : <>
      <div className={`account-tabs ${session.admin_setup_available ? 'has-admin-setup' : ''}`} role="tablist" aria-label="การเข้าใช้บัญชี"><button ref={loginTab} id="account-login-tab" role="tab" aria-selected={accountTab === 'login'} aria-controls="account-auth-panel" tabIndex={accountTab === 'login' ? 0 : -1} onClick={() => changeTab('login')} onKeyDown={tabKeys}><LogIn size={17}/>เข้าสู่ระบบ</button><button ref={registerTab} id="account-register-tab" role="tab" aria-selected={accountTab === 'register'} aria-controls="account-auth-panel" tabIndex={accountTab === 'register' ? 0 : -1} onClick={() => changeTab('register')} onKeyDown={tabKeys}><UserPlus size={17}/>สมัครสมาชิก</button>{session.admin_setup_available && <button ref={adminSetupTab} id="account-admin-setup-tab" role="tab" aria-selected={adminSetup} aria-controls="account-auth-panel" tabIndex={adminSetup ? 0 : -1} onClick={() => changeTab('adminSetup')} onKeyDown={tabKeys}><ShieldCheck size={17}/>ตั้งค่าผู้ดูแลครั้งแรก</button>}</div>
      <div id="account-auth-panel" role="tabpanel" aria-labelledby={accountTab === 'login' ? 'account-login-tab' : adminSetup ? 'account-admin-setup-tab' : 'account-register-tab'}><p className="account-form-intro">{accountTab === 'register' ? 'ตั้งชื่อบัญชีและรหัสผ่านของคุณเพื่อเก็บประวัติผลตรวจ และส่งภาพให้ผู้เชี่ยวชาญทบทวน' : adminSetup ? 'สำหรับเจ้าของระบบที่มีรหัสตั้งค่าจากโฮสต์ สร้างบัญชีผู้ดูแลเพื่อจัดการสมาชิกและอนุมัติสิทธิ์ผู้เชี่ยวชาญ' : 'ใช้ชื่อบัญชีและรหัสผ่านของคุณ เพื่อเปิดประวัติผลตรวจและภาพที่ส่งต่อไว้'}</p><form className={`account-auth-form ${creatingAccount ? 'account-register-form' : ''}`} onSubmit={event => { event.preventDefault(); void authenticate() }}>
        {adminSetup && <label className="account-setup-token">รหัสตั้งค่าผู้ดูแล<PasswordInput aria-label="รหัสตั้งค่าผู้ดูแล" toggleLabel="รหัสตั้งค่าผู้ดูแล" required value={setupToken} onChange={event => setSetupToken(event.target.value)} maxLength={256} autoComplete="off" autoCapitalize="none" spellCheck={false} disabled={authUnavailable || busy}/><small>ใช้รหัสที่เจ้าของระบบกำหนดบนโฮสต์ ช่องนี้ไม่ใช่รหัสผ่านของบัญชีใหม่</small></label>}
        <label>ชื่อบัญชี<input required value={username} onChange={event => setUsername(event.target.value)} pattern={creatingAccount ? USERNAME_PATTERN : undefined} title={creatingAccount ? 'ใช้ภาษาอังกฤษ ตัวเลข จุด ขีดกลาง หรือขีดล่าง และเริ่มด้วยตัวอักษรหรือตัวเลข' : undefined} autoComplete="username" autoCapitalize="none" spellCheck={false} disabled={!accountReady || busy}/></label>
        <label>รหัสผ่าน<PasswordInput key={`${accountTab}-password`} aria-label="รหัสผ่าน" required value={password} onChange={event => setPassword(event.target.value)} minLength={creatingAccount ? 4 : undefined} maxLength={256} autoComplete={creatingAccount ? 'new-password' : 'current-password'} disabled={!accountReady || busy}/></label>
        {creatingAccount && <label>ยืนยันรหัสผ่าน<PasswordInput key={`${accountTab}-confirmation`} aria-label="ยืนยันรหัสผ่าน" toggleLabel="รหัสผ่านยืนยัน" required value={passwordConfirm} onChange={event => setPasswordConfirm(event.target.value)} minLength={4} maxLength={256} autoComplete="new-password" disabled={authUnavailable || busy}/></label>}
        <button className="platform-button primary" type="submit" disabled={authUnavailable || busy}>{creatingAccount ? <UserPlus size={17}/> : <LogIn size={17}/>} {busy ? 'กำลังดำเนินการ…' : accountTab === 'register' ? 'สร้างบัญชีและเข้าใช้งาน' : adminSetup ? 'สร้างบัญชีผู้ดูแล' : 'เข้าสู่ระบบ'}</button>
      </form>{accountTab === 'register' && <div className="account-registration-note"><ShieldCheck size={18}/><p>ชื่อบัญชีใช้ภาษาอังกฤษ ตัวเลข จุด ขีดกลาง หรือขีดล่าง และเริ่มด้วยตัวอักษรหรือตัวเลข รหัสผ่านอย่างน้อย 4 ตัวอักษร</p></div>}{adminSetup && <div className="account-registration-note"><ShieldCheck size={18}/><p>กำหนดรหัสผ่านบัญชีใหม่อย่างน้อย 4 ตัวอักษร การตั้งค่านี้ทำได้ก่อนมีผู้ดูแลคนแรกเท่านั้น ระบบไม่ใช้รหัสตั้งค่าผู้ดูแลแทนรหัสผ่านเข้าสู่ระบบ</p></div>}{!accountReady && <p className="platform-muted">{checkingConnection ? 'กำลังเชื่อมต่อบริการบัญชี กรุณารอสักครู่' : 'บริการบัญชียังไม่ตอบกลับ กดตรวจสอบระบบอีกครั้งหรือลองโหลดหน้าใหม่'}</p>}{session.configured && accountTab === 'register' && session.registration_enabled === false && <p className="platform-muted">ระบบยังไม่เปิดรับสมัครสมาชิก กรุณาติดต่อผู้ดูแล</p>}</div>
    </>}</section>
    {session.user && <AccountPreferences key={session.user.id} session={session} onSaved={refresh}/>}
    {session.configured && session.user?.role === 'admin' && <UserManagement session={session} onSessionChanged={onSessionChanged}/>}
    <section className="platform-card"><div className="platform-card-heading"><h2>สิทธิ์และการเก็บข้อมูล</h2><ShieldCheck size={24}/></div><ul className="platform-policy-list"><li><strong>ผู้ใช้ทั่วไป:</strong> ตรวจภาพ ดูประวัติของตนเอง และติดตามคำตอบจากภาพที่ส่งให้ผู้เชี่ยวชาญ</li><li><strong>ผู้เชี่ยวชาญ:</strong> ผู้ดูแลอนุมัติสิทธิ์ก่อน และต้องยืนยันรหัสผ่านอีกครั้งเพื่อเปิดคลังภาพส่งต่อและยืนยันผล</li><li><strong>ผู้ดูแล:</strong> จัดการบัญชีและอนุมัติสิทธิ์ผู้เชี่ยวชาญตามนโยบาย</li><li><strong>บัญชีอ่านอย่างเดียว:</strong> อ่าน Atlas และเนื้อหาอ้างอิง สิทธิ์เดิมไม่เปลี่ยนอัตโนมัติ</li></ul><p className="platform-muted">ภาพที่บันทึกเข้าสู่ระบบอยู่ภายใต้สิทธิ์บัญชี การลบภาพไม่ลบประวัติการดำเนินการที่จำเป็น ไม่ควรใส่ชื่อหรือข้อมูลระบุตัวผู้ป่วยในรหัสตัวอย่าง</p></section>
  </div>
}
const accountRoleNames: Record<PlatformRole, string> = { admin: 'ผู้ดูแลระบบ', reviewer: 'ผู้เชี่ยวชาญ', lab: 'ผู้ใช้ทั่วไป', student: 'อ่านอย่างเดียว' }

function AccountPreferences({ session, onSaved }: { session: PlatformSession; onSaved: () => Promise<void> }) {
  const [username, setUsername] = useState(session.user?.username ?? ''), [currentPassword, setCurrentPassword] = useState(''), [password, setPassword] = useState(''), [passwordConfirm, setPasswordConfirm] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const changed = username.trim() !== session.user?.username || password !== ''
  const save = async () => {
    if (!changed) return
    if (password && password !== passwordConfirm) { setError('รหัสผ่านใหม่และการยืนยันรหัสผ่านไม่ตรงกัน'); return }
    setBusy(true); setError(''); setNotice('')
    try {
      await apiRequest(session, '/account', { method: 'PATCH', json: { current_password: currentPassword, ...(username.trim() !== session.user?.username ? { username: username.trim() } : {}), ...(password ? { new_password: password } : {}) } })
      setCurrentPassword(''); setPassword(''); setPasswordConfirm('')
      await onSaved()
      setNotice('บันทึกบัญชีแล้ว เซสชันเดิมถูกยกเลิก กรุณาใช้ชื่อบัญชีและรหัสผ่านล่าสุดในอุปกรณ์อื่น')
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'บันทึกการตั้งค่าบัญชีไม่ได้') }
    finally { setBusy(false) }
  }
  return <section className="platform-card account-preferences" aria-labelledby="account-preferences-title"><div className="platform-card-heading"><div><h2 id="account-preferences-title">เปลี่ยนชื่อบัญชีและรหัสผ่าน</h2><p>ยืนยันรหัสผ่านปัจจุบันก่อนบันทึก เว้นรหัสผ่านใหม่ไว้หากต้องการเปลี่ยนเฉพาะชื่อบัญชี</p></div></div>{error && <ErrorNotice message={error}/>} {notice && <p className="platform-notice" role="status">{notice}</p>}<form onSubmit={event => { event.preventDefault(); void save() }}><div className="platform-form-grid"><label>ชื่อบัญชีที่ต้องการใช้<input required value={username} onChange={event => setUsername(event.target.value)} pattern={USERNAME_PATTERN} autoComplete="username" autoCapitalize="none" spellCheck={false} disabled={busy}/></label><label>รหัสผ่านปัจจุบัน<PasswordInput aria-label="รหัสผ่านปัจจุบัน" toggleLabel="รหัสผ่านปัจจุบัน" required value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} maxLength={256} autoComplete="current-password" disabled={busy}/></label><label>รหัสผ่านใหม่ (เว้นว่างหากไม่เปลี่ยน)<PasswordInput aria-label="รหัสผ่านใหม่ (เว้นว่างหากไม่เปลี่ยน)" toggleLabel="รหัสผ่านใหม่" value={password} onChange={event => setPassword(event.target.value)} minLength={4} maxLength={256} autoComplete="new-password" disabled={busy}/></label><label>ยืนยันรหัสผ่านใหม่<PasswordInput aria-label="ยืนยันรหัสผ่านใหม่" toggleLabel="รหัสผ่านใหม่ที่ยืนยัน" required={password !== ''} value={passwordConfirm} onChange={event => setPasswordConfirm(event.target.value)} minLength={password ? 4 : undefined} maxLength={256} autoComplete="new-password" disabled={busy}/></label></div><p className="platform-muted">ใช้รหัสผ่านอย่างน้อย 4 ตัวอักษร การเปลี่ยนบัญชีจะยกเลิกการเข้าสู่ระบบเดิม รวมถึงการยืนยันสิทธิ์ผู้เชี่ยวชาญ</p><button className="platform-button primary" disabled={busy || !changed}><Save size={17}/>{busy ? 'กำลังบันทึก…' : 'บันทึกบัญชีของฉัน'}</button></form></section>
}
function UserManagement({ session, onSessionChanged }: { session: PlatformSession; onSessionChanged?: () => Promise<void> }) {
  const users = usePlatformResource<Paged<PlatformUser>>('/users?limit=100&offset=0', session, true)
  const [username, setUsername] = useState(''), [password, setPassword] = useState(''), [role, setRole] = useState<PlatformRole>('lab'), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const create = async () => { setBusy(true); setError(''); setNotice(''); try { await apiRequest(session, '/users', { json: { username: username.trim(), password, role } }); setUsername(''); setPassword(''); setNotice('สร้างบัญชีแล้ว ไม่มีการส่งรหัสผ่านออกทางอีเมลอัตโนมัติ'); users.reload() } catch (failure) { setError(failure instanceof Error ? failure.message : 'สร้างบัญชีไม่ได้') } finally { setBusy(false) } }
  return <section className="platform-card"><div className="platform-card-heading"><h2>จัดการผู้ใช้</h2><Users size={24}/></div>{error && <ErrorNotice message={error}/>} {notice && <p className="platform-notice" role="status">{notice}</p>}<form onSubmit={event => { event.preventDefault(); void create() }}><div className="platform-form-grid"><label>ชื่อบัญชีใหม่<input required value={username} onChange={event => setUsername(event.target.value)} autoComplete="off" pattern={USERNAME_PATTERN}/></label><label>รหัสผ่านใหม่ (อย่างน้อย 4 ตัว)<PasswordInput aria-label="รหัสผ่านใหม่ (อย่างน้อย 4 ตัว)" toggleLabel="รหัสผ่านใหม่" required minLength={4} maxLength={256} value={password} onChange={event => setPassword(event.target.value)} autoComplete="new-password"/></label><label>บทบาท<select value={role} onChange={event => setRole(event.target.value as PlatformRole)}>{Object.entries(accountRoleNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div><button className="platform-button primary" disabled={busy}>สร้างบัญชี</button></form>
    <h3>บัญชีในระบบ</h3>{users.loading ? <LoadingNotice/> : users.error ? <ErrorNotice message={users.error} onRetry={users.reload}/> : <div className="platform-user-list">{users.value?.items.map(user => <UserEntry key={user.id + ':' + user.role + ':' + user.active} user={user} session={session} onSaved={async () => { users.reload(); if (user.id === session.user?.id) await onSessionChanged?.() }}/>)}</div>}
  </section>
}
function UserEntry({ user, session, onSaved }: { user: PlatformUser; session: PlatformSession; onSaved: () => Promise<void> }) {
  const [role, setRole] = useState(user.role), [active, setActive] = useState(user.active), [password, setPassword] = useState(''), [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const save = async () => { setBusy(true); setError(''); try { await apiRequest(session, `/users/${encodeURIComponent(user.id)}`, { method: 'PATCH', json: { role, active, ...(password ? { password } : {}) } }); setPassword(''); setConfirm(false); await onSaved() } catch (failure) { setError(failure instanceof Error ? failure.message : 'แก้ไขบัญชีไม่ได้'); setConfirm(false) } finally { setBusy(false) } }
  return <article className="platform-user-entry"><div><strong>{user.username}</strong><p>{user.id} · สร้าง {formatDate(user.created_at)}</p></div><div className="platform-form-grid"><label>บทบาทของ {user.username}<select value={role} onChange={event => setRole(event.target.value as PlatformRole)}>{Object.entries(accountRoleNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="platform-check"><input type="checkbox" checked={active} onChange={event => setActive(event.target.checked)}/>เปิดใช้งานบัญชี</label><label>เปลี่ยนรหัสผ่าน (เว้นว่างเพื่อคงเดิม)<PasswordInput aria-label="เปลี่ยนรหัสผ่าน (เว้นว่างเพื่อคงเดิม)" toggleLabel="รหัสผ่านใหม่" value={password} onChange={event => setPassword(event.target.value)} minLength={4} maxLength={256} autoComplete="new-password"/></label></div>{error && <ErrorNotice message={error}/>}<button className="platform-button" disabled={busy || (role === user.role && active === user.active && !password)} onClick={() => { if (password && password.length < 4) { setError('รหัสผ่านใหม่ต้องยาวอย่างน้อย 4 ตัว'); return } setConfirm(true) }}>บันทึกสิทธิ์ / บัญชี</button>{confirm && <ConfirmDialog title={`ยืนยันการเปลี่ยนบัญชี ${user.username}?`} busy={busy} onCancel={() => setConfirm(false)} onConfirm={() => void save()}><p>การเปลี่ยนสิทธิ์ ปิดบัญชี หรือเปลี่ยนรหัสผ่านจะยกเลิกเซสชันของบัญชีนี้ และมีประวัติการดำเนินการ</p></ConfirmDialog>}</article>
}
