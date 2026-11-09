import { useEffect, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { ArrowLeft, ArrowUpRight, Images, LogOut, ShieldCheck, Users } from 'lucide-react'
import AdminDashboard from '../components/AdminDashboard'
import AdminImageArchive from './AdminImageArchive'
import { ErrorNotice } from '../components/PlatformShared'
import { usePlatformSession } from '../platform/api'

export default function AdminApp() {
  const platform = usePlatformSession()
  const [loggingOut, setLoggingOut] = useState(false)
  const [error, setError] = useState('')
  const [page, setPage] = useState<'members' | 'archive'>(() => window.location.hash === '#archive' ? 'archive' : 'members')
  const user = platform.session.user
  const owner = user?.is_super_admin && user.active && user.approval_status === 'approved'
  useEffect(() => {
    const changed = () => setPage(window.location.hash === '#archive' ? 'archive' : 'members')
    window.addEventListener('hashchange', changed)
    return () => window.removeEventListener('hashchange', changed)
  }, [])
  const navigate = (next: 'members' | 'archive') => { setPage(next); window.history.replaceState(null, '', next === 'archive' ? '#archive' : window.location.pathname); window.scrollTo({ top: 0 }) }
  const tabKeys = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const next = event.key === 'Home' ? 'members' : event.key === 'End' ? 'archive' : page === 'members' ? 'archive' : 'members'
    navigate(next); document.getElementById(`admin-${next}-tab`)?.focus()
  }
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
      {owner && <div className="admin-site-navigation" role="tablist" aria-label="เมนูหลังบ้าน"><button id="admin-members-tab" role="tab" aria-selected={page === 'members'} aria-controls="admin-page-panel" tabIndex={page === 'members' ? 0 : -1} onKeyDown={tabKeys} onClick={() => navigate('members')}><Users size={18}/>อนุมัติสมาชิก</button><button id="admin-archive-tab" role="tab" aria-selected={page === 'archive'} aria-controls="admin-page-panel" tabIndex={page === 'archive' ? 0 : -1} onKeyDown={tabKeys} onClick={() => navigate('archive')}><Images size={18}/>คลังภาพและผลตรวจ</button></div>}
      {error && <ErrorNotice message={error}/>}
      <div id="admin-page-panel" role={owner ? 'tabpanel' : undefined} aria-labelledby={owner ? page === 'archive' ? 'admin-archive-tab' : 'admin-members-tab' : undefined}>{owner && page === 'archive' ? <AdminImageArchive key={user.id} session={platform.session}/> : <AdminDashboard session={platform.session} loading={platform.loading} onSessionChanged={platform.refresh} onOpenSettings={() => { window.location.assign('/#settings') }}/>}</div>
    </main>
    <footer className="admin-site-footer">HelpMinths · Super Admin</footer>
  </div>
}
