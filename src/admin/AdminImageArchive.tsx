import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, CalendarDays, ImageOff, Images, RefreshCw, Search, ShieldCheck, UserRound } from 'lucide-react'
import type { ExpertReview, PlatformAnalysis, PlatformSession } from '../platform/api'
import { buildQuery, formatDate } from '../platform/api'
import { ErrorNotice, LoadingNotice, PlatformHeading, usePlatformResource } from '../components/PlatformShared'
import { PrivateReferralImage } from '../components/ReferralPanel'
import DiagnosisComparison from '../components/DiagnosisComparison'
import '../styles/backoffice.css'

interface ArchiveAccount { id: string; username: string; full_name: string | null; image_count?: number }
interface ArchiveImage {
  id: string; owner_id: string; owner: ArchiveAccount; created_at: string; examined_at: string; examined_date: string
  source: 'analysis' | 'supplemental'; status: string; sample_code: string; analysis_id: string | null
  referral_id: string | null; attachment_id: string | null; width: number; height: number
  image_url: string | null; image_available: boolean; operational_deleted: boolean; review_status: string | null
}
interface ArchiveMessage { id: string; action: string; comment: string; created_at: string; author_name?: string; author_username?: string; author_role?: string }
interface ArchiveAttachment { id: string; created_at: string; comment?: string; archive_image_id?: string | null }
interface ArchiveReferral {
  id: string; status: string; reason: string; created_at: string; response_comment?: string | null
  reviewer_username?: string | null; reviewer_name?: string | null; responded_at?: string | null
  latest_review?: ExpertReview | null; messages: ArchiveMessage[]; attachments: ArchiveAttachment[]
}
interface ArchiveDetail extends ArchiveImage {
  analysis: PlatformAnalysis | null; reviews: ExpertReview[]; referrals: ArchiveReferral[]
  quality?: { status: string; checks?: { label?: string; message?: string; status: string }[] } | null
}
interface ArchivePage { items: ArchiveImage[]; total: number; limit: number; offset: number; backfill_remaining?: number }
interface Filters { owner_id: string; date_from: string; date_to: string; status: string; source: string; q: string }
const emptyFilters: Filters = { owner_id: '', date_from: '', date_to: '', status: '', source: '', q: '' }
const endpoint = '/admin/image-archive'
const pageSize = 12
const statusNames: Record<string, string> = { processing: 'กำลังวิเคราะห์', completed: 'มีผล AI', quality_rejected: 'หยุดตรวจ: คุณภาพภาพ', failed: 'วิเคราะห์ไม่สำเร็จ', cancelled: 'ยกเลิกการรอผล', missing_image: 'ไม่มีไฟล์ภาพเดิม', received: 'รับภาพแล้ว' }
const reviewNames: Record<string, string> = { pending: 'รอผู้เชี่ยวชาญ', in_review: 'กำลังทบทวน', verified: 'ผู้เชี่ยวชาญยืนยันแล้ว', confirmed: 'ผู้เชี่ยวชาญยืนยันแล้ว', needs_more: 'ขอภาพเพิ่มเติม', needs_additional_review: 'ต้องตรวจเพิ่ม', not_available: 'ยังไม่มีผลให้ทบทวน' }
const messageNames: Record<string, string> = { reply: 'คำตอบจากผู้เชี่ยวชาญ', request_more: 'ขอภาพเพิ่มเติม', confirmed: 'ยืนยันผลตรวจ', review: 'บันทึกการทบทวน', request: 'ส่งภาพให้ผู้เชี่ยวชาญ', attachment: 'ส่งภาพเพิ่มเติม' }
function ownerName(owner: ArchiveAccount) { return owner.full_name || owner.username }
function dayLabel(value: string) {
  const date = new Date(`${value}T12:00:00+07:00`)
  return Number.isFinite(date.valueOf()) ? new Intl.DateTimeFormat('th-TH', { dateStyle: 'long', timeZone: 'Asia/Bangkok' }).format(date) : 'ไม่ระบุวันที่'
}
function ArchiveStatus({ item }: { item: ArchiveImage }) {
  const confirmed = item.review_status === 'verified'
  if (item.source === 'supplemental') return <span className="admin-archive-status">ภาพเพิ่มเติม</span>
  return <span className={`admin-archive-status ${confirmed ? 'is-confirmed' : item.status === 'failed' || item.status === 'missing_image' ? 'is-warning' : ''}`}>{confirmed ? <ShieldCheck size={14}/> : null}{confirmed ? 'ผู้เชี่ยวชาญยืนยันแล้ว' : statusNames[item.status] ?? 'ภาพในคลัง'}</span>
}

