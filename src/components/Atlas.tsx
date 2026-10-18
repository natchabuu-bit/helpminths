import { Component, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ComponentRef, type ErrorInfo, type ReactNode } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { BufferGeometry, Color, DoubleSide, Float32BufferAttribute, SphereGeometry, Vector3 } from 'three';
import { ArrowUpRight, BookOpen, Box, Check, ChevronRight, Eye, Info, Layers3, Maximize2, Pause, Play, RotateCcw, Search, SlidersHorizontal, Sparkles, X } from 'lucide-react';
import { getSpeciesById, groupLabels, species, type ParasiteSpecies, type SpeciesGroup } from '../data/species';
import EggIllustration from './EggIllustration';
import '../styles/atlas.css';

interface AtlasProps { initialSpecies?: string }

function webGLAvailable() {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!context) return false;
    context.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch { return false; }
}

class ModelBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(_error: Error, _info: ErrorInfo) { /* The SVG fallback keeps the atlas available. */ }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

function dimensions(id: string): [number, number, number] {
  if (id === 'taenia') return [1, 1, 1];
  if (id === 'schistosoma-japonicum') return [1.16, .94, .87];
  if (id === 'trichuris') return [1.5, .62, .62];
  if (id === 'enterobius') return [1.55, .74, .64];
  if (id.startsWith('schistosoma-')) return [1.55, .68, .65];
  return [1.4, .86, .79];
}

function eggGeometry(id: string, cutaway: boolean) {
  const scale = dimensions(id);
  const geometry = new SphereGeometry(1, 64, 40, cutaway ? Math.PI : 0, cutaway ? Math.PI : Math.PI * 2);
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const y = positions.getY(i);
    const z = positions.getZ(i);
    let nextY = y;
    if (id === 'enterobius' && nextY < -.34) nextY = -.34 + (nextY + .34) * .075;
    if (id === 'trichuris') {
      const endShape = .88 + .12 * (1 - x * x);
      positions.setXYZ(i, x * scale[0], nextY * scale[1] * endShape, z * scale[2] * endShape);
    } else {
      const asymmetry = id.startsWith('schistosoma-') ? 1 + x * .055 : 1;
      positions.setXYZ(i, x * scale[0], nextY * scale[1] * asymmetry, z * scale[2] * asymmetry);
    }
  }
  geometry.computeVertexNormals();
  return geometry;
}

