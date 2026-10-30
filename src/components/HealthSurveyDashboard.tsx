import { Activity, ArrowUpRight, BarChart3, CalendarDays, CircleAlert, Clock3, Database, FileSpreadsheet, Filter, Info, LockKeyhole, MapPinned, Microscope, Percent, RefreshCw, ShieldCheck, UsersRound, WifiOff } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { APIError, apiRequest, buildQuery, emptyPlatformSession } from '../platform/api'
import type { PlatformSession } from '../platform/api'
import '../styles/health-survey-dashboard.css'

const fallbackSource = 'https://docs.google.com/spreadsheets/d/1OlVnkehNCAJWVE0sR_5ypqi9XeuCI8-d/edit'
type SurveyStatus = 'ready' | 'empty' | 'stale' | 'unavailable' | 'not_configured' | 'mapping_required'
interface SurveySource { provider: string; spreadsheet_id: string; url: string; worksheet?: string | null; gid?: string; format?: string }
interface SurveyMetadata { configured: boolean; source: SurveySource; refresh_seconds: number; access: 'authenticated' | 'public_aggregates'; mapping_configured?: boolean }
interface Metric { key: string; label: string; value: number | null; unit?: string }
interface ProvinceRow { province: string; records: number; tested_count: number | null; infected_count: number | null }
interface ParasiteRow { parasite: string; count: number; unit: 'people' | 'objects' | 'positive_tests' }
interface SurveyData {
  row_count: number
  metrics: Metric[]
  trend: { date: string; count: number }[]
  statuses: { key: string; label: string; count: number }[]
  coverage: { dated_rows: number; status_rows: number }
  by_province?: ProvinceRow[]
  by_parasite?: ParasiteRow[]
  available_years?: number[]
  available_provinces?: string[]
}
interface SurveyResponse {
  status: SurveyStatus
  source: SurveySource
  refresh_seconds: number
  fetched_at: string | null
  last_attempt_at: string | null
  error: { code: string; message: string } | null
  warnings: string[]
  data: SurveyData | null
}
interface Snapshot { key: string; value: SurveyResponse }
function sameSource(first?: SurveySource | null, second?: SurveySource | null) {
  return !!first && !!second && first.provider === second.provider && first.spreadsheet_id === second.spreadsheet_id && (first.worksheet ?? '') === (second.worksheet ?? '') && (first.gid ?? '') === (second.gid ?? '') && (first.format ?? '') === (second.format ?? '')
}
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
function number(value: unknown, decimals = 0) { return isNumber(value) ? value.toLocaleString('th-TH', { maximumFractionDigits: decimals }) : '—' }
function timestamp(value?: string | null) { return value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Asia/Bangkok' }).format(new Date(value)) : 'ยังไม่มีการอ่านข้อมูลสำเร็จ' }
function sourceURL(value?: string) {
  try { const url = new URL(value ?? fallbackSource); if (url.protocol === 'https:' && url.hostname === 'docs.google.com' && /^\/spreadsheets\/d\/[A-Za-z0-9_-]+(?:\/|$)/.test(url.pathname)) return `${url.origin}${url.pathname}` } catch { /* Use the fixed source link if an invalid URL is returned. */ }
  return fallbackSource
}
function dateLabel(value: string) {
  if (/^\d{4}$/.test(value)) { const year = Number(value); return `พ.ศ. ${year < 2400 ? year + 543 : year}` }
  if (!/^\d{4}-\d{2}-\d{2}/.test(value) || !Number.isFinite(Date.parse(value))) return value
  return new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'Asia/Bangkok' }).format(new Date(value))
}
function ChartEmpty({ children }: { children: ReactNode }) { return <div className="hsd-chart-empty"><BarChart3 size={30}/><p>{children}</p></div> }

