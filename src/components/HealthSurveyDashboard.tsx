import { Activity, ArrowDownToLine, ArrowUpRight, Check, ChevronDown, CircleAlert, Clock3, FileSpreadsheet, Filter, Info, LockKeyhole, RefreshCw, Search, ShieldCheck, WifiOff } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { APIError, apiRequest, buildQuery, emptyPlatformSession } from '../platform/api'
import type { PlatformSession } from '../platform/api'
import '../styles/health-survey-dashboard.css'

// The layout follows the owner's helminth-dashboard.zip. Source statistics and
// access rules come from the API. Named school statistics are opt-in and were
// explicitly requested by the owner; the original workbook/notes stay private.
type Count = number | null | undefined
type TableDimension = 'school' | 'district' | 'province' | 'affiliation'
type Filters = { province: string; district: string; affiliation: string; year: string; record_status: string; positivity_band: string }
type Source = { provider: string; spreadsheet_id?: string; url?: string | null; worksheet?: string | null; gid?: string; format?: string; file_name?: string; version?: string; imported_at?: string; year?: number; year_basis?: string }
type Metadata = { source: Source; refresh_seconds: number; access: string; capabilities?: { named_school_statistics?: boolean; published_school_count?: number } }
type Metric = { key: string; value: Count; label: string; unit?: string }
type Group = { school_id?: string; school?: string; label?: string; province?: string; district?: string; affiliation?: string; records?: number; school_count?: number; reported_school_count?: number; tested_school_count?: number; pending_school_count?: number; total_students_known?: Count; total_students?: Count; tested_count?: Count; infected_count?: Count; coverage_percent?: Count; infection_rate_percent?: Count }
type Parasite = { key?: string; parasite: string; count: Count; reported_count?: Count; validated_count?: Count; flagged_count?: Count; missing_school_count?: Count; tested_missing_school_count?: Count; rate_percent?: Count; unit: string }
type Issue = { id?: string; code?: string; severity?: string; title?: string; message: string; cells?: string[]; count?: Count }
type Band = { key: string; label: string; school_count: number }
type SurveyData = {
  row_count: number; metrics: Metric[]; summary?: Record<string, Count>; by_province?: Group[]; by_district?: Group[]; by_affiliation?: Group[]; by_parasite?: Parasite[]; by_positivity_band?: Band[];
  available_years?: number[]; available_provinces?: string[]; available_districts?: string[]; available_affiliations?: string[];
  options?: { provinces?: string[]; districts?: string[]; affiliations?: string[]; statuses?: { key: string; label: string }[] };
  quality?: { issues?: Issue[]; issue_count?: number; conflicting_count?: Count; missing_count_cells?: Count; formula_error_count?: Count; source_summary_matches?: boolean };
  insights?: string[]; by_school?: Group[]; followup_schools?: Group[]; followup_eligible_school_count?: number; followup_min_tested?: number; named_school_statistics?: boolean; published_school_count?: number;
}
type SurveyResponse = { source: Source; status: string; data: SurveyData | null; refresh_seconds: number; fetched_at: string | null; error: { message: string } | null; warnings: string[] }
type Options = { provinces: string[]; districts: string[]; affiliations: string[]; years: number[]; statuses: { key: string; label: string }[] }
const choices = (values: string[], selected: string) => selected && !values.includes(selected) ? [...values, selected] : values
const emptyData: SurveyData = { row_count: 0, metrics: [] }
const noOptions: Options = { provinces: [], districts: [], affiliations: [], years: [], statuses: [] }
const emptyFilters: Filters = { province: '', district: '', affiliation: '', year: '', record_status: '', positivity_band: '' }
const numeric = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
const number = (value: unknown, digits = 0) => numeric(value) ? value.toLocaleString('th-TH', { maximumFractionDigits: digits }) : '—'
const percent = (value: Count, digits = 1) => numeric(value) ? `${number(value, digits)}%` : '—'
const ratio = (a: Count, b: Count) => numeric(a) && numeric(b) && b > 0 ? a / b * 100 : null
const metric = (data: SurveyData | null, key: string, legacy = key) => data?.summary && Object.hasOwn(data.summary, key) ? data.summary[key] : data?.metrics.find(item => item.key === legacy)?.value
const tested = (row: Group) => row.tested_count
const found = (row: Group) => row.infected_count
const positivity = (row: Group) => row.school_id ? ratio(found(row), tested(row)) : row.infection_rate_percent ?? ratio(found(row), tested(row))
const coverage = (row: Group) => row.coverage_percent ?? ratio(tested(row), row.total_students_known ?? row.total_students)
const groupName = (row: Group, dimension: string) => (dimension === 'school' ? row.school : dimension === 'district' ? row.district : dimension === 'affiliation' ? row.affiliation : row.province) ?? row.label ?? 'ไม่ระบุ'
const stamp = (value?: string | null) => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' }).format(new Date(value)) : 'ยังไม่มีการอ่านข้อมูลสำเร็จ'
const sameSource = (a?: Source | null, b?: Source | null) => !!a && !!b && ['provider', 'spreadsheet_id', 'worksheet', 'gid', 'format', 'version'].every(key => a[key as keyof Source] === b[key as keyof Source])
function sourceURL(source?: Source) { try { if (source?.provider !== 'google_sheets' || !source.url) return null; const url = new URL(source.url); return url.protocol === 'https:' && url.hostname === 'docs.google.com' && /^\/spreadsheets\/d\/[A-Za-z0-9_-]+(?:\/|$)/.test(url.pathname) ? source.url : null } catch { return null } }
const bands = [
  { key: 'none', label: 'ไม่พบ (0%)', color: '#c3d0ca', ink: '#1c2b29' },
  { key: 'under5', label: 'มากกว่า 0–<5%', color: '#8fb3a6', ink: '#1c2b29' },
  { key: '5to10', label: '5–<10%', color: '#e2b546', ink: '#1c2b29' },
  { key: '10to20', label: '10–<20%', color: '#d77f2a', ink: '#1c2b29' },
  { key: '20plus', label: 'ตั้งแต่ 20%', color: '#a8322a', ink: '#fff' },
]
const bandFor = (value: Count) => bands[!numeric(value) || value === 0 ? 0 : value < 5 ? 1 : value < 10 ? 2 : value < 20 ? 3 : 4]
const speciesColors: Record<string, string> = { hookworm: '#b2452e', ascaris: '#14867f', trichuris: '#d99a2b', liver_fluke: '#6d4c8f', pinworm: '#4f86a8', tapeworm: '#8a8f3a', medium_intestinal: '#c26b8f', strongyloides: '#6b7a78' }
function Empty({ children }: { children: ReactNode }) { return <p className="hd-empty">{children}</p> }

