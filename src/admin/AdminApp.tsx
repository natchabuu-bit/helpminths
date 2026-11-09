import { useState } from 'react'
import { ArrowLeft, ArrowUpRight, LogOut, ShieldCheck } from 'lucide-react'
import AdminDashboard from '../components/AdminDashboard'
import { ErrorNotice } from '../components/PlatformShared'
import { usePlatformSession } from '../platform/api'

export default function AdminApp() {
  const platform = usePlatformSession()
  const [loggingOut, setLoggingOut] = useState(false)
  const [error, setError] = useState('')
  const user = platform.session.user
  const owner = user?.is_super_admin && user.active && user.approval_status === 'approved'
  const logout = async () => {
    if (loggingOut) return
    setLoggingOut(true); setError('')
    try { await platform.logout() }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'ออกจากระบบไม่ได้ กรุณาลองอีกครั้ง') }
    finally { setLoggingOut(false) }
  }
  return <div className="admin-site">
    <a className="admin-skip-link" href="#admin-content">ข้ามไปเนื้อหาหลัก</a>
    <header className="admin-site-header">
      <a className="admin-site-brand" href="/admin/" aria-label="HelpMinths หลังบ้าน"><span><ShieldCheck size={25}/></span><div><strong>HelpMinths</strong><small>SUPER ADMIN</small></div></a>
      <div className="admin-site-header-actions">
        <a className="admin-public-link" href="/" aria-label="กลับไป HelpMinths"><ArrowLeft size={17}/><span>กลับไป HelpMinths</span></a>
        {owner && <button className="admin-logout" type="button" onClick={() => void logout()} disabled={loggingOut}><LogOut size={17}/><span>{loggingOut ? 'กำลังออก…' : 'ออกจากระบบ'}</span></button>}
      </div>
    </header>
    <main id="admin-content" className="admin-site-content" tabIndex={-1}>
      {owner && <div className="admin-site-account"><span><i aria-hidden="true"/>Super Admin</span><strong>{user.full_name || user.username}</strong><a href="/#settings">ตั้งค่าบัญชี<ArrowUpRight size={15}/></a></div>}
      {error && <ErrorNotice message={error}/>}
      <AdminDashboard session={platform.session} loading={platform.loading} onSessionChanged={platform.refresh} onOpenSettings={() => { window.location.assign('/#settings') }}/>
    </main>
    <footer className="admin-site-footer">HelpMinths · จัดการสมาชิก</footer>
  </div>
}