function RecordTrend({ rows }: { rows: SurveyData['trend'] }) {
  const valid = rows.filter(row => isNumber(row.count))
  if (!valid.length) return <ChartEmpty>กราฟจะแสดงเมื่ออ่านคอลัมน์วันที่หรือปีจากแหล่งข้อมูลได้</ChartEmpty>
  const maximum = Math.max(1, ...valid.map(row => row.count)), width = 640, height = 180, left = 45, right = 18, top = 16, bottom = 28
  const points = valid.map((row, index) => ({ ...row, x: valid.length === 1 ? (width + left - right) / 2 : left + index / (valid.length - 1) * (width - left - right), y: top + (1 - row.count / maximum) * (height - top - bottom) }))
  const path = points.map(point => `${point.x},${point.y}`).join(' ')
  return <><div className="hsd-trend-chart"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`จำนวนแถวข้อมูลตามเวลา ${valid.length} ช่วง รวม ${number(valid.reduce((sum, row) => sum + row.count, 0))} แถว`}>
    {[0, .5, 1].map(fraction => { const y = top + fraction * (height - top - bottom); return <g key={fraction}><line x1={left} x2={width - right} y1={y} y2={y} stroke="#e1eaf4" strokeDasharray="4 5"/><text x={left - 9} y={y + 4} textAnchor="end">{number(maximum * (1 - fraction), 1)}</text></g> })}
    {points.length > 1 && <><polygon points={`${left},${height - bottom} ${path} ${width - right},${height - bottom}`} fill="#e9f2ff"/><polyline points={path} fill="none" stroke="#2166b3" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round"/></>}
    {points.map((point, index) => <g key={`${point.date}-${index}`}><circle cx={point.x} cy={point.y} r={points.length > 40 ? 2 : 4} fill="#2166b3" stroke="#fff" strokeWidth="2"><title>{dateLabel(point.date)}: {number(point.count)} แถว</title></circle>{(index === 0 || index === points.length - 1 || (points.length > 2 && index === Math.floor(points.length / 2))) && <text x={point.x} y={height - 6} textAnchor={index === 0 && points.length > 1 ? 'start' : index === points.length - 1 && points.length > 1 ? 'end' : 'middle'}>{dateLabel(point.date)}</text>}</g>)}
  </svg></div><details className="hsd-data-details"><summary>ดูข้อมูลกราฟเป็นตาราง</summary><div className="hsd-table-wrap"><table><thead><tr><th>วันที่ / ปี</th><th>จำนวนแถว</th></tr></thead><tbody>{valid.map((row, index) => <tr key={`${row.date}-${index}`}><td>{dateLabel(row.date)}</td><td>{number(row.count)}</td></tr>)}</tbody></table></div></details></>
}

function ProvinceChart({ rows }: { rows: ProvinceRow[] }) {
  if (!rows.length) return <ChartEmpty>รอคอลัมน์จังหวัดและข้อมูลที่ตรวจสอบได้จาก Google Sheets</ChartEmpty>
  const hasCounts = rows.some(row => isNumber(row.tested_count) || isNumber(row.infected_count))
  const maximum = Math.max(1, ...rows.flatMap(row => hasCounts ? [row.tested_count ?? 0, row.infected_count ?? 0] : [row.records]))
  return <><div className="hsd-chart-legend">{hasCounts ? <><span><i/>ส่งตรวจ</span><span><i className="hsd-legend-positive"/>ตรวจพบพยาธิ</span></> : <span><i/>จำนวนแถวข้อมูล</span>}</div><ul className="hsd-province-bars">{rows.map(row => <li key={row.province}><div className="hsd-province-label"><strong>{row.province}</strong><span>{hasCounts ? `${number(row.infected_count)} / ${number(row.tested_count)} คน` : `${number(row.records)} แถว`}</span></div><div className="hsd-bar-track">{isNumber(hasCounts ? row.tested_count : row.records) && <span style={{ width: `${(hasCounts ? row.tested_count! : row.records) / maximum * 100}%` }}/>}</div>{hasCounts && <div className="hsd-bar-track is-positive">{isNumber(row.infected_count) && <span style={{ width: `${row.infected_count / maximum * 100}%` }}/>}</div>}</li>)}</ul><p className="hsd-caption">{hasCounts ? 'ตัวเลขคนแสดงเฉพาะยอดที่ผ่านเงื่อนไขการรวมข้อมูล ขีด — หมายถึงยังสรุปไม่ได้' : 'จำนวนแถวแสดงความครอบคลุมของข้อมูล และไม่เท่ากับจำนวนผู้ส่งตรวจ'}</p></>
}