function useSurvey(session: PlatformSession, filters: Filters) {
  const [metadata, setMetadata] = useState<Metadata | null>(null), [snapshot, setSnapshot] = useState<{ key: string; value: SurveyResponse } | null>(null), [options, setOptions] = useState<Options>(noOptions)
  const [busy, setBusy] = useState(false), [failure, setFailure] = useState(''), [authRequired, setAuthRequired] = useState(false), [online, setOnline] = useState(navigator.onLine)
  const refresh = useRef<(() => void) | null>(null), sessionRef = useRef(session), sourceRef = useRef<Source | null>(null)
  sessionRef.current = session
  const query = buildQuery(filters), identity = `${session.user?.id ?? 'public'}:${session.user?.role ?? 'public'}`, key = `${identity}:${query}`
  const current = snapshot?.key === key ? snapshot.value : null
  useEffect(() => {
    let disposed = false, inFlight = false, queued = false, timer: number | undefined, controller: AbortController | null = null, interval = 30_000
    setFailure(''); setAuthRequired(false)
    const schedule = () => { if (!disposed && interval > 0 && !document.hidden && navigator.onLine) timer = window.setTimeout(() => { void load() }, interval) }
    const load = async () => {
      window.clearTimeout(timer)
      if (disposed || document.hidden || !navigator.onLine) return
      if (inFlight) { queued = true; return }
      inFlight = true; setBusy(true); controller = new AbortController(); const active = controller
      try {
        const meta = await apiRequest<Metadata>('/operations/status', { signal: active.signal, timeoutMs: 12_000 }, sessionRef.current)
        if (disposed || active.signal.aborted) return
        setMetadata(meta)
        if (sourceRef.current && !sameSource(sourceRef.current, meta.source)) { setSnapshot(null); setOptions(noOptions) }
        sourceRef.current = meta.source
        setSnapshot(previous => previous && !sameSource(previous.value.source, meta.source) ? null : previous)
        if (meta.access === 'authenticated' && !sessionRef.current.user) { setSnapshot(null); setOptions(noOptions); setAuthRequired(true); setFailure(''); return }
        interval = numeric(meta.refresh_seconds) && meta.refresh_seconds > 0 ? Math.max(15_000, Math.min(300_000, meta.refresh_seconds * 1000)) : 0
        const value = await apiRequest<SurveyResponse>(`/operations/dashboard${query}`, { signal: active.signal, timeoutMs: 25_000 }, sessionRef.current)
        if (disposed || active.signal.aborted) return
        if (!['ready', 'empty', 'stale', 'unavailable', 'not_configured', 'mapping_required'].includes(value.status)) throw new APIError(502, 'รูปแบบข้อมูล Dashboard ไม่ถูกต้อง')
        setSnapshot(previous => !value.data && ['unavailable', 'stale'].includes(value.status) && previous?.key === key && previous.value.data && sameSource(previous.value.source, value.source) ? { key, value: { ...value, data: previous.value.data, fetched_at: previous.value.fetched_at, status: 'stale' } } : { key, value })
        if (value.data) setOptions({ years: value.data.available_years ?? [], provinces: value.data.options?.provinces ?? value.data.available_provinces ?? [], districts: value.data.options?.districts ?? value.data.available_districts ?? [], affiliations: value.data.options?.affiliations ?? value.data.available_affiliations ?? [], statuses: value.data.options?.statuses ?? [] })
        setFailure(''); setAuthRequired(false)
      } catch (error) {
        if (disposed || active.signal.aborted) return
        const needsAuth = error instanceof APIError && [401, 403].includes(error.status)
        setAuthRequired(needsAuth)
        if (needsAuth) { setSnapshot(null); setOptions(noOptions) }
        setFailure(error instanceof Error ? error.message : 'เชื่อมต่อแหล่งข้อมูลไม่ได้')
      } finally { inFlight = false; if (!disposed) { setBusy(false); if (queued) { queued = false; void load() } else schedule() } }
    }
    const wake = () => { setOnline(navigator.onLine); if (!document.hidden && navigator.onLine) void load(); else window.clearTimeout(timer) }
    refresh.current = () => { void load() }
    document.addEventListener('visibilitychange', wake); window.addEventListener('online', wake); window.addEventListener('offline', wake); void load()
    return () => { disposed = true; controller?.abort(); window.clearTimeout(timer); refresh.current = null; document.removeEventListener('visibilitychange', wake); window.removeEventListener('online', wake); window.removeEventListener('offline', wake) }
  }, [identity, key, query])
  return { current, metadata, options, busy, failure, authRequired, online, refresh }
}

function CoverageRing({ enrolled, sent, value }: { enrolled: Count; sent: Count; value: Count }) {
  const valid = numeric(value) && value <= 100 && numeric(enrolled) && enrolled > 0 && numeric(sent) && sent <= enrolled, circumference = 2 * Math.PI * 46
  return <div className="hd-ring"><svg viewBox="0 0 120 120" role="img" aria-label={`ความครอบคลุมส่งตรวจ ${valid ? percent(value) : 'ยังคำนวณไม่ได้'}`}><circle className="hd-rb" cx="60" cy="60" r="46"/>{valid && <circle className="hd-rf" cx="60" cy="60" r="46" strokeDasharray={`${value / 100 * circumference} ${circumference}`} transform="rotate(-90 60 60)"/>}<text className="hd-rt" x="60" y="59">{valid ? percent(value) : '—'}</text><text className="hd-rs" x="60" y="78">ครอบคลุมส่งตรวจ</text></svg></div>
}

