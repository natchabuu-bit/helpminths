import { useEffect, useState, useSyncExternalStore } from 'react'
import { Check, ChevronDown, Download, Info, LoaderCircle, WifiOff } from 'lucide-react'
import { getOfflineStatus, subscribeOfflineStatus } from '../offline'
import '../styles/offline.css'

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export default function OfflinePanel() {
  const state = useSyncExternalStore(subscribeOfflineStatus, getOfflineStatus)
  const [expanded, setExpanded] = useState(false)
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null)
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    const beforeInstall = (event: Event) => {
      event.preventDefault()
      setInstallPrompt(event as InstallPromptEvent)
    }
    const installed = () => setInstallPrompt(null)
    window.addEventListener('beforeinstallprompt', beforeInstall)
    window.addEventListener('appinstalled', installed)
    return () => {
      window.removeEventListener('beforeinstallprompt', beforeInstall)
      window.removeEventListener('appinstalled', installed)
    }
  }, [])

  const install = async () => {
    if (!installPrompt || installing) return
    setInstalling(true)
    try {
      await installPrompt.prompt()
      await installPrompt.userChoice
    } catch {
      setExpanded(true)
    } finally {
      setInstallPrompt(null)
      setInstalling(false)
    }
  }

  // A development server deliberately does not install an offline copy.
  if (import.meta.env.DEV && state.online) return null
  const ready = state.status === 'ready' || state.status === 'update-available'
  const busy = state.status === 'idle' || state.status === 'installing'
  const title = !state.online
    ? ready ? 'กำลังใช้งานออฟไลน์' : 'เครือข่ายไม่พร้อมใช้งาน'
    : ready ? 'พร้อมใช้งานออฟไลน์' : busy ? 'กำลังเตรียมแอพสำหรับออฟไลน์…' : 'ยังไม่พร้อมใช้งานออฟไลน์'
  const Icon = !state.online ? WifiOff : ready ? Check : busy ? LoaderCircle : Info

  return <section className={`offline-panel ${!state.online ? 'is-offline' : ''}`} aria-label="การใช้งานออฟไลน์">
    <div className="offline-overview">
      <Icon size={18} className={busy && state.online ? 'spin' : ''} aria-hidden="true" />
      <div className="offline-copy" role="status">
        <strong>{title}</strong>
        <p>{ready
          ? 'Atlas 3D และตัวอย่างใช้งานได้โดยไม่ใช้เน็ต · การตรวจ AI ยังต้องเชื่อมบริการ'
          : busy ? 'เปิดหน้านี้พร้อมอินเทอร์เน็ตไว้จนกว่าจะขึ้นว่าพร้อมใช้งานออฟไลน์'
          : 'เชื่อมอินเทอร์เน็ตแล้วเปิดใหม่ เพื่อเตรียมแอพในเบราว์เซอร์ที่รองรับ'}</p>
      </div>
      <div className="offline-actions">
        {installPrompt && ready && <button className="offline-install" onClick={() => void install()} disabled={installing}><Download size={14} />{installing ? 'กำลังเปิด…' : 'ติดตั้งแอพ'}</button>}
        <button className="offline-details-toggle" onClick={() => setExpanded(old => !old)} aria-expanded={expanded} aria-controls="offline-details">วิธีใช้ออฟไลน์ <ChevronDown size={14} /></button>
      </div>
    </div>
    {expanded && <div className="offline-details" id="offline-details">
      <p><strong>เริ่มต้น:</strong> เปิด HelpMinths ขณะมีอินเทอร์เน็ต และรอข้อความ “พร้อมใช้งานออฟไลน์” ก่อนปิดเน็ต จากนั้นเปิดแอพหรือเว็บไซต์เดิมด้วยเบราว์เซอร์เดิมได้</p>
      <p><strong>ติดตั้งบนมือถือ:</strong> Android ใช้เมนูเบราว์เซอร์ → ติดตั้งแอพ / เพิ่มไปยังหน้าจอหลัก ส่วน iPhone ใช้ Safari → แชร์ → เพิ่มไปยังหน้าจอโฮม ชื่อเมนูอาจต่างกันตามอุปกรณ์ หลังติดตั้งให้เปิดจากไอคอนขณะออนไลน์ และรอให้พร้อมใช้งานออฟไลน์อีกครั้งก่อนปิดเน็ต</p>
      <p><strong>เมื่อไม่มีเน็ต:</strong> อ่านเนื้อหา หมุนและซูม Atlas 3D ดูผลสาธิต เลือกหรือถ่ายภาพเพื่อดูบนเครื่องได้ การตรวจ AI จริงต้องเชื่อมบริการที่ติดตั้งโมเดลไว้ ภาพจะไม่ถูกส่งตรวจอัตโนมัติเมื่อเน็ตกลับมา</p>
      <p>ภาพและประวัติยังอยู่เฉพาะเซสชัน เมื่อปิดหรือรีเฟรชจะหายไป หากล้างข้อมูลเว็บไซต์ ใช้โหมดส่วนตัว หรือเครื่องลบข้อมูลแอพเพื่อเพิ่มพื้นที่ ต้องเปิดออนไลน์เพื่อเตรียมใหม่</p>
      {state.status === 'update-available' && <p className="offline-update">มีเวอร์ชันใหม่พร้อมแล้ว ปิด HelpMinths ทุกแท็บและหน้าต่างแอพ แล้วเปิดใหม่เพื่อรับการอัปเดต</p>}
    </div>}
  </section>
}