function ParasiteChart({ rows }: { rows: ParasiteRow[] }) {
  const valid = rows.filter(row => isNumber(row.count))
  if (!valid.length) return <ChartEmpty>รอผลตรวจแยกกลุ่มพยาธิจากแหล่งข้อมูล ไม่มีจำนวนตัวอย่างเติมไว้ในกราฟ</ChartEmpty>
  const maximum = Math.max(1, ...valid.map(row => row.count)), comparable = new Set(valid.map(row => row.unit)).size <= 1
  const unit = (value: ParasiteRow['unit']) => value === 'people' ? 'คน' : value === 'objects' ? 'วัตถุ' : 'ผลบวก'
  return <><ul className="hsd-parasite-bars">{valid.map((row, index) => <li key={`${row.parasite}-${index}`}><div><strong>{row.parasite}</strong><span>{number(row.count)} <small>{unit(row.unit)}</small></span></div>{comparable && <div className="hsd-bar-track"><span style={{ width: `${row.count / maximum * 100}%` }}/></div>}</li>)}</ul><p className="hsd-caption">ผู้ติดพยาธิหลายชนิดอาจถูกนับในหลายกลุ่ม จึงไม่รวมรายชนิดเป็นจำนวนผู้ติดเชื้อทั้งหมด</p>{!comparable && <p className="hsd-caption">ข้อมูลใช้หน่วยต่างกัน จึงไม่เปรียบเทียบความยาวของกราฟ</p>}</>
}

