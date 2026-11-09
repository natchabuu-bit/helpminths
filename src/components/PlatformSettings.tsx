import { CheckCircle2, LogIn, LogOut, Save, ShieldCheck, UserPlus, Users } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { apiRequest, buildQuery, formatDate } from '../platform/api'
import type { Paged, PendingRegistration, PlatformApprovalStatus, PlatformRole, PlatformSession, PlatformUser } from '../platform/api'
import { ConfirmDialog, ErrorNotice, LoadingNotice, PlatformHeading, usePlatformResource } from './PlatformShared'
import PasswordInput from './PasswordInput'
import '../styles/account.css'

const USERNAME_PATTERN = '[A-Za-z0-9][A-Za-z0-9_.\\- ]*'
const accountRoleNames: Record<PlatformRole, string> = { admin: 'ผู้ดูแลระบบ', reviewer: 'ผู้เชี่ยวชาญ', lab: 'ผู้ใช้ทั่วไป', student: 'อ่านอย่างเดียว' }
const approvalNames: Record<PlatformApprovalStatus, string> = { pending: 'รออนุมัติ', approved: 'อนุมัติแล้ว', rejected: 'ไม่อนุมัติ' }
type AccountTab = 'login' | 'register' | 'adminSetup'
type AccountPortal = 'user' | 'expert'
function userRoleName(user: PlatformUser) { return user.is_super_admin ? 'Super admin' : accountRoleNames[user.role] }