function Scatter({ rows, onSelect }: { rows: Group[]; onSelect: (row: Group) => void }) {
  const [focus, setFocus] = useState<Group | null>(null)
  const points = rows.filter(row => numeric(tested(row)) && tested(row)! > 0 && numeric(positivity(row))).sort((a, b) => (found(a) ?? 0) - (found(b) ?? 0))
  const W = 600, H = 310, margin = { l: 42, r: 20, t: 20, b: 42 }, logarithm = (n: number) => Math.log10(Math.max(1, n))
  const x0 = logarithm(Math.min(...points.map(row => tested(row)!))) - .1, x1 = logarithm(Math.max(...points.map(row => tested(row)!))) + .1
  const ymax = Math.max(5, Math.ceil(Math.max(...points.map(row => positivity(row)!)) / 5) * 5)
  const X = (n: number) => margin.l + (logarithm(n) - x0) / (x1 - x0 || 1) * (W - margin.l - margin.r)
  const Y = (n: number) => H - margin.b - n / ymax * (H - margin.t - margin.b)
  return <section className="hd-card hd-c7"><h2>จำนวนส่งตรวจ เทียบกับร้อยละตรวจพบ</h2><p className="hd-hint">1 จุด = 1 อำเภอ · ขนาดจุดตามจำนวนผู้ตรวจพบ · เลือกจุดเพื่อดูพื้นที่</p>{!points.length ? <Empty>ยังไม่มีอำเภอที่คำนวณจำนวนและร้อยละได้</Empty> : <><div className="hd-scatter" data-testid="survey-scatter"><svg viewBox={`0 0 ${W} ${H}`} aria-label="กราฟกระจายจำนวนผู้ส่งตรวจเทียบร้อยละตรวจพบรายอำเภอ" role="group">{[0, 5, 10, 20, 30, 40, 50, 60, 80, 100].filter(n => n <= ymax).map(n => <g key={n}><line className="hd-gl" x1={margin.l} x2={W - margin.r} y1={Y(n)} y2={Y(n)}/><text x={margin.l - 8} y={Y(n) + 4} textAnchor="end">{n}</text></g>)}{[1, 10, 30, 100, 300, 1000, 3000, 10000, 30000].filter(n => logarithm(n) > x0 && logarithm(n) < x1).map(n => <text key={n} x={X(n)} y={H - margin.b + 19} textAnchor="middle">{number(n)}</text>)}<text x={W / 2} y={H - 2} textAnchor="middle">จำนวนผู้ส่งตรวจ (สเกลลอการิทึม)</text><text x="12" y="20">%</text>{points.map(row => <g key={`${row.province}-${row.district}`} role="button" tabIndex={0} aria-label={`${row.district} ${row.province} ส่งตรวจ ${number(tested(row))} ตรวจพบ ${number(found(row))} คน ${percent(positivity(row), 2)} กรองพื้นที่นี้`} onMouseEnter={() => setFocus(row)} onMouseLeave={() => setFocus(null)} onFocus={() => setFocus(row)} onBlur={() => setFocus(null)} onClick={() => onSelect(row)} onKeyDown={event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); onSelect(row) } }}><title>{`${row.district} · ${row.province}: ${number(found(row))}/${number(tested(row))} คน (${percent(positivity(row), 2)})`}</title><circle className="hd-hit" cx={X(tested(row)!)} cy={Y(positivity(row)!)} r="18"/><circle className="hd-point" cx={X(tested(row)!)} cy={Y(positivity(row)!)} r={Math.min(19, 4.5 + Math.sqrt(found(row) ?? 0) * .8)} fill={bandFor(positivity(row)).color}/></g>)}</svg></div><p className="hd-scatter-tip" aria-live="polite">{focus ? <><strong>{focus.district}</strong> · {focus.province} · {percent(positivity(focus), 2)} ({number(found(focus))}/{number(tested(focus))} คน)</> : 'แตะจุด วางเมาส์ หรือใช้แป้น Tab เพื่อดูรายละเอียดอำเภอ'}</p></>}</section>
}
function Followup({ rows, onSelect }: { rows: Group[]; onSelect: (row: Group) => void }) {
  const ranked = rows.filter(row => (tested(row) ?? 0) >= 30 && (found(row) ?? 0) > 0).sort((a, b) => (positivity(b) ?? 0) - (positivity(a) ?? 0) || (found(b) ?? 0) - (found(a) ?? 0)).slice(0, 8)
  return <section className="hd-card hd-c5"><h2>พื้นที่สำหรับติดตามข้อมูล</h2><p className="hd-hint">เรียงตามร้อยละตรวจพบ · เฉพาะอำเภอที่ส่งตรวจตั้งแต่ 30 คน · เลือกเพื่อกรอง</p><ol className="hd-top" data-testid="survey-top-areas">{ranked.map((row, i) => { const band = bandFor(positivity(row)); return <li key={`${row.province}-${row.district}`}><button type="button" onClick={() => onSelect(row)}><span className="hd-rank">{i + 1}</span><span className="hd-name">{row.district}<small>{row.province} · {number(found(row))}/{number(tested(row))} คน</small></span><span className="hd-pill" style={{ background: band.color, color: band.ink }}>{percent(positivity(row))}</span></button></li> })}</ol>{!ranked.length && <Empty>ไม่มีพื้นที่เข้าเงื่อนไขในมุมมองนี้</Empty>}<p className="hd-hint hd-bottom-note">เกณฑ์ 30 คนใช้จัดแสดงกราฟนี้เท่านั้น ลำดับและสีเป็นการสรุปข้อมูล ไม่ใช่เกณฑ์จัดระดับความเสี่ยงทางคลินิก</p></section>
}
function SchoolFollowup({ rows, eligible, loading, onSelect, onViewAll }: { rows: Group[]; eligible: Count; loading: boolean; onSelect: (row: Group) => void; onViewAll: () => void }) {
  return <section className="hd-card hd-c5 hd-school-followup" data-testid="survey-school-followup">
    <div className="hd-followup-heading"><div><h2>โรงเรียนที่ควรติดตาม</h2><p className="hd-hint">เรียงตามความชุกในผู้ส่งตรวจ · เฉพาะแห่งที่ส่งตรวจตั้งแต่ 30 คนขึ้นไป</p></div>{numeric(eligible) && <span className="hd-eligible-count">{number(eligible)} แห่งเข้าเกณฑ์</span>}</div>
    <ol className="hd-top hd-top-schools">{rows.map((row, i) => { const band = bandFor(positivity(row)); return <li key={row.school_id}><button type="button" onClick={() => onSelect(row)} aria-label={`ดู ${row.school} ในตาราง`}><span className="hd-rank">{i + 1}</span><span className="hd-name">{row.school}<small>{row.district} · {row.province}</small><small>พบ {number(found(row))} / ส่งตรวจ {number(tested(row))} คน</small></span><span className="hd-pill" style={{ background: band.color, color: band.ink }}>{percent(positivity(row), 2)}</span></button></li> })}</ol>
    {!rows.length && <Empty>{loading ? 'กำลังอ่านข้อมูลโรงเรียน…' : 'ไม่มีโรงเรียนที่ส่งตรวจตั้งแต่ 30 คนในมุมมองนี้'}</Empty>}
    {numeric(eligible) && eligible > 0 && <button type="button" className="hd-view-eligible" onClick={onViewAll}>ดูรายชื่อที่เข้าเกณฑ์ทั้งหมด <strong>{number(eligible)} แห่ง</strong><ArrowUpRight size={16}/></button>}
    <p className="hd-hint hd-bottom-note">ความชุกในรายการนี้ = ผู้ตรวจพบ ÷ ผู้ส่งตรวจ แสดง {number(rows.length)} อันดับแรกตามพื้นที่และตัวกรองปัจจุบัน พร้อมจำนวนคนประกอบ</p>
  </section>
}

