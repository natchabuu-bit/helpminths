import { ArrowUpRight, Clock3, History, ScanLine } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { PlatformSession } from '../platform/api'
import { formatDate } from '../platform/api'
import type { AnalysisRecord } from './Scan'
import AnalysisHistory from './AnalysisHistory'
import '../styles/platform.css'

export type MyWorkTab = 'saved' | 'session'

interface MyWorkProps {
  session: PlatformSession
  records: AnalysisRecord[]
  initialTab?: MyWorkTab
  onOpenAnalysis: (id: string) => void
  onOpenSession: (record: AnalysisRecord) => void
  onNewScan: () => void
  onOpenReferrals: () => void
  onOpenSettings?: () => void
}

export default function MyWork({ session, records, initialTab, onOpenAnalysis, onOpenSession, onNewScan, onOpenReferrals, onOpenSettings }: MyWorkProps) {
  const [tab, setTab] = useState<MyWorkTab>(() => initialTab ?? (session.user ? 'saved' : 'session'))
  const id = useId()
  const savedTab = useRef<HTMLButtonElement>(null), sessionTab = useRef<HTMLButtonElement>(null)
  // Private clinical records belong to the authenticated history endpoint.
  // Only the demonstration or anonymous, non-persistent results can appear here.
  const sessionRecords = records.filter(record => record.storage !== 'private' && (record.mode === 'demo' || (!session.configured && !session.user)))

  useEffect(() => { setTab(initialTab ?? (session.user ? 'saved' : 'session')) }, [initialTab, session.user?.id])

  const changeTab = (next: MyWorkTab) => setTab(next)
  const tabKeys = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const next = event.key === 'Home' ? 'saved' : event.key === 'End' ? 'session' : tab === 'saved' ? 'session' : 'saved'
    changeTab(next)
    ;(next === 'saved' ? savedTab : sessionTab).current?.focus()
  }

  return <div className="my-work-page">
    <div className="my-work-heading"><div><h1>งานของฉัน</h1><p>ผลตรวจและคำตอบจากผู้เชี่ยวชาญในที่เดียว</p></div><button type="button" className="platform-button primary" onClick={onNewScan}><ScanLine size={18}/>ตรวจภาพใหม่</button></div>
    <div className="my-work-tabs" role="tablist" aria-label="รายการงานของฉัน">
      <button ref={savedTab} type="button" id={`${id}-saved-tab`} role="tab" aria-selected={tab === 'saved'} aria-controls={`${id}-saved-panel`} tabIndex={tab === 'saved' ? 0 : -1} onClick={() => changeTab('saved')} onKeyDown={tabKeys}><History size={18}/>ประวัติการตรวจ</button>
      <button ref={sessionTab} type="button" id={`${id}-session-tab`} role="tab" aria-label="ผลในเซสชันนี้" aria-selected={tab === 'session'} aria-controls={`${id}-session-panel`} tabIndex={tab === 'session' ? 0 : -1} onClick={() => changeTab('session')} onKeyDown={tabKeys}><Clock3 size={18}/>ผลในเซสชันนี้{sessionRecords.length > 0 && <span aria-hidden="true">{sessionRecords.length}</span>}</button>
    </div>
    <section className="my-work-panel" id={`${id}-saved-panel`} role="tabpanel" aria-labelledby={`${id}-saved-tab`} hidden={tab !== 'saved'} tabIndex={0}>
      {tab === 'saved' && <><AnalysisHistory embedded session={session} onOpenAnalysis={onOpenAnalysis} onOpenReferrals={onOpenReferrals}/>{!session.user && onOpenSettings && <div className="my-work-account-action"><button type="button" className="platform-button primary" onClick={onOpenSettings}>เข้าสู่ระบบเพื่อดูประวัติ</button></div>}</>}
    </section>
    <section className="my-work-panel" id={`${id}-session-panel`} role="tabpanel" aria-labelledby={`${id}-session-tab`} hidden={tab !== 'session'} tabIndex={0}>
      {tab === 'session' && <><p className="my-work-session-note">ผลในแท็บนี้อยู่เฉพาะการเปิดเว็บครั้งนี้ และอาจหายเมื่อรีเฟรชหรือปิดหน้าเว็บ</p>{sessionRecords.length === 0 ? <div className="empty-state my-work-empty"><div className="empty-icon"><History size={30}/></div><h2>ยังไม่มีผลในเซสชันนี้</h2><p>เริ่มตรวจภาพใหม่ หรือเปิดตัวอย่างจากหน้าตรวจวิเคราะห์</p><button type="button" className="platform-button primary" onClick={onNewScan}>เริ่มตรวจวิเคราะห์</button></div> : <div className="my-work-grid">{sessionRecords.map(record => <button type="button" className="history-card" key={record.id} onClick={() => onOpenSession(record)}><img src={record.imageUrl} alt={`ภาพ ${record.filename}`}/><div><span className={`record-mode ${record.mode}`}>{record.mode === 'demo' ? 'ข้อมูลสาธิต' : 'ผลจากโมเดล'}</span><h3>{record.filename}</h3><p><Clock3 size={14}/><time dateTime={record.createdAt}>{formatDate(record.createdAt)}</time></p><div className="history-card-bottom"><strong>{record.detections.length} ตำแหน่ง</strong><span>เปิดผลตรวจ<ArrowUpRight size={16}/></span></div></div></button>)}</div>}</>}
    </section>
  </div>
}
