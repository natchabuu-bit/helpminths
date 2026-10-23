import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, BookOpen, Box, Check, ChevronRight, Eye, Info, Layers3, Maximize2, Minus, Pause, Play, Plus, RotateCcw, Search, SlidersHorizontal, X } from 'lucide-react';
import { getSpeciesById, groupLabels, matchSpeciesLabel, species, type SpeciesGroup } from '../data/species';
import { atlasEvidenceNote, atlasSources, getAtlasStructures } from '../data/atlasStructures';
import { atlasPhotos, getAtlasPhotos } from '../data/atlasPhotos';
import { ascarisStages, getAscarisStage, getAscarisStagePhotos, getAscarisStructures, type AscarisStageId } from '../data/ascarisStages';
import EggIllustration from './EggIllustration';
import AtlasModel from './AtlasModel';
import AtlasPhotoViewer from './AtlasPhotoViewer';
import AscarisStageGuide from './AscarisStageGuide';
import StrongyloidesGuide from './StrongyloidesGuide';
import '../styles/atlas.css';

type ViewMode = 'compare' | 'model' | 'photo';
const viewModes: { id: ViewMode; label: string }[] = [
  { id: 'compare', label: 'เทียบภาพจริงกับ 3D' }, { id: 'model', label: 'โมเดล 3D' }, { id: 'photo', label: 'ภาพไข่จริง' },
];
const photoCoverage = new Set(atlasPhotos.map((photo) => photo.speciesId)).size;
const structureCount = species.reduce((count, item) => count + (item.id === 'ascaris'
  ? new Set(ascarisStages.flatMap((stage) => getAscarisStructures(stage.id).map((part) => part.id))).size
  : getAtlasStructures(item.id).length), 0);