export default function HealthSurveyDashboard({ session = emptyPlatformSession }: { session?: PlatformSession }) {
  const [province, setProvince] = useState(''), [year, setYear] = useState('')
  const [metadata, setMetadata] = useState<SurveyMetadata | null>(null)
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [busy, setBusy] = useState(false), [failure, setFailure] = useState(''), [authRequired, setAuthRequired] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)
  const requestNow = useRef<(() => void) | null>(null)
  const sessionRef = useRef(session); sessionRef.current = session
  const query = buildQuery({ province, year }), identity = `${session.user?.id ?? 'public'}:${session.user?.role ?? 'public'}`
  const currentKey = `${identity}:${query}`
  const current = snapshot?.key === currentKey ? snapshot.value : null
  const data = current?.data ?? null

  useEffect(() => {
    let disposed = false, inFlight = false, queued = false
    let timer: number | undefined, controller: AbortController | null = null, interval = 30_000
    setFailure(''); setAuthRequired(false); setBusy(false)
    const schedule = () => { if (!disposed && !document.hidden && navigator.onLine) timer = window.setTimeout(() => { void load() }, interval) }
    const load = async () => {
      window.clearTimeout(timer)
      if (disposed || document.hidden || !navigator.onLine) return
      if (inFlight) { queued = true; return }
      inFlight = true; setBusy(true)
      controller = new AbortController()
      const activeController = controller
      try {
        const meta = await apiRequest<SurveyMetadata>('/operations/status', { signal: activeController.signal, timeoutMs: 12_000 }, sessionRef.current)
        if (disposed || activeController.signal.aborted) return
        setMetadata(meta)
        setSnapshot(previous => previous && !sameSource(previous.value.source, meta.source) ? null : previous)
        if (meta.access === 'authenticated' && !sessionRef.current.user) {
          setSnapshot(null); setAuthRequired(true); setFailure(''); return
        }
        if (isNumber(meta.refresh_seconds)) interval = Math.max(15_000, Math.min(300_000, meta.refresh_seconds * 1000))
        const value = await apiRequest<SurveyResponse>(`/operations/dashboard${query}`, { signal: activeController.signal, timeoutMs: 25_000 }, sessionRef.current)
        if (disposed || activeController.signal.aborted) return
        if (!['ready', 'empty', 'stale', 'unavailable', 'not_configured', 'mapping_required'].includes(value.status)) throw new APIError(502, 'รูปแบบข้อมูล Dashboard ไม่ถูกต้อง')
        setSnapshot(previous => {
          // Only a snapshot for this exact filter can survive a transient source failure.
          if (!value.data && ['unavailable', 'stale'].includes(value.status) && previous?.key === currentKey && previous.value.data && sameSource(previous.value.source, value.source)) return { key: currentKey, value: { ...value, data: previous.value.data, fetched_at: previous.value.fetched_at, status: 'stale' } }
          return { key: currentKey, value }
        })
        setFailure(''); setAuthRequired(false); setBusy(false)
      } catch (error) {
        if (disposed || activeController.signal.aborted) return
        const needsAuth = error instanceof APIError && [401, 403].includes(error.status)
        setAuthRequired(needsAuth)
        if (needsAuth) setSnapshot(null)
        setFailure(error instanceof Error ? error.message : 'เชื่อมต่อแหล่งข้อมูลไม่ได้')
      } finally {
        inFlight = false
        if (!disposed) {
          setBusy(false)
          if (queued) { queued = false; void load() } else schedule()
        }
      }
    }
    const wake = () => { setOnline(navigator.onLine); if (!document.hidden && navigator.onLine) void load(); else window.clearTimeout(timer) }
    requestNow.current = () => { void load() }
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('online', wake); window.addEventListener('offline', wake)
    void load()
    return () => { disposed = true; controller?.abort(); window.clearTimeout(timer); requestNow.current = null; document.removeEventListener('visibilitychange', wake); window.removeEventListener('online', wake); window.removeEventListener('offline', wake) }
  }, [currentKey, identity, query])

  const refreshSeconds = metadata?.refresh_seconds ?? current?.refresh_seconds ?? 30
  const source = current?.source ?? metadata?.source
  const metrics = data?.metrics ?? []
  const metric = (key: string) => metrics.find(item => item.key === key)?.value ?? null
  const stale = !!data && (!online || !!failure || current?.status === 'stale')
  const ready = !stale && ['ready', 'empty'].includes(current?.status ?? '')
  const mappingRequired = current?.status === 'mapping_required'
  const statusText = !online ? 'หยุดอัปเดต · ออฟไลน์' : stale ? 'กำลังแสดงข้อมูลครั้งก่อน' : busy ? 'กำลังตรวจสอบข้อมูล' : ready ? 'เชื่อมต่อข้อมูลแล้ว' : mappingRequired ? 'รอตรวจโครงสร้างข้อมูล' : 'รอเชื่อมต่อข้อมูล'
  const cards = [
    { key: 'total_students', label: 'นักเรียนทั้งหมด', icon: UsersRound, unit: 'คน', detail: 'จำนวนนักเรียนตามข้อมูลโรงเรียนที่เลือก' },
    { key: 'tested_count', label: 'ส่งตรวจ', icon: Microscope, unit: 'คน', detail: 'จำนวนผู้ส่งตรวจตามยอดในแหล่งข้อมูล' },
    { key: 'coverage_percent', label: 'ร้อยละส่งตรวจ', icon: Percent, unit: '%', detail: 'จำนวนผู้ส่งตรวจต่อจำนวนนักเรียนทั้งหมด' },
    { key: 'infected_count', label: 'ตรวจพบการติดพยาธิ', icon: Microscope, unit: 'คน', detail: 'นับคนที่ตรวจพบ ไม่รวมชนิดพยาธิซ้ำเป็นจำนวนคน' },
    { key: 'infection_rate_percent', label: 'ร้อยละตรวจพบ', icon: Percent, unit: '%', detail: 'จำนวนผู้ตรวจพบต่อผู้ส่งตรวจในข้อมูลที่เลือก' },
    { key: 'multiple_infections_count', label: 'ติดพยาธิมากกว่า 1 ชนิด', icon: Activity, unit: 'คน', detail: 'นับคนตามยอดที่แหล่งข้อมูลระบุแยกไว้' },
    { key: 'school_count', label: 'โรงเรียนที่มีข้อมูล', icon: Database, unit: 'โรงเรียน', detail: 'เฉพาะโรงเรียนที่ผ่านการตรวจความซ้ำของข้อมูล' },
    { key: 'province_count', label: 'จังหวัดที่มีข้อมูล', icon: MapPinned, unit: 'จังหวัด', detail: 'เฉพาะจังหวัดที่ระบุได้จากแหล่งข้อมูล' },
  ]
  const years = data?.available_years ?? [], provinces = data?.available_provinces ?? []

  return <div className="health-survey-dashboard" data-testid="health-survey-dashboard">
    <header className="hsd-header"><div><span className="hsd-eyebrow"><Activity size={17}/> HELPMINTHS · HEALTH AREA 2</span><h1>สถานการณ์การติดพยาธิ</h1><p>พื้นที่โครงการ กพด. <span>·</span> เขตสุขภาพที่ 2</p></div><a className="hsd-source-button" href={sourceURL(source?.url)} target="_blank" rel="noopener noreferrer"><FileSpreadsheet size={19}/>เปิดแหล่งข้อมูล<ArrowUpRight size={17}/></a></header>

    <section className="hsd-connection" aria-label="สถานะการเชื่อมข้อมูล"><div className="hsd-connection-main"><span className={`hsd-status ${ready ? 'is-ready' : stale ? 'is-stale' : ''}`} role="status">{!online ? <WifiOff size={16}/> : <span className={busy ? 'is-pulsing' : ''}/>} {statusText}</span><span className="hsd-refresh-note"><Clock3 size={16}/>อัปเดตอัตโนมัติทุก {number(refreshSeconds)} วินาที</span></div><div className="hsd-update"><span>ดึงข้อมูลล่าสุด <strong>{timestamp(current?.fetched_at)}</strong></span><button type="button" onClick={() => requestNow.current?.()} disabled={busy || !online} aria-label="รีเฟรชข้อมูล Dashboard"><RefreshCw size={17} className={busy ? 'hsd-spin' : ''}/>{busy ? 'กำลังอัปเดต' : 'รีเฟรชข้อมูล'}</button></div></section>

    {authRequired ? <section className="hsd-notice is-warning" role="alert"><LockKeyhole size={24}/><div><h2>แหล่งข้อมูลนี้ต้องเข้าสู่ระบบ</h2><p>ผู้ดูแลตั้งสิทธิ์ข้อมูลไว้สำหรับบัญชีที่ได้รับอนุญาต เข้าสู่ระบบจากเมนูตั้งค่าและบัญชี แล้วเปิด Dashboard อีกครั้ง</p></div></section> : (failure || current?.error || !online) && <section className="hsd-notice is-warning" role="alert"><CircleAlert size={24}/><div><h2>{stale ? 'ข้อมูลอาจยังไม่เป็นปัจจุบัน' : 'ยังอ่านข้อมูลจาก Google Sheets ไม่ได้'}</h2><p>{!online ? 'กลับมาเชื่อมต่อเครือข่ายเพื่ออัปเดตข้อมูล โดยระบบจะลองใหม่อัตโนมัติ' : current?.error?.message ?? failure}</p>{stale && <p>ตัวเลขด้านล่างเป็นข้อมูลครั้งที่อ่านสำเร็จตามเวลาที่แสดง และยังไม่ใช่ผลอัปเดตรอบนี้</p>}</div></section>}

    <section className="hsd-filter-card" aria-label="ตัวกรองข้อมูล"><div className="hsd-filter-heading"><Filter size={19}/><strong>เลือกช่วงข้อมูล</strong></div><label>ปีข้อมูลตามชีต (พ.ศ.)<select aria-label="ปีข้อมูล Dashboard" value={year} disabled={!years.length || busy} onChange={event => setYear(event.target.value)}><option value="">{years.length ? 'ทุกปีที่มีข้อมูล' : current?.fetched_at ? 'แหล่งข้อมูลยังไม่ระบุปี' : 'รอข้อมูลปีจากแหล่งข้อมูล'}</option>{years.map(value => <option key={value} value={value}>{value}</option>)}</select></label><label>จังหวัด<select aria-label="จังหวัด Dashboard" value={province} disabled={!provinces.length || busy} onChange={event => setProvince(event.target.value)}><option value="">{provinces.length ? 'ทุกจังหวัดที่มีข้อมูล' : current?.fetched_at ? 'ยังไม่มีจังหวัดที่ระบุได้' : 'รอข้อมูลจังหวัดจากแหล่งข้อมูล'}</option>{provinces.map(value => <option key={value} value={value}>{value}</option>)}</select></label><button type="button" className="hsd-reset" disabled={!year && !province} onClick={() => { setYear(''); setProvince('') }}>ล้างตัวกรอง</button></section>

    <section className="hsd-stat-grid" aria-label="สถิติสรุปการคัดกรอง">{cards.map(card => <article className={`hsd-stat hsd-stat-${card.key}`} key={card.key}><div className="hsd-stat-top"><span>{card.label}</span><card.icon size={21}/></div><div className="hsd-stat-value"><strong>{number(metric(card.key), card.key.endsWith('_percent') ? 1 : 0)}</strong><span>{isNumber(metric(card.key)) ? card.unit : data ? 'ยังสรุปไม่ได้' : 'รอข้อมูล'}</span></div><p>{card.detail}</p></article>)}</section>

    {mappingRequired && <section className="hsd-notice" role="status"><Info size={23}/><div><h2>อ่านแหล่งข้อมูลได้แล้ว รอยืนยันวิธีรวมยอด</h2><p>ต้องจับคู่คอลัมน์และตรวจว่าข้อมูลแต่ละแถวไม่ซ้ำกัน ก่อนสรุปจำนวนคนและร้อยละตรวจพบ {data && isNumber(data.row_count) ? `ขณะนี้อ่านได้ ${number(data.row_count)} แถวข้อมูล` : ''}</p></div></section>}
    {current?.status === 'empty' && <section className="hsd-notice"><Database size={24}/><div><h2>แหล่งข้อมูลยังไม่มีแถวข้อมูล</h2><p>เชื่อมต่อได้แล้ว แต่ยังไม่มีข้อมูลที่ใช้สรุปผลในชีต ตัวเลขที่ยังสรุปไม่ได้แสดงเป็นขีด —</p></div></section>}
    {current?.status === 'not_configured' && <section className="hsd-notice"><Database size={24}/><div><h2>กำลังรอการตั้งค่าแหล่งข้อมูล</h2><p>ผู้ดูแลต้องเปิดตัวเชื่อมและกำหนดแท็บ / คอลัมน์ของ Google Sheets ก่อน ตัวเลขจะปรากฏเมื่ออ่านข้อมูลจริงได้</p></div></section>}

    <div className="hsd-chart-grid"><section className="hsd-panel"><div className="hsd-panel-heading"><div><span className="hsd-panel-kicker">AREA OVERVIEW</span><h2>ภาพรวมรายจังหวัด</h2></div><MapPinned size={22}/></div><ProvinceChart rows={data?.by_province ?? []}/></section><section className="hsd-panel"><div className="hsd-panel-heading"><div><span className="hsd-panel-kicker">PARASITE FINDINGS</span><h2>ผลตรวจแยกตามกลุ่มพยาธิ</h2></div><Microscope size={22}/></div><ParasiteChart rows={data?.by_parasite ?? []}/></section></div>

    <section className="hsd-panel hsd-province-table"><div className="hsd-panel-heading"><div><span className="hsd-panel-kicker">SCREENING SUMMARY</span><h2>สรุปข้อมูลพื้นที่</h2></div><span className="hsd-source-tag"><ShieldCheck size={16}/>สถิติสรุปเท่านั้น</span></div>{!data?.by_province?.length ? <ChartEmpty>ยังไม่มีข้อมูลรายจังหวัดที่พร้อมแสดง ระบบไม่แสดงรายชื่อหรือผลตรวจรายบุคคล</ChartEmpty> : <div className="hsd-table-wrap"><table><thead><tr><th>จังหวัด</th><th>ส่งตรวจ (คน)</th><th>ตรวจพบ (คน)</th><th>แถวข้อมูล</th></tr></thead><tbody>{data.by_province.map(row => <tr key={row.province}><th scope="row">{row.province}</th><td>{number(row.tested_count)}</td><td>{number(row.infected_count)}</td><td>{number(row.records)}</td></tr>)}</tbody></table></div>}</section>

    {!!data?.trend?.length && <section className="hsd-panel"><div className="hsd-panel-heading"><div><span className="hsd-panel-kicker">DATA OVER TIME</span><h2>จำนวนแถวข้อมูลตามเวลา</h2></div><CalendarDays size={22}/></div><RecordTrend rows={data.trend}/><p className="hsd-caption">แสดงเฉพาะแถวที่มีช่วงเวลาระบุได้ และไม่ใช้แทนแนวโน้มจำนวนผู้ติดเชื้อ</p></section>}

    <footer className="hsd-data-footer"><div><FileSpreadsheet size={19}/><p><strong>แหล่งข้อมูล: Google Sheets{source?.worksheet ? ` · ${source.worksheet}` : ''}</strong><span>เผยแพร่เฉพาะสถิติภาพรวมจากโครงการ กพด. เขตสุขภาพที่ 2 ไม่มีข้อมูลรายบุคคลในหน้านี้</span>{data && isNumber(data.row_count) && <span>ใช้ข้อมูล {number(data.row_count)} แถวตามตัวกรองที่เลือก · จำนวนแถวไม่เท่ากับจำนวนคน</span>}</p></div><p><Info size={17}/>ร้อยละตรวจพบใช้ยอดผู้ส่งตรวจและช่วงข้อมูลที่บันทึก ไม่ใช่ข้อสรุปความชุกของประชากรทั้งพื้นที่</p>{!!current?.warnings?.length && <details><summary>ข้อควรทราบเกี่ยวกับข้อมูล ({current.warnings.length})</summary><ul>{current.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}</footer>
  </div>
}
