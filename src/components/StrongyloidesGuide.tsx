import { useId } from 'react';
import { ArrowUpRight, Focus, Info, Microscope } from 'lucide-react';
import { strongyloidesEvidenceNote, strongyloidesSources } from '../data/strongyloides';
import StrongyloidesIllustration from './StrongyloidesIllustration';
import '../styles/strongyloides.css';

interface StrongyloidesGuideProps {
  onSelectGenitalPrimordium: () => void;
}

export default function StrongyloidesGuide({ onSelectGenitalPrimordium }: StrongyloidesGuideProps) {
  const headingId = useId();
  return <section className="strongyloides-guide" aria-labelledby={headingId}>
    <div className="strongyloides-guide-heading"><div><span>LARVAL MORPHOLOGY</span><h3 id={headingId}>ตัวอ่อนระยะ rhabditiform</h3></div><span className="strongyloides-stage-tag"><Microscope size={14} /> Strongyloides stercoralis</span></div>
    <div className="strongyloides-guide-overview">
      <figure className="strongyloides-guide-figure"><StrongyloidesIllustration showInternal selectedStructureId="genital-primordium" /><figcaption>ภาพวาดอธิบายตัวอ่อน · หัวอยู่ซ้าย หางอยู่ขวา<br />เน้น Genital primordium ด้วยสีและขนาดเพื่อการเรียนรู้ ไม่ใช้วัดสัดส่วนจริง</figcaption></figure>
      <div className="strongyloides-guide-description">
        <span className="strongyloides-gp-label">จุดสังเกตเด่น</span>
        <h4>Genital primordium <span>ใหญ่และเห็นเด่น</span></h4>
        <p>กลุ่มเนื้อเยื่อต้นกำเนิดระบบสืบพันธุ์อยู่ภายในลำตัว ใช้สังเกตร่วมกับช่องปากสั้นและหลอดอาหารแบบ rhabditoid ที่มีส่วนกระเปาะ</p>
        <button type="button" className="strongyloides-focus-button" aria-label="ขยายดู Genital primordium" onClick={onSelectGenitalPrimordium}><Focus size={16} aria-hidden="true" /> ขยายดู Genital primordium</button>
      </div>
    </div>
    <div className="strongyloides-stage-note"><Info size={15} aria-hidden="true" /><p>ในอุจจาระของผู้ติดเชื้อ S. stercoralis มักตรวจพบตัวอ่อนมากกว่าไข่ ตัวอย่างนี้แสดงระยะ rhabditiform ซึ่งมีหางแหลม ส่วนระยะติดต่อ filariform มีลักษณะต่างออกไป</p></div>
    <div className="strongyloides-comparison-wrap">
      <table className="strongyloides-comparison">
        <caption>เปรียบเทียบตัวอ่อนระยะ rhabditiform</caption>
        <thead><tr><th scope="col">ลักษณะ</th><th scope="col">Strongyloides</th><th scope="col">Hookworm</th></tr></thead>
        <tbody><tr><th scope="row">ช่องปาก<br /><span>Buccal cavity</span></th><td>สั้น</td><td>ยาวกว่า</td></tr><tr><th scope="row">Genital primordium</th><td><strong>ใหญ่และเด่นชัด</strong></td><td>เล็กหรือเห็นไม่เด่น</td></tr></tbody>
      </table>
      <p className="strongyloides-comparison-note">ตารางนี้เทียบตัวอ่อน rhabditiform ทั้งสองกลุ่ม การดูจุดสังเกตร่วมกันช่วยแยกจากตัวอ่อนพยาธิปากขอ</p>
    </div>
    <p className="strongyloides-evidence-note">{strongyloidesEvidenceNote}</p>
    <div className="strongyloides-guide-sources">{Object.values(strongyloidesSources).map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.title}<ArrowUpRight size={12} aria-hidden="true" /></a>)}</div>
  </section>;
}