function CurveTube({ points, color, radius = .055 }: { points: Vector3[]; color: string; radius?: number }) {
  // A continuous tapered ribbon gives internal structures a soft organic silhouette.
  const geometry = useMemo(() => {
    const vertices: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    points.forEach((point, i) => {
      const tangent = (points[Math.min(i + 1, points.length - 1)].clone().sub(points[Math.max(i - 1, 0)])).normalize();
      const normal = new Vector3(-tangent.y, tangent.x, 0).normalize();
      for (let j = 0; j < 10; j++) {
        const angle = j / 10 * Math.PI * 2;
        vertices.push(point.x + normal.x * Math.cos(angle) * radius, point.y + normal.y * Math.cos(angle) * radius, point.z + Math.sin(angle) * radius);
        normals.push(normal.x * Math.cos(angle), normal.y * Math.cos(angle), Math.sin(angle));
        if (i > 0) {
          const a = (i - 1) * 10 + j, b = (i - 1) * 10 + (j + 1) % 10, c = i * 10 + j, d = i * 10 + (j + 1) % 10;
          indices.push(a, c, b, b, c, d);
        }
      }
    });
    const value = new BufferGeometry();
    value.setAttribute('position', new Float32BufferAttribute(vertices, 3));
    value.setAttribute('normal', new Float32BufferAttribute(normals, 3));
    value.setIndex(indices);
    return value;
  }, [points, radius]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh geometry={geometry}><meshStandardMaterial color={color} roughness={.6} /></mesh>;
}

function Larva() {
  const points = useMemo(() => Array.from({ length: 95 }, (_, i) => {
    const angle = i / 94 * Math.PI * 3.4;
    const radius = .67 * (1 - i / 150);
    return new Vector3(Math.cos(angle) * radius * 1.35, Math.sin(angle) * radius * .38 - .01, .1);
  }), []);
  return <CurveTube points={points} color="#9ba875" radius={.075} />;
}

function Egg({ item, cutaway }: { item: ParasiteSpecies; cutaway: boolean }) {
  const shellGeometry = useMemo(() => eggGeometry(item.id, cutaway), [item.id, cutaway]);
  useEffect(() => () => shellGeometry.dispose(), [shellGeometry]);
  const scale = dimensions(item.id);
  const shell = new Color(item.color);
  const isSchisto = item.id.startsWith('schistosoma-');
  const bumps = useMemo(() => Array.from({ length: 105 }, (_, i) => {
    const y = 1 - (i / 104) * 2;
    const r = Math.sqrt(1 - y * y);
    const theta = Math.PI * (3 - Math.sqrt(5)) * i;
    return new Vector3(Math.cos(theta) * r * 1.4, y * .86, Math.sin(theta) * r * .79);
  }), []);
  const hooks = useMemo(() => Array.from({ length: 6 }, (_, n) => Array.from({ length: 16 }, (_, j) => {
    const t = j / 15;
    const a = n / 6 * Math.PI * 2;
    const x = .1 + t * .18;
    const y = Math.sin(t * Math.PI) * .12;
    return new Vector3(Math.cos(a) * x - Math.sin(a) * y, Math.sin(a) * x + Math.cos(a) * y, .24);
  })), []);
  const internalColor = '#8d996b';
  return (
    <group rotation={[.09, -.08, -.18]}>
      <mesh geometry={shellGeometry} renderOrder={3}>
        <meshPhysicalMaterial color={shell} roughness={.38} metalness={.03} clearcoat={.35} transparent opacity={cutaway ? .78 : .57} depthWrite={false} side={DoubleSide} />
      </mesh>
      {cutaway && item.id !== 'enterobius' && <mesh scale={[scale[0], scale[1], 1]} position={[0, 0, .005]}><ringGeometry args={[.94, 1, 80]} /><meshStandardMaterial color={item.color} roughness={.7} side={DoubleSide} /></mesh>}
      {item.id === 'ascaris' && bumps.filter((p) => !cutaway || p.z < .025).map((p, i) => <mesh key={i} position={p} scale={[1, .8, .8]}><sphereGeometry args={[.08 + (i % 3) * .012, 8, 7]} /><meshStandardMaterial color={i % 3 === 0 ? '#e2b57e' : '#c4945c'} roughness={.8} transparent opacity={.88} /></mesh>)}
      {item.id === 'trichuris' && [-1, 1].map((direction) => <group key={direction} position={[direction * 1.46, 0, 0]} rotation={[0, 0, Math.PI / 2]}><mesh scale={[.18, .24, .18]}><sphereGeometry args={[1, 24, 20]} /><meshPhysicalMaterial color="#ead6ad" roughness={.3} transparent opacity={.9} /></mesh><mesh rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[.18, .035, 10, 32]} /><meshStandardMaterial color="#c49a61" /></mesh></group>)}
      {item.id === 'hookworm' && [[-.48, .15, .02], [0, .25, -.06], [.45, .08, .01], [-.33, -.26, .12], [.18, -.21, .15], [.12, .03, -.25]].map((position, i) => <mesh key={i} position={position as [number, number, number]} scale={[1, .91, .85]}><sphereGeometry args={[.31, 28, 22]} /><meshPhysicalMaterial color={i % 2 ? '#aab487' : '#8e9c74'} roughness={.7} clearcoat={.2} /></mesh>)}
      {item.id === 'enterobius' && <Larva />}
      {item.id !== 'hookworm' && item.id !== 'enterobius' && <mesh scale={item.id === 'taenia' ? [.5, .5, .48] : isSchisto ? [.89, .42, .37] : [.77, .51, .45]}><sphereGeometry args={[1, 44, 30]} /><meshStandardMaterial color={internalColor} roughness={.64} /></mesh>}
      {isSchisto && Array.from({ length: 24 }, (_, i) => {
        const a = i / 24 * Math.PI * 2;
        return <mesh key={i} position={[Math.cos(a) * .84, Math.sin(a) * .41, .025]} rotation={[0, 0, a - Math.PI / 2]}><coneGeometry args={[.024, .13, 6]} /><meshStandardMaterial color="#c2c69c" /></mesh>;
      })}
      {item.id === 'schistosoma-mansoni' && <mesh position={[-.6, .82, 0]} rotation={[0, 0, .58]}><coneGeometry args={[.18, .77, 32]} /><meshStandardMaterial color={item.color} roughness={.4} /></mesh>}
      {item.id === 'schistosoma-haematobium' && <mesh position={[1.68, -.015, 0]} rotation={[0, 0, -Math.PI / 2]}><coneGeometry args={[.12, .59, 32]} /><meshStandardMaterial color={item.color} roughness={.4} /></mesh>}
      {item.id === 'schistosoma-japonicum' && <mesh position={[-.72, .72, 0]} scale={[.16, .2, .13]}><sphereGeometry args={[1, 20, 16]} /><meshStandardMaterial color={item.color} roughness={.5} /></mesh>}
      {item.id === 'taenia' && <>
        {Array.from({ length: 42 }, (_, i) => {
          const angle = i / 42 * Math.PI * 2;
          return <mesh key={i} position={[Math.cos(angle) * .955, Math.sin(angle) * .955, 0]} rotation={[0, 0, angle]} scale={[.07, .024, cutaway ? .12 : .2]}><sphereGeometry args={[1, 10, 8]} /><meshStandardMaterial color={i % 3 ? '#d3a76d' : '#805831'} roughness={.8} /></mesh>;
        })}
        {hooks.map((points, i) => <CurveTube key={i} points={points} color="#e7d1a0" radius={.024} />)}
      </>}
    </group>
  );
}

