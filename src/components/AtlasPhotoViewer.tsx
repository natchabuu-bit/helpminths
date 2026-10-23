import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, ImageOff, Minus, Plus, RotateCcw } from 'lucide-react';
import type { ParasiteSpecies } from '../data/species';
import type { AtlasPhoto } from '../data/atlasPhotos';
import { atlasSources, getAtlasStructures, type AtlasStructure } from '../data/atlasStructures';

interface AtlasPhotoViewerProps {
  item: ParasiteSpecies;
  photos: AtlasPhoto[];
  selectedStructure: AtlasStructure | null;
  emptyTitle?: string;
  emptyDescription?: string;
}

interface PhotoView { zoom: number; x: number; y: number }
interface Point { x: number; y: number }
const initialView: PhotoView = { zoom: 1, x: 0, y: 0 };
const boundedZoom = (zoom: number) => Math.max(1, Math.min(5, zoom));
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** Real, credited micrographs remain separate from the explanatory 3D model. */
export default function AtlasPhotoViewer({ item, photos, selectedStructure, emptyTitle, emptyDescription }: AtlasPhotoViewerProps) {
  const [photoIndex, setPhotoIndex] = useState(0);
  const [view, setView] = useState<PhotoView>(initialView);
  const [failed, setFailed] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<PhotoView>(initialView);
  const pointers = useRef(new Map<number, Point>());
  const instructionsId = useId();
  const captionId = useId();
  const photoKey = photos.map(photo => `${photo.id}:${photo.src}`).join('|');
  const photo = photos[photoIndex] ?? photos[0];
  const specimenLabel = item.specimenType === 'larva' ? 'ตัวอ่อน' : 'ไข่';
  const photoLabel = `ภาพ${specimenLabel}จริง`;

  const updateView = useCallback((next: PhotoView) => {
    const zoom = boundedZoom(next.zoom);
    const rect = frameRef.current?.getBoundingClientRect();
    const maxX = (rect?.width ?? 0) * (zoom - 1) / 2;
    const maxY = (rect?.height ?? 0) * (zoom - 1) / 2;
    const bounded = {
      zoom,
      x: Math.max(-maxX, Math.min(maxX, next.x)),
      y: Math.max(-maxY, Math.min(maxY, next.y)),
    };
    viewRef.current = bounded;
    setView(bounded);
  }, []);

  const reset = useCallback(() => {
    pointers.current.clear();
    viewRef.current = initialView;
    setView(initialView);
  }, []);

  useEffect(() => {
    setPhotoIndex(0);
    setFailed(false);
    reset();
  }, [item.id, photoKey, reset]);

  const zoomTo = useCallback((requested: number, anchor: Point = { x: 0, y: 0 }) => {
    const current = viewRef.current;
    const zoom = boundedZoom(requested);
    const ratio = zoom / current.zoom;
    updateView({
      zoom,
      x: anchor.x - (anchor.x - current.x) * ratio,
      y: anchor.y - (anchor.y - current.y) * ratio,
    });
  }, [updateView]);

  // React's delegated wheel listener may be passive; register explicitly so
  // zooming the micrograph does not also scroll the surrounding Atlas page.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || failed) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = frame.getBoundingClientRect();
      const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1);
      zoomTo(viewRef.current.zoom * Math.exp(-pixels * .0018), {
        x: event.clientX - rect.left - rect.width / 2,
        y: event.clientY - rect.top - rect.height / 2,
      });
    };
    frame.addEventListener('wheel', onWheel, { passive: false });
    return () => frame.removeEventListener('wheel', onWheel);
  }, [photo?.id, photo?.src, failed, zoomTo]);

  const changePhoto = (nextIndex: number) => {
    reset();
    setFailed(false);
    setPhotoIndex((nextIndex + photos.length) % photos.length);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (failed || event.button !== 0) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const previous = pointers.current.get(event.pointerId);
    if (!previous || failed) return;
    const oldPoints = [...pointers.current.values()];
    const nextPoint = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, nextPoint);
    const nextPoints = [...pointers.current.values()];
    const current = viewRef.current;
    if (oldPoints.length >= 2) {
      const before = distance(oldPoints[0], oldPoints[1]);
      if (before < 1) return;
      const zoom = boundedZoom(current.zoom * distance(nextPoints[0], nextPoints[1]) / before);
      const ratio = zoom / current.zoom;
      const oldMid = midpoint(oldPoints[0], oldPoints[1]);
      const nextMid = midpoint(nextPoints[0], nextPoints[1]);
      const rect = event.currentTarget.getBoundingClientRect();
      const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      updateView({
        zoom,
        x: nextMid.x - center.x - (oldMid.x - center.x - current.x) * ratio,
        y: nextMid.y - center.y - (oldMid.y - center.y - current.y) * ratio,
      });
    } else {
      updateView({ ...current, x: current.x + nextPoint.x - previous.x, y: current.y + nextPoint.y - previous.y });
    }
  };

  const onPointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (failed) return;
    const current = viewRef.current;
    if (event.key === '+' || event.key === '=') zoomTo(current.zoom + .25);
    else if (event.key === '-') zoomTo(current.zoom - .25);
    else if (event.key === 'Home' || event.key === '0') reset();
    else if (event.key === 'ArrowLeft') updateView({ ...current, x: current.x + 30 });
    else if (event.key === 'ArrowRight') updateView({ ...current, x: current.x - 30 });
    else if (event.key === 'ArrowUp') updateView({ ...current, y: current.y + 30 });
    else if (event.key === 'ArrowDown') updateView({ ...current, y: current.y - 30 });
    else return;
    event.preventDefault();
  };

  if (!photo) {
    const sourceIds = [...new Set(getAtlasStructures(item.id).flatMap(structure => structure.sourceIds))];
    const sources = sourceIds.filter(id => id.startsWith('cdc-')).map(id => atlasSources[id]).filter(Boolean);
    return (
      <section className="atlas-photo-viewer atlas-photo-missing" aria-label={photoLabel}>
        <div className="atlas-photo-empty" role="status">
          <ImageOff size={28} aria-hidden="true" />
          <h3>{emptyTitle ?? `ยังไม่มี${photoLabel}ในชุดนี้`}</h3>
          <p>{emptyDescription ?? `ยังไม่มีภาพของ ${item.name} ที่ตรวจสอบชนิดและสิทธิ์พร้อมเก็บออฟไลน์ จึงแสดงเฉพาะแบบจำลองและแหล่งอ้างอิง`}</p>
        </div>
        <div className="atlas-photo-sources">
          {sources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.title} <ExternalLink size={13} aria-hidden="true" /></a>)}
          <small>เปิดเว็บไซต์แหล่งอ้างอิงขณะเชื่อมต่ออินเทอร์เน็ต</small>
        </div>
      </section>
    );
  }

  const supportsStructure = selectedStructure && photo.observableStructureIds.includes(selectedStructure.id);
  return (
    <section className="atlas-photo-viewer" aria-label={photoLabel}>
      <div className="atlas-photo-heading">
        <div><span className="atlas-photo-eyebrow">ภาพกล้องจุลทรรศน์จริง</span><h3><i>{photo.sourceTaxon}</i></h3></div>
        {photos.length > 1 && <div className="atlas-photo-gallery">
          <button type="button" aria-label="ภาพจริงก่อนหน้า" onClick={() => changePhoto(photoIndex - 1)}><ChevronLeft size={18} aria-hidden="true" /></button>
          <span aria-live="polite">{photoIndex + 1} / {photos.length}</span>
          <button type="button" aria-label="ภาพจริงถัดไป" onClick={() => changePhoto(photoIndex + 1)}><ChevronRight size={18} aria-hidden="true" /></button>
        </div>}
      </div>
      <div
        ref={frameRef}
        className="atlas-photo-frame"
        style={{ touchAction: 'none', overflow: 'hidden', position: 'relative', cursor: failed ? 'default' : view.zoom > 1 ? 'grab' : 'zoom-in' }}
        role="group"
        aria-label={`${photoLabel}ของ ${photo.sourceTaxon}`}
        aria-describedby={`${instructionsId} ${captionId}`}
        tabIndex={failed ? -1 : 0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onLostPointerCapture={event => pointers.current.delete(event.pointerId)}
        onKeyDown={onKeyDown}
      >
        {failed ? <div className="atlas-photo-error" role="alert"><ImageOff size={28} aria-hidden="true" /><p>โหลดภาพจริงไม่สำเร็จ</p><a href={photo.sourceUrl} target="_blank" rel="noreferrer">เปิดภาพจากแหล่งต้นฉบับ <ExternalLink size={13} aria-hidden="true" /></a></div> : <img
          key={photo.id}
          className="atlas-real-photo"
          src={photo.src}
          alt={`${specimenLabel} ${photo.sourceTaxon} จากภาพกล้องจุลทรรศน์ — ${photo.caption}`}
          draggable={false}
          style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', userSelect: 'none', transformOrigin: 'center', transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.zoom})` }}
          onError={() => { setFailed(true); reset(); }}
        />}
      </div>
      <div className="atlas-photo-controls">
        <button type="button" aria-label="ย่อภาพจริง" disabled={failed || view.zoom <= 1} onClick={() => zoomTo(viewRef.current.zoom - .25)}><Minus size={17} aria-hidden="true" /></button>
        <input type="range" min={1} max={5} step={.05} value={view.zoom} aria-label="ซูมภาพจริง" aria-valuetext={`${Math.round(view.zoom * 100)} เปอร์เซ็นต์`} disabled={failed} onChange={event => zoomTo(Number(event.currentTarget.value))} />
        <button type="button" aria-label="ขยายภาพจริง" disabled={failed || view.zoom >= 5} onClick={() => zoomTo(viewRef.current.zoom + .25)}><Plus size={17} aria-hidden="true" /></button>
        <output className="atlas-photo-zoom-value" aria-label="ระดับซูมภาพจริง">{Math.round(view.zoom * 100)}%</output>
        <button type="button" aria-label="คืนค่าภาพจริง" disabled={failed} onClick={reset}><RotateCcw size={16} aria-hidden="true" /></button>
      </div>
      <p id={instructionsId} className="atlas-photo-help">เลื่อนล้อเมาส์หรือจีบสองนิ้วเพื่อซูม · ลากเพื่อเลื่อนภาพ · แป้น + / − และปุ่มลูกศรใช้ได้เมื่อโฟกัสภาพ</p>
      <div className="atlas-photo-caption" id={captionId}>
        <p>{photo.caption}</p>
        {photo.stageNote && <p className="atlas-photo-stage">{photo.stageNote}</p>}
      </div>
      {selectedStructure && <div className={`atlas-photo-feature${supportsStructure ? ' is-supported' : ''}`} role="status">
        <strong>{selectedStructure.shortLabel}</strong>
        <p>{supportsStructure ? 'ลองซูมเพื่อสังเกตลักษณะนี้ในภาพและเทียบกับแบบจำลอง เป็นแนวทางเพื่อการเรียนรู้ ความชัดขึ้นกับระนาบโฟกัสของภาพ' : 'โครงสร้างนี้อาจไม่ปรากฏชัดในภาพนี้ แบบจำลองช่วยอธิบายตำแหน่ง แต่ภาพระนาบเดียวไม่ยืนยันว่ามีหรือไม่มีโครงสร้างนั้น'}</p>
      </div>}
      <div className="atlas-photo-attribution">
        <p>ภาพ: {photo.credit}</p>
        <div className="atlas-photo-source-links">
          <a href={photo.sourceUrl} target="_blank" rel="noreferrer">แหล่งภาพและคำบรรยาย <ExternalLink size={13} aria-hidden="true" /></a>
          <a href={photo.licenseUrl} target="_blank" rel="noreferrer">{photo.license} <ExternalLink size={13} aria-hidden="true" /></a>
        </div>
        <small>{photo.changes}</small>
      </div>
    </section>
  );
}