function ArchiveThumbnail({ item, session }: { item: ArchiveImage; session: PlatformSession }) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (!('IntersectionObserver' in window)) { setVisible(true); return }
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect() } }, { rootMargin: '180px' })
    if (ref.current) observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])
  return <div ref={ref} className="admin-archive-thumbnail">{item.image_available && item.image_url ? visible ? <PrivateReferralImage session={session} path={item.image_url} alt={`ภาพส่งตรวจ ${item.sample_code || 'ไม่ระบุรหัส'}`}/> : <Images size={28} aria-hidden="true"/> : <div className="admin-archive-unavailable"><ImageOff size={27}/><span>ไม่มีไฟล์ภาพเดิม</span></div>}</div>
}

export default function AdminImageArchive({ session }: { session: PlatformSession }) {
  const enabled = session.configured && !session.connection_error && session.user?.is_super_admin === true && session.user.role === 'admin' && session.user.active && session.user.approval_status === 'approved'
  const [draft, setDraft] = useState<Filters>(emptyFilters), [filters, setFilters] = useState<Filters>(emptyFilters), [offset, setOffset] = useState(0), [selected, setSelected] = useState('')
  const heading = useRef<HTMLDivElement>(null)
  const identity = `${session.user?.id ?? ''}:${session.user?.role ?? ''}`
  useEffect(() => { setSelected(''); setOffset(0); setDraft(emptyFilters); setFilters(emptyFilters) }, [identity])
  const accounts = usePlatformResource<{ items: ArchiveAccount[]; backfill_remaining?: number }>(`${endpoint}/accounts`, session, enabled)
  const list = usePlatformResource<ArchivePage>(`${endpoint}${buildQuery({ ...filters, limit: pageSize, offset })}`, session, enabled && !selected)
  const detail = usePlatformResource<ArchiveDetail>(`${endpoint}/${encodeURIComponent(selected)}`, session, enabled && !!selected)
  const backfillRemaining = Math.max(accounts.value?.backfill_remaining ?? 0, list.value?.backfill_remaining ?? 0)
  useEffect(() => {
    if (!enabled || selected || !backfillRemaining || list.loading || accounts.loading || list.error || accounts.error) return
    const timer = window.setTimeout(() => { list.reload(); accounts.reload() }, 1000)
    return () => window.clearTimeout(timer)
  }, [enabled, selected, backfillRemaining, list.loading, accounts.loading, list.error, accounts.error])
  useEffect(() => { if (selected) heading.current?.focus({ preventScroll: true }); window.scrollTo({ top: 0 }) }, [selected])
  const open = (id: string) => setSelected(id)
  const refresh = () => { if (selected) detail.reload(); else { list.reload(); accounts.reload() } }
  const change = (key: keyof Filters, value: string) => setDraft(previous => ({ ...previous, [key]: value }))
  if (!enabled) return null
  if (selected) return <div className="platform-page admin-archive-page admin-archive-detail" data-archive-id={selected}>
    <div className="admin-archive-top-actions"><button type="button" className="platform-button" onClick={() => setSelected('')}><ArrowLeft size={18}/>กลับคลังภาพ</button><button type="button" className="platform-button" onClick={refresh}><RefreshCw size={16}/>อัปเดตข้อมูล</button></div>
    <div ref={heading} tabIndex={-1} className="admin-archive-detail-heading"><PlatformHeading kicker="PRIVATE IMAGE ARCHIVE" title="ภาพและผลตรวจ" description="ผล AI เดิมและประวัติคำตอบของผู้เชี่ยวชาญ"/></div>
    {detail.loading ? <LoadingNotice>กำลังเปิดภาพและผลตรวจ…</LoadingNotice> : detail.error ? <ErrorNotice message={detail.error} onRetry={detail.reload}/> : detail.value ? <ArchiveDetailView item={detail.value} session={session} onOpen={open}/> : null}
  </div>
  const groups = new Map<string, { date: string; owners: Map<string, { owner: ArchiveAccount; items: ArchiveImage[] }> }>()
  for (const item of list.value?.items ?? []) {
    let day = groups.get(item.examined_date)
    if (!day) { day = { date: item.examined_date, owners: new Map() }; groups.set(item.examined_date, day) }
    let account = day.owners.get(item.owner_id)
    if (!account) { account = { owner: item.owner, items: [] }; day.owners.set(item.owner_id, account) }
    account.items.push(item)
  }
  return <div className="platform-page admin-archive-page">
    <PlatformHeading kicker="PRIVATE IMAGE ARCHIVE" title="คลังภาพและผลตรวจ" description="ภาพทุกบัญชี แยกตามวันที่ส่งตรวจ พร้อมผล AI และคำตอบผู้เชี่ยวชาญ"><button type="button" className="platform-button" onClick={refresh}><RefreshCw size={16}/>อัปเดตข้อมูล</button></PlatformHeading>
    <form className="admin-archive-filters" aria-label="กรองคลังภาพ" onSubmit={event => { event.preventDefault(); setOffset(0); setFilters({ ...draft, q: draft.q.trim() }) }}>
      <label>บัญชีผู้ส่ง<select aria-label="บัญชีผู้ส่ง" value={draft.owner_id} onChange={event => change('owner_id', event.target.value)}><option value="">ทุกบัญชี</option>{accounts.value?.items.map(account => <option key={account.id} value={account.id}>{ownerName(account)} · {account.username}</option>)}</select></label>
      <label className="admin-archive-search">ค้นหาภาพ<input type="search" value={draft.q} onChange={event => change('q', event.target.value)} placeholder="รหัสภาพ หรือชื่อบัญชี" maxLength={100}/></label>
      <details className="admin-archive-advanced"><summary><CalendarDays size={17}/>วันที่และตัวกรองเพิ่มเติม</summary><div>
        <label>ตั้งแต่วันที่<input type="date" value={draft.date_from} max={draft.date_to || undefined} onChange={event => change('date_from', event.target.value)}/></label>
        <label>ถึงวันที่<input type="date" value={draft.date_to} min={draft.date_from || undefined} onChange={event => change('date_to', event.target.value)}/></label>
        <label>สถานะผลตรวจ<select aria-label="สถานะผลตรวจ" value={draft.status} onChange={event => change('status', event.target.value)}><option value="">ทุกสถานะ</option>{Object.entries(statusNames).filter(([value]) => value !== 'received').map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>ประเภทภาพ<select aria-label="ประเภทภาพ" value={draft.source} onChange={event => change('source', event.target.value)}><option value="">ภาพทั้งหมด</option><option value="analysis">ภาพส่งตรวจ AI</option><option value="supplemental">ภาพเพิ่มเติมให้ผู้เชี่ยวชาญ</option></select></label>
      </div></details>
      <div className="admin-archive-filter-actions"><button type="submit" className="platform-button primary"><Search size={17}/>ค้นหาภาพ</button><button type="button" className="platform-button" onClick={() => { setDraft(emptyFilters); setFilters(emptyFilters); setOffset(0) }}>ล้างตัวกรอง</button></div>
    </form>
    {accounts.error && <ErrorNotice message={accounts.error} onRetry={accounts.reload}/>}
    {backfillRemaining > 0 && <p className="admin-archive-importing" role="status">กำลังรวบรวมภาพเดิมเข้าคลัง รายการจะอัปเดตให้อัตโนมัติ</p>}
    <div className="admin-archive-results-heading"><span><Images size={18}/>{list.value ? `พบ ${list.value.total.toLocaleString('th-TH')} ภาพ` : 'ภาพในคลัง'}</span><span><ShieldCheck size={15}/>เฉพาะ Super Admin</span></div>
    {list.loading ? <LoadingNotice>กำลังอ่านคลังภาพ…</LoadingNotice> : list.error ? <ErrorNotice message={list.error} onRetry={list.reload}/> : !list.value?.items.length ? <div className="admin-archive-empty"><Images size={36}/><h2>ยังไม่มีภาพในรายการนี้</h2><p>ภาพที่ส่งตรวจและภาพเพิ่มเติมจะจัดเก็บที่นี่ ลองเปลี่ยนตัวกรองเพื่อดูรายการอื่น</p></div> : <>
      {[...groups.values()].map(group => <section className="admin-archive-day" key={group.date} aria-label={`ภาพวันที่ ${dayLabel(group.date)}`}><h2><CalendarDays size={20}/>{dayLabel(group.date)}</h2>{[...group.owners.values()].map(account => <section className="admin-archive-account-group" key={account.owner.id} aria-label={`ภาพของ ${account.owner.username}`}><h3><UserRound size={18}/><span>{ownerName(account.owner)}<small>บัญชี {account.owner.username}</small></span></h3><div className="admin-archive-grid">{account.items.map(item => <article className="admin-archive-card" key={item.id}><button type="button" onClick={() => open(item.id)} aria-label={`เปิดภาพ ${item.sample_code || 'ภาพส่งตรวจ'} ของ ${item.owner.username}`}><ArchiveThumbnail item={item} session={session}/><div className="admin-archive-card-content"><ArchiveStatus item={item}/><h4>{item.sample_code || 'ภาพส่งตรวจ'}</h4><time dateTime={item.examined_at || item.created_at}>{formatDate(item.examined_at || item.created_at)}</time>{item.operational_deleted && <span className="admin-archive-retained">นำออกจากประวัติผู้ใช้แล้ว · เก็บในคลัง</span>}<span className="admin-archive-open">เปิดภาพและผลตรวจ<ArrowRight size={16}/></span></div></button></article>)}</div></section>)}</section>)}
      <div className="platform-pagination admin-archive-pagination"><span>แสดง {offset + 1}–{offset + list.value.items.length} จาก {list.value.total} ภาพ</span><button type="button" className="platform-button" disabled={!offset} onClick={() => { setOffset(value => Math.max(0, value - pageSize)); window.scrollTo({ top: 0 }) }}>ก่อนหน้า</button><button type="button" className="platform-button" disabled={offset + list.value.items.length >= list.value.total} onClick={() => { setOffset(value => value + pageSize); window.scrollTo({ top: 0 }) }}>ถัดไป</button></div>
    </>}
  </div>
}

function ArchiveDetailView({ item, session, onOpen }: { item: ArchiveDetail; session: PlatformSession; onOpen: (id: string) => void }) {
  const analysis = item.analysis
  const currentReferral = analysis ? item.referrals.find(referral => referral.id === analysis.referral_id) : undefined
  const expertMessages = item.referrals.flatMap(referral => referral.messages ?? []).filter(message => ['reply', 'request_more', 'confirmed', 'review'].includes(message.action)).sort((a, b) => b.created_at.localeCompare(a.created_at))
  return <>
    <section className="admin-archive-identity" aria-label="ข้อมูลภาพในคลัง"><div><span>เจ้าของภาพ</span><h2>{ownerName(item.owner)}</h2><p>บัญชี {item.owner.username}</p></div><div><span>วันที่ส่งตรวจ</span><strong>{formatDate(item.examined_at || item.created_at)}</strong><p>{item.sample_code || 'ภาพส่งตรวจ'}</p></div><div><ArchiveStatus item={item}/>{item.operational_deleted && <p className="admin-archive-retained">นำออกจากประวัติผู้ใช้แล้ว สำเนาในคลังยังคงอยู่</p>}</div></section>
    <section className="admin-archive-full-image" aria-label="ภาพต้นฉบับที่จัดเก็บ">{item.image_available && item.image_url ? <PrivateReferralImage session={session} path={item.image_url} alt={`ภาพในคลัง ${item.sample_code || 'ภาพส่งตรวจ'} ของ ${item.owner.username}`}/> : <div className="admin-archive-unavailable"><ImageOff size={36}/><h2>ไม่มีไฟล์ภาพเดิม</h2><p>ยังดูผลและประวัติที่เก็บไว้ได้ ภาพที่ถูกลบไปก่อนมีระบบคลังจะเรียกคืนไม่ได้</p></div>}<span>{item.source === 'supplemental' ? 'ภาพเพิ่มเติมที่ส่งให้ผู้เชี่ยวชาญ' : 'ภาพที่ส่งตรวจวิเคราะห์'} · {item.width} × {item.height} พิกเซล</span></section>
    {item.source === 'supplemental' && <p className="admin-archive-context-note">ภาพนี้เป็นหลักฐานเพิ่มเติม ผลด้านล่างเป็นผลของภาพต้นฉบับในรายการตรวจเดียวกัน ภาพเพิ่มเติมยังไม่ได้วิเคราะห์ด้วย AI แยกต่างหาก</p>}
    {analysis ? <DiagnosisComparison analysis={analysis} review={currentReferral ? currentReferral.latest_review ?? null : analysis.latest_review} reviewState={currentReferral?.status ?? analysis.review_status} expertComment={currentReferral?.response_comment} expertName={currentReferral?.reviewer_name ?? currentReferral?.reviewer_username} respondedAt={currentReferral?.responded_at}/> : <section className="admin-archive-no-ai"><h2>ยังไม่มีผล AI สำหรับภาพนี้</h2><p>{item.status === 'quality_rejected' ? 'ภาพมีข้อจำกัดด้านคุณภาพ ระบบจึงหยุดก่อนรันโมเดล' : 'รายการนี้ยังไม่มีผลวิเคราะห์ที่เสร็จสมบูรณ์'}</p>{item.quality?.checks?.filter(check => check.status !== 'pass').map((check, index) => <p key={index}>{check.label ? `${check.label}: ` : ''}{check.message}</p>)}</section>}
    {analysis?.error_message && <p className="admin-archive-context-note">{analysis.error_message}</p>}
    <section className="admin-archive-expert-history" aria-label="ประวัติคำตอบผู้เชี่ยวชาญ"><h2>ประวัติคำตอบผู้เชี่ยวชาญ</h2>{!expertMessages.length ? <p>ยังไม่มีคำตอบจากผู้เชี่ยวชาญสำหรับรายการนี้</p> : <ol>{expertMessages.map(message => <li key={message.id}><div><strong>{messageNames[message.action] ?? 'คำตอบจากผู้เชี่ยวชาญ'}</strong><time dateTime={message.created_at}>{formatDate(message.created_at)}</time></div><span>{message.author_name || message.author_username || 'ผู้เชี่ยวชาญ'}</span><p className="platform-preserve-text">{message.comment || (message.action === 'confirmed' ? 'ยืนยันผลตรวจแล้ว ดูผลยืนยันด้านบน' : 'บันทึกการทบทวนแล้ว')}</p></li>)}</ol>}</section>
    {!!item.reviews.length && analysis && <details className="admin-archive-history"><summary>ประวัติผลตรวจทานทั้งหมด ({item.reviews.length})</summary>{item.reviews.map((review, index) => <details key={review.id ?? index}><summary>{formatDate(review.created_at)} · {reviewNames[review.status] ?? 'ผลตรวจทาน'}</summary><DiagnosisComparison analysis={analysis} review={review} compact/></details>)}</details>}
    {!!item.referrals.length && <details className="admin-archive-history"><summary>รายละเอียดการส่งต่อและภาพเพิ่มเติม ({item.referrals.length} รอบ)</summary>{item.referrals.map(referral => <section className="admin-archive-referral-history" key={referral.id}><h3>{formatDate(referral.created_at)} · {reviewNames[referral.status] ?? 'รายการส่งต่อ'}</h3><p className="platform-preserve-text">{referral.reason}</p>{referral.attachments?.map(attachment => <div className="admin-archive-related-image" key={attachment.id}><span>ภาพเพิ่มเติม · {formatDate(attachment.created_at)}</span>{attachment.comment && <p className="platform-preserve-text">{attachment.comment}</p>}{attachment.archive_image_id && <button type="button" className="platform-button" onClick={() => onOpen(attachment.archive_image_id!)}>เปิดภาพเพิ่มเติม<ArrowRight size={16}/></button>}</div>)}</section>)}</details>}
  </>
}