function GroupBars({ rows, dimension, selected, onSelect, title }: { rows: Group[]; dimension: string; selected: string; onSelect: (row: Group) => void; title: string }) {
  const sorted = [...rows].sort((a, b) => (positivity(b) ?? -1) - (positivity(a) ?? -1)), max = Math.max(1, ...sorted.map(row => positivity(row) ?? 0))
  return <section className="hd-card hd-c6"><h2>{title}</h2><p className="hd-hint">ร้อยละผู้ตรวจพบต่อผู้ส่งตรวจในแต่ละกลุ่ม · เลือกแท่งเพื่อกรอง</p><ul className="hd-bars">{sorted.map((row, i) => { const name = groupName(row, dimension), value = positivity(row); return <li key={`${row.province}-${name}-${i}`}><button type="button" className="hd-bar-row" aria-pressed={selected === name} onClick={() => onSelect(row)}><span className="hd-bar-label">{name}{dimension === 'district' && <small>{row.province}</small>}</span><span className="hd-track">{numeric(value) && value > 0 && <i style={{ width: `${value / max * 100}%`, background: bandFor(value).color }}/>}</span><span className="hd-bar-value">{percent(value)}<small>{number(found(row))}/{number(tested(row))} คน</small></span></button></li> })}</ul>{!rows.length && <Empty>ยังไม่มีข้อมูลในระดับนี้</Empty>}</section>
}
function SpeciesBars({ rows }: { rows: Parasite[] }) {
  const sorted = [...rows].sort((a, b) => (b.count ?? -1) - (a.count ?? -1)), max = Math.max(1, ...sorted.map(row => row.count ?? 0))
  return <section className="hd-card hd-c6"><h2>ชนิดพยาธิที่พบ</h2><p className="hd-hint">ความยาวแท่งตามจำนวนที่รายงาน · ร้อยละต่อผู้ส่งตรวจ</p><ul className="hd-bars hsd-parasite-bars">{sorted.map((row, i) => <li key={row.key ?? i}><div className="hd-bar-row"><span className="hd-bar-label">{row.parasite}{(row.flagged_count ?? 0) > 0 && <small className="hd-flag">{number(row.flagged_count)} รายต้องตรวจทาน</small>}{(row.missing_school_count ?? 0) > 0 && <small>ไม่ระบุ {number(row.missing_school_count)} ช่อง</small>}</span><span className="hd-track">{numeric(row.count) && row.count > 0 && <i style={{ width: `${row.count / max * 100}%`, background: speciesColors[row.key ?? ''] ?? '#14867f' }}/>}</span><span className="hd-bar-value">{number(row.count)} <small>{row.unit === 'objects' ? 'วัตถุ' : row.unit === 'positive_tests' ? 'ผลบวก' : 'คน'} · {percent(row.rate_percent, 2)}</small></span></div>{(row.flagged_count ?? 0) > 0 && <p className="hd-species-note">รายงาน {number(row.count)} · สอดคล้องเงื่อนไขตัวเลข {number(row.validated_count)} · ต้องตรวจทาน {number(row.flagged_count)}</p>}</li>)}</ul>{!rows.length && <Empty>รอข้อมูลแยกชนิดที่อ่านได้</Empty>}<p className="hd-hint hd-bottom-note">ผู้ติดพยาธิหลายชนิดอาจนับในหลายกลุ่ม จึงไม่รวมรายชนิดเป็นจำนวนคนทั้งหมด ร้อยละ — หมายถึงยังไม่มีตัวหาร หรือมีจำนวนขัดกัน/ช่องชนิดว่างในหน่วยส่งตรวจ ไม่แทนช่องว่างเป็นศูนย์</p></section>
}
function Distribution({ rows, selected, busy, onSelect, pending, zero }: { rows: Band[]; selected: string; busy: boolean; onSelect: (key: string) => void; pending: Count; zero: Count }) {
  const total = rows.reduce((sum, row) => sum + row.school_count, 0)
  return <section className="hd-card hd-c6"><h2>หน่วยรายงานตามร้อยละตรวจพบ</h2><p className="hd-hint">เฉพาะหน่วยที่มีผู้ส่งตรวจมากกว่า 0 คน</p>{rows.length ? <><div className="hd-stack" role="img" aria-label={`การกระจาย ${number(total)} หน่วยรายงาน`}>{bands.map(band => { const count = rows.find(row => row.key === band.key)?.school_count ?? 0; return count > 0 && <span key={band.key} style={{ flex: count, background: band.color }} title={`${band.label}: ${number(count)} แห่ง`}/> })}</div><div className="hd-chips" data-testid="survey-bands">{bands.map(band => { const count = rows.find(row => row.key === band.key)?.school_count ?? 0; return <button type="button" key={band.key} className="hd-chip" disabled={busy} aria-pressed={selected === band.key} onClick={() => onSelect(selected === band.key ? '' : band.key)}><i style={{ background: band.color }}/>{band.label}<strong>{number(count)}</strong></button> })}</div><p className="hd-hint hd-bottom-note">เลือกช่วงเพื่อกรองข้อมูลทั้งหน้า จำนวนบนปุ่มแสดงทุกช่วงภายใต้พื้นที่/สังกัด/สถานะที่เลือก ช่วงเหล่านี้ใช้บรรยายการกระจาย ไม่ใช่ระดับความเสี่ยงทางคลินิก</p></> : <Empty>ชุดข้อมูลนี้ยังไม่มีการกระจายรายหน่วยที่คำนวณได้</Empty>}<p className="hd-hint">มุมมองปัจจุบัน: ส่งตรวจศูนย์ {number(zero)} หน่วย · รอข้อมูล {number(pending)} หน่วย แสดงแยกจากหน่วยที่ตรวจแล้วไม่พบ</p></section>
}