export default function PlatformSettings({ session, onSessionChanged, onExpertSignedIn, onOpenAdmin, initialPortal = 'user' }: { session: PlatformSession; onSessionChanged?: () => Promise<void>; onExpertSignedIn?: () => void; onOpenAdmin?: () => void; initialPortal?: AccountPortal }) {
  const [username, setUsername] = useState(''), [password, setPassword] = useState(''), [passwordConfirm, setPasswordConfirm] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [accountTab, setAccountTab] = useState<AccountTab>('login'), [portal, setPortal] = useState<AccountPortal>(initialPortal), [setupToken, setSetupToken] = useState('')
  const [pendingRegistration, setPendingRegistration] = useState<PlatformUser | null>(null)
  const [fullName, setFullName] = useState(''), [workplace, setWorkplace] = useState(''), [affiliation, setAffiliation] = useState(''), [phone, setPhone] = useState('')
  const [rechecking, setRechecking] = useState(false)
  const loginTab = useRef<HTMLButtonElement>(null), registerTab = useRef<HTMLButtonElement>(null), adminSetupTab = useRef<HTMLButtonElement>(null)
  const userPortalTab = useRef<HTMLButtonElement>(null), expertPortalTab = useRef<HTMLButtonElement>(null)
  useEffect(() => { setPortal(initialPortal); setAccountTab('login'); setPassword(''); setPasswordConfirm(''); setSetupToken(''); setError(''); setNotice('') }, [initialPortal])
  const sessionRefresh = useRef(onSessionChanged)
  sessionRefresh.current = onSessionChanged
  useEffect(() => {
    if (!sessionRefresh.current) return
    let active = true
    setRechecking(true)
    void sessionRefresh.current().catch(failure => { if (active) setError(failure instanceof Error ? failure.message : 'ตรวจสอบบัญชีไม่ได้') }).finally(() => { if (active) setRechecking(false) })
    return () => { active = false }
  }, [])
  const refresh = async () => { if (onSessionChanged) await onSessionChanged(); else window.location.reload() }
  const changeTab = (tab: AccountTab) => { if (tab === 'adminSetup') setUsername(session.owner_username ?? 'Super Admin'); else if (accountTab === 'adminSetup') setUsername(''); setAccountTab(tab); setPassword(''); setPasswordConfirm(''); setSetupToken(''); setError(''); setNotice('') }
  const changePortal = (next: AccountPortal) => { setPortal(next); changeTab('login') }
  const expertPortal = portal === 'expert'
  const tabKeys = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const tabs: AccountTab[] = session.admin_setup_available && !expertPortal ? ['login', 'register', 'adminSetup'] : ['login', 'register']
    const current = Math.max(0, tabs.indexOf(accountTab))
    const next = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[tabs.length - 1] : tabs[(current + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]
    changeTab(next)
    const nextTab = next === 'login' ? loginTab : next === 'register' ? registerTab : adminSetupTab
    nextTab.current?.focus()
  }
  const portalKeys = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const next = event.key === 'Home' ? 'user' : event.key === 'End' ? 'expert' : expertPortal ? 'user' : 'expert'
    changePortal(next); (next === 'expert' ? expertPortalTab : userPortalTab).current?.focus()
  }
  const authenticate = async () => {
    if (accountTab === 'register' && (!fullName.trim() || !workplace.trim() || !affiliation.trim() || !/^[0-9]{10}$/.test(phone))) { setError('กรอกชื่อ-นามสกุล สถานที่ทำงาน สังกัด และเบอร์โทร 10 หลักให้ครบถ้วน'); return }
    if (accountTab !== 'login' && password !== passwordConfirm) { setError('รหัสผ่านและการยืนยันรหัสผ่านไม่ตรงกัน'); return }
    setBusy(true); setError(''); setNotice('')
    try {
      if (accountTab === 'register') {
        const result = await apiRequest<PendingRegistration>('/register', { json: { username: username.trim(), password, account_type: expertPortal ? 'expert' : 'user', full_name: fullName.trim(), workplace: workplace.trim(), affiliation: affiliation.trim(), phone } })
        setPendingRegistration(result.user)
        setPassword(''); setPasswordConfirm(''); setFullName(''); setWorkplace(''); setAffiliation(''); setPhone(''); setAccountTab('login')
        return
      }
      await apiRequest(accountTab === 'adminSetup' ? '/admin-setup' : expertPortal ? '/expert-signin' : '/login', { json: { username: username.trim(), password, ...(accountTab === 'adminSetup' ? { setup_token: setupToken } : {}) } })
      setPassword(''); setPasswordConfirm(''); setSetupToken(''); setPendingRegistration(null)
      await refresh()
      setNotice(accountTab === 'adminSetup' ? 'สร้างบัญชี Super admin และเข้าสู่ระบบแล้ว' : 'เข้าสู่ระบบแล้ว')
      if (expertPortal) onExpertSignedIn?.()
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'ดำเนินการเกี่ยวกับบัญชีไม่ได้') }
    finally { setBusy(false) }
  }
  const logout = async () => { setBusy(true); setError(''); try { await apiRequest(session, '/logout', { method: 'POST' }); await refresh(); setNotice('ออกจากระบบแล้ว') } catch (failure) { setError(failure instanceof Error ? failure.message : 'ออกจากระบบไม่ได้') } finally { setBusy(false) } }
  const accountReady = session.configured && !session.connection_error
  const creatingAccount = accountTab !== 'login'
  const registering = accountTab === 'register'
  const adminSetup = accountTab === 'adminSetup'
  const authUnavailable = !accountReady || (registering && session.registration_enabled === false) || (adminSetup && !session.admin_setup_available)
  const checkingConnection = !accountReady && rechecking
  return <div className="platform-page account-page">
    <PlatformHeading kicker="SETTINGS & ACCESS" title="ตั้งค่าและบัญชีผู้ใช้" description="จัดการบัญชีและข้อมูลส่วนตัวของคุณ"/>
    {error && <ErrorNotice message={error}/>} {notice && <p className="platform-notice" role="status">{notice}</p>}
    <section className="platform-card account-access-card" aria-labelledby="account-access-title">
      <div className="platform-card-heading"><h2 id="account-access-title">{session.user ? 'บัญชีปัจจุบัน' : 'เข้าใช้งาน HelpMinths'}</h2></div>
      {session.user ? <>
        <div className="platform-definition-grid"><div><span>ชื่อ-นามสกุล</span><strong>{session.user.full_name || session.user.username}</strong></div><div><span>บัญชี</span><strong>{session.user.username}</strong></div><div><span>สถานะ</span><strong>{userRoleName(session.user)} · {approvalNames[session.user.approval_status] ?? 'อนุมัติแล้ว'}</strong></div></div>
        {session.user.is_super_admin && accountReady && onOpenAdmin && <div className="account-admin-access"><div><h3>หลังบ้าน Super Admin</h3><p>เปิดหน้ารออนุมัติเพื่อพิจารณาคำขอสมัคร และจัดการสิทธิ์สมาชิก</p></div><button className="platform-button primary" onClick={onOpenAdmin}><ShieldCheck size={18}/>เปิดหลังบ้าน</button></div>}
        <div className="account-current-actions"><div className="platform-actions">{onExpertSignedIn && ['reviewer', 'admin'].includes(session.user.role) && <button className="platform-button" onClick={onExpertSignedIn}><ShieldCheck size={17}/>เปิดหน้าผู้เชี่ยวชาญ</button>}<button className="platform-button" disabled={busy} onClick={() => void logout()}><LogOut size={17}/>ออกจากระบบ</button></div></div>
      </> : <>
        {pendingRegistration && <div className="account-pending-registration" role="status"><CheckCircle2 size={25}/><div><h3>สมัครสมาชิกแล้ว รอการอนุมัติ</h3><p>บัญชี <strong>{pendingRegistration.username}</strong> · {accountRoleNames[pendingRegistration.requested_role ?? 'lab']}</p><p>เข้าสู่ระบบได้เมื่อผู้ดูแลอนุมัติบัญชี</p></div></div>}
        <div className="account-portal-tabs" role="tablist" aria-label="ช่องทางเข้าใช้งาน">
          <button ref={userPortalTab} id="account-user-portal-tab" role="tab" aria-selected={!expertPortal} aria-controls="account-portal-panel" tabIndex={expertPortal ? -1 : 0} disabled={busy} onClick={() => changePortal('user')} onKeyDown={portalKeys}><Users size={20}/><span>ผู้ใช้ทั่วไป<small>ผลตรวจและประวัติของคุณ</small></span></button>
          <button ref={expertPortalTab} id="account-expert-portal-tab" role="tab" aria-selected={expertPortal} aria-controls="account-portal-panel" tabIndex={expertPortal ? 0 : -1} disabled={busy} onClick={() => changePortal('expert')} onKeyDown={portalKeys}><ShieldCheck size={20}/><span>ผู้เชี่ยวชาญ<small>ทบทวนภาพและยืนยันผล</small></span></button>
        </div>
        <div id="account-portal-panel" role="tabpanel" aria-labelledby={expertPortal ? 'account-expert-portal-tab' : 'account-user-portal-tab'}>
          <div className={`account-tabs ${session.admin_setup_available && !expertPortal ? 'has-admin-setup' : ''}`} role="tablist" aria-label={expertPortal ? 'บัญชีผู้เชี่ยวชาญ' : 'การเข้าใช้บัญชี'}>
            <button ref={loginTab} id="account-login-tab" role="tab" aria-selected={accountTab === 'login'} aria-controls="account-auth-panel" tabIndex={accountTab === 'login' ? 0 : -1} disabled={busy} onClick={() => changeTab('login')} onKeyDown={tabKeys}><LogIn size={17}/>{expertPortal ? 'เข้าสู่ระบบผู้เชี่ยวชาญ' : 'เข้าสู่ระบบ'}</button>
            <button ref={registerTab} id="account-register-tab" role="tab" aria-selected={registering} aria-controls="account-auth-panel" tabIndex={registering ? 0 : -1} disabled={busy} onClick={() => changeTab('register')} onKeyDown={tabKeys}><UserPlus size={17}/>{expertPortal ? 'สมัครเป็นผู้เชี่ยวชาญ' : 'สมัครสมาชิก'}</button>
            {session.admin_setup_available && !expertPortal && <button ref={adminSetupTab} id="account-admin-setup-tab" role="tab" aria-selected={adminSetup} aria-controls="account-auth-panel" tabIndex={adminSetup ? 0 : -1} disabled={busy} onClick={() => changeTab('adminSetup')} onKeyDown={tabKeys}><ShieldCheck size={17}/>ตั้งค่า Super admin ครั้งแรก</button>}
          </div>
          <div id="account-auth-panel" role="tabpanel" aria-labelledby={accountTab === 'login' ? 'account-login-tab' : adminSetup ? 'account-admin-setup-tab' : 'account-register-tab'}>
            {adminSetup && <p className="account-form-intro">สำหรับเจ้าของระบบที่มีรหัสตั้งค่าจากโฮสต์</p>}
            <form className={`account-auth-form ${creatingAccount ? 'account-register-form' : ''}`} onSubmit={event => { event.preventDefault(); void authenticate() }}>
              {adminSetup && <label className="account-setup-token">รหัสตั้งค่า Super admin<PasswordInput aria-label="รหัสตั้งค่า Super admin" toggleLabel="รหัสตั้งค่า Super admin" required value={setupToken} onChange={event => setSetupToken(event.target.value)} maxLength={256} autoComplete="off" autoCapitalize="none" spellCheck={false} disabled={authUnavailable || busy}/><small>ใช้รหัสที่เจ้าของระบบกำหนดบนโฮสต์ ช่องนี้ไม่ใช่รหัสผ่านของบัญชีใหม่</small></label>}
              {registering && <>
                <label>ชื่อ-นามสกุล<input required value={fullName} onChange={event => setFullName(event.target.value)} maxLength={200} autoComplete="name" disabled={authUnavailable || busy}/></label>
                <label>สถานที่ทำงาน<input required value={workplace} onChange={event => setWorkplace(event.target.value)} maxLength={300} autoComplete="organization" disabled={authUnavailable || busy}/></label>
                <label>สังกัด<input required value={affiliation} onChange={event => setAffiliation(event.target.value)} maxLength={300} disabled={authUnavailable || busy}/></label>
                <label>เบอร์โทร 10 หลัก<input required type="tel" inputMode="numeric" pattern="[0-9]{10}" title="กรอกตัวเลข 0–9 จำนวน 10 หลัก" value={phone} onChange={event => setPhone(event.target.value)} maxLength={10} autoComplete="tel-national" disabled={authUnavailable || busy}/></label>
              </>}
              <label>ชื่อบัญชี<input readOnly={adminSetup} required value={username} onChange={event => setUsername(event.target.value)} pattern={creatingAccount ? USERNAME_PATTERN : undefined} title={creatingAccount ? 'ใช้ภาษาอังกฤษ ตัวเลข ช่องว่าง จุด ขีดกลาง หรือขีดล่าง และเริ่มด้วยตัวอักษรหรือตัวเลข' : undefined} autoComplete="username" autoCapitalize="none" spellCheck={false} disabled={authUnavailable || busy}/></label>
              <label>รหัสผ่าน<PasswordInput key={`${portal}-${accountTab}-password`} aria-label="รหัสผ่าน" required value={password} onChange={event => setPassword(event.target.value)} minLength={creatingAccount ? 4 : undefined} maxLength={256} autoComplete={creatingAccount ? 'new-password' : 'current-password'} disabled={authUnavailable || busy}/></label>
              {creatingAccount && <label>ยืนยันรหัสผ่าน<PasswordInput key={`${portal}-${accountTab}-confirmation`} aria-label="ยืนยันรหัสผ่าน" toggleLabel="รหัสผ่านยืนยัน" required value={passwordConfirm} onChange={event => setPasswordConfirm(event.target.value)} minLength={4} maxLength={256} autoComplete="new-password" disabled={authUnavailable || busy}/></label>}
              <button className="platform-button primary" type="submit" disabled={authUnavailable || busy}>{creatingAccount ? <UserPlus size={17}/> : <LogIn size={17}/>} {busy ? 'กำลังดำเนินการ…' : registering ? expertPortal ? 'ส่งคำขอเป็นผู้เชี่ยวชาญ' : 'สมัครและส่งคำขออนุมัติ' : adminSetup ? 'สร้างบัญชี Super admin' : expertPortal ? 'เข้าสู่ระบบผู้เชี่ยวชาญ' : 'เข้าสู่ระบบ'}</button>
            </form>
            {creatingAccount && <p className="account-registration-help">รหัสผ่านอย่างน้อย 4 ตัวอักษร</p>}
            {!accountReady && <p className="platform-muted">{checkingConnection ? 'กำลังเชื่อมต่อบริการบัญชี กรุณารอสักครู่' : 'เชื่อมต่อบริการบัญชีไม่ได้ กรุณาลองโหลดหน้าใหม่'}</p>}
            {session.configured && registering && session.registration_enabled === false && <p className="platform-muted">ระบบยังไม่เปิดรับสมัครสมาชิก กรุณาติดต่อ Super admin</p>}
          </div>
        </div>
      </>}
    </section>
    {session.user && <AccountPreferences key={session.user.id} session={session} onSaved={refresh}/>}
    <details className="account-privacy"><summary>ความเป็นส่วนตัว</summary><p>ประวัติและภาพที่ส่งตรวจเข้าถึงได้ตามสิทธิ์บัญชี กรุณาไม่ใส่ชื่อหรือข้อมูลระบุตัวผู้ป่วยในรหัสตัวอย่าง</p></details>
  </div>
}