export default function Atlas({ initialSpecies }: { initialSpecies?: string }) {
  const [selectedId, setSelectedId] = useState(getSpeciesById(initialSpecies).id);
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<SpeciesGroup | 'all'>('all');
  const [mode, setMode] = useState<ViewMode>('compare');
  const [cutaway, setCutaway] = useState(initialSpecies === 'strongyloides');
  const [labels, setLabels] = useState(true);
  const [autoRotate, setAutoRotate] = useState(initialSpecies !== 'strongyloides');
  const [zoom, setZoom] = useState(1);
  const [selectedStructureId, setSelectedStructureId] = useState<string | null>(initialSpecies === 'strongyloides' ? 'genital-primordium' : null);
  const [ascarisStage, setAscarisStage] = useState<AscarisStageId>('fertilized');
  const [ascarisDecorticated, setAscarisDecorticated] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const viewerRef = useRef<HTMLDivElement>(null);
  const item = getSpeciesById(selectedId);
  const isAscaris = item.id === 'ascaris';
  const isLarva = item.specimenType === 'larva';
  const currentStage = getAscarisStage(ascarisStage);
  const structures = isAscaris ? getAscarisStructures(ascarisStage, ascarisDecorticated) : getAtlasStructures(item.id);
  const selectedStructure = structures.find((part) => part.id === selectedStructureId) || null;
  const photos = isAscaris ? getAscarisStagePhotos(ascarisStage, ascarisDecorticated) : getAtlasPhotos(item.id);
  const displayFeatures = isAscaris ? [...currentStage.features, ascarisDecorticated ? 'ชั้นผิวนอกขรุขระหลุดออก เหลือเปลือกผิวเรียบ' : 'มีชั้นผิวนอกขรุขระ (mammillated coat)'] : item.features;
  const queryLabel = query.toLowerCase().trim();
  const aliasMatch = matchSpeciesLabel(queryLabel);
  const matches = species.filter((entry) => (group === 'all' || entry.group === group) && (entry.id === aliasMatch?.id || `${entry.name} ${entry.thaiName}`.toLowerCase().includes(queryLabel)));

  function chooseSpecies(id: string) {
    const larva = id === 'strongyloides';
    setSelectedId(id); setSelectedStructureId(larva ? 'genital-primordium' : null); setZoom(1); setCutaway(larva);
    if (larva) setAutoRotate(false);
    setAscarisStage('fertilized'); setAscarisDecorticated(false);
    setResetKey((value) => value + 1);
  }
  function selectStructure(id: string) {
    const part = structures.find((entry) => entry.id === id);
    if (!part) return;
    setSelectedStructureId(id); setAutoRotate(false);
    if (part.internal) setCutaway(true);
    if (mode === 'photo') setMode('compare');
  }
  function resetModel() {
    setSelectedStructureId(null); setZoom(1); setResetKey((value) => value + 1);
  }
  useEffect(() => { if (initialSpecies) chooseSpecies(getSpeciesById(initialSpecies).id); }, [initialSpecies]);
  useEffect(() => {
    if (!expanded) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setExpanded(false); return; }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(viewerRef.current?.querySelectorAll<HTMLElement>('button, a[href], input, [tabindex="0"]') || []).filter((element) => element.getClientRects().length && !(element as HTMLButtonElement).disabled);
      const first = focusable[0], last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && (document.activeElement === first || document.activeElement === viewerRef.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === viewerRef.current)) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; viewerRef.current?.focus();
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = previous; previousFocus?.focus(); };
  }, [expanded]);

  return <section className="atlas-page" aria-label="คลังเรียนรู้ไข่และตัวอ่อนพยาธิสามมิติ">
    <div className="atlas-heading">
      <div><div className="atlas-eyebrow"><span /> THE MORPHOLOGY COLLECTION</div><h1>จากภาพจริง <span>สู่ความเข้าใจโครงสร้าง</span></h1><p>เทียบภาพกล้องจุลทรรศน์กับโมเดล 3D แล้วเลือกสำรวจทีละส่วน</p></div>
      <div className="atlas-collection-tag"><Box size={23} /><div><strong>Microscopy × 3D Atlas</strong><span>{species.length} กลุ่มอ้างอิง · ภาพจริง {photoCoverage} กลุ่ม · โครงสร้าง {structureCount} จุด</span></div></div>
    </div>
    <div className="atlas-workspace">
      <aside className="atlas-catalog" aria-label="เลือกชนิดพยาธิ">
        <div className="atlas-catalog-heading"><h2>คลังไข่และตัวอ่อน</h2><span>{species.length}</span></div>
        <label className="atlas-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหาชื่อพยาธิ..." aria-label="ค้นหาชื่อพยาธิ" /></label>
        <label className="atlas-filter"><SlidersHorizontal size={14} /><select value={group} onChange={(event) => setGroup(event.target.value as SpeciesGroup | 'all')} aria-label="กรองกลุ่มพยาธิ"><option value="all">ทุกกลุ่มพยาธิ</option>{Object.entries(groupLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <div className="atlas-species-list">
          {matches.map((entry) => <button className={`atlas-species-item ${entry.id === selectedId ? 'atlas-selected' : ''}`} key={entry.id} onClick={() => chooseSpecies(entry.id)} aria-pressed={entry.id === selectedId}>
            <div className="atlas-species-thumb"><EggIllustration speciesId={entry.id} /></div><div className="atlas-species-name"><span className="atlas-item-index">SPECIMEN {String(species.indexOf(entry) + 1).padStart(2, '0')}</span><strong>{entry.name}</strong><span>{entry.thaiName}</span><small>{getAtlasPhotos(entry.id).length ? entry.specimenType === 'larva' ? 'มีภาพตัวอ่อนจริง' : 'มีภาพไข่จริง' : '3D · รอภาพจริง'}</small></div><ChevronRight size={15} />
          </button>)}
          {matches.length === 0 && <p className="atlas-empty">ไม่พบชนิดที่ตรงกับคำค้น<br /><button onClick={() => { setQuery(''); setGroup('all'); }}>ดูทั้งหมด</button></p>}
        </div>
        <div className="atlas-catalog-foot"><BookOpen size={15} /><span>ภาพและโมเดลพร้อมใช้ออฟไลน์<br />หลังบันทึกแอพครบแล้ว</span></div>
      </aside>
      <div className={`atlas-viewer ${expanded ? 'atlas-viewer-expanded' : ''}`} ref={viewerRef} tabIndex={-1} role={expanded ? 'dialog' : undefined} aria-modal={expanded || undefined} aria-label={expanded ? `แบบจำลองสามมิติ ${item.name}` : undefined}>
        <div className="atlas-viewer-top">
          <div className="atlas-specimen-caption"><span>{groupLabels[item.group]}</span><h2>{item.name}</h2><p>{item.thaiName}</p></div>
          <div className="atlas-viewer-actions"><button aria-label={expanded ? 'ปิดมุมมองแบบขยาย' : 'ขยายมุมมอง'} aria-pressed={expanded} title="ขยายหรือย่อมุมมอง · Esc เพื่อปิด" onClick={() => setExpanded((value) => !value)}>{expanded ? <><X size={16} /><span>ปิด</span></> : <Maximize2 size={17} />}</button></div>
        </div>
        {isAscaris && <AscarisStageGuide stage={ascarisStage} decorticated={ascarisDecorticated} onStageChange={(stage) => { setAscarisStage(stage); resetModel(); }} onDecorticatedChange={(value) => { setAscarisDecorticated(value); resetModel(); }} />}
        {isLarva && <StrongyloidesGuide onSelectGenitalPrimordium={() => { selectStructure('genital-primordium'); setZoom(1.6); setResetKey((value) => value + 1); }} />}
        <div className="atlas-view-tabs" role="tablist" aria-label="รูปแบบการเรียนรู้">{viewModes.map((view, index) => <button id={`atlas-tab-${view.id}`} key={view.id} role="tab" aria-selected={mode === view.id} aria-controls="atlas-learning-panels" tabIndex={mode === view.id ? 0 : -1} onClick={() => setMode(view.id)} onKeyDown={(event) => {
          const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : step ? (index + step + viewModes.length) % viewModes.length : null;
          if (next !== null) { event.preventDefault(); setMode(viewModes[next].id); document.getElementById(`atlas-tab-${viewModes[next].id}`)?.focus(); }
        }}>{view.label}</button>)}</div>
        <div id="atlas-learning-panels" role="tabpanel" aria-labelledby={`atlas-tab-${mode}`} className={`atlas-comparison atlas-comparison-${mode}`}>
          <section className="atlas-photo-panel" aria-label={isLarva ? 'ตัวอย่างภาพตัวอ่อนจริง' : 'ตัวอย่างภาพไข่จริง'} hidden={mode === 'model'}><div className="atlas-pane-title"><span className="atlas-pane-index">01</span><div><h3>{isLarva ? 'ภาพตัวอ่อนจริง' : 'ภาพไข่จริง'}</h3><p>LIGHT MICROSCOPY</p></div></div><AtlasPhotoViewer key={isAscaris ? `${item.id}-${ascarisStage}-${ascarisDecorticated}` : item.id} item={item} photos={photos} selectedStructure={selectedStructure} emptyTitle={isAscaris ? 'ยังไม่มีภาพจริงที่ตรงกับตัวเลือกนี้' : undefined} emptyDescription={isAscaris ? `ยังไม่มีภาพไข่ ${currentStage.englishTitle}${ascarisDecorticated ? ' แบบ decorticated' : ''} ที่ยืนยันระยะ ลักษณะเปลือก และสิทธิ์นำมาใช้ได้ ดูภาพวาดอธิบายด้านบนและโมเดลที่เปลี่ยนตามตัวเลือก พร้อมแหล่งอ้างอิงประกอบ` : undefined} /></section>
          <section className="atlas-model-panel" aria-label="แบบจำลองโครงสร้าง" hidden={mode === 'photo'}>
            <div className="atlas-pane-title"><span className="atlas-pane-index">02</span><div><h3>โมเดลอธิบายโครงสร้าง</h3><p>INTERACTIVE 3D · ไม่ใช่สเกลจริง</p></div><button className="atlas-icon-button" aria-label="เริ่มมุมมองใหม่" title="เริ่มมุมมองใหม่" onClick={resetModel}><RotateCcw size={16} /></button></div>
            <div className="atlas-model-stage"><AtlasModel item={item} cutaway={cutaway} autoRotate={autoRotate} resetKey={resetKey} selectedStructureId={selectedStructureId} onSelectStructure={selectStructure} zoom={zoom} labels={labels} ascarisStage={ascarisStage} ascarisDecorticated={ascarisDecorticated} />
              {labels && <div className="atlas-annotations" aria-label="จุดสังเกตของแบบจำลอง"><span className="atlas-model-label">{selectedStructure ? selectedStructure.shortLabel : 'กดจุดสีเขียวหรือส่วนของโมเดล'}</span><small>{cutaway ? 'ภาพตัดภายใน' : isLarva ? 'ผิวลำตัวโปร่งเพื่อเรียนรู้ภายใน' : 'เปลือกโปร่งเพื่อเรียนรู้ภายใน'}</small></div>}
            </div>
            <div className="atlas-zoom-controls"><button aria-label="ย่อโมเดล 3D" disabled={zoom <= .65} onClick={() => setZoom((value) => Math.max(.65, +(value - .2).toFixed(2)))}><Minus size={16} /></button><input aria-label="ซูมโมเดล 3D" type="range" min="0.65" max="2.5" step="0.05" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /><button aria-label="ขยายโมเดล 3D" disabled={zoom >= 2.5} onClick={() => setZoom((value) => Math.min(2.5, +(value + .2).toFixed(2)))}><Plus size={16} /></button><output>{Math.round(zoom * 100)}%</output></div>
            <div className="atlas-model-toolbar"><button className={cutaway ? 'atlas-tool-active' : ''} aria-pressed={cutaway} onClick={() => { setCutaway((value) => !value); if (cutaway && selectedStructure?.internal) setSelectedStructureId(null); }}><Layers3 size={16} /> ภาพตัดภายใน</button><button className={labels ? 'atlas-tool-active' : ''} aria-pressed={labels} onClick={() => setLabels((value) => !value)}><Eye size={16} /> จุดสังเกต</button><button className={autoRotate ? 'atlas-tool-active' : ''} aria-label={autoRotate ? 'หยุดหมุนอัตโนมัติ' : 'หมุนอัตโนมัติ'} aria-pressed={autoRotate} onClick={() => setAutoRotate((value) => !value)}>{autoRotate ? <Pause size={15} /> : <Play size={15} />}</button></div>
            <p className="atlas-viewer-instructions">ลากเพื่อหมุน · ล้อเมาส์หรือสองนิ้วเพื่อซูม · กดส่วนประกอบเพื่อโฟกัส</p>
          </section>
        </div>
        <p className="atlas-compare-note"><Info size={14} /> ภาพจริงกับโมเดลอาจต่างมุม ระยะพัฒนา และกำลังขยาย ใช้เทียบลักษณะ ไม่ใช้วัดขนาดหรือจัดแนว{isLarva ? 'ตัวอ่อน' : 'ฟองไข่'}</p>
        <section className="atlas-structure-explorer" aria-label={isLarva ? 'สำรวจส่วนประกอบของตัวอ่อน' : 'สำรวจส่วนประกอบของไข่'}>
          <div className="atlas-structure-heading"><h3>สำรวจทีละส่วน <span>{structures.length} จุด</span></h3><span>เลือกจากโมเดลหรือรายการนี้</span></div>
          <div className="atlas-structure-list">{structures.map((part, index) => <button key={part.id} className={part.id === selectedStructureId ? 'atlas-structure-selected' : ''} aria-pressed={part.id === selectedStructureId} onClick={() => selectStructure(part.id)}><span>{String(index + 1).padStart(2, '0')}</span>{part.shortLabel}{part.internal && <Layers3 size={13} />}</button>)}</div>
          <div className="atlas-structure-description" aria-live="polite" aria-atomic="true">{selectedStructure ? <><div><span>{selectedStructure.internal ? 'โครงสร้างภายใน' : 'ลักษณะภายนอก'}</span><h4>{selectedStructure.label}</h4></div><p>{selectedStructure.description}</p><div className="atlas-structure-sources">{selectedStructure.sourceIds.map((sourceId) => <a key={sourceId} href={atlasSources[sourceId].url} target="_blank" rel="noreferrer">{atlasSources[sourceId].title}<ArrowUpRight size={12} /></a>)}</div></> : <p>เลือกส่วนประกอบเพื่อดูคำอธิบาย แหล่งอ้างอิง และโฟกัสตำแหน่งในโมเดล ส่วนภายในจะเปิดภาพตัดให้โดยอัตโนมัติ</p>}</div>
        </section>
      </div>
      <aside className="atlas-details" aria-label={isLarva ? 'รายละเอียดลักษณะตัวอ่อนพยาธิ' : 'รายละเอียดลักษณะไข่พยาธิ'}>
        <div><div className="atlas-detail-eyebrow">MORPHOLOGY GUIDE</div><h2>ลักษณะอ้างอิง{isAscaris ? ` · ${currentStage.title}` : ''}</h2><p className="atlas-description">{isAscaris ? currentStage.description : item.description}</p><dl className="atlas-dimensions"><div><dt>ขนาดโดยทั่วไป</dt><dd>{isAscaris ? currentStage.size : item.size}</dd></div><div><dt>รูปร่าง</dt><dd>{isAscaris ? `${currentStage.shape}${ascarisDecorticated ? ' · ชั้นผิวนอกหลุด ผิวเรียบ' : ''}` : item.shape}</dd></div></dl></div>
        <div><div className="atlas-feature-section"><h3>จุดสังเกตสำคัญ</h3>{displayFeatures.map((feature, index) => <div className="atlas-feature" key={feature}><span>{String(index + 1).padStart(2, '0')}</span><p>{feature}</p><Check size={13} /></div>)}</div>{item.clinicalNote && <div className="atlas-clinical-note"><Info size={16} /><p>{item.clinicalNote}</p></div>}</div>
      </aside>
    </div>
    <div className="atlas-education-note"><Info size={16} /><div><p>{atlasEvidenceNote}</p><p>รายชื่อใน Atlas ไม่ยืนยันขอบเขตหรือความแม่นยำของ AI การระบุชนิดจริงควรให้ผู้เชี่ยวชาญตรวจยืนยัน ภาพจาก Buckelew ใช้เพื่อการศึกษาไม่ใช่เชิงพาณิชย์ตาม CC BY-NC 4.0; ลิงก์อ้างอิงภายนอกต้องใช้อินเทอร์เน็ต</p></div></div>
  </section>;
}
