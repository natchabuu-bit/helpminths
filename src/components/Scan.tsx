import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowRight, Camera, Check, CheckCheck, ChevronRight, CircleHelp, Crosshair, Expand, Eye, EyeOff, FileImage, ImagePlus, Info, LoaderCircle, Microscope, RefreshCw, ScanLine, ShieldCheck, Sparkles, Upload, X, ZoomIn, ZoomOut } from 'lucide-react';
import '../styles/scan.css';
import { matchSpeciesLabel } from '../data/species';

export interface Detection {
  id: string | number;
  class_id: number;
  label: string;
  confidence: number;
  bbox: [number, number, number, number];
}

export interface AnalysisResponse {
  id: string;
  filename: string;
  width: number;
  height: number;
  model: string;
  duration_ms: number;
  detections: Detection[];
}

export interface AnalysisRecord extends AnalysisResponse {
  imageUrl: string;
  mode: 'real' | 'demo';
  createdAt: string;
}

interface ScanProps {
  onResult?: (record: AnalysisRecord) => void;
  initialRecord?: AnalysisRecord | null;
  openAtlas?: (label: string) => void;
  startDemo?: boolean;
}

type HealthStatus = 'checking' | 'ready' | 'unavailable' | 'offline';
const COLORS = ['#47e2b5', '#ffbb69', '#b6a0ff', '#72c9ff', '#ff8fa2'];
const MAX_SIZE = 20 * 1024 * 1024;
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

function thaiName(label: string) {
  const match = matchSpeciesLabel(label);
  return match ? match.specimenType === 'larva' ? match.thaiName : `ไข่${match.thaiName}` : 'ผลการจำแนกชนิด';
}

