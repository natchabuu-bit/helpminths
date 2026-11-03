import { ArrowDownRight, ArrowUpRight, Check, ChevronDown, Info, Layers3, TrendingUp } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import '../styles/survey-history.css'

type Value = number | null
export interface ComparisonSchool {
  school_id: string
  school: string
  province: string
  district: string
  previous_tested: Value
  current_tested: Value
  previous_infected: Value
  current_infected: Value
  previous_rate_percent: Value
  current_rate_percent: Value
  delta_pp: Value
}
interface ComparisonKPI {
  key: string
  label: string
  previous: Value
  current: Value
  delta: Value
  unit: 'percent' | 'percentage_points' | 'people' | 'schools'
}
interface ComparisonDistrict {
  province: string
  district: string
  previous_tested: Value
  current_tested: Value
  previous_infected: Value
  current_infected: Value
  previous_rate_percent: Value
  current_rate_percent: Value
  delta_pp: Value
}
interface ComparisonParasite {
  key: string
  parasite: string
  previous_count: Value
  current_count: Value
  previous_rate_percent: Value
  current_rate_percent: Value
  delta_pp: Value
}
export interface ComparisonData {
  available: boolean
  previous_year: number | null
  year: number
  kpis?: ComparisonKPI[]
  by_district?: ComparisonDistrict[]
  by_parasite?: ComparisonParasite[]
  matched_schools?: ComparisonSchool[]
  largest_decreases?: ComparisonSchool[]
  largest_increases?: ComparisonSchool[]
  matched_count?: number
  decreased_count?: number
  increased_count?: number
  stable_count?: number
  change_threshold_pp?: number
  minimum_tested_both_years?: number
  notes?: string[]
}
export interface HistorySeries {
  key: string
  name: string
  is_total?: boolean
  coverage_percent: Value[]
  infection_rate_percent: Value[]
}
interface HistoryDimension {
  key: string
  label: string
  province?: string
  series: HistorySeries[]
}
interface HistorySpecies {
  key: string
  name: string
  positive_share_percent: Value[]
  flagged_years?: number[]
}
interface SourceIssue {
  code?: string
  severity?: string
  title?: string
  message: string
  year?: number
  dimension?: string
  series?: string
  metric?: string
  reported_value?: Value
  computed_value?: Value
  reported_values?: Record<string, Value>
}
export interface HistoryData {
  years: number[]
  source: { file_name?: string; archive_sha256?: string; note?: string; verification_status?: string }
  dimensions: HistoryDimension[]
  species_series: HistorySpecies[]
  quality?: { issues?: SourceIssue[] }
  insights?: string[]
  scope_note?: string
}
interface ChartSeries {
  key: string
  name: string
  isTotal?: boolean
  values: Value[]
  flaggedYears?: number[]
}
interface PairedRow {
  key: string
  name: string
  detail?: string
  previous: Value
  current: Value
  previousCount?: Value
  currentCount?: Value
  previousTested?: Value
  currentTested?: Value
}
const palette = ['#14867f', '#d77f2a', '#6d4c8f', '#a8322a', '#4f86a8', '#8a8f3a', '#c26b8f', '#bd8c16', '#5d6f6b']
const numeric = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const number = (value: unknown, digits = 0) => numeric(value) ? value.toLocaleString('th-TH', { maximumFractionDigits: digits }) : '—'
const percent = (value: unknown, digits = 2) => numeric(value) ? `${number(value, digits)}%` : '—'
const signed = (value: unknown, digits = 2) => numeric(value) ? `${value > 0 ? '+' : ''}${number(value, digits)}` : '—'
const seriesColor = (row: ChartSeries, index: number) => row.isTotal ? '#233f39' : palette[index % palette.length]

