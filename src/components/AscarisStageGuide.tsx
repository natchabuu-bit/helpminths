import { useId } from 'react';
import { ArrowUpRight, Check, Info, Layers3 } from 'lucide-react';
import { ascarisDecorticatedNote, ascarisDevelopmentNote, ascarisStages, getAscarisStage, type AscarisStageId } from '../data/ascarisStages';
import { atlasSources } from '../data/atlasStructures';
import AscarisStageIllustration from './AscarisStageIllustration';
import '../styles/ascaris-stages.css';

interface AscarisStageGuideProps {
  stage: AscarisStageId;
  decorticated: boolean;
  onStageChange: (stage: AscarisStageId) => void;
  onDecorticatedChange: (value: boolean) => void;
}

export default function AscarisStageGuide({ stage, decorticated, onStageChange, onDecorticatedChange }: AscarisStageGuideProps) {
  const headingId = useId();
  const selected = getAscarisStage(stage);
  return <section className="ascaris-stages" aria-labelledby={headingId}>
    <div className="ascaris-stage-heading"><div><span>ASCARIS EGG DEVELOPMENT</span><h3 id={headingId}>ระยะไข่พยาธิไส้เดือน</h3></div><span className="ascaris-stage-guide-tag"><Layers3 size={13} /> เลือกเพื่อเปลี่ยนภาพและโมเดล</span></div>
    <div className="ascaris-stage-options" role="group" aria-label="เลือกระยะพัฒนาไข่ Ascaris">
      {ascarisStages.map((entry) => <button type="button" key={entry.id} className={`ascaris-stage-option${stage === entry.id ? ' ascaris-stage-selected' : ''}`} data-stage={entry.id} aria-pressed={stage === entry.id} onClick={() => onStageChange(entry.id)}>
        <AscarisStageIllustration stage={entry.id} decorticated={decorticated} className="ascaris-stage-thumbnail" />
        <strong>{entry.title}</strong><span>{entry.englishTitle}</span>
        {stage === entry.id && <Check className="ascaris-stage-check" size={14} aria-hidden="true" />}
      </button>)}
    </div>
    <p className="ascaris-development-note"><Info size={14} />{ascarisDevelopmentNote}</p>
    <div className="ascaris-selected-stage">
      <figure className="ascaris-stage-figure"><AscarisStageIllustration stage={stage} decorticated={decorticated} /><figcaption>ภาพวาดอธิบายโครงสร้าง<br />ไม่ใช่ภาพกล้องจุลทรรศน์ · ไม่อ้างอิงสเกล</figcaption></figure>
      <div className="ascaris-stage-description" aria-live="polite" aria-atomic="true">
        <span className={`ascaris-stage-status${stage === 'embryonated' ? ' ascaris-stage-status-mature' : ''}`}>{selected.status}</span>
        <h4>{selected.title} <span>{selected.englishTitle}</span></h4>
        <p>{selected.description}</p>
        <div className="ascaris-stage-sources">{selected.sourceIds.map((id) => atlasSources[id]).filter(Boolean).map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.title}<ArrowUpRight size={12} aria-hidden="true" /></a>)}</div>
      </div>
    </div>
    <div className="ascaris-coat-section">
      <div className="ascaris-coat-comparison" aria-label="เปรียบเทียบชั้นผิวนอกของระยะที่เลือก">
        <div><AscarisStageIllustration stage={stage} showInternal={false} /><span>มีชั้นผิวนอก</span></div>
        <div><AscarisStageIllustration stage={stage} decorticated showInternal={false} /><span>ชั้นผิวนอกหลุด</span></div>
      </div>
      <div className="ascaris-coat-explanation"><button type="button" className="ascaris-decorticated-toggle" aria-label="เปลือกชั้นนอกหลุด (Decorticated)" aria-pressed={decorticated} onClick={() => onDecorticatedChange(!decorticated)}><span className="ascaris-coat-switch" aria-hidden="true"><span /></span><span>เปลือกชั้นนอกหลุด <small>(Decorticated)</small></span></button><p>{ascarisDecorticatedNote}</p></div>
    </div>
    <p className="ascaris-stage-media-note">ภาพวาดและโมเดลเปลี่ยนตามระยะและสภาพเปลือกที่เลือก ภาพจริงด้านล่างแสดงเฉพาะตัวอย่างที่มีแหล่งข้อมูลรองรับ ภาพวาดทุกระยะใช้ต่อได้เมื่อแอพพร้อมออฟไลน์</p>
  </section>;
}
