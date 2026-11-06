import { lazy, Suspense, useEffect, useState } from 'react'
import { ArrowRight, ArrowUpRight, Box, Check, CircleDot, Crosshair, Layers3, LoaderCircle, Pause, Play, RotateCcw, ScanLine, ShieldCheck, Upload, ZoomIn, ZoomOut } from 'lucide-react'
import { getSpeciesById, species } from '../data/species'
import { getAtlasStructures } from '../data/atlasStructures'
import EggIllustration from './EggIllustration'
import '../styles/field-overview.css'

const AtlasModel = lazy(() => import('./AtlasModel'))
const specimenOptions = [
  { id: 'opisthorchis', label: 'OV', detail: 'ใบไม้ตับ' },
  { id: 'ascaris', label: 'ASCARIS', detail: 'ไส้เดือน' },
  { id: 'taenia', label: 'TAENIA', detail: 'พยาธิตืด' },
] as const

interface FieldOverviewProps {
  modelReady: boolean
  backendReady: boolean
  backendChecked: boolean
  onScan: () => void
  onDemo: () => void
  onAtlas: (id?: string) => void
}

function reducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export default function FieldOverview({ modelReady, backendReady, backendChecked, onScan, onDemo, onAtlas }: FieldOverviewProps) {
  const [specimenId, setSpecimenId] = useState<string>('opisthorchis')
  const [cutaway, setCutaway] = useState(true)
  const [autoRotate, setAutoRotate] = useState(() => !reducedMotion())
  const [zoom, setZoom] = useState(1)
  const [resetKey, setResetKey] = useState(0)
  const [selectedStructureId, setSelectedStructureId] = useState<string | null>(null)
  const item = getSpeciesById(specimenId)
  const structures = getAtlasStructures(item.id)
  const selectedStructure = structures.find(part => part.id === selectedStructureId)
  const specimenIndex = specimenOptions.findIndex(option => option.id === item.id) + 1
  const modelStatus = modelReady ? 'โมเดล AI พร้อมใช้งาน' : backendReady ? 'ยังไม่พร้อมตรวจด้วย AI' : backendChecked ? 'ยังเชื่อมบริการตรวจภาพไม่ได้' : 'กำลังเชื่อมต่อบริการ'

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const change = () => { if (preference.matches) setAutoRotate(false) }
    preference.addEventListener('change', change)
    return () => preference.removeEventListener('change', change)
  }, [])

  const chooseSpecimen = (id: string) => {
    setSpecimenId(id)
    setSelectedStructureId(null)
    setZoom(1)
    setResetKey(previous => previous + 1)
  }
  const chooseStructure = (id: string) => {
    const part = structures.find(structure => structure.id === id)
    if (part?.internal) setCutaway(true)
    setSelectedStructureId(previous => previous === id ? null : id)
  }
  const resetModel = () => {
    setZoom(1)
    setSelectedStructureId(null)
    setResetKey(previous => previous + 1)
  }
  const setMagnification = (value: number) => setZoom(Math.max(.7, Math.min(1.7, Math.round(value * 10) / 10)))

  return <section className="field-overview" aria-labelledby="field-title">
    <header className="field-heading">
      <div>
        <p className="field-eyebrow"><span /> PARASITOLOGY / A CLOSER LOOK</p>
        <h1 id="field-title">มองเห็น เข้าใจ <span>เรียนรู้</span><i aria-hidden="true">/</i></h1>
        <p className="field-intro">จากภาพใต้กล้อง สู่ความเข้าใจในทุกรายละเอียด</p>
      </div>
      <div className={`field-connection ${modelReady ? 'field-connection-ready' : ''}`} role="status">
        <span className="field-connection-dot" />
        <div><span className="field-meta-label">AI ANALYSIS</span><strong>{modelStatus}</strong></div>
      </div>
    </header>

    <button className="field-mobile-upload" onClick={onScan}><Upload size={18}/> อัปโหลดหรือถ่ายภาพ <ArrowRight size={17}/></button>

    <div className="field-deck">
      <div className="field-deck-topline" aria-hidden="true"><span>HELPMINTHS / MORPHOLOGY STUDIO</span><span>INTERACTIVE SPECIMEN · 0{specimenIndex}</span></div>
      <div className="field-instruments">
        <div className="field-left-column">
          <section className="field-panel field-analysis-panel" aria-labelledby="field-analysis-title">
            <div className="field-panel-heading"><h2 id="field-analysis-title">เริ่มตรวจภาพ</h2><span>01 / ANALYZE</span></div>
            <div className="field-upload-mark"><Upload size={24} strokeWidth={1.5}/><span className="field-upload-plus" aria-hidden="true">+</span></div>
            <p>อัปโหลดภาพจุลทรรศน์<br/>หรือถ่ายภาพด้วยกล้องมือถือ</p>
            <button className="field-scan-button" onClick={onScan}><ScanLine size={18}/><span>เริ่มตรวจวิเคราะห์</span><ArrowRight size={16}/></button>
            <button className="field-demo-button" onClick={onDemo}>ดูตัวอย่าง <ArrowUpRight size={16}/></button>
            <div className="field-mini-note"><ShieldCheck size={14}/><span>ผล AI ต้องให้ผู้เชี่ยวชาญยืนยัน</span></div>
          </section>
          <section className="field-panel field-collection-panel" aria-labelledby="field-collection-title">
            <div className="field-panel-heading"><h2 id="field-collection-title">คลังการเรียนรู้</h2><span>02 / ATLAS</span></div>
            <div className="field-collection-value"><strong>{String(species.length).padStart(2, '0')}</strong><span>กลุ่มไข่และตัวอ่อน<br/>ใน Atlas</span><Box size={27} strokeWidth={1.2}/></div>
            <p>ภาพไข่จริงและโมเดล 3D<br/>สำหรับเปรียบเทียบโครงสร้าง</p>
            <button className="field-atlas-link" onClick={() => onAtlas()}>สำรวจ Atlas ทั้งหมด <ArrowUpRight size={16}/></button>
          </section>
        </div>

        <div className="field-specimen-column">
          <div className="field-specimen-selector" role="group" aria-label="เลือกตัวอย่างโมเดลบนหน้าหลัก">
            {specimenOptions.map(option => <button key={option.id} onClick={() => chooseSpecimen(option.id)} aria-pressed={item.id === option.id} className={item.id === option.id ? 'field-specimen-active' : ''}><span>{option.label}</span><small>{option.detail}</small></button>)}
          </div>
          <div className="field-specimen-stage">
            <div className="field-orbit field-orbit-outer" aria-hidden="true"/><div className="field-orbit field-orbit-mid" aria-hidden="true"/><div className="field-orbit field-orbit-inner" aria-hidden="true"/>
            <span className="field-stage-cross field-stage-cross-one" aria-hidden="true">+</span><span className="field-stage-cross field-stage-cross-two" aria-hidden="true">+</span>
            <span className="field-stage-axis" aria-hidden="true">X <span/> Y</span>
            <div className="field-model-stage" role="group" aria-label={`แบบจำลอง 3D ${item.name}`}>
              <Suspense fallback={<div className="field-model-loading"><EggIllustration speciesId={item.id} showInternal={cutaway}/><span><LoaderCircle size={14} className="spin"/>กำลังเตรียมโมเดล 3D…</span></div>}>
                <AtlasModel item={item} cutaway={cutaway} autoRotate={autoRotate} resetKey={resetKey} selectedStructureId={selectedStructureId} onSelectStructure={chooseStructure} zoom={zoom} labels={false}/>
              </Suspense>
            </div>
            <div className="field-stage-caption"><span className="field-coral-square"/><span>EDUCATIONAL MODEL</span><span className="field-stage-view">{cutaway ? 'SECTION VIEW' : 'SURFACE VIEW'}</span></div>
          </div>
          <div className="field-specimen-caption">
            <div><span className="field-meta-label">SELECTED SPECIMEN / 0{specimenIndex}</span><h2>{item.name}</h2><p>ไข่{item.thaiName}</p></div>
            <button className="field-open-specimen" onClick={() => onAtlas(item.id)} aria-label={`ดู ${item.name} ใน Atlas`}><ArrowUpRight size={22}/></button>
          </div>
          <div className="field-model-controls" role="group" aria-label="ปรับมุมมองโมเดลหน้าหลัก">
            <button aria-pressed={autoRotate} onClick={() => setAutoRotate(previous => !previous)} title={autoRotate ? 'หยุดหมุน' : 'หมุนอัตโนมัติ'}>{autoRotate ? <Pause size={15}/> : <Play size={15}/>}<span>หมุน</span></button>
            <button aria-pressed={cutaway} onClick={() => setCutaway(previous => !previous)}><Layers3 size={15}/><span>ภาพตัด</span></button>
            <div className="field-zoom-controls"><button onClick={() => setMagnification(zoom - .1)} disabled={zoom <= .7} aria-label="ย่อโมเดลหน้าหลัก"><ZoomOut size={16}/></button><label><span className="field-visually-hidden">ขยายโมเดลหน้าหลัก</span><input type="range" min=".7" max="1.7" step=".1" value={zoom} onChange={event => setMagnification(Number(event.target.value))}/></label><button onClick={() => setMagnification(zoom + .1)} disabled={zoom >= 1.7} aria-label="ขยายโมเดลหน้าหลัก"><ZoomIn size={16}/></button></div>
            <button onClick={resetModel} aria-label="คืนมุมมองโมเดลหน้าหลัก" title="คืนมุมมอง"><RotateCcw size={16}/></button>
          </div>
          <p className="field-drag-hint">ลากเพื่อหมุน · เลื่อนหรือจีบนิ้วเพื่อซูม</p>
        </div>

        <section className="field-panel field-structure-panel" aria-labelledby="field-structure-title">
          <div className="field-panel-heading"><h2 id="field-structure-title">จุดสังเกต</h2><span>03 / STRUCTURE</span></div>
          <p className="field-structure-intro">เลือกส่วนที่ต้องการสำรวจ</p>
          <div className="field-structure-list">{structures.map((part, index) => <button key={part.id} aria-pressed={selectedStructureId === part.id} onClick={() => chooseStructure(part.id)}><span className="field-structure-number">{String(index + 1).padStart(2, '0')}</span><span>{part.shortLabel}</span>{selectedStructureId === part.id ? <Check size={15}/> : <CircleDot size={13}/>}</button>)}</div>
          <div className="field-structure-description" aria-live="polite"><Crosshair size={17}/><h3>{selectedStructure?.shortLabel ?? 'มองให้ใกล้ เข้าใจให้ชัด'}</h3><p>{selectedStructure?.description ?? item.features[0]}</p></div>
          <div className="field-reference-size"><span className="field-meta-label">REFERENCE SIZE</span><strong>{item.size}</strong><small>ขนาดอ้างอิง ไม่ใช่สเกลบนจอ</small></div>
        </section>
      </div>
      <div className="field-deck-footer"><span><Box size={14}/> แบบจำลองเพื่ออธิบายโครงสร้าง สีและสัดส่วนไม่ใช่ภาพสแกนจริง</span><button onClick={() => onAtlas(item.id)}>เปรียบเทียบกับภาพไข่จริง <ArrowRight size={15}/></button></div>
    </div>
  </section>
}