function sampleImage() {
  let particles = '';
  for (let i = 0; i < 95; i += 1) {
    const x = 18 + ((i * 137 + 41) % 860);
    const y = 18 + ((i * 83 + 57) % 564);
    const r = 1 + (i % 5) * 0.7;
    particles += `<ellipse cx="${x}" cy="${y}" rx="${r * 1.6}" ry="${r}" fill="${i % 3 === 0 ? '#547573' : '#8c9d8c'}" opacity="${0.15 + (i % 4) * 0.08}" transform="rotate(${i * 19} ${x} ${y})"/>`;
  }
  const egg = (x: number, y: number, rotation: number) => `<g transform="translate(${x} ${y}) rotate(${rotation})"><ellipse rx="66" ry="48" fill="#d9bb76" stroke="#8c7148" stroke-width="7"/><ellipse rx="57" ry="39" fill="#ad864c" stroke="#ebd6a3" stroke-width="3"/><ellipse rx="43" ry="28" fill="#c9ab6b"/><path d="M-31,-12 Q-13,-35 8,-12 T29,15 Q4,33 -19,12 T-31,-12" fill="#8c7042" opacity=".65"/><g fill="#ead095" opacity=".6"><circle cx="-17" cy="-10" r="5"/><circle cx="16" cy="13" r="6"/><circle cx="24" cy="-9" r="4"/></g></g>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600" viewBox="0 0 900 600"><defs><radialGradient id="bg"><stop stop-color="#cbd3b6"/><stop offset="1" stop-color="#92aaa1"/></radialGradient><filter id="soft"><feGaussianBlur stdDeviation="1.4"/></filter></defs><rect width="900" height="600" fill="url(#bg)"/><g filter="url(#soft)" opacity=".45"><path d="M-20 160Q160 30 350 120T920 200" stroke="#6d8a7d" stroke-width="22" fill="none"/><path d="M150 640Q310 400 700 520" stroke="#e3dec0" stroke-width="45" fill="none"/><ellipse cx="740" cy="150" rx="60" ry="35" fill="#617e75" opacity=".25"/></g>${particles}${egg(285, 234, -22)}${egg(625, 390, 28)}<g transform="translate(656 164) rotate(-24)"><ellipse rx="50" ry="23" fill="#ad7c45" stroke="#705738" stroke-width="5"/><ellipse rx="38" ry="15" fill="#cda76c"/><ellipse cx="-50" rx="8" ry="11" fill="#ddd4ac" stroke="#8e754e" stroke-width="3"/><ellipse cx="50" rx="8" ry="11" fill="#ddd4ac" stroke="#8e754e" stroke-width="3"/><path d="M-29 0Q-7 -12 16 0T31 0" stroke="#8d633b" stroke-width="7" fill="none"/></g><text x="26" y="574" font-family="Arial,sans-serif" font-size="16" letter-spacing="2" fill="#34554e" opacity=".8">HELPMINTHS · SYNTHETIC ILLUSTRATION</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function readImage(file: File): Promise<{ url: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('อ่านไฟล์ไม่สำเร็จ กรุณาลองเลือกภาพอีกครั้ง'));
    reader.onload = () => {
      const url = String(reader.result);
      const img = new Image();
      img.onload = () => resolve({ url, width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => reject(new Error('เปิดภาพนี้ไม่ได้ กรุณาใช้ไฟล์ JPG, PNG หรือ WEBP ที่สมบูรณ์'));
      img.src = url;
    };
    reader.readAsDataURL(file);
  });
}

export default function Scan({ onResult, initialRecord = null, openAtlas, startDemo = false }: ScanProps) {
  const [health, setHealth] = useState<HealthStatus>('checking');
  const [healthMessage, setHealthMessage] = useState('');
  const [imageUrl, setImageUrl] = useState(initialRecord?.imageUrl ?? '');
  const [filename, setFilename] = useState(initialRecord?.filename ?? '');
  const [dimensions, setDimensions] = useState({ width: initialRecord?.width ?? 0, height: initialRecord?.height ?? 0 });
  const [record, setRecord] = useState<AnalysisRecord | null>(initialRecord);
  const [working, setWorking] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [threshold, setThreshold] = useState(40);
  const [showBoxes, setShowBoxes] = useState(true);
  const [selectedId, setSelectedId] = useState<string | number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [exported, setExported] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const imageFile = useRef<File | null>(null);
  const demoStarted = useRef(false);
  const requestController = useRef<AbortController | null>(null);
  const healthController = useRef<AbortController | null>(null);

  const checkHealth = useCallback(async () => {
    healthController.current?.abort();
    const controller = new AbortController();
    healthController.current = controller;
    setHealth(navigator.onLine ? 'checking' : 'offline');
    setHealthMessage('เชื่อมบริการวิเคราะห์ไม่ได้ ยังเลือกภาพบนเครื่อง ดูตัวอย่าง และเปิด Atlas ได้');
    const timeout = window.setTimeout(() => controller.abort(), 10000);
    try {
      // Probe the actual service, including a local server with no internet uplink.
      const response = await fetch('/api/health', { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error('health');
      const data = await response.json();
      if (controller.signal.aborted) return;
      const ready = data.model_ready === true || data.model_loaded === true || data.ready === true;
      setHealth(ready ? 'ready' : 'unavailable');
      setHealthMessage(ready ? String(data.model_name || data.model || 'โมเดลตรวจจับพร้อมใช้งาน') : 'ต้องติดตั้งไฟล์โมเดลที่ฝึกแล้ว จึงจะวิเคราะห์ภาพจริงได้');
    } catch {
      if (healthController.current !== controller) return;
      setHealth('offline');
      setHealthMessage('เชื่อมบริการวิเคราะห์ไม่ได้ ยังเลือกภาพบนเครื่อง ดูตัวอย่าง และเปิด Atlas ได้ ภาพจะไม่ถูกส่งตรวจอัตโนมัติ');
    } finally {
      window.clearTimeout(timeout);
    }
  }, []);

  useEffect(() => {
    void checkHealth();
    const networkChanged = () => { void checkHealth(); };
    window.addEventListener('online', networkChanged);
    window.addEventListener('offline', networkChanged);
    const timer = window.setInterval(networkChanged, 30000);
    return () => {
      healthController.current?.abort();
      healthController.current = null;
      requestController.current?.abort();
      window.clearInterval(timer);
      window.removeEventListener('online', networkChanged);
      window.removeEventListener('offline', networkChanged);
    };
  }, [checkHealth]);

  useEffect(() => {
    if (!initialRecord) return;
    setRecord(initialRecord);
    setImageUrl(initialRecord.imageUrl);
    setFilename(initialRecord.filename);
    setDimensions({ width: initialRecord.width, height: initialRecord.height });
    setSelectedId(initialRecord.detections[0]?.id ?? null);
    imageFile.current = null;
    setError('');
    setZoom(1);
  }, [initialRecord]);

  const loadDemo = useCallback(() => {
    const demo: AnalysisRecord = {
      id: `demo-${Date.now()}`,
      filename: 'helpminths-demo-illustration.svg',
      imageUrl: sampleImage(),
      width: 900,
      height: 600,
      model: 'Synthetic demonstration — no AI inference',
      duration_ms: 0,
      mode: 'demo',
      createdAt: new Date().toISOString(),
      detections: [
        { id: 'demo-1', class_id: 0, label: 'Ascaris lumbricoides', confidence: 0.97, bbox: [212, 174, 358, 294] },
        { id: 'demo-2', class_id: 0, label: 'Ascaris lumbricoides', confidence: 0.94, bbox: [550, 325, 700, 455] },
        { id: 'demo-3', class_id: 1, label: 'Trichuris trichiura', confidence: 0.89, bbox: [598, 122, 714, 205] },
      ],
    };
    imageFile.current = null;
    setRecord(demo);
    setImageUrl(demo.imageUrl);
    setFilename(demo.filename);
    setDimensions({ width: demo.width, height: demo.height });
    setSelectedId(demo.detections[0].id);
    setThreshold(40);
    setShowBoxes(true);
    setZoom(1);
    setError('');
    onResult?.(demo);
  }, [onResult]);

  useEffect(() => {
    if (startDemo && !demoStarted.current && !initialRecord) {
      demoStarted.current = true;
      loadDemo();
    }
  }, [startDemo, initialRecord, loadDemo]);

  const acceptFile = async (file?: File) => {
    if (!file || working || reading) return;
    setError('');
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError('กรุณาเลือกไฟล์ภาพ JPG, PNG หรือ WEBP หากภาพเป็น HEIC ให้แปลงเป็น JPG ก่อน');
      return;
    }
    if (file.size > MAX_SIZE) {
      setError('ไฟล์มีขนาดเกิน 20 MB กรุณาลดขนาดภาพแล้วลองอีกครั้ง');
      return;
    }
    setReading(true);
    try {
      const image = await readImage(file);
      imageFile.current = file;
      setImageUrl(image.url);
      setFilename(file.name);
      setDimensions({ width: image.width, height: image.height });
      setRecord(null);
      setSelectedId(null);
      setZoom(1);
      setShowBoxes(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ไม่สามารถอ่านไฟล์ภาพได้');
    } finally {
      setReading(false);
      if (fileInput.current) fileInput.current.value = '';
      if (cameraInput.current) cameraInput.current.value = '';
    }
  };

  const analyze = async () => {
    if (!imageUrl || working || reading || record?.mode === 'demo') return;
    if (health !== 'ready') {
      setError(healthMessage || 'ยังไม่เชื่อมต่อโมเดล AI กรุณาตรวจสอบบริการวิเคราะห์');
      return;
    }
    setError('');
    setWorking(true);
    const controller = new AbortController();
    requestController.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 90000);
    try {
      const form = new FormData();
      const file = imageFile.current ?? new File([await (await fetch(imageUrl)).blob()], filename, { type: 'image/jpeg' });
      form.append('image', file, filename);
      form.append('confidence', '0.15');
      const response = await fetch('/api/analyze', { method: 'POST', body: form, signal: controller.signal });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = typeof data.detail === 'string' ? data.detail : typeof data.message === 'string' ? data.message : '';
        throw new Error(detail || `วิเคราะห์ภาพไม่สำเร็จ (HTTP ${response.status}) กรุณาลองอีกครั้ง`);
      }
      if (!Array.isArray(data.detections) || !Number.isFinite(data.width) || !Number.isFinite(data.height) || data.width <= 0 || data.height <= 0 || data.detections.some((d: Detection) => !Array.isArray(d.bbox) || d.bbox.length !== 4 || d.bbox.some((v: number) => !Number.isFinite(v)) || !Number.isFinite(d.confidence) || typeof d.label !== 'string')) {
        throw new Error('รูปแบบผลลัพธ์จากบริการวิเคราะห์ไม่ถูกต้อง กรุณาตรวจสอบการตั้งค่าโมเดล');
      }
      const result: AnalysisRecord = { ...data, filename: data.filename || filename, imageUrl, mode: 'real', createdAt: new Date().toISOString() };
      setRecord(result);
      setDimensions({ width: result.width, height: result.height });
      setSelectedId(result.detections[0]?.id ?? null);
      onResult?.(result);
    } catch (cause) {
      if (cause instanceof TypeError) {
        setHealth('offline');
        setHealthMessage('เชื่อมบริการวิเคราะห์ไม่ได้ กรุณาเชื่อมต่อแล้วตรวจสอบบริการอีกครั้ง');
        setError('เชื่อมบริการวิเคราะห์ไม่ได้ ภาพยังอยู่ในหน้านี้ และจะไม่ส่งตรวจอัตโนมัติ กรุณาเชื่อมต่อแล้วกดวิเคราะห์อีกครั้ง');
      } else {
        setError(cause instanceof Error && cause.name === 'AbortError' ? 'การวิเคราะห์ใช้เวลานานเกินไป ภาพยังอยู่ สามารถลองใหม่ได้' : cause instanceof Error ? cause.message : 'วิเคราะห์ภาพไม่สำเร็จ กรุณาลองอีกครั้ง');
      }
    } finally {
      clearTimeout(timeout);
      requestController.current = null;
      setWorking(false);
    }
  };

  const detections = useMemo(() => record?.detections.filter((d) => d.confidence * 100 >= threshold) ?? [], [record, threshold]);
  const species = useMemo(() => [...new Set(detections.map((d) => d.label))], [detections]);
  const hasLarvalDetections = detections.some((detection) => matchSpeciesLabel(detection.label)?.specimenType === 'larva');
  const selected = detections.find((d) => d.id === selectedId);
  const selectedAtlasSpecies = matchSpeciesLabel(selected?.label);
  const meanConfidence = detections.length ? Math.round(detections.reduce((sum, d) => sum + d.confidence, 0) / detections.length * 100) : 0;
  const hasImage = Boolean(imageUrl);
  const demo = record?.mode === 'demo';

  const exportReport = () => {
    if (!record) return;
    const report = {
      application: 'HelpMinths',
      reportVersion: 1,
      id: record.id,
      mode: record.mode,
      notice: demo ? 'ข้อมูลสาธิต ไม่ใช่ผลตรวจจาก AI ภาพและกรอบทั้งหมดสร้างขึ้นเพื่อแสดงการใช้งาน' : 'ข้อมูลช่วยคัดกรอง ควรยืนยันผลโดยผู้เชี่ยวชาญ ไม่ใช่การวินิจฉัยทางการแพทย์',
      createdAt: record.createdAt,
      filename: record.filename,
      width: record.width,
      height: record.height,
      model: record.model,
      duration_ms: record.duration_ms,
      confidenceThreshold: threshold / 100,
      detectionCount: detections.length,
      speciesCount: species.length,
      detections,
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `HelpMinths-${demo ? 'DEMO-' : ''}${record.id}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    setExported(true);
    window.setTimeout(() => setExported(false), 2500);
  };

  return (
    <section className="scan-workspace" aria-label="ตรวจหาไข่พยาธิ">
      <div className="scan-section-heading">
        <div><span className="scan-eyebrow"><span /> INTELLIGENT MICROSCOPY</span><h1>ตรวจหาไข่พยาธิ<span className="scan-heading-dot">.</span></h1><p>เปลี่ยนภาพจากกล้องจุลทรรศน์ ให้เป็นข้อมูลที่มองเห็นได้ชัดเจน</p></div>
        <div className={`scan-health scan-health--${health}`} title={healthMessage}><span className="scan-status-dot" />{health === 'ready' ? 'โมเดล AI พร้อมใช้งาน' : health === 'checking' ? 'กำลังเชื่อมต่อบริการ' : 'ยังไม่เชื่อมต่อโมเดล AI'}{health !== 'ready' && <button type="button" onClick={() => void checkHealth()} disabled={health === 'checking'} aria-label="ตรวจสอบการเชื่อมต่ออีกครั้ง"><RefreshCw size={13} className={health === 'checking' ? 'scan-spin' : ''} /></button>}</div>
      </div>

      <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" className="scan-sr-only" onChange={(event) => void acceptFile(event.target.files?.[0])} aria-label="เลือกภาพจากอุปกรณ์" />
      <input ref={cameraInput} type="file" accept="image/*" capture="environment" className="scan-sr-only" onChange={(event) => void acceptFile(event.target.files?.[0])} aria-label="ถ่ายภาพด้วยกล้อง" />

      {demo && <div className="scan-demo-banner" role="status"><Sparkles size={16} /><div><strong>ข้อมูลสาธิต ไม่ใช่ผลตรวจจาก AI</strong><span>ภาพวาดจำลองและกรอบตัวอย่าง ใช้เพื่อสำรวจการทำงานของแอปเท่านั้น</span></div><button type="button" onClick={() => fileInput.current?.click()}><Upload size={14} /> ใช้ภาพของคุณ <ArrowRight size={14} /></button></div>}
      {error && <div className="scan-error" role="alert"><CircleHelp size={18} /><span>{error}</span><button type="button" onClick={() => setError('')} aria-label="ปิดข้อความ"><X size={16} /></button></div>}

      <div className="scan-grid">
        <div className="scan-main-column">
          <div className={`scan-viewer-card ${dragging ? 'scan-viewer-card--drag' : ''}`} onDragOver={(event) => { event.preventDefault(); if (!working) setDragging(true); }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }} onDrop={(event) => { event.preventDefault(); setDragging(false); void acceptFile(event.dataTransfer.files[0]); }}>
            <div className="scan-card-header"><div className="scan-card-title"><span className="scan-icon-tile"><ScanLine size={17} /></span><span>{hasImage ? 'ภาพตัวอย่าง' : 'อัปโหลดภาพเพื่อตรวจวิเคราะห์'}</span></div><span className="scan-card-caption">{hasImage ? `${dimensions.width} × ${dimensions.height} px` : '01 / IMAGE INPUT'}</span></div>

            {!hasImage ? (
              <div className="scan-upload-zone">
                <div className="scan-upload-orbit" aria-hidden="true"><span className="scan-orbit scan-orbit-one" /><span className="scan-orbit scan-orbit-two" /><span className="scan-orbit-node scan-orbit-node-one" /><span className="scan-orbit-node scan-orbit-node-two" /><div className="scan-upload-symbol"><Microscope size={44} strokeWidth={1.3} /></div><span className="scan-orbit-cross">+</span></div>
                <h2>{reading ? 'กำลังเตรียมภาพ…' : dragging ? 'วางภาพของคุณที่นี่' : 'เริ่มต้นด้วยภาพเพียงหนึ่งภาพ'}</h2>
                <p>ลากภาพกล้องจุลทรรศน์มาวางที่นี่<br />หรือเลือกจากอุปกรณ์ของคุณ</p>
                <div className="scan-upload-actions"><button type="button" className="scan-button scan-button-primary" onClick={() => fileInput.current?.click()} disabled={reading}><Upload size={17} /> เลือกรูปภาพ <ArrowRight size={16} /></button><button type="button" className="scan-button scan-button-secondary" onClick={() => cameraInput.current?.click()} disabled={reading}><Camera size={17} /> ถ่ายภาพ</button></div>
                <span className="scan-file-formats">JPG, PNG หรือ WEBP <span>·</span> ขนาดไม่เกิน 20 MB</span>
                <div className="scan-upload-divider"><span /> หรือทดลองใช้งาน <span /></div>
                <button type="button" className="scan-demo-link" onClick={loadDemo}><Sparkles size={15} /> ดูตัวอย่างสาธิต <ChevronRight size={15} /></button>
              </div>
            ) : (
              <>
                <div className="scan-image-toolbar"><span className="scan-image-name"><FileImage size={14} /><span>{filename}</span>{demo && <b>DEMO</b>}</span><div className="scan-view-controls"><button type="button" title="ซูมออก" aria-label="ซูมออก" disabled={zoom <= 1} onClick={() => setZoom((z) => Math.max(1, z - 0.25))}><ZoomOut size={16} /></button><span>{Math.round(zoom * 100)}%</span><button type="button" title="ซูมเข้า" aria-label="ซูมเข้า" disabled={zoom >= 2.5} onClick={() => setZoom((z) => Math.min(2.5, z + 0.25))}><ZoomIn size={16} /></button><button type="button" title="ปรับภาพพอดี" aria-label="ปรับภาพพอดี" onClick={() => setZoom(1)}><Expand size={15} /></button>{record && <button type="button" className={showBoxes ? 'scan-control-active' : ''} title={showBoxes ? 'ซ่อนกรอบ' : 'แสดงกรอบ'} aria-label={showBoxes ? 'ซ่อนกรอบ' : 'แสดงกรอบ'} onClick={() => setShowBoxes((value) => !value)}>{showBoxes ? <Eye size={16} /> : <EyeOff size={16} />}</button>}</div></div>
                <div className={`scan-image-scroll ${working ? 'scan-image-scroll--working' : ''}`}>
                  <svg className="scan-image-svg" viewBox={`0 0 ${dimensions.width} ${dimensions.height}`} style={{ width: `${zoom * 100}%`, maxHeight: zoom === 1 ? '520px' : 'none' }} role="img" aria-label={demo ? 'ภาพวาดจำลองไข่พยาธิพร้อมกรอบสาธิต' : 'ภาพกล้องจุลทรรศน์และกรอบตำแหน่งที่ตรวจพบ'}>
                    <image href={imageUrl} width={dimensions.width} height={dimensions.height} />
                    {showBoxes && detections.map((detection, index) => {
                      const [x1, y1, x2, y2] = detection.bbox;
                      const color = COLORS[Math.abs(detection.class_id || 0) % COLORS.length];
                      const fontSize = Math.max(13, dimensions.width / 65);
                      const labelHeight = fontSize * 1.8;
                      const labelText = `${String(index + 1).padStart(2, '0')}  ${detection.label.split(' ')[0]}  ${Math.round(detection.confidence * 100)}%`;
                      const labelWidth = Math.min(dimensions.width, labelText.length * fontSize * 0.58 + fontSize);
                      const labelX = Math.max(0, Math.min(x1, dimensions.width - labelWidth));
                      const labelY = y1 >= labelHeight ? y1 - labelHeight : y1;
                      return <g key={detection.id} className="scan-detection-box" role="button" tabIndex={0} aria-label={`${thaiName(detection.label)} ${detection.label} ความเชื่อมั่น ${Math.round(detection.confidence * 100)} เปอร์เซ็นต์`} onClick={() => setSelectedId(detection.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedId(detection.id); } }}><rect x={x1} y={y1} width={Math.max(0, x2 - x1)} height={Math.max(0, y2 - y1)} rx={3} stroke={color} strokeWidth={detection.id === selectedId ? 2.5 : 1.7} vectorEffect="non-scaling-stroke" fill={color} fillOpacity={detection.id === selectedId ? 0.13 : 0.035} /><rect x={labelX} y={labelY} width={labelWidth} height={labelHeight} rx={3} fill={color} /><text x={labelX + fontSize * 0.5} y={labelY + fontSize * 1.2} fill="#09251e" fontSize={fontSize} fontFamily="Arial, sans-serif" fontWeight="700">{labelText}</text></g>;
                    })}
                  </svg>
                  {working && <div className="scan-analysis-overlay"><LoaderCircle className="scan-spin" size={28} /><strong>กำลังวิเคราะห์ภาพ</strong><span>ตรวจจับตำแหน่งและจำแนกชนิดไข่พยาธิ</span></div>}
                </div>
                <div className="scan-viewer-bottom"><span><span className={`scan-mini-dot ${record ? '' : 'scan-mini-dot--muted'}`} />{record ? demo ? 'กรอบตัวอย่าง · คลิกเพื่อดูรายละเอียด' : 'คลิกกรอบเพื่อดูรายละเอียด' : 'ภาพพร้อมสำหรับการวิเคราะห์'}</span><button type="button" disabled={working || reading} onClick={() => fileInput.current?.click()}><ImagePlus size={15} /> เปลี่ยนภาพ</button></div>
              </>
            )}
          </div>

          {hasImage && !demo && <div className="scan-analyze-row"><div><ShieldCheck size={18} /><span>{health === 'ready' ? 'ภาพพร้อมแล้ว เริ่มวิเคราะห์เพื่อแสดงตำแหน่งและชนิด' : health === 'checking' ? 'กำลังตรวจสอบความพร้อมของโมเดล' : 'บันทึกภาพไว้แล้ว · ต้องเชื่อมต่อโมเดลเพื่อวิเคราะห์จริง'}</span></div><button type="button" className="scan-button scan-button-primary" disabled={working || reading || health !== 'ready'} onClick={() => void analyze()}>{working ? <LoaderCircle className="scan-spin" size={17} /> : <ScanLine size={17} />}{working ? 'กำลังวิเคราะห์…' : record ? 'วิเคราะห์อีกครั้ง' : 'เริ่มวิเคราะห์ภาพ'}{!working && <ArrowRight size={16} />}</button></div>}

          <div className="scan-quality-tip"><span className="scan-tip-icon"><Sparkles size={16} /></span><div><strong>ภาพที่ชัดเจน ช่วยให้เห็นรายละเอียดได้ดีขึ้น</strong><p>ใช้ภาพจากกล้องจุลทรรศน์ ปรับโฟกัสให้คมชัด และให้แสงสม่ำเสมอทั่วทั้งภาพ</p></div><span className="scan-tip-decoration" aria-hidden="true">✦</span></div>
        </div>

        <aside className="scan-results-card" aria-label="ผลการวิเคราะห์">
          <div className="scan-card-header"><div className="scan-card-title"><span className="scan-icon-tile"><Crosshair size={17} /></span><span>ผลการวิเคราะห์</span></div>{record ? <span className={`scan-result-badge ${demo ? 'scan-result-badge--demo' : ''}`}>{demo ? 'ตัวอย่างสาธิต' : 'เสร็จสมบูรณ์'}</span> : <span className="scan-card-caption">02 / RESULTS</span>}</div>
          {!record ? (
            <div className="scan-results-empty"><div className="scan-results-empty-icon"><ScanLine size={34} strokeWidth={1.2} /></div><h3>รายละเอียดจะปรากฏที่นี่</h3><p>เมื่อวิเคราะห์ภาพแล้ว คุณจะเห็นตำแหน่ง<br />ชนิด และความเชื่อมั่นของแต่ละผลตรวจ</p><div className="scan-how-it-works"><span className="scan-small-label">เพียง 3 ขั้นตอน</span><div><span className={hasImage ? 'scan-step-number scan-step-number--done' : 'scan-step-number'}>{hasImage ? <Check size={12} /> : '01'}</span><p><strong>เพิ่มภาพกล้องจุลทรรศน์</strong><span>อัปโหลดหรือถ่ายภาพจากมือถือ</span></p></div><div><span className="scan-step-number">02</span><p><strong>ให้ AI ช่วยตรวจจับ</strong><span>ค้นหาตำแหน่งและจำแนกชนิด</span></p></div><div><span className="scan-step-number">03</span><p><strong>สำรวจผลอย่างละเอียด</strong><span>ดูกรอบบนภาพและเรียนรู้ใน Atlas</span></p></div></div>{health !== 'ready' && health !== 'checking' && <div className="scan-model-note"><Info size={15} /><p><strong>ยังไม่เชื่อมต่อโมเดล AI</strong><span>{healthMessage}</span><button type="button" onClick={loadDemo}>สำรวจตัวอย่างสาธิต <ArrowRight size={13} /></button></p></div>}</div>
          ) : (
            <>
              <div className="scan-results-summary"><div><span className="scan-small-label">{demo ? 'ไข่พยาธิในตัวอย่าง' : 'ตรวจพบตามเกณฑ์ที่เลือก'}</span><p><strong>{detections.length.toString().padStart(2, '0')}</strong><span>{hasLarvalDetections ? 'ตำแหน่ง' : 'ฟอง'}</span></p></div><span className="scan-summary-divider" /><div><span className="scan-small-label">จำแนกชนิด</span><p><strong>{species.length.toString().padStart(2, '0')}</strong><span>ชนิด</span></p></div><span className="scan-summary-icon"><CheckCheck size={22} /></span></div>
              <div className="scan-confidence-control"><label htmlFor="scan-confidence"><span>เกณฑ์ความเชื่อมั่นขั้นต่ำ <CircleHelp size={12}><title>แสดงเฉพาะกรอบที่มีความเชื่อมั่นตั้งแต่เกณฑ์นี้ขึ้นไป ค่านี้ไม่ใช่ความแม่นยำทางคลินิก</title></CircleHelp></span><strong>{threshold}%</strong></label><input id="scan-confidence" type="range" min="15" max="99" step="1" value={threshold} onChange={(event) => setThreshold(Number(event.target.value))} style={{ '--range-progress': `${(threshold - 15) / 84 * 100}%` } as React.CSSProperties} /><div><span>15%</span><span>99%</span></div></div>
              <div className="scan-detections-heading"><span>รายการที่ตรวจพบ</span><span>{detections.length} รายการ</span></div>
              <div className="scan-detections-list">
                {detections.map((detection, index) => <button key={detection.id} type="button" className={`scan-detection-item ${detection.id === selectedId ? 'scan-detection-item--selected' : ''}`} onClick={() => setSelectedId(detection.id)} style={{ '--detection-color': COLORS[Math.abs(detection.class_id || 0) % COLORS.length] } as React.CSSProperties}><span className="scan-detection-number">{String(index + 1).padStart(2, '0')}</span><span className="scan-detection-name"><strong>{detection.label}</strong><span>{thaiName(detection.label)}</span></span><span className="scan-detection-confidence">{Math.round(detection.confidence * 100)}<small>%</small></span></button>)}
                {detections.length === 0 && <div className="scan-no-results"><Crosshair size={26} /><strong>{record.detections.length > 0 ? 'ไม่มีกรอบที่ผ่านเกณฑ์นี้' : 'ไม่พบไข่พยาธิจากการวิเคราะห์'}</strong><p>{record.detections.length > 0 ? 'ลองลดเกณฑ์ความเชื่อมั่นเพื่อดูผลเพิ่มเติม' : 'การไม่ตรวจพบไม่ยืนยันว่าไม่มีพยาธิ ควรให้ผู้เชี่ยวชาญตรวจสอบภาพร่วมด้วย'}</p>{record.detections.length > 0 && <button type="button" onClick={() => setThreshold(15)}>ปรับเกณฑ์เป็น 15%</button>}</div>}
              </div>
              {selectedAtlasSpecies?.id === 'opisthorchis' && <div className="scan-model-note scan-ov-note"><Info size={15} /><p><strong>ลักษณะไข่คล้าย OV ต้องตรวจยืนยัน</strong><span>ไข่พยาธิใบไม้ตับอาจคล้ายไข่พยาธิใบไม้ลำไส้ขนาดเล็กและ Clonorchis ผลจากภาพเพียงอย่างเดียวยังไม่ยืนยันชนิด ควรให้ผู้เชี่ยวชาญทบทวน</span></p></div>}
              {selectedAtlasSpecies?.clinicalNote && ['mif', 'hymenolepis-nana', 'hymenolepis-diminuta', 'echinostoma', 'fasciolopsis', 'strongyloides'].includes(selectedAtlasSpecies.id) && <div className="scan-model-note scan-species-note"><Info size={15} /><p><strong>ข้อควรพิจารณาในการจำแนก{selectedAtlasSpecies.specimenType === 'larva' ? 'ตัวอ่อน' : 'ไข่'}</strong><span>{selectedAtlasSpecies.clinicalNote}</span></p></div>}
              {selected && selectedAtlasSpecies && openAtlas && <button type="button" className="scan-atlas-link" onClick={() => openAtlas(selectedAtlasSpecies.id)}><span className="scan-atlas-link-icon"><Microscope size={18} /></span><span><strong>รู้จัก {selectedAtlasSpecies.id === 'mif' ? 'MIF' : selectedAtlasSpecies.name.split(' ')[0]} ให้มากขึ้น</strong><small>สำรวจลักษณะ{selectedAtlasSpecies.specimenType === 'larva' ? 'ตัวอ่อน' : 'ไข่'}ใน Morphology Atlas</small></span><ArrowRight size={16} /></button>}
              <div className="scan-results-footer"><div><span className="scan-mini-dot" />{demo ? 'ค่าจำลองเพื่อสาธิตการแสดงผล' : `ความเชื่อมั่นเฉลี่ย ${meanConfidence}% · ${(record.duration_ms / 1000).toFixed(1)} วินาที`}</div><button type="button" className="scan-export-button" onClick={exportReport}>{exported ? <Check size={16} /> : <ArrowDownToLine size={16} />}{exported ? 'ดาวน์โหลดแล้ว' : 'ส่งออกรายงาน JSON'}<ArrowRight size={15} /></button></div>
            </>
          )}
        </aside>
      </div>
      <p className="scan-medical-note"><ShieldCheck size={14} />{demo ? 'ข้อมูลสาธิต ไม่ใช่ผลตรวจจาก AI · ภาพนี้เป็นภาพวาดจำลอง ไม่ใช่ภาพตัวอย่างทางการแพทย์' : 'ผลการวิเคราะห์เป็นข้อมูลช่วยคัดกรอง ควรตรวจสอบและยืนยันโดยผู้เชี่ยวชาญก่อนนำไปใช้ทางการแพทย์'}</p>
    </section>
  );
}