function useChartWidth(ref: RefObject<HTMLDivElement | null>) {
  const [width, setWidth] = useState(640)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const update = () => setWidth(Math.max(240, Math.round(element.getBoundingClientRect().width)))
    update()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update)
      return () => window.removeEventListener('resize', update)
    }
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return width
}
function PairLegend({ previousYear, year }: { previousYear: number | null; year: number }) {
  return <p className="shp-pair-legend"><span><i className="shp-color-dot is-previous"/>ปี {previousYear}</span><span><i className="shp-color-dot is-current"/>ปี {year}</span></p>
}
function PairedBars({ title, rows, previousYear, year, species = false }: { title: string; rows: PairedRow[]; previousYear: number | null; year: number; species?: boolean }) {
  const max = Math.max(1, ...rows.flatMap(row => [row.previous, row.current]).filter(numeric))
  return <section className="shp-card">
    <h3>{title}</h3>
    <PairLegend previousYear={previousYear} year={year}/>
    <ul className="shp-pair-list">{rows.map(row => <li key={row.key}>
      <div className="shp-pair-row">
        <span className="shp-pair-name">{row.name}{row.detail && <small>{row.detail}</small>}</span>
        <span className="shp-pair-tracks" aria-hidden="true"><span className="shp-track is-previous">{numeric(row.previous) && row.previous > 0 && <i style={{ width: `${row.previous / max * 100}%` }}/>}</span><span className="shp-track is-current">{numeric(row.current) && row.current > 0 && <i style={{ width: `${row.current / max * 100}%` }}/>}</span></span>
        <span className="shp-pair-value"><span>{percent(row.previous)} <small>→</small> {percent(row.current)}</span><small>{number(row.previousCount)}{species ? '' : `/${number(row.previousTested)}`} → {number(row.currentCount)}{species ? '' : `/${number(row.currentTested)}`} คน</small></span>
      </div>
    </li>)}</ul>
    {!rows.length && <p className="shp-chart-empty">ไม่มีข้อมูลกลุ่มที่เปรียบเทียบได้ในตัวกรองนี้</p>}
    <p className="shp-series-note">{species ? 'ตัวหารคือผู้ส่งตรวจของแต่ละปี ผลแยกชนิดอาจนับคนเดียวกันในหลายกลุ่ม ร้อยละ — หมายถึงยังคำนวณไม่ได้จากข้อมูลที่มี' : 'ตัวเลขกำกับคือผู้ตรวจพบ/ผู้ส่งตรวจของแต่ละปี กลุ่มที่ไม่มีข้อมูลแสดง — ไม่แทนเป็นศูนย์'}</p>
  </section>
}
function MatchedScatter({ comparison, onSelectSchool }: { comparison: ComparisonData; onSelectSchool?: (school: ComparisonSchool) => void }) {
  const ref = useRef<HTMLDivElement>(null), width = useChartWidth(ref)
  const [active, setActive] = useState<ComparisonSchool | null>(null)
  const rows = (comparison.matched_schools ?? []).filter(row => numeric(row.previous_rate_percent) && numeric(row.current_rate_percent))
  const height = 310, margin = { left: 44, right: 18, top: 24, bottom: 46 }
  const max = Math.max(20, Math.ceil(Math.max(0, ...rows.flatMap(row => [row.previous_rate_percent!, row.current_rate_percent!])) / 10) * 10)
  const X = (value: number) => margin.left + value / max * (width - margin.left - margin.right)
  const Y = (value: number) => height - margin.bottom - value / max * (height - margin.top - margin.bottom)
  const threshold = comparison.change_threshold_pp ?? .5
  const pointColor = (row: ComparisonSchool) => (row.delta_pp ?? 0) < -threshold ? '#14867f' : (row.delta_pp ?? 0) > threshold ? '#a8322a' : '#839b90'
  const activeExists = active && rows.some(row => row.school_id === active.school_id)
  return <section className="shp-card">
    <h3>โรงเรียนเดียวกัน สองปี</h3>
    <p className="shp-series-note shp-match-summary">จับคู่ได้ {number(comparison.matched_count)} แห่ง · ลดลงเกิน {number(threshold, 2)} จุด {number(comparison.decreased_count)} แห่ง · เพิ่มขึ้นเกิน {number(threshold, 2)} จุด {number(comparison.increased_count)} แห่ง</p>
    <div ref={ref} className="shp-chart shp-match-chart" data-testid="survey-comparison-scatter">
      {!!rows.length && <svg viewBox={`0 0 ${width} ${height}`} role="group" aria-label={`กราฟเปรียบเทียบร้อยละโรงเรียนเดียวกัน ปี ${comparison.previous_year} และ ${comparison.year}`}>
        {Array.from({ length: 5 }, (_, index) => index * max / 4).map(tick => <g key={tick}><line className="shp-gridline" x1={margin.left} x2={width - margin.right} y1={Y(tick)} y2={Y(tick)}/><text className="shp-axis-text" x={margin.left - 7} y={Y(tick) + 4} textAnchor="end">{number(tick, 1)}</text><text className="shp-axis-text" x={X(tick)} y={height - margin.bottom + 20} textAnchor="middle">{number(tick, 1)}</text></g>)}
        <line className="shp-diagonal" x1={X(0)} y1={Y(0)} x2={X(max)} y2={Y(max)}/>
        <text className="shp-axis-text" x={width / 2} y={height - 5} textAnchor="middle">ร้อยละปี {comparison.previous_year}</text>
        <text className="shp-axis-text" x={margin.left} y="14">ร้อยละปี {comparison.year}</text>
        {rows.map(row => <g key={row.school_id} className="shp-chart-point" tabIndex={0} role="button" aria-label={`${row.school} ปี ${comparison.previous_year} ${percent(row.previous_rate_percent)} ปี ${comparison.year} ${percent(row.current_rate_percent)} ดูในตาราง`} onMouseEnter={() => setActive(row)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(row)} onBlur={() => setActive(null)} onClick={() => { setActive(row); onSelectSchool?.(row) }} onKeyDown={event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); setActive(row); onSelectSchool?.(row) } }}>
          <title>{`${row.school}: ${comparison.previous_year} ${number(row.previous_infected)}/${number(row.previous_tested)} คน → ${comparison.year} ${number(row.current_infected)}/${number(row.current_tested)} คน`}</title>
          <circle className="shp-point-hit" cx={X(row.previous_rate_percent!)} cy={Y(row.current_rate_percent!)} r="10"/>
          <circle className="shp-point" cx={X(row.previous_rate_percent!)} cy={Y(row.current_rate_percent!)} r={Math.min(12, 3 + Math.sqrt(Math.max(0, row.current_infected ?? 0)) * .8)} fill={pointColor(row)}/>
        </g>)}
      </svg>}
      {!rows.length && <p className="shp-chart-empty">ยังไม่มีโรงเรียนที่จับคู่และมีผลตรวจทั้งสองปีในตัวกรองนี้</p>}
    </div>
    <p className="shp-series-note">จุดใต้เส้นประมีร้อยละปีที่เลือกต่ำกว่าปีก่อน จุดเหนือเส้นมีร้อยละสูงขึ้น แต่ละปีอาจเป็นนักเรียนคนละกลุ่ม ไม่ใช่การติดตามรายบุคคล</p>
    <div className="shp-tooltip" aria-live="polite">{activeExists ? <><strong>{active.school}</strong><span>{active.district} · {active.province}</span><span>ปี {comparison.previous_year}: {percent(active.previous_rate_percent)} ({number(active.previous_infected)}/{number(active.previous_tested)} คน)</span><span>ปี {comparison.year}: {percent(active.current_rate_percent)} ({number(active.current_infected)}/{number(active.current_tested)} คน)</span><span>เปลี่ยนแปลง {signed(active.delta_pp)} จุดร้อยละ</span></> : <span>ชี้ แตะ หรือใช้แป้น Tab เพื่ออ่านโรงเรียน แล้วเลือกเพื่อดูในตาราง</span>}</div>
  </section>
}
function SchoolChanges({ comparison, onSelectSchool }: { comparison: ComparisonData; onSelectSchool?: (school: ComparisonSchool) => void }) {
  const groups = [{ key: 'decreases', title: 'ลดลงมากที่สุด', rows: comparison.largest_decreases ?? [], icon: ArrowDownRight }, { key: 'increases', title: 'เพิ่มขึ้นมากที่สุด', rows: comparison.largest_increases ?? [], icon: ArrowUpRight }]
  return <section className="shp-card" data-testid="survey-school-changes"><h3>โรงเรียนที่เปลี่ยนแปลงมากที่สุด</h3><p className="shp-series-note">เฉพาะแห่งที่ส่งตรวจตั้งแต่ {number(comparison.minimum_tested_both_years ?? 30)} คนทั้งสองปี · เรียงตามจุดร้อยละที่เปลี่ยน · เลือกชื่อเพื่อดูในตาราง</p><div className="shp-change-groups">{groups.map(group => <div key={group.key}><h4><group.icon size={17}/>{group.title}</h4><ol className="shp-ranking">{group.rows.map((row, index) => <li key={row.school_id}><button type="button" disabled={!onSelectSchool} onClick={() => onSelectSchool?.(row)} aria-label={`ดูการเปลี่ยนแปลง ${row.school} ในตาราง`}><span className="shp-rank">{index + 1}</span><span className="shp-school">{row.school}<small>{row.district} · {percent(row.previous_rate_percent)} → {percent(row.current_rate_percent)}</small><small>ส่งตรวจ {number(row.previous_tested)} → {number(row.current_tested)} คน</small></span><span className={`shp-delta ${group.key === 'decreases' ? 'is-decrease' : 'is-increase'}`}>{signed(row.delta_pp)}</span></button></li>)}</ol>{!group.rows.length && <p className="shp-series-note">ไม่มีโรงเรียนที่เข้าเกณฑ์ในมุมมองนี้</p>}</div>)}</div></section>
}
export function SurveyYearComparison({ data, onSelectSchool }: { data: ComparisonData; onSelectSchool?: (school: ComparisonSchool) => void }) {
  if (!data.available) return <section className="shp shp-comparison" data-testid="survey-year-comparison"><div className="shp-section-head"><div><span className="shp-eyebrow">เปรียบเทียบกับปีก่อนหน้า</span><h2>ข้อมูลเปรียบเทียบปี {data.year}</h2></div><Layers3 size={23}/></div><div className="shp-notice"><Info size={20}/><div><p>ยังไม่มีข้อมูลรายโรงเรียนของปีก่อนหน้าที่ใช้เปรียบเทียบกับปีที่เลือกได้</p>{data.notes?.map(note => <p key={note}>{note}</p>)}</div></div></section>
  const districts = (data.by_district ?? []).map(row => ({ key: `${row.province}:${row.district}`, name: row.district, detail: row.province, previous: row.previous_rate_percent, current: row.current_rate_percent, previousCount: row.previous_infected, currentCount: row.current_infected, previousTested: row.previous_tested, currentTested: row.current_tested }))
  const species = (data.by_parasite ?? []).map(row => ({ key: row.key, name: row.parasite, previous: row.previous_rate_percent, current: row.current_rate_percent, previousCount: row.previous_count, currentCount: row.current_count }))
  return <section className="shp shp-comparison" data-testid="survey-year-comparison">
    <div className="shp-section-head"><div><span className="shp-eyebrow">ภาพรวมสองปีภายใต้ตัวกรองเดียวกัน</span><h2>เปรียบเทียบปี {data.previous_year} กับปี {data.year}</h2></div><Layers3 size={23}/></div>
    <div className="shp-kpis">{(data.kpis ?? []).map(kpi => <article className="shp-kpi" key={kpi.key} data-testid={`comparison-kpi-${kpi.key}`}><span>{kpi.label}</span><strong><span>{(kpi.unit === 'percent' || kpi.unit === 'percentage_points') ? percent(kpi.previous) : number(kpi.previous)}</span><i>→</i><span>{(kpi.unit === 'percent' || kpi.unit === 'percentage_points') ? percent(kpi.current) : number(kpi.current)}</span></strong><small>{numeric(kpi.delta) ? (kpi.unit === 'percent' || kpi.unit === 'percentage_points') ? `${signed(kpi.delta)} จุดร้อยละ` : `${signed(kpi.delta, 0)} ${kpi.unit === 'people' ? 'คน' : 'แห่ง'}` : 'ยังคำนวณการเปลี่ยนแปลงไม่ได้'}</small></article>)}</div>
    {!!data.notes?.length && <div className="shp-notice"><Info size={19}/><ul className="shp-notes">{data.notes.map(note => <li key={note}>{note}</li>)}</ul></div>}
    <div className="shp-grid"><PairedBars title="ร้อยละตรวจพบแยกตามอำเภอ" rows={districts} previousYear={data.previous_year} year={data.year}/><PairedBars title="ชนิดพยาธิเทียบสองปี" rows={species} previousYear={data.previous_year} year={data.year} species/><MatchedScatter comparison={data} onSelectSchool={onSelectSchool}/><SchoolChanges comparison={data} onSelectSchool={onSelectSchool}/></div>
  </section>
}