function Scene({ item, cutaway, autoRotate, resetKey }: { item: ParasiteSpecies; cutaway: boolean; autoRotate: boolean; resetKey: number }) {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const { camera } = useThree();
  useEffect(() => {
    camera.position.set(0, .15, 5.3);
    controls.current?.target.set(0, 0, 0);
    controls.current?.update();
  }, [resetKey, camera]);
  return <>
    <ambientLight intensity={1.1} />
    <directionalLight position={[-3, 4, 5]} intensity={2.6} color="#fff1d9" />
    <directionalLight position={[4, 1, -2]} intensity={2.2} color="#9de9dc" />
    <pointLight position={[0, -3, 2]} intensity={8} color="#80aaa1" />
    <Egg item={item} cutaway={cutaway} />
    <OrbitControls ref={controls} makeDefault enablePan={false} minDistance={3} maxDistance={8} autoRotate={autoRotate} autoRotateSpeed={.7} enableDamping dampingFactor={.07} />
  </>;
}

function CanvasContextGuard({ onLost }: { onLost: () => void }) {
  const gl = useThree((state) => state.gl);
  useEffect(() => {
    const canvas = gl.domElement;
    canvas.addEventListener('webglcontextlost', onLost);
    return () => canvas.removeEventListener('webglcontextlost', onLost);
  }, [gl, onLost]);
  return null;
}

function ModelViewer({ item, cutaway, autoRotate, resetKey }: { item: ParasiteSpecies; cutaway: boolean; autoRotate: boolean; resetKey: number }) {
  const [available, setAvailable] = useState(webGLAvailable);
  const onContextLost = useCallback(() => setAvailable(false), []);
  const fallback = <div className="atlas-svg-fallback"><EggIllustration speciesId={item.id} showInternal={cutaway} /><span><Box size={14} /> ภาพวาดจำลอง 2 มิติ · อุปกรณ์นี้ไม่รองรับ WebGL</span></div>;
  if (!available) return fallback;
  return <ModelBoundary fallback={fallback}>
    <Canvas camera={{ position: [0, .15, 5.3], fov: 38 }} dpr={[1, 1.7]} gl={{ antialias: true, alpha: true }} fallback={fallback}>
      <CanvasContextGuard onLost={onContextLost} />
      <Suspense fallback={null}><Scene item={item} cutaway={cutaway} autoRotate={autoRotate} resetKey={resetKey} /></Suspense>
    </Canvas>
  </ModelBoundary>;
}

/** DOM callouts stay in the application root, separate from the WebGL scene lifecycle. */
function ModelAnnotations({ item, cutaway }: { item: ParasiteSpecies; cutaway: boolean }) {
  const outerLabel = item.id === 'trichuris' ? 'จุกสองขั้ว' : item.id === 'enterobius' ? 'ด้านหนึ่งแบน' : item.id === 'taenia' ? 'ผนังลายรัศมี' : item.id === 'schistosoma-mansoni' ? 'หนามด้านข้าง' : item.id === 'schistosoma-haematobium' ? 'หนามปลายขั้ว' : item.id === 'schistosoma-japonicum' ? 'ปุ่มด้านข้าง' : item.id === 'hookworm' ? 'เปลือกบางใส' : 'ผิวนอกขรุขระ';
  const innerLabel = item.id === 'hookworm' ? 'ตัวอ่อนแบ่งเซลล์' : item.id === 'enterobius' ? 'ตัวอ่อน' : item.id === 'taenia' ? 'ตะขอ 3 คู่' : item.id.startsWith('schistosoma-') ? 'Miracidium' : 'เซลล์ไข่';
  return <div className="atlas-annotations" aria-label="จุดสังเกตของแบบจำลอง">
    <div className="atlas-callout atlas-callout-outer"><div className="atlas-model-label"><span />{outerLabel}</div><small>ลักษณะภายนอก</small></div>
    {cutaway && <div className="atlas-callout atlas-callout-inner"><small>โครงสร้างภายใน</small><div className="atlas-model-label"><span />{innerLabel}</div></div>}
  </div>;
}

