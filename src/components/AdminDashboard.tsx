import { ArrowLeft, Database, LogIn, RefreshCw, Settings, ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { apiRequest } from '../platform/api'
import type { PlatformSession } from '../platform/api'
import PasswordInput from './PasswordInput'
import { ErrorNotice, LoadingNotice, PlatformHeading } from './PlatformShared'
import { UserManagement } from './PlatformSettings'
import '../styles/account.css'

interface AdminDashboardProps {
  session: PlatformSession
  loading?: boolean
  onOpenSettings: () => void
  onSessionChanged?: () => Promise<void>
}

function OwnerPasswordSteps({ username }: { username: string }) {
  return <ol>
    <li>เปิด Render → Environment เพิ่ม <code>HELPMINTHS_SUPER_ADMIN_PASSWORD</code> และตั้งรหัสผ่านที่คุณเลือกเองอย่างน้อย 4 ตัวอักษร</li>
    <li>บันทึก แล้วเลือก Manual Deploy เพื่อเริ่มระบบด้วยค่าที่ตั้งไว้</li>
    <li>กลับมาหน้านี้ ใช้ชื่อบัญชี <strong>{username}</strong> และรหัสผ่านที่คุณตั้งไว้เพื่อเข้าสู่หลังบ้าน</li>
  </ol>
}

export default function AdminDashboard({ session, loading = false, onOpenSettings, onSessionChanged }: AdminDashboardProps) {
  const [rechecking, setRechecking] = useState(false)
  const [error, setError] = useState('')
  const [signingIn, setSigningIn] = useState(false)
  const [loginError, setLoginError] = useState('')
  const [localSession, setLocalSession] = useState<{ source: PlatformSession; value: PlatformSession } | null>(null)
  const currentSession = localSession?.source === session ? localSession.value : session
  const suggestedUsername = currentSession.owner_login_username ?? currentSession.owner_username ?? 'Super Admin'
  const [username, setUsername] = useState(suggestedUsername)
  const [usernameEdited, setUsernameEdited] = useState(false)
  const [password, setPassword] = useState('')
  useEffect(() => { if (!usernameEdited) setUsername(suggestedUsername) }, [suggestedUsername, usernameEdited])

  const accountReady = currentSession.configured && !currentSession.connection_error
  const isOwner = accountReady && currentSession.user?.is_super_admin === true && currentSession.user.active && currentSession.user.approval_status === 'approved'
  const bootstrap = currentSession.owner_bootstrap
  const recheck = async () => {
    if (!onSessionChanged) return
    setRechecking(true); setError('')
    try { await onSessionChanged() }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'ตรวจสอบระบบบัญชีไม่ได้') }
    finally { setRechecking(false) }
  }
  const signIn = async () => {
    if (signingIn) return
    setSigningIn(true); setLoginError('')
    try {
      const value = await apiRequest<PlatformSession>('/owner-signin', { json: { username: username.trim(), password } })
      if (!value.configured || value.user?.is_super_admin !== true || !value.user.active || value.user.approval_status !== 'approved') throw new Error('บริการยังไม่ได้ยืนยันสิทธิ์ Super Admin กรุณาลองเข้าสู่ระบบอีกครั้ง')
      if (onSessionChanged) await onSessionChanged()
      else setLocalSession({ source: session, value })
      setPassword('')
    } catch (failure) { setLoginError(failure instanceof Error ? failure.message : 'เข้าสู่หลังบ้านไม่ได้ กรุณาลองอีกครั้ง') }
    finally { setSigningIn(false) }
  }

  return <div className="platform-page account-page admin-dashboard">
    <PlatformHeading kicker="SUPER ADMIN" title="หลังบ้าน Super Admin" description="อนุมัติคำขอและจัดการสมาชิกในที่เดียว"/>
    {error && <ErrorNotice message={error}/>}
    {loading ? <LoadingNotice/> : !accountReady ? <section className="platform-card admin-access-gate" aria-labelledby="admin-gate-title">
      <Database size={34}/>
      <h2 id="admin-gate-title">ยังเชื่อมต่อระบบบัญชีไม่ได้</h2>
      <p>หลังบ้านจะพร้อมใช้งานเมื่อเชื่อมต่อระบบบัญชีได้ กรุณาตรวจสอบการเชื่อมต่อ แล้วเข้าสู่ระบบด้วยบัญชี Super Admin ของคุณ</p>
      <div className="platform-actions">
        {onSessionChanged && <button className="platform-button primary" disabled={rechecking} onClick={() => void recheck()}><RefreshCw size={17} className={rechecking ? 'spin' : ''}/>{rechecking ? 'กำลังตรวจสอบ…' : 'ตรวจสอบระบบอีกครั้ง'}</button>}
        <button className="platform-button" onClick={onOpenSettings}><Settings size={17}/>ไปหน้าบัญชีและการตั้งค่า</button>
      </div>
    </section> : !isOwner ? <section className="platform-card admin-access-gate" aria-labelledby="admin-gate-title">
      <ShieldCheck size={34}/>
      <h2 id="admin-gate-title">{currentSession.user ? 'บัญชีนี้ไม่มีสิทธิ์เข้าหลังบ้าน' : 'เข้าสู่ระบบ Super Admin'}</h2>
      {currentSession.user ? <p>บัญชี <strong>{currentSession.user.username}</strong> ไม่มีสิทธิ์จัดการสมาชิก เข้าสู่ระบบด้วยบัญชี Super Admin เพื่อดำเนินการต่อ</p> : <p>เข้าสู่ระบบด้วยบัญชีเจ้าของระบบ</p>}
      <form className="admin-login-form" onSubmit={event => { event.preventDefault(); void signIn() }} aria-label="เข้าสู่ระบบ Super Admin" aria-busy={signingIn}>
        <label>ชื่อบัญชี<input required name="username" value={username} onChange={event => { setUsername(event.target.value); setUsernameEdited(true) }} autoComplete="username" autoCapitalize="none" spellCheck={false} disabled={signingIn}/></label>
        <label>รหัสผ่าน<PasswordInput aria-label="รหัสผ่าน" name="password" required value={password} onChange={event => setPassword(event.target.value)} minLength={4} maxLength={256} autoComplete="current-password" disabled={signingIn}/></label>
        {loginError && <div className="admin-login-error"><ErrorNotice message={loginError}/></div>}
        <button className="platform-button primary" type="submit" disabled={signingIn}><LogIn size={17}/>{signingIn ? 'กำลังเข้าสู่หลังบ้าน…' : 'เข้าสู่หลังบ้าน'}</button>
      </form>
      {currentSession.bootstrap_required ? <div className="admin-first-setup"><h3>ตั้งรหัสผ่าน Super Admin ครั้งแรก</h3><p>ให้เจ้าของโฮสต์ตั้งรหัสผ่านก่อนเข้าสู่หลังบ้าน</p>{bootstrap?.configured && !bootstrap.ready && <p role="status">{bootstrap.message}</p>}<OwnerPasswordSteps username={suggestedUsername}/></div> : <details className="admin-first-setup"><summary>ลืมรหัสผ่านหรือต้องการความช่วยเหลือ</summary>{bootstrap?.configured && !bootstrap.ready && <p role="status">{bootstrap.message}</p>}<p>ใช้รหัสผ่านล่าสุดของบัญชี หากจำไม่ได้ ให้เจ้าของโฮสต์กำหนดรหัสผ่านใหม่</p><OwnerPasswordSteps username={suggestedUsername}/></details>}
      {currentSession.bootstrap_required && currentSession.admin_setup_available && <div className="admin-legacy-setup"><p>หากมีรหัสตั้งค่า Super admin จากโฮสต์อยู่แล้ว คุณยังใช้วิธีตั้งค่าบัญชีเดิมได้</p><button className="platform-button" type="button" onClick={onOpenSettings}><Settings size={17}/>ตั้งค่า Super admin ด้วยรหัสตั้งค่า</button></div>}
      {currentSession.user && <button className="platform-button admin-return-account" type="button" onClick={onOpenSettings}><ArrowLeft size={17}/>กลับไปบัญชีของฉัน</button>}
    </section> : <>
      <UserManagement session={currentSession} onSessionChanged={onSessionChanged} title="อนุมัติคำขอและจัดการสมาชิก"/>
    </>}
  </div>
}