function csvValue(value: unknown) { const text = value === null || value === undefined ? '' : String(value); return `"${(/^[\s]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text) ? "'" : '') + text.replace(/"/g, '""')}"` }
function AggregateTable({ data, search, setSearch, version, dimension, setDimension, namedSchools, onlyThirty, setOnlyThirty, selectedSchoolId, onClear }: {
  data: SurveyData; search: string; setSearch: (value: string) => void; version?: string;
  dimension: TableDimension; setDimension: (value: TableDimension) => void; namedSchools: boolean;
  onlyThirty: boolean; setOnlyThirty: (value: boolean) => void; selectedSchoolId: string | null; onClear: () => void;
}) {
  const [sort, setSort] = useState({ key: 'rate', direction: -1 })
  const schoolView = dimension === 'school'
  const source = schoolView ? data.by_school ?? [] : dimension === 'district' ? data.by_district ?? [] : dimension === 'affiliation' ? data.by_affiliation ?? [] : data.by_province ?? []
  const value = (row: Group, key: string): string | Count => key === 'name' ? groupName(row, dimension) : key === 'district' ? row.district : key === 'province' ? row.province : key === 'affiliation' ? row.affiliation : key === 'rate' ? positivity(row) : key === 'coverage' ? coverage(row) : key === 'enrolled' ? row.total_students_known ?? row.total_students : key === 'tested' ? tested(row) : key === 'positive' ? found(row) : key === 'pending' ? row.pending_school_count : row.school_count ?? row.records
  const query = search.trim().toLocaleLowerCase('th')
  const rows = source.filter(row => (!schoolView || !onlyThirty || (tested(row) ?? 0) >= 30) && (schoolView ? `${row.school ?? ''} ${row.district ?? ''} ${row.province ?? ''} ${row.affiliation ?? ''}` : `${groupName(row, dimension)} ${row.province ?? ''}`).toLocaleLowerCase('th').includes(query)).sort((a, b) => {
    const x = value(a, sort.key), y = value(b, sort.key)
    if (x == null) return y == null ? 0 : 1
    if (y == null) return -1
    const comparison = typeof x === 'string' ? x.localeCompare(String(y), 'th') : x - Number(y)
    return comparison * sort.direction || (schoolView && sort.key === 'rate' ? (found(b) ?? 0) - (found(a) ?? 0) : 0) || groupName(a, dimension).localeCompare(groupName(b, dimension), 'th')
  })
  const columns = schoolView
    ? [{ key: 'name', label: 'โรงเรียน / ศูนย์' }, { key: 'district', label: 'อำเภอ' }, { key: 'province', label: 'จังหวัด' }, { key: 'affiliation', label: 'สังกัด' }, { key: 'enrolled', label: 'นักเรียนที่ระบุ' }, { key: 'tested', label: 'ส่งตรวจ' }, { key: 'positive', label: 'ตรวจพบ' }, { key: 'rate', label: 'ร้อยละตรวจพบ' }, { key: 'coverage', label: 'ครอบคลุมส่งตรวจ' }]
    : [{ key: 'name', label: dimension === 'district' ? 'อำเภอ / จังหวัด' : dimension === 'affiliation' ? 'สังกัด' : 'จังหวัด' }, { key: 'units', label: 'หน่วยรายงาน' }, { key: 'enrolled', label: 'นักเรียนที่ระบุ' }, { key: 'tested', label: 'ส่งตรวจ' }, { key: 'positive', label: 'ตรวจพบ' }, { key: 'rate', label: 'ร้อยละตรวจพบ' }, { key: 'coverage', label: 'ครอบคลุมส่งตรวจ' }, { key: 'pending', label: 'รอข้อมูล' }]
  const download = () => {
    const records = rows.map(row => columns.map(column => value(row, column.key)))
    const text = '\ufeff' + [[...columns.map(column => column.label), 'รุ่นชุดข้อมูล'], ...records.map(row => [...row, version ?? ''])].map(row => row.map(csvValue).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' })), link = document.createElement('a')
    link.href = url; link.download = `HelpMinths-${dimension}-summary.csv`; document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
  }
  const dimensions: { key: TableDimension; label: string }[] = [...(namedSchools ? [{ key: 'school' as const, label: 'โรงเรียน / ศูนย์' }] : []), { key: 'district', label: 'อำเภอ' }, { key: 'province', label: 'จังหวัด' }, { key: 'affiliation', label: 'สังกัด' }]
  return <section className="hd-table-section" data-testid="survey-aggregate-table">
    <div className="hd-table-heading"><div><span className="hd-section-eyebrow">สำรวจข้อมูลเพิ่มเติม</span><h2>{schoolView ? 'รายชื่อโรงเรียน / ศูนย์ที่ส่งตรวจ' : `ตารางสรุป${dimension === 'district' ? 'รายอำเภอ' : dimension === 'affiliation' ? 'รายสังกัด' : 'รายจังหวัด'}`} <small>({number(rows.length)} {schoolView ? 'แห่ง' : 'รายการ'})</small></h2></div><button type="button" className="hd-download" disabled={!rows.length} onClick={download}><ArrowDownToLine size={17}/>ดาวน์โหลด CSV</button></div>
    <div className="hd-table-tools"><div className="hd-segments" role="group" aria-label="ระดับตารางสรุป">{dimensions.map(item => <button type="button" key={item.key} aria-pressed={dimension === item.key} onClick={() => setDimension(item.key)}>{item.label}</button>)}</div><label className="hd-search"><Search size={17}/><input type="search" value={search} onChange={event => setSearch(event.target.value)} aria-label={namedSchools ? 'ค้นหาโรงเรียน พื้นที่ และสังกัด' : 'ค้นหาตารางพื้นที่และสังกัด'} placeholder={schoolView ? 'ค้นหาชื่อโรงเรียน อำเภอ จังหวัด หรือสังกัด' : 'ค้นหาอำเภอ จังหวัด หรือสังกัด'}/></label></div>
    {schoolView && <div className="hd-school-toolbar"><label><input type="checkbox" checked={onlyThirty} onChange={event => setOnlyThirty(event.target.checked)}/>เฉพาะแห่งที่ส่งตรวจตั้งแต่ 30 คน</label><span>มีผู้ส่งตรวจจริง {number(source.length)} แห่งในตัวกรองนี้</span>{(search || onlyThirty) && <button type="button" onClick={onClear}>แสดงรายชื่อทั้งหมด</button>}</div>}
    <div className={`hd-table-scroll ${schoolView ? 'hd-school-table' : ''}`}><table className="hsd-province-table"><caption>{schoolView ? 'สถิติรายโรงเรียน/ศูนย์ที่มีผู้ส่งตรวจมากกว่า 0 คน · จำนวนคนตามรายงาน · เลือกหัวตารางเพื่อเรียงลำดับ' : 'ผลรวมตามตัวกรองปัจจุบัน · หน่วยจำนวนคน ยกเว้นหน่วยรายงานและรอข้อมูลเป็นแห่ง · เลือกหัวตารางเพื่อเรียงลำดับ'}</caption><thead><tr>{columns.map(column => <th key={column.key} aria-sort={sort.key !== column.key ? 'none' : sort.direction > 0 ? 'ascending' : 'descending'}><button type="button" onClick={() => setSort({ key: column.key, direction: sort.key === column.key ? -sort.direction : column.key === 'name' ? 1 : -1 })}>{column.label}{sort.key === column.key ? sort.direction > 0 ? ' ↑' : ' ↓' : ''}</button></th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={row.school_id ?? `${groupName(row, dimension)}-${row.province}-${i}`} className={schoolView && row.school_id === selectedSchoolId ? 'hd-school-selected' : undefined} data-school-id={schoolView ? row.school_id : undefined}>{columns.map(column => {
      const cell = value(row, column.key)
      return column.key === 'name' ? <th scope="row" key={column.key}>{cell}{dimension === 'district' && <small>{row.province}</small>}</th> : <td key={column.key} className={['district', 'province', 'affiliation'].includes(column.key) ? 'hd-table-text' : undefined}>{column.key === 'rate' ? <span className="hd-table-rate">{percent(cell as Count, 2)}</span> : column.key === 'coverage' ? percent(cell as Count, 2) : ['district', 'province', 'affiliation'].includes(column.key) ? cell ?? '—' : number(cell)}</td>
    })}</tr>)}</tbody></table>{!rows.length && <Empty>ไม่พบรายการตามตัวกรองหรือคำค้นนี้</Empty>}</div>
    <p className="hd-hint">{schoolView ? 'รายชื่อรวมทุกแห่งที่มีผู้ส่งตรวจจริง รวมแห่งที่ส่งตรวจน้อยกว่า 30 คน เกณฑ์ 30 คนใช้กับรายการติดตามหรือเมื่อเปิดตัวเลือกด้านบนเท่านั้น' : 'ตารางแสดงสถิติสรุปตามพื้นที่และสังกัด'} คำค้นและลำดับตารางใช้กับ CSV ที่ดาวน์โหลด ไม่มีข้อมูลรายบุคคล</p>
  </section>
}

export default function HealthSurveyDashboard({ session = emptyPlatformSession }: { session?: PlatformSession }) {
  const [filters, setFilters] = useState<Filters>(emptyFilters), [search, setSearch] = useState(''), [qualityOpen, setQualityOpen] = useState(false)
  const [tableDimension, setTableDimension] = useState<TableDimension>('school'), [onlyThirty, setOnlyThirty] = useState(false), [selectedSchoolId, setSelectedSchoolId] = useState<string | null>(null)
  const schoolTableRef = useRef<HTMLDivElement>(null)
  const { current, metadata, options, busy, failure, authRequired, online, refresh } = useSurvey(session, filters)
  const qualityRef = useRef<HTMLDetailsElement>(null), data = current?.data ?? null, source = current?.source ?? metadata?.source, imported = source?.provider === 'uploaded_workbook'
  const sent = metric(data, 'tested_count'), positive = metric(data, 'infected_count'), enrollment = metric(data, 'total_students_known', 'total_students'), rate = metric(data, 'infection_rate_percent'), cover = metric(data, 'coverage_percent'), units = metric(data, 'school_count'), testedUnits = metric(data, 'tested_school_count'), zero = metric(data, 'zero_tested_school_count'), pending = metric(data, 'pending_school_count'), positiveUnits = metric(data, 'positive_school_count'), negativeUnits = metric(data, 'negative_school_count'), mixed = metric(data, 'multiple_infections_count')
  const issues = data?.quality?.issues ?? [], stale = !!data && (!online || !!failure || current?.status === 'stale'), ready = !authRequired && !stale && ['ready', 'empty'].includes(current?.status ?? ''), sourceTime = imported ? source?.imported_at ?? current?.fetched_at : current?.fetched_at, sourceLink = sourceURL(source)
  const namedSchools = metadata?.capabilities?.named_school_statistics === true
  useEffect(() => { if (metadata && !namedSchools && tableDimension === 'school') setTableDimension(imported ? 'district' : 'province') }, [metadata, namedSchools, tableDimension, imported])
  const showSchool = (row?: Group) => { setTableDimension('school'); setOnlyThirty(!row); setSearch(row?.school ?? ''); setSelectedSchoolId(row?.school_id ?? null); requestAnimationFrame(() => schoolTableRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })) }
  const clearTable = () => { setSearch(''); setOnlyThirty(false); setSelectedSchoolId(null) }
  const searchTable = (value: string) => { setSearch(value); setSelectedSchoolId(null) }
  const setFilter = (key: keyof Filters, value: string) => setFilters(previous => ({ ...previous, [key]: value, ...(key === 'province' ? { district: '' } : {}) }))
  const selectDistrict = (row: Group) => setFilters(previous => ({ ...previous, province: row.province ?? previous.province, district: previous.district === row.district && previous.province === row.province ? '' : row.district ?? '' }))
  const openQuality = () => { setQualityOpen(true); requestAnimationFrame(() => qualityRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })) }
  const reset = () => { setFilters(emptyFilters); clearTable() }
  const hasFilters = Object.values(filters).some(Boolean), refreshSeconds = metadata?.refresh_seconds ?? current?.refresh_seconds ?? 30
  const strip = [{ key: 'total_students', value: enrollment, label: 'นักเรียนที่ระบุจำนวน' }, { key: 'tested_count', value: sent, label: 'นักเรียนส่งตรวจ' }, { key: 'school_count', value: units, label: 'สถานศึกษา / หน่วยรายงาน' }, { key: 'negative_school_count', value: negativeUnits, label: 'หน่วยที่ตรวจแล้วไม่พบ' }]
  return <div className="health-survey-dashboard hd-page" data-testid="health-survey-dashboard">
    <header className="hd-hero"><div className="hd-eyebrow"><Activity size={16}/>แดชบอร์ดเฝ้าระวังโรคหนอนพยาธิ<span>HELPMINTHS</span></div><h1>ผลตรวจพยาธิในเด็กและเยาวชน</h1><p className="hd-subtitle">โครงการ กพด. · เขตสุขภาพที่ 2{source?.year ? ` · ชุดข้อมูล ${source.year}` : ''}</p><div className="hd-hero-main"><div className="hd-big hsd-stat-infection_rate_percent"><b className="hsd-stat-value"><strong data-testid="survey-positivity">{percent(rate)}</strong></b><span>ร้อยละตรวจพบในผู้ส่งตรวจ</span><small className="hsd-stat-infected_count">พบ <strong data-testid="survey-positive">{number(positive)}</strong> จาก {number(sent)} คน</small></div><CoverageRing enrolled={enrollment} sent={sent} value={cover}/><p className="hd-lead">{data ? <>จาก <b>{number(units)}</b> หน่วยรายงาน มีผู้ส่งตรวจจริงใน <b>{number(testedUnits)}</b> หน่วย และตรวจพบอย่างน้อย 1 คนใน <b>{number(positiveUnits)}</b> หน่วย</> : <>ภาพรวมผลตรวจในพื้นที่โครงการ อ่านข้อมูลจากแหล่งที่กำหนดก่อนแสดงตัวเลข</>}</p></div><div className="hd-strip">{strip.map(item => <div className={`hsd-stat-${item.key}`} key={item.key}><b className="hsd-stat-value"><strong>{number(item.value)}</strong></b><span>{item.label}</span></div>)}</div><div className="hd-hero-note"><span><Check size={15}/>ข้อมูลสรุปสาธารณะ</span><span>ส่งตรวจศูนย์ {number(zero)} หน่วย · รอข้อมูล {number(pending)} หน่วย</span><span>พบมากกว่า 1 ชนิด {number(mixed)} คน (รวมอยู่ในยอดตรวจพบแล้ว)</span></div></header>

    <div className="hd-source hsd-connection"><div><span className={`hsd-status ${ready ? 'is-ready' : stale ? 'is-stale' : ''}`} role="status">{!online ? <WifiOff size={16}/> : <i/>}{!online ? 'หยุดอัปเดต · ออฟไลน์' : stale ? 'กำลังแสดงข้อมูลครั้งก่อน' : busy ? 'กำลังอ่านข้อมูล' : ready ? imported ? 'ข้อมูลจากไฟล์นำเข้า' : 'เชื่อมต่อข้อมูลแล้ว' : 'รอเชื่อมต่อข้อมูล'}</span><span className="hsd-refresh-note"><Clock3 size={14}/>{imported || refreshSeconds === 0 ? 'ปรับปรุงเมื่อมีการนำเข้าไฟล์รุ่นใหม่' : `อัปเดตอัตโนมัติทุก ${number(refreshSeconds)} วินาที`}</span></div><div className="hsd-update"><span>{imported ? 'นำเข้า' : 'ดึงข้อมูลล่าสุด'} <strong>{stamp(sourceTime)}</strong></span><button type="button" className="hd-icon-button" disabled={busy || !online} onClick={() => refresh.current?.()} aria-label="รีเฟรชข้อมูล Dashboard"><RefreshCw size={16} className={busy ? 'hd-spin' : ''}/>รีเฟรช</button>{sourceLink ? <a className="hd-icon-button" href={sourceLink} target="_blank" rel="noopener noreferrer"><FileSpreadsheet size={16}/>เปิดแหล่งข้อมูล<ArrowUpRight size={14}/></a> : <button type="button" className="hd-icon-button" onClick={openQuality}><FileSpreadsheet size={16}/>ข้อมูลและที่มา</button>}</div></div>

    {authRequired ? <section className="hd-notice" role="alert"><LockKeyhole size={21}/><div><h2>แหล่งข้อมูลนี้ต้องเข้าสู่ระบบ</h2><p>เปิดเมนูตั้งค่าและบัญชี เพื่อเข้าสู่ระบบด้วยบัญชีที่ได้รับสิทธิ์</p></div></section> : (failure || current?.error || !online) && <section className="hd-notice" role="alert"><CircleAlert size={21}/><div><h2>{stale ? 'ข้อมูลอาจยังไม่เป็นปัจจุบัน' : imported ? 'ยังอ่านชุดข้อมูลที่นำเข้าไม่ได้' : 'ยังอ่านข้อมูลจาก Google Sheets ไม่ได้'}</h2><p>{!online ? 'ระบบจะตรวจข้อมูลรุ่นใหม่เมื่อกลับมาเชื่อมต่อเครือข่าย' : current?.error?.message ?? failure}</p>{stale && <p>แสดงข้อมูลครั้งที่อ่านสำเร็จตามเวลาที่ระบุด้านบน</p>}</div></section>}

    <section className="hd-filters" aria-label="ตัวกรองข้อมูล"><div className="hd-filter-title"><Filter size={17}/>มุมมองข้อมูล{busy && <span>กำลังปรับมุมมอง…</span>}</div><div className="hd-filter-row"><label>จังหวัด<select aria-label="จังหวัด Dashboard" disabled={!options.provinces.length || busy} value={filters.province} onChange={event => setFilter('province', event.target.value)}><option value="">ทุกจังหวัดที่มีข้อมูล</option>{options.provinces.map(value => <option key={value}>{value}</option>)}</select></label>{imported && <><label>อำเภอ<select aria-label="อำเภอ Dashboard" disabled={(!options.districts.length && !filters.district) || busy} value={filters.district} onChange={event => setFilter('district', event.target.value)}><option value="">ทุกอำเภอ</option>{choices(options.districts, filters.district).map(value => <option key={value}>{value}</option>)}</select></label><label>สังกัด<select aria-label="สังกัด Dashboard" disabled={(!options.affiliations.length && !filters.affiliation) || busy} value={filters.affiliation} onChange={event => setFilter('affiliation', event.target.value)}><option value="">ทุกสังกัด</option>{choices(options.affiliations, filters.affiliation).map(value => <option key={value}>{value}</option>)}</select></label><label>สถานะรายงาน<select aria-label="สถานะข้อมูล Dashboard" disabled={!options.statuses.length || busy} value={filters.record_status} onChange={event => setFilter('record_status', event.target.value)}><option value="">ทุกสถานะ</option>{options.statuses.map(value => <option key={value.key} value={value.key}>{value.label}</option>)}</select></label></>}<label>{imported ? 'ปีชุดข้อมูล' : 'ปีข้อมูลตามชีต'}<select aria-label="ปีข้อมูล Dashboard" disabled={!options.years.length || busy} value={filters.year} onChange={event => setFilter('year', event.target.value)}><option value="">{options.years.length ? 'ทุกปีที่มีข้อมูล' : 'ต้นทางยังไม่ระบุปี'}</option>{options.years.map(value => <option key={value}>{value}</option>)}</select></label><button type="button" className="hd-reset" disabled={!hasFilters && !search && !onlyThirty} onClick={reset}>ล้างตัวกรอง</button></div>{filters.positivity_band && <button type="button" className="hd-active-band" onClick={() => setFilter('positivity_band', '')}>ช่วงที่เลือก: {bands.find(band => band.key === filters.positivity_band)?.label} <span>× ล้างช่วง</span></button>}</section>

    {imported && numeric(pending) && pending > 0 && <p className="hd-cohort-note"><Info size={17}/><span>จำนวนนักเรียนและความครอบคลุมอ้างเฉพาะหน่วยที่มีตัวเลข อีก <strong>{number(pending)} หน่วย</strong> ยังรอข้อมูล ไม่แทนเป็นศูนย์</span></p>}
    {current?.status === 'empty' && <section className="hd-notice"><Info size={21}/><div><h2>ไม่มีรายการตามตัวกรองนี้</h2><p>ลองล้างตัวกรองเพื่อกลับไปดูภาพรวม</p></div></section>}
    {current?.status === 'mapping_required' && <section className="hd-notice"><Info size={21}/><div><h2>อ่านแหล่งข้อมูลได้แล้ว รอยืนยันวิธีรวมยอด</h2><p>ต้องตรวจคอลัมน์และหน่วยนับก่อนแสดงจำนวนคน</p></div></section>}
    {current?.status === 'not_configured' && <section className="hd-notice"><Info size={21}/><div><h2>กำลังรอการตั้งค่าแหล่งข้อมูล</h2><p>แสดงตัวเลขเมื่อมีข้อมูลที่อ่านได้และตรวจโครงสร้างแล้ว</p></div></section>}

    <div className="hd-grid" aria-busy={busy}><Scatter rows={data?.by_district ?? []} onSelect={selectDistrict}/>{namedSchools ? <SchoolFollowup rows={data?.followup_schools ?? []} eligible={data?.followup_eligible_school_count} loading={busy || !data} onSelect={showSchool} onViewAll={() => showSchool()}/> : <Followup rows={data?.by_district ?? []} onSelect={selectDistrict}/>}<GroupBars rows={data?.by_district ?? []} dimension="district" selected={filters.district} onSelect={selectDistrict} title="ร้อยละที่พบ แยกตามอำเภอ"/><SpeciesBars rows={data?.by_parasite ?? []}/><Distribution rows={data?.by_positivity_band ?? []} selected={filters.positivity_band} busy={busy} onSelect={value => setFilter('positivity_band', value)} pending={pending} zero={zero}/><GroupBars rows={data?.by_affiliation ?? []} dimension="affiliation" selected={filters.affiliation} onSelect={row => setFilter('affiliation', filters.affiliation === row.affiliation ? '' : row.affiliation ?? '')} title="ร้อยละที่พบ แยกตามสังกัด"/></div>

    {!!data?.insights?.length && <section className="hd-insights"><div className="hd-insights-title"><ShieldCheck size={20}/><h2>อ่านข้อมูลในมุมมองนี้</h2></div><ul>{data.insights.map(insight => <li key={insight}>{insight}</li>)}</ul></section>}
    <div ref={schoolTableRef} className="hd-school-table-anchor">{metadata && <AggregateTable data={data ?? emptyData} search={search} setSearch={searchTable} version={source?.version} dimension={tableDimension} setDimension={setTableDimension} namedSchools={namedSchools} onlyThirty={onlyThirty} setOnlyThirty={setOnlyThirty} selectedSchoolId={selectedSchoolId} onClear={clearTable}/>}</div>

    <details className="hd-quality" ref={qualityRef} open={qualityOpen} onToggle={event => setQualityOpen(event.currentTarget.open)}><summary><span><CircleAlert size={18}/>หมายเหตุข้อมูลและแหล่งที่มา{issues.length > 0 && <b>{number(issues.length)} ประเด็น</b>}</span><ChevronDown size={18}/></summary><div className="hd-quality-body"><div className="hd-provenance"><p>แหล่งข้อมูล<strong>{imported ? source.file_name ?? 'ไฟล์นำเข้า' : 'Google Sheets'}</strong></p><p>แท็บ<strong>{source?.worksheet ?? 'ตามการตั้งค่า'}</strong></p><p>{imported ? 'นำเข้าข้อมูล' : 'อ่านข้อมูลสำเร็จ'}<strong>{stamp(sourceTime)}</strong></p>{source?.version && <p>รุ่นข้อมูล<strong>{source.version}</strong></p>}</div>{imported && <p>ปี {source?.year} อ้างจากชื่อไฟล์ ไม่มีวันที่รายแถวสำหรับแสดงแนวโน้มตามเวลา แสดงตัวเลขตามไฟล์รุ่นที่นำเข้า โดยเก็บต้นฉบับแยกจากข้อมูลสาธารณะ</p>}<ul className="hd-quality-issues">{issues.map((issue, index) => <li key={issue.id ?? index}><strong>{issue.title ?? 'ข้อสังเกตของข้อมูล'}</strong><p>{issue.message}</p>{!!issue.cells?.length && <small>อ้างอิงต้นฉบับ: {issue.cells.join(', ')}</small>}</li>)}</ul>{!!current?.warnings?.length && <ul>{current.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>}<p className="hd-method">ความครอบคลุม = ผู้ส่งตรวจ ÷ นักเรียนที่ระบุจำนวน · ร้อยละตรวจพบ = ผู้ตรวจพบ ÷ ผู้ส่งตรวจ รวมจำนวนคนก่อนคำนวณ ไม่เฉลี่ยร้อยละรายหน่วย การตรวจเงื่อนไขตัวเลขไม่ได้ยืนยันผลทางคลินิก</p></div></details>
    <footer className="hd-footer hsd-data-footer"><span><FileSpreadsheet size={16}/>ที่มา: {imported ? source.file_name : 'Google Sheets'}{source?.worksheet ? ` · ${source.worksheet}` : ''}</span><p>ร้อยละตรวจพบเป็นผลในกลุ่มผู้ส่งตรวจ ไม่ใช้แทนความชุกของประชากรทั้งพื้นที่ จำนวนหน่วยรายงานไม่ใช่จำนวนคน และไม่รวมยอดรายชนิดเป็นยอดผู้ติดเชื้อ</p></footer>
  </div>
}
