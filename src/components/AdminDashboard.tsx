import { ArrowLeft, ClipboardCheck, Database, LogIn, RefreshCw, Settings, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import type { PlatformSession } from '../platform/api'
import { ErrorNotice, LoadingNotice, PlatformHeading } from './PlatformShared'
import { UserManagement } from './PlatformSettings'
import '../styles/account.css'
import '../styles/admin.css'

interface AdminDashboardProps {
  session: PlatformSession
  loading?: boolean
  onOpenSettings: () => void
  onSessionChanged?: () => Promise<void>
}

export default function AdminDashboard({ session, loading = false, onOpenSettings, onSessionChanged }: AdminDashboardProps) {
  const [rechecking, setRechecking] = useState(false)
  const [error, setError] = useState('')
  const accountReady = session.configured && !session.connection_error
  const isOwner = accountReady && session.user?.is_super_admin === true
  const recheck = async () => {
    if (!onSessionChanged) return
    setRechecking(true); setError('')
    try { await onSessionChanged() }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'ตรวจสอบระบบบัญชีไม่ได้') }
    finally { setRechecking(false) }
  }

  return <div className="platform-page account-page admin-dashboard">
    <PlatformHeading kicker="SUPER ADMIN" title="หลังบ้าน Super Admin" description="พิจารณาคำขอสมัครสมาชิก อนุมัติสิทธิ์ผู้เชี่ยวชาญ และจัดการบัญชีผู้ใช้">
      {isOwner && <button className="platform-button" onClick={onOpenSettings}><Settings size={17}/>บัญชีและการตั้งค่า</button>}
    </PlatformHeading>
    {error && <ErrorNotice message={error}/>}
    {loading ? <LoadingNotice/> : !accountReady ? <section className="platform-card admin-access-gate" aria-labelledby="admin-gate-title">
      <Database size={34}/>
      <h2 id="admin-gate-title">ยังเชื่อมต่อระบบบัญชีไม่ได้</h2>
      <p>หลังบ้านจะพร้อมใช้งานเมื่อเชื่อมต่อระบบบัญชีได้ กรุณาตรวจสอบการเชื่อมต่อ แล้วเข้าสู่ระบบด้วยบัญชี Super Admin ของคุณ</p>
      <div className="platform-actions">
        {onSessionChanged && <button className="platform-button primary" disabled={rechecking} onClick={() => void recheck()}><RefreshCw size={17} className={rechecking ? 'spin' : ''}/>{rechecking ? 'กำลังตรวจสอบ…' : 'ตรวจสอบระบบอีกครั้ง'}</button>}
        <button className="platform-button" onClick={onOpenSettings}><Settings size={17}/>ไปหน้าบัญชีและการตั้งค่า</button>
      </div>
    </section> : !session.user ? <section className="platform-card admin-access-gate" aria-labelledby="admin-gate-title">
      <ShieldCheck size={34}/>
      <h2 id="admin-gate-title">เข้าสู่ระบบ Super Admin</h2>
      <p>เข้าสู่ระบบด้วยบัญชีเจ้าของระบบเพื่อดูคำขอที่รออนุมัติและจัดการสิทธิ์สมาชิก หลังเข้าสู่ระบบสำเร็จจะกลับมาที่หลังบ้านนี้</p>
      <button className="platform-button primary" onClick={onOpenSettings}><LogIn size={17}/>เข้าสู่ระบบ Super Admin</button>
      {session.bootstrap_required && <div className="admin-first-setup"><h3>ยังไม่ได้สร้างบัญชี Super Admin?</h3>{session.admin_setup_available ? <p>ไปหน้าบัญชีและการตั้งค่า แล้วเลือก “ตั้งค่า Super admin ครั้งแรก” ใช้รหัสตั้งค่าจากโฮสต์และกำหนดรหัสผ่านของคุณเอง</p> : <p>เจ้าของโฮสต์ต้องเพิ่ม <code>HELPMINTHS_ADMIN_SETUP_TOKEN</code> เป็นค่าสุ่มส่วนตัว 32–256 ตัวอักษรอังกฤษหรือตัวเลขใน Environment ของ Render แล้ว deploy จากนั้นไปหน้าบัญชีและการตั้งค่า เลือก “ตั้งค่า Super admin ครั้งแรก” เพื่อเปิดบัญชีเจ้าของระบบ ชื่อบัญชีเพียงอย่างเดียวไม่เปิดสิทธิ์ผู้ดูแล</p>}</div>}
    </section> : !isOwner ? <section className="platform-card admin-access-gate" aria-labelledby="admin-gate-title">
      <ShieldCheck size={34}/>
      <h2 id="admin-gate-title">บัญชีนี้ไม่มีสิทธิ์เข้าหลังบ้าน</h2>
      <p>คุณเข้าสู่ระบบด้วยบัญชี <strong>{session.user.username}</strong> หน้านี้เปิดให้เฉพาะ Super Admin เจ้าของระบบเท่านั้น</p>
      <button className="platform-button" onClick={onOpenSettings}><ArrowLeft size={17}/>กลับไปบัญชีของฉัน</button>
    </section> : <>
      <section className="admin-owner-banner" aria-label="บัญชีผู้ดูแลปัจจุบัน"><div className="admin-owner-identity"><ShieldCheck size={27}/><div><span>กำลังจัดการระบบในนาม</span><strong>{session.user?.username}</strong></div></div><span className="platform-badge success">Super Admin · เจ้าของระบบ</span></section>
      <section className="platform-card admin-approval-guide" aria-labelledby="admin-approval-title"><div className="platform-card-heading"><div><h2 id="admin-approval-title">พิจารณาคำขอสมัครสมาชิก</h2><p>คำขอที่รออนุมัติจะแสดงด้านล่าง สมาชิกจะเข้าสู่ระบบได้เมื่อคุณอนุมัติบัญชี</p></div><ClipboardCheck size={26}/></div><ol><li>ตรวจสอบชื่อบัญชีและประเภทสิทธิ์ที่สมาชิกขอ</li><li>เลือกสิทธิ์ที่จะอนุมัติ แล้วกด “อนุมัติบัญชี” หรือ “ไม่อนุมัติบัญชี”</li><li>ตรวจสอบรายละเอียดในหน้าต่างยืนยันก่อนดำเนินการ</li></ol></section>
      <UserManagement session={session} onSessionChanged={onSessionChanged} title="อนุมัติคำขอและจัดการสมาชิก"/>
    </>}
  </div>
}