function heatColor(value: Value, metric: 'infection' | 'coverage' | 'share') {
  if (!numeric(value)) return undefined
  if (metric === 'infection') {
    const colors = value === 0 ? ['#d5dfd8', '#213a2e'] : value < 5 ? ['#b9d3c4', '#213a2e'] : value < 10 ? ['#efd386', '#3e361e'] : value < 20 ? ['#dfaa75', '#432d19'] : ['#ab453b', '#fff']
    return { background: colors[0], color: colors[1] }
  }
  const t = Math.max(0, Math.min(1, value / 100)), mix = (a: number, b: number) => Math.round(a + (b - a) * t)
  return { background: `rgb(${mix(232, 19)},${mix(241, 108)},${mix(235, 99)})`, color: t > .6 ? '#fff' : '#203c30' }
}
function Heatmap({ years, rows, metric, title, testId }: { years: number[]; rows: ChartSeries[]; metric: 'infection' | 'coverage' | 'share'; title: string; testId: string }) {
  return <div className="shp-heat-scroll" data-testid={testId}><table className="shp-heat"><caption>{title} · หน่วยร้อยละ · — หมายถึงไม่มีข้อมูลหรือไม่มีตัวหารที่ใช้ได้</caption><thead><tr><th scope="col">กลุ่มข้อมูล</th>{years.map(year => <th scope="col" key={year}>{year}</th>)}</tr></thead><tbody>{rows.map(row => <tr className={row.isTotal ? 'shp-heat-total' : undefined} key={row.key}><th scope="row">{row.name}</th>{years.map((year, index) => <td key={year} style={heatColor(row.values[index], metric)} data-missing={!numeric(row.values[index])} data-flagged={row.flaggedYears?.includes(year)} title={`${row.name} ปี ${year}: ${percent(row.values[index])}${row.flaggedYears?.includes(year) ? ' มีข้อสังเกตต้นทาง' : ''}`}>{number(row.values[index], 2)}{row.flaggedYears?.includes(year) && <sup aria-label="มีข้อสังเกตต้นทาง">†</sup>}</td>)}</tr>)}</tbody></table></div>
}
function YearLines({ years, rows, title, testId }: { years: number[]; rows: ChartSeries[]; title: string; testId: string }) {
  const ref = useRef<HTMLDivElement>(null), width = useChartWidth(ref)
  const [hidden, setHidden] = useState<Set<string>>(new Set()), [selectedYear, setSelectedYear] = useState<number | null>(null)
  const selectedIndex = selectedYear !== null && years.includes(selectedYear) ? years.indexOf(selectedYear) : Math.max(0, years.length - 1)
  const visible = rows.filter(row => !hidden.has(row.key)), values = visible.flatMap(row => row.values).filter(numeric)
  const height = 300, margin = { left: 43, right: 13, top: 20, bottom: 38 }, max = Math.max(5, Math.ceil(Math.max(0, ...values) / 10) * 10)
  const X = (index: number) => margin.left + index / Math.max(1, years.length - 1) * (width - margin.left - margin.right)
  const Y = (value: number) => height - margin.bottom - value / max * (height - margin.top - margin.bottom)
  const toggle = (key: string) => setHidden(previous => { const next = new Set(previous); if (next.has(key)) next.delete(key); else next.add(key); return next })
  const chooseAtPointer = (clientX: number, bounds: DOMRect) => {
    const position = (clientX - bounds.left) / bounds.width * width
    const index = Math.max(0, Math.min(years.length - 1, Math.round((position - margin.left) / (width - margin.left - margin.right) * Math.max(1, years.length - 1))))
    setSelectedYear(years[index])
  }
  return <div className="shp-year-lines">
    <div className="shp-chart-year-select"><label>อ่านค่าปี<select aria-label={`ดูค่าปี ${title}`} value={years[selectedIndex] ?? ''} onChange={event => setSelectedYear(Number(event.target.value))}>{years.map(year => <option key={year}>{year}</option>)}</select></label><span>หน่วยร้อยละ · ชี้หรือแตะกราฟเพื่อเลือกปี</span></div>
    <div ref={ref} className="shp-chart shp-line-chart" data-testid={testId} onPointerMove={event => chooseAtPointer(event.clientX, event.currentTarget.getBoundingClientRect())}>
      {!!years.length && <svg viewBox={`0 0 ${width} ${height}`} role="group" aria-label={title}>
        {Array.from({ length: 5 }, (_, index) => max * index / 4).map(tick => <g key={tick}><line className="shp-gridline" x1={margin.left} x2={width - margin.right} y1={Y(tick)} y2={Y(tick)}/><text className="shp-axis-text" x={margin.left - 7} y={Y(tick) + 4} textAnchor="end">{number(tick, 1)}</text></g>)}
        {years.map((year, index) => (width >= 480 || index % 2 === 0 || index === years.length - 1) && <text className="shp-axis-text" x={X(index)} y={height - 12} textAnchor="middle" key={year}>{String(year).slice(-2)}</text>)}
        {rows.map((row, index) => {
          if (hidden.has(row.key)) return null
          let pen = false, path = ''
          row.values.forEach((value, position) => { if (!numeric(value)) { pen = false; return } path += `${pen ? 'L' : 'M'}${X(position)} ${Y(value)} `; pen = true })
          const color = seriesColor(row, index)
          return <g key={row.key} data-series={row.key}><path d={path} fill="none" stroke={color} strokeWidth={row.isTotal ? 3 : 2} strokeDasharray={row.isTotal ? '6 4' : undefined} strokeLinejoin="round"/>{row.values.map((value, position) => numeric(value) && <circle key={years[position]} cx={X(position)} cy={Y(value)} r={position === selectedIndex ? 4.5 : 2.8} fill={color}/>)}</g>
        })}
        <line className="shp-year-guide" x1={X(selectedIndex)} x2={X(selectedIndex)} y1={margin.top} y2={height - margin.bottom}/>
        {years.map((year, index) => <rect key={year} className="shp-year-hit" x={X(index) - Math.min(17, (width - margin.left - margin.right) / Math.max(1, years.length - 1) / 2)} y={margin.top} width={Math.min(34, (width - margin.left - margin.right) / Math.max(1, years.length - 1))} height={height - margin.top - margin.bottom} fill="transparent" role="button" tabIndex={0} aria-label={`อ่านค่าปี ${year} ใน${title}`} aria-pressed={index === selectedIndex} onFocus={() => setSelectedYear(year)} onClick={() => setSelectedYear(year)} onKeyDown={event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); setSelectedYear(year) } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setSelectedYear(years[Math.max(0, Math.min(years.length - 1, selectedIndex + (event.key === 'ArrowRight' ? 1 : -1)))]) } }}/>) }
      </svg>}
    </div>
    <div className="shp-legend" role="group" aria-label={`เส้นข้อมูล ${title}`}>{rows.map((row, index) => <button type="button" key={row.key} className={`shp-legend-item ${hidden.has(row.key) ? 'is-hidden' : ''}`} aria-pressed={!hidden.has(row.key)} aria-label={`${hidden.has(row.key) ? 'แสดง' : 'ซ่อน'}เส้น ${row.name} ใน${title}`} onClick={() => toggle(row.key)}><i className="shp-color-dot" style={{ background: seriesColor(row, index) }}/>{row.name}{!!row.flaggedYears?.length && <sup aria-label="มีข้อสังเกตต้นทาง">†</sup>}{!hidden.has(row.key) && <Check size={13}/>}</button>)}</div>
    <div className="shp-tooltip" aria-live="polite" data-testid={`${testId}-values`}><strong>ปี {years[selectedIndex]}</strong><div className="shp-tooltip-grid">{visible.map((row, index) => <span key={row.key}><i className="shp-color-dot" style={{ background: seriesColor(row, rows.findIndex(item => item.key === row.key)) }}/>{row.name}<b>{percent(row.values[selectedIndex])}{row.flaggedYears?.includes(years[selectedIndex]) && <sup aria-label="มีข้อสังเกตต้นทาง">†</sup>}</b><span className="shp-screen-reader-only">ลำดับ {index + 1}</span></span>)}</div>{!visible.length && <span>ซ่อนเส้นทั้งหมดอยู่ เลือกชื่อกลุ่มด้านบนเพื่อแสดงอีกครั้ง</span>}</div>
  </div>
}
export function SurveyHistoricalTrends({ data }: { data: HistoryData }) {
  const [dimensionKey, setDimensionKey] = useState('province'), [metric, setMetric] = useState<'infection' | 'coverage'>('infection')
  const dimension = data.dimensions.find(item => item.key === dimensionKey) ?? data.dimensions[0]
  const issues = data.quality?.issues ?? []
  const flaggedYears = (name: string) => issues.filter(issue => issue.series === name && issue.year !== undefined && issue.dimension?.split('|').includes(dimension?.key ?? '') && (!issue.metric || issue.metric === (metric === 'coverage' ? 'coverage_percent' : 'infection_rate_percent'))).map(issue => issue.year!)
  const rows: ChartSeries[] = (dimension?.series ?? []).map(row => ({ key: row.key, name: row.name, isTotal: row.is_total, values: metric === 'coverage' ? row.coverage_percent : row.infection_rate_percent, flaggedYears: flaggedYears(row.name) }))
  const species: ChartSeries[] = data.species_series.map(row => ({ key: row.key, name: row.name, values: row.positive_share_percent, flaggedYears: row.flagged_years }))
  const title = metric === 'coverage' ? 'ความครอบคลุมการส่งตรวจ' : 'ร้อยละตรวจพบในผู้ส่งตรวจ'
  if (!data.years.length) return null
  return <section className="shp shp-history" data-testid="survey-history">
    <div className="shp-section-head"><div><span className="shp-eyebrow">มองการเปลี่ยนแปลงในระยะยาว</span><h2>แนวโน้มทุกปี {data.years[0]}–{data.years.at(-1)}</h2></div><TrendingUp size={24}/></div>
    <div className="shp-notice"><Info size={20}/><p>{data.scope_note ?? 'ส่วนนี้แสดงชุดสรุปรายปีและมีตัวเลือกมิติของตนเอง ตัวกรองโรงเรียนในส่วนบนไม่ได้ใช้คำนวณข้อมูลย้อนหลังที่มีเพียงร้อยละ'}</p></div>
    {!!data.insights?.length && <section className="shp-card shp-insights"><h3>ข้อค้นพบสำคัญจากข้อมูลรายปี</h3><ul>{data.insights.map(insight => <li key={insight}>{insight}</li>)}</ul></section>}
    <section className="shp-card">
      <div className="shp-controls"><label>มิติข้อมูล<select aria-label="มิติข้อมูลแนวโน้ม" value={dimension?.key ?? ''} onChange={event => setDimensionKey(event.target.value)}>{data.dimensions.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label><div className="shp-segments" role="group" aria-label="ตัวชี้วัดแนวโน้ม"><button type="button" aria-pressed={metric === 'infection'} onClick={() => setMetric('infection')}>ร้อยละตรวจพบ</button><button type="button" aria-pressed={metric === 'coverage'} onClick={() => setMetric('coverage')}>ความครอบคลุมส่งตรวจ</button></div></div>
      <h3>{title} · {dimension?.label}</h3><p className="shp-series-note">เส้นประหนาแสดงยอดรวมที่มีรายงาน เลือกชื่อกลุ่มเพื่อซ่อน/แสดงเส้น ช่องว่างคือไม่มีข้อมูลหรือตัวหารที่ใช้ได้ ปีบนแกนแสดงสองหลักท้ายของ พ.ศ.</p>
      <p className="shp-series-note">† มีข้อสังเกตต้นทางหรือค่าที่คำนวณใหม่ อ่านรายละเอียดด้านล่าง โดยไม่ตัดค่าที่เกิน 100% ออกจากกราฟ</p>
      <YearLines key={`dimension:${dimension?.key}`} years={data.years} rows={rows} title={`${title} ${dimension?.label ?? ''}`} testId="history-trend-chart"/>
      <Heatmap years={data.years} rows={rows} metric={metric} title={`${title} แยกตาม${dimension?.label ?? 'มิติ'}`} testId="history-trend-heatmap"/>
    </section>
    <section className="shp-card"><h3>ชนิดพยาธิรายปี · ร้อยละของผู้ตรวจพบพยาธิ</h3><p className="shp-series-note">ตัวหารส่วนนี้คือผู้ตรวจพบพยาธิ ต่างจากกราฟหลักที่หารด้วยผู้ส่งตรวจ ผลรวมแต่ละชนิดอาจเกิน 100% เพราะคนหนึ่งอาจพบมากกว่าหนึ่งชนิด</p><YearLines years={data.years} rows={species} title="ชนิดพยาธิ ร้อยละของผู้ตรวจพบพยาธิ" testId="history-species-chart"/><Heatmap years={data.years} rows={species} metric="share" title="ชนิดพยาธิรายปี ร้อยละของผู้ตรวจพบพยาธิ" testId="history-species-heatmap"/></section>
    <details className="shp-source shp-provenance-details"><summary><span><Info size={18}/>แหล่งข้อมูลและข้อควรอ่าน{issues.length > 0 && <b>{issues.length} ประเด็น</b>}</span><ChevronDown size={18}/></summary><div><p><strong>{data.source.file_name ?? 'ไฟล์สรุปรายปีที่แนบ'}</strong></p>{data.source.note && <p>{data.source.note}</p>}<p>ข้อมูลย้อนหลังอ้างอิงไฟล์แนบ ยังไม่ได้ตรวจเทียบ Excel ต้นฉบับย้อนหลังทั้งหมด ปีที่มีจำนวนรายโรงเรียนคำนวณใหม่จากชุดที่นำเข้า พร้อมเก็บข้อสังเกตของค่ารายงานเดิม</p>{issues.length > 0 && <ul>{issues.map((issue, index) => <li key={`${issue.code}-${index}`}><strong>{issue.title ?? 'ข้อสังเกตข้อมูล'}</strong><p>{issue.message}</p>{numeric(issue.reported_value) && <small>ค่ารายงานเดิม {percent(issue.reported_value)}{numeric(issue.computed_value) ? ` · ค่าคำนวณจากจำนวนคน ${percent(issue.computed_value)}` : ''}</small>}{issue.reported_values && <small>{Object.entries(issue.reported_values).map(([key, value]) => `${key === 'province' ? 'ตารางจังหวัด' : key === 'affiliation' ? 'ตารางสังกัด' : key}: ${percent(value)}`).join(' · ')}</small>}</li>)}</ul>}</div></details>
  </section>
}
export default function SurveyHistoryPanels({ comparison, history, onSelectSchool }: { comparison?: ComparisonData | null; history?: HistoryData | null; onSelectSchool?: (school: ComparisonSchool) => void }) {
  return <>{comparison && <SurveyYearComparison data={comparison} onSelectSchool={onSelectSchool}/>} {history && <SurveyHistoricalTrends data={history}/>}</>
}