function AccountPreferences({ session, onSaved }: { session: PlatformSession; onSaved: () => Promise<void> }) {
  const [username, setUsername] = useState(session.user?.username ?? ''), [currentPassword, setCurrentPassword] = useState(''), [password, setPassword] = useState(''), [passwordConfirm, setPasswordConfirm] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [fullName, setFullName] = useState(session.user?.full_name ?? ''), [workplace, setWorkplace] = useState(session.user?.workplace ?? ''), [affiliation, setAffiliation] = useState(session.user?.affiliation ?? ''), [phone, setPhone] = useState(session.user?.phone ?? '')
  const profile = { full_name: fullName.trim(), workplace: workplace.trim(), affiliation: affiliation.trim(), phone: phone.trim() }
  const profileChanges = Object.fromEntries(Object.entries(profile).filter(([key, value]) => value !== (session.user?.[key as keyof typeof profile] ?? '')))
  const changed = username.trim() !== session.user?.username || password !== '' || Object.keys(profileChanges).length > 0
  const save = async () => {
    if (!changed) return
    if (password && password !== passwordConfirm) { setError('รหัสผ่านใหม่และการยืนยันรหัสผ่านไม่ตรงกัน'); return }
    setBusy(true); setError(''); setNotice('')
    try {
      await apiRequest(session, '/account', { method: 'PATCH', json: { current_password: currentPassword, ...profileChanges, ...(username.trim() !== session.user?.username ? { username: username.trim() } : {}), ...(password ? { new_password: password } : {}) } })
      setCurrentPassword(''); setPassword(''); setPasswordConfirm('')
      await onSaved()
      setNotice('บันทึกข้อมูลบัญชีแล้ว')
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'บันทึกการตั้งค่าบัญชีไม่ได้') }
    finally { setBusy(false) }
  }
  return <section className="platform-card account-preferences" aria-labelledby="account-preferences-title"><div className="platform-card-heading"><div><h2 id="account-preferences-title">ข้อมูลบัญชี</h2><p>ยืนยันรหัสผ่านปัจจุบันก่อนบันทึก</p></div></div>{error && <ErrorNotice message={error}/>} {notice && <p className="platform-notice" role="status">{notice}</p>}<form onSubmit={event => { event.preventDefault(); void save() }}><div className="platform-form-grid"><label>ชื่อ-นามสกุล<input required={Boolean(session.user?.full_name)} value={fullName} onChange={event => setFullName(event.target.value)} maxLength={200} autoComplete="name" disabled={busy}/></label><label>สถานที่ทำงาน<input required={Boolean(session.user?.workplace)} value={workplace} onChange={event => setWorkplace(event.target.value)} maxLength={300} autoComplete="organization" disabled={busy}/></label><label>สังกัด<input required={Boolean(session.user?.affiliation)} value={affiliation} onChange={event => setAffiliation(event.target.value)} maxLength={300} disabled={busy}/></label><label>เบอร์โทร 10 หลัก<input required={Boolean(session.user?.phone)} type="tel" inputMode="numeric" pattern="[0-9]{10}" title="กรอกตัวเลข 0–9 จำนวน 10 หลัก" value={phone} onChange={event => setPhone(event.target.value)} maxLength={10} autoComplete="tel-national" disabled={busy}/></label><label>ชื่อบัญชีที่ต้องการใช้<input required value={username} onChange={event => setUsername(event.target.value)} pattern={USERNAME_PATTERN} autoComplete="username" autoCapitalize="none" spellCheck={false} disabled={busy}/></label><label>รหัสผ่านปัจจุบัน<PasswordInput aria-label="รหัสผ่านปัจจุบัน" toggleLabel="รหัสผ่านปัจจุบัน" required value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} maxLength={256} autoComplete="current-password" disabled={busy}/></label><label>รหัสผ่านใหม่ (เว้นว่างหากไม่เปลี่ยน)<PasswordInput aria-label="รหัสผ่านใหม่ (เว้นว่างหากไม่เปลี่ยน)" toggleLabel="รหัสผ่านใหม่" value={password} onChange={event => setPassword(event.target.value)} minLength={4} maxLength={256} autoComplete="new-password" disabled={busy}/></label><label>ยืนยันรหัสผ่านใหม่<PasswordInput aria-label="ยืนยันรหัสผ่านใหม่" toggleLabel="รหัสผ่านใหม่ที่ยืนยัน" required={password !== ''} value={passwordConfirm} onChange={event => setPasswordConfirm(event.target.value)} minLength={password ? 4 : undefined} maxLength={256} autoComplete="new-password" disabled={busy}/></label></div><p className="platform-muted">รหัสผ่านใหม่อย่างน้อย 4 ตัวอักษร เว้นว่างหากไม่เปลี่ยน</p><button className="platform-button primary" disabled={busy || !changed}><Save size={17}/>{busy ? 'กำลังบันทึก…' : 'บันทึกบัญชีของฉัน'}</button></form></section>
}
type MemberFilter = 'pending' | 'all' | 'general' | 'expert'
export function UserManagement({ session, onSessionChanged, title = 'Super admin' }: { session: PlatformSession; onSessionChanged?: () => Promise<void>; title?: string }) {
  const [filter, setFilter] = useState<MemberFilter>('pending'), [offset, setOffset] = useState(0)
  const query = buildQuery({ limit: 50, offset, approval_status: filter === 'pending' ? 'pending' : undefined, account_type: filter === 'general' ? 'user' : filter === 'expert' ? 'expert' : undefined })
  const users = usePlatformResource<Paged<PlatformUser>>(`/users${query}`, session, session.configured && !session.connection_error && session.user?.is_super_admin === true)
  const [username, setUsername] = useState(''), [password, setPassword] = useState(''), [role, setRole] = useState<PlatformRole>('lab'), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const create = async () => {
    setBusy(true); setError(''); setNotice('')
    try { await apiRequest(session, '/users', { json: { username: username.trim(), password, role } }); setUsername(''); setPassword(''); setNotice('สร้างและอนุมัติบัญชีแล้ว'); users.reload() }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'สร้างบัญชีไม่ได้') }
    finally { setBusy(false) }
  }
  const filters: [MemberFilter, string][] = [['pending', 'รออนุมัติ'], ['all', 'สมาชิกทั้งหมด'], ['general', 'ผู้ใช้ทั่วไป'], ['expert', 'ผู้เชี่ยวชาญ']]
  return <section className="platform-card account-super-admin" aria-labelledby="super-admin-title">
    <div className="platform-card-heading"><div><h2 id="super-admin-title">{title}</h2><p>เริ่มจากคำขอที่รออนุมัติ เลือกสิทธิ์ให้เหมาะกับสมาชิกก่อนยืนยัน</p></div><Users size={24}/></div>
    {error && <ErrorNotice message={error}/>} {notice && <p className="platform-notice" role="status">{notice}</p>}
    <div className="account-member-filters" role="group" aria-label="กรองสมาชิก">{filters.map(([value, label]) => <button key={value} className={`platform-button ${filter === value ? 'primary' : ''}`} aria-pressed={filter === value} onClick={() => { setFilter(value); setOffset(0) }}>{label}</button>)}</div>
    {users.loading ? <LoadingNotice/> : users.error ? <ErrorNotice message={users.error} onRetry={users.reload}/> : <>
      <p className="platform-muted">{filters.find(([value]) => value === filter)?.[1]} {users.value?.total ?? 0} บัญชี</p>
      <div className="platform-user-list">{users.value?.items.map(user => <UserEntry key={[user.id, user.role, user.active, user.approval_status, user.approved_at].join(':')} user={user} session={session} onSaved={async () => { setOffset(0); users.reload(); if (user.id === session.user?.id) await onSessionChanged?.() }}/>)}</div>
      {users.value?.items.length === 0 && <p className="account-member-empty">{filter === 'pending' ? 'ยังไม่มีคำขอที่รออนุมัติ' : 'ไม่มีบัญชีในกลุ่มนี้'}</p>}
      {(users.value?.total ?? 0) > 50 && <div className="account-member-pagination"><button className="platform-button" disabled={offset === 0} onClick={() => setOffset(value => Math.max(0, value - 50))}>หน้าก่อนหน้า</button><span>{offset + 1}–{Math.min(offset + 50, users.value?.total ?? 0)} จาก {users.value?.total}</span><button className="platform-button" disabled={offset + 50 >= (users.value?.total ?? 0)} onClick={() => setOffset(value => value + 50)}>หน้าถัดไป</button></div>}
    </>}
    <details className="account-create-member"><summary>สร้างและอนุมัติบัญชีให้สมาชิก</summary><form onSubmit={event => { event.preventDefault(); void create() }}><div className="platform-form-grid"><label>ชื่อบัญชีใหม่<input required value={username} onChange={event => setUsername(event.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} pattern={USERNAME_PATTERN} disabled={busy}/></label><label>รหัสผ่านใหม่ (อย่างน้อย 4 ตัว)<PasswordInput aria-label="รหัสผ่านใหม่ (อย่างน้อย 4 ตัว)" toggleLabel="รหัสผ่านใหม่" required minLength={4} maxLength={256} value={password} onChange={event => setPassword(event.target.value)} autoComplete="new-password" disabled={busy}/></label><label>บทบาท<select value={role} onChange={event => setRole(event.target.value as PlatformRole)} disabled={busy}>{Object.entries(accountRoleNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div><button className="platform-button primary" disabled={busy}>{busy ? 'กำลังสร้าง…' : 'สร้างและอนุมัติบัญชี'}</button></form></details>
  </section>
}

type MemberAction = 'approve' | 'reject' | 'save' | null
function UserEntry({ user, session, onSaved }: { user: PlatformUser; session: PlatformSession; onSaved: () => Promise<void> }) {
  const [role, setRole] = useState<PlatformRole>(user.approval_status !== 'approved' ? user.requested_role ?? 'lab' : user.role), [active, setActive] = useState(user.active), [password, setPassword] = useState(''), [action, setAction] = useState<MemberAction>(null), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const protectedOwner = user.is_super_admin === true
  const status = user.approval_status ?? 'approved'
  const pendingEntry = status === 'pending' && !protectedOwner
  const changed = role !== user.role || active !== user.active || password !== ''
  const save = async () => {
    if (!action || protectedOwner) return
    setBusy(true); setError('')
    try {
      const json = action === 'reject' ? { approval_status: 'rejected' } : action === 'approve' ? { approval_status: 'approved', role, active: true } : { role, active, ...(password ? { password } : {}) }
      await apiRequest(session, `/users/${encodeURIComponent(user.id)}`, { method: 'PATCH', json })
      setPassword(''); setAction(null); await onSaved()
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'แก้ไขบัญชีไม่ได้'); setAction(null) }
    finally { setBusy(false) }
  }
  const confirm = (next: MemberAction) => {
    if (password && password.length < 4) { setError('รหัสผ่านใหม่ต้องยาวอย่างน้อย 4 ตัว'); return }
    setError(''); setAction(next)
  }
  const metadata = <dl className="account-member-metadata">{user.workplace && <div><dt>สถานที่ทำงาน</dt><dd>{user.workplace}</dd></div>}{user.affiliation && <div><dt>สังกัด</dt><dd>{user.affiliation}</dd></div>}{user.phone && <div><dt>เบอร์โทร</dt><dd>{user.phone}</dd></div>}{pendingEntry && <div><dt>สมัครเมื่อ</dt><dd>{formatDate(user.created_at)}</dd></div>}<div><dt>ประเภทที่ขอ</dt><dd>{accountRoleNames[user.requested_role ?? (user.role === 'reviewer' ? 'reviewer' : 'lab')]}</dd></div><div><dt>บทบาทปัจจุบัน</dt><dd>{status === 'approved' ? userRoleName(user) : status === 'pending' ? 'รอพิจารณาสิทธิ์' : 'ยังไม่ได้รับสิทธิ์'}</dd></div><div><dt>อนุมัติเมื่อ</dt><dd>{formatDate(user.approved_at)}</dd></div>{user.approved_by && <div><dt>ผู้อนุมัติ</dt><dd>{user.approved_by === session.user?.id ? session.user.username : user.approved_by}</dd></div>}</dl>
  return <article className="platform-user-entry">
    <div className="account-member-heading"><div><strong>{user.full_name || user.username}</strong>{user.full_name && <p className="account-member-username">{user.username}</p>}{!pendingEntry && <p>สมัคร {formatDate(user.created_at)}</p>}</div><span className={`platform-badge ${status === 'approved' ? 'success' : status === 'rejected' ? 'danger' : 'warning'}`}>{approvalNames[status]}</span></div>
    {!pendingEntry && metadata}
    {protectedOwner ? <p className="platform-muted">บัญชีเจ้าของระบบ · เปลี่ยนชื่อบัญชีและรหัสผ่านของคุณในส่วนบัญชีส่วนตัว</p> : <>
      <div className="platform-form-grid"><label>{pendingEntry ? 'สิทธิ์ที่จะอนุมัติ' : `${status === 'approved' ? 'บทบาท' : 'สิทธิ์ที่จะอนุมัติ'}ของ ${user.username}`}<select aria-label={pendingEntry ? `สิทธิ์ที่จะอนุมัติของ ${user.username}` : undefined} value={role} onChange={event => setRole(event.target.value as PlatformRole)} disabled={busy}>{Object.entries(accountRoleNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>{status === 'approved' && <><label className="platform-check"><input type="checkbox" checked={active} onChange={event => setActive(event.target.checked)} disabled={busy}/>เปิดใช้งานบัญชี</label><label>เปลี่ยนรหัสผ่าน (เว้นว่างเพื่อคงเดิม)<PasswordInput aria-label={`เปลี่ยนรหัสผ่านของ ${user.username}`} toggleLabel={`รหัสผ่านใหม่ของ ${user.username}`} value={password} onChange={event => setPassword(event.target.value)} minLength={4} maxLength={256} autoComplete="new-password" disabled={busy}/></label></>}</div>
      {error && <ErrorNotice message={error}/>}
      <div className="platform-actions">{status !== 'approved' ? <><button className="platform-button primary" aria-label={pendingEntry ? `อนุมัติบัญชี ${user.username}` : undefined} disabled={busy} onClick={() => confirm('approve')}><CheckCircle2 size={17}/>อนุมัติบัญชี{!pendingEntry && ` ${user.username}`}</button>{status === 'pending' && <button className="platform-button danger" aria-label={`ไม่อนุมัติบัญชี ${user.username}`} disabled={busy} onClick={() => confirm('reject')}>ไม่อนุมัติบัญชี{!pendingEntry && ` ${user.username}`}</button>}</> : <><button className="platform-button" disabled={busy || !changed} onClick={() => confirm('save')}>บันทึกสิทธิ์ / บัญชี {user.username}</button><button className="platform-button danger" disabled={busy} onClick={() => confirm('reject')}>ถอนการอนุมัติ {user.username}</button></>}</div>
    </>}
    {pendingEntry && <details className="account-member-details"><summary>รายละเอียดคำขอของ {user.username}</summary>{metadata}</details>}
    {action && <ConfirmDialog title={`${action === 'approve' ? 'อนุมัติบัญชี' : action === 'reject' ? status === 'approved' ? 'ถอนการอนุมัติบัญชี' : 'ไม่อนุมัติบัญชี' : 'เปลี่ยนสิทธิ์บัญชี'} ${user.username}?`} busy={busy} onCancel={() => setAction(null)} onConfirm={() => void save()}><p>{action === 'approve' ? `อนุมัติให้ ${user.username} เข้าสู่ระบบด้วยบทบาท ${accountRoleNames[role]}${role === 'reviewer' ? ' และเข้าทบทวนภาพในหน้าผู้เชี่ยวชาญได้' : ''}` : action === 'reject' ? `บัญชี ${user.username} จะเข้าสู่ระบบไม่ได้ และเซสชันเดิมจะถูกยกเลิก` : `บันทึกบทบาท ${accountRoleNames[role]} และ${active ? 'เปิด' : 'ปิด'}ใช้งานบัญชี ${user.username} การเปลี่ยนสิทธิ์หรือรหัสผ่านจะยกเลิกเซสชันเดิม`}</p></ConfirmDialog>}
  </article>
}
