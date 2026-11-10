import { BarChart3, Box, ChevronDown, CircleHelp, FileText, FolderOpen, MoreHorizontal, ScanLine, ShieldCheck, Activity } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import type { PlatformSession } from '../platform/api'

type Destination = 'scan' | 'atlas' | 'dashboard' | 'work' | 'verification' | 'reports' | 'performance'
interface NavigationProps {
  page: string
  session: PlatformSession
  brand: ReactNode
  onHome: () => void
  onNavigate: (target: Destination) => void
  onHelp: () => void
  children: ReactNode
}

const primaryItems = [
  { id: 'scan', label: 'ตรวจวิเคราะห์', icon: ScanLine },
  { id: 'atlas', label: 'Atlas 3D', icon: Box },
  { id: 'dashboard', label: 'สถิติโรค', icon: BarChart3 },
  { id: 'work', label: 'งานของฉัน', icon: FolderOpen },
] as const
const managementItems = [
  { id: 'verification', label: 'ทบทวนโดยผู้เชี่ยวชาญ', icon: ShieldCheck },
  { id: 'reports', label: 'รายงาน', icon: FileText },
  { id: 'performance', label: 'ประเมินโมเดล', icon: Activity },
] as const

export default function AppNavigation({ page, session, brand, onHome, onNavigate, onHelp, children }: NavigationProps) {
  const [managementOpen, setManagementOpen] = useState(false)
  const management = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null)
  const popoverId = useId()
  const user = session.user
  const canManage = session.configured && !session.connection_error && !!user && user.active && user.approval_status === 'approved' && ['admin', 'reviewer', 'lab'].includes(user.role)
  const activeManagement = managementItems.some(item => item.id === page)
  useEffect(() => { setManagementOpen(false) }, [page, user?.id, user?.role, canManage])
  useEffect(() => {
    if (!managementOpen) return
    management.current?.querySelector<HTMLButtonElement>('.management-popover button')?.focus()
    const outside = (event: Event) => { if (event.target instanceof Node && !management.current?.contains(event.target)) setManagementOpen(false) }
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setManagementOpen(false); trigger.current?.focus() }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('focusin', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('focusin', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [managementOpen])
  const managementKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!managementOpen || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const buttons = [...(management.current?.querySelectorAll<HTMLButtonElement>('.management-popover button') ?? [])]
    if (!buttons.length) return
    event.preventDefault()
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length
    buttons[next]?.focus()
  }
  const navigate = (target: Destination) => {
    if (managementOpen) trigger.current?.focus()
    setManagementOpen(false)
    onNavigate(target)
  }
  return <header className={`app-navigation ${canManage ? 'has-management' : ''}`}>
    <div className="app-navigation-inner">
      <button className="app-navigation-brand" type="button" onClick={onHome} aria-label="HelpMinths หน้าหลัก" aria-current={page === 'home' ? 'page' : undefined}>{brand}</button>
      <nav className="primary-nav" aria-label="เมนูหลัก">
        {primaryItems.map(item => <button key={item.id} type="button" className={`primary-nav-item ${page === item.id ? 'is-current' : ''}`} aria-current={page === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}><item.icon size={19} aria-hidden="true"/><span>{item.label}</span></button>)}
      </nav>
      <div className="app-navigation-actions">
        {canManage && <div className="management-menu" ref={management} onKeyDown={managementKeys}>
          <button ref={trigger} type="button" className={`management-trigger ${activeManagement ? 'is-current' : ''}`} aria-label="จัดการ" aria-expanded={managementOpen} aria-controls={popoverId} onClick={() => setManagementOpen(value => !value)} onKeyDown={event => { if (event.key === 'ArrowDown' && !managementOpen) { event.preventDefault(); setManagementOpen(true) } }}><MoreHorizontal size={20} aria-hidden="true"/><span>จัดการ</span><ChevronDown className="management-chevron" size={14} aria-hidden="true"/></button>
          {managementOpen && <section id={popoverId} className="management-popover" aria-label="เมนูจัดการ"><p>จัดการ</p>{managementItems.map(item => <button key={item.id} type="button" onClick={() => navigate(item.id)} aria-current={page === item.id ? 'page' : undefined}><item.icon size={19} aria-hidden="true"/><span>{item.label}</span></button>)}</section>}
        </div>}
        <button type="button" className="navigation-help icon-button" aria-label="คู่มือการใช้งาน" onClick={() => { setManagementOpen(false); onHelp() }}><CircleHelp size={20} aria-hidden="true"/></button>
        {children}
      </div>
    </div>
  </header>
}