export default function Atlas({ initialSpecies }: AtlasProps) {
  const [selectedId, setSelectedId] = useState(getSpeciesById(initialSpecies).id);
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<SpeciesGroup | 'all'>('all');
  const [cutaway, setCutaway] = useState(false);
  const [labels, setLabels] = useState(true);
  const [autoRotate, setAutoRotate] = useState(true);
  const [resetKey, setResetKey] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const viewerRef = useRef<HTMLDivElement>(null);
  const item = getSpeciesById(selectedId);
  const matches = species.filter((entry) => (group === 'all' || entry.group === group) && `${entry.name} ${entry.thaiName}`.toLowerCase().includes(query.toLowerCase()));
  useEffect(() => { if (initialSpecies) setSelectedId(getSpeciesById(initialSpecies).id); }, [initialSpecies]);
  useEffect(() => {
    if (!expanded) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false);
      if (event.key !== 'Tab') return;
      const buttons = viewerRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
      if (!buttons?.length) return;
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === viewerRef.current)) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    viewerRef.current?.focus();
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = previous; previousFocus?.focus(); };
  }, [expanded]);
  return <section className="atlas-page" aria-label="คลังเรียนรู้ไข่พยาธิสามมิติ">
    <div className="atlas-heading">
      <div><div className="atlas-eyebrow"><span /> THE MORPHOLOGY COLLECTION</div><h1>รายละเอียดเล็ก ๆ <span>ที่สร้างความเข้าใจ</span></h1><p>สำรวจโครงสร้างไข่พยาธิ หมุนดูได้ทุกมุม และเรียนรู้จุดสังเกตที่สำคัญ</p></div>
      <div className="atlas-collection-tag"><Box size={23} /><div><strong>3D Morphology Atlas</strong><span>{species.length} ชนิดอ้างอิง · เรียนรู้แบบอินเทอร์แอคทีฟ</span></div></div>
    </div>
    <div className="atlas-workspace">
      <aside className="atlas-catalog" aria-label="เลือกชนิดพยาธิ">
        <div className="atlas-catalog-heading"><h2>คลังไข่พยาธิ</h2><span>{species.length}</span></div>
        <label className="atlas-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหาชื่อพยาธิ..." aria-label="ค้นหาชื่อพยาธิ" /></label>
        <label className="atlas-filter"><SlidersHorizontal size={14} /><select value={group} onChange={(event) => setGroup(event.target.value as SpeciesGroup | 'all')} aria-label="กรองกลุ่มพยาธิ"><option value="all">ทุกกลุ่มพยาธิ</option>{Object.entries(groupLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <div className="atlas-species-list">
          {matches.map((entry) => <button className={`atlas-species-item ${entry.id === selectedId ? 'atlas-selected' : ''}`} key={entry.id} onClick={() => { setSelectedId(entry.id); setResetKey((value) => value + 1); }} aria-pressed={entry.id === selectedId}>
            <div className="atlas-species-thumb"><EggIllustration speciesId={entry.id} /></div><div className="atlas-species-name"><span className="atlas-item-index">SPECIMEN {String(species.indexOf(entry) + 1).padStart(2, '0')}</span><strong>{entry.name}</strong><span>{entry.thaiName}</span></div><ChevronRight size={15} />
          </button>)}
          {matches.length === 0 && <p className="atlas-empty">ไม่พบชนิดที่ตรงกับคำค้น<br /><button onClick={() => { setQuery(''); setGroup('all'); }}>ดูทั้งหมด</button></p>}
        </div>
        <div className="atlas-catalog-foot"><BookOpen size={15} /><span>เรียนรู้จากโครงสร้างและลักษณะเฉพาะ</span></div>
      </aside>
      <div className={`atlas-viewer ${expanded ? 'atlas-viewer-expanded' : ''}`} ref={viewerRef} tabIndex={-1} role={expanded ? 'dialog' : undefined} aria-modal={expanded || undefined} aria-label={expanded ? `แบบจำลองสามมิติ ${item.name}` : undefined}>
        <div className="atlas-viewer-top"><div className="atlas-viewer-mode"><span /> INTERACTIVE 3D</div><div className="atlas-viewer-actions"><button aria-label="เริ่มมุมมองใหม่" title="เริ่มมุมมองใหม่" onClick={() => setResetKey((value) => value + 1)}><RotateCcw size={17} /></button><button className={expanded ? 'atlas-close-expanded' : ''} aria-label={expanded ? 'ปิดมุมมองแบบขยาย' : 'ขยายมุมมอง'} aria-pressed={expanded} title="ขยายหรือย่อมุมมอง · Esc เพื่อปิด" onClick={() => setExpanded((value) => !value)}>{expanded ? <><X size={16} /><span>ปิด</span></> : <Maximize2 size={17} />}</button></div></div>
        <div className="atlas-model-stage"><ModelViewer item={item} cutaway={cutaway} autoRotate={autoRotate} resetKey={resetKey} />{labels && <ModelAnnotations item={item} cutaway={cutaway} />}<div className="atlas-stage-watermark" aria-hidden="true">{String(species.findIndex((entry) => entry.id === item.id) + 1).padStart(2, '0')}</div></div>
        <div className="atlas-specimen-caption"><span>{groupLabels[item.group]}</span><h2>{item.name}</h2><p>{item.thaiName}</p></div>
        <div className="atlas-model-toolbar"><button className={cutaway ? 'atlas-tool-active' : ''} aria-pressed={cutaway} onClick={() => setCutaway((value) => !value)}><Layers3 size={16} /> ภาพตัดภายใน</button><button className={labels ? 'atlas-tool-active' : ''} aria-pressed={labels} onClick={() => setLabels((value) => !value)}><Eye size={16} /> จุดสังเกต</button><button className={`atlas-rotate-button ${autoRotate ? 'atlas-tool-active' : ''}`} aria-label={autoRotate ? 'หยุดหมุนอัตโนมัติ' : 'หมุนอัตโนมัติ'} aria-pressed={autoRotate} onClick={() => setAutoRotate((value) => !value)}>{autoRotate ? <Pause size={15} /> : <Play size={15} />}</button></div>
        <div className="atlas-viewer-instructions"><span className="atlas-mouse-icon" /> ลากเพื่อหมุน <span>·</span> เลื่อนเพื่อซูม <span className="atlas-model-note">แบบจำลองเพื่อการศึกษา · ไม่อ้างอิงสเกลระหว่างชนิด</span></div>
      </div>
      <aside className="atlas-details" aria-label="รายละเอียดลักษณะไข่พยาธิ">
        <div className="atlas-detail-eyebrow"><Sparkles size={15} /> MORPHOLOGY GUIDE</div>
        <h2>มองให้เห็น<br /><span>ลักษณะเฉพาะ</span></h2>
        <p className="atlas-description">{item.description}</p>
        <dl className="atlas-dimensions"><div><dt>ขนาดโดยทั่วไป</dt><dd>{item.size}</dd></div><div><dt>รูปร่าง</dt><dd>{item.shape}</dd></div></dl>
        <div className="atlas-feature-section"><h3>จุดสังเกตสำคัญ</h3>{item.features.map((feature, index) => <div className="atlas-feature" key={feature}><span>{String(index + 1).padStart(2, '0')}</span><p>{feature}</p><Check size={13} /></div>)}</div>
        {item.clinicalNote && <div className="atlas-clinical-note"><Info size={16} /><p>{item.clinicalNote}</p></div>}
        <a className="atlas-source-link" href="https://www.cdc.gov/dpdx/" target="_blank" rel="noreferrer">อ่านข้อมูลอ้างอิง CDC DPDx <ArrowUpRight size={14} /></a>
      </aside>
    </div>
    <div className="atlas-education-note"><Info size={15} /><p>แบบจำลองสร้างขึ้นเพื่อเรียนรู้ morphology ไม่ใช่ภาพจากกล้องจุลทรรศน์ รายชื่อใน Atlas ไม่ยืนยันขอบเขตชนิดที่โมเดล AI ตรวจจับได้ การระบุชนิดจริงควรให้ผู้เชี่ยวชาญตรวจยืนยัน</p></div>
  </section>;
}
