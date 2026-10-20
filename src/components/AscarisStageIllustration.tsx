import { useId } from 'react';
import type { AscarisStageId } from '../data/ascarisStages';

export interface AscarisStageIllustrationProps {
  stage: AscarisStageId;
  decorticated?: boolean;
  className?: string;
  showInternal?: boolean;
}

const stageLabels: Record<AscarisStageId, string> = {
  unfertilized: 'ไข่ไม่ปฏิสนธิ',
  fertilized: 'ไข่ปฏิสนธิระยะต้น',
  cleavage: 'ไข่ระยะแบ่งเซลล์',
  embryonated: 'ไข่มีตัวอ่อนเจริญเต็มที่',
};

/** Original explanatory drawing: no photograph, calibrated scale, or inferred organelles. */
export default function AscarisStageIllustration({ stage, decorticated = false, className, showInternal = true }: AscarisStageIllustrationProps) {
  const uid = useId().replace(/:/g, '');
  const elongated = stage === 'unfertilized';
  const rx = elongated ? 98 : 81;
  const ry = elongated ? 44 : 59;
  const coatCount = elongated ? 45 : 40;
  return <svg className={className} viewBox="0 0 250 200" role="img" aria-label={`ภาพวาดจำลอง Ascaris lumbricoides ${stageLabels[stage]}${decorticated ? ' เปลือกชั้นนอกหลุด (decorticated)' : ''}`} data-ascaris-stage={stage} data-decorticated={decorticated}>
    <defs>
      <radialGradient id={`${uid}-shell`} cx="35%" cy="25%"><stop offset="0" stopColor="#f4e3bf" /><stop offset=".6" stopColor="#d8b777" /><stop offset="1" stopColor="#a9814c" /></radialGradient>
      <radialGradient id={`${uid}-cavity`} cx="42%" cy="35%"><stop offset="0" stopColor="#e8ddab" /><stop offset="1" stopColor="#c1b17b" /></radialGradient>
      <radialGradient id={`${uid}-ovum`} cx="32%" cy="23%"><stop offset="0" stopColor="#d0d5a1" /><stop offset=".65" stopColor="#a7b080" /><stop offset="1" stopColor="#7e8e63" /></radialGradient>
      <filter id={`${uid}-shadow`}><feGaussianBlur stdDeviation="3.5" /></filter>
    </defs>
    <ellipse cx="125" cy="169" rx={rx * .8} ry="7" fill="#000" opacity=".24" filter={`url(#${uid}-shadow)`} />
    {!decorticated && <g role="group" aria-label="ชั้นผิวนอกขรุขระของไข่ Ascaris">
      {Array.from({ length: coatCount }, (_, i) => {
        const angle = i / coatCount * Math.PI * 2;
        const irregular = elongated ? 1 + Math.sin(i * 2.1) * .035 : 1;
        return <ellipse key={i} cx={125 + Math.cos(angle) * rx * irregular} cy={100 + Math.sin(angle) * ry * irregular} rx={4 + i % 3} ry={3.6 + i % 2 * .8} fill={i % 3 ? '#b58a54' : '#c69a63'} stroke="#e1bd85" strokeWidth="1.1" transform={`rotate(${angle * 180 / Math.PI} ${125 + Math.cos(angle) * rx * irregular} ${100 + Math.sin(angle) * ry * irregular})`} />;
      })}
    </g>}
    <g role="group" aria-label={decorticated ? 'เปลือกเรียบที่เหลือหลังชั้นผิวนอกหลุด' : 'เปลือกไข่ Ascaris'}>
      <ellipse cx="125" cy="100" rx={rx} ry={ry} fill={`url(#${uid}-shell)`} stroke="#e6c891" strokeWidth={elongated ? 2 : 3} />
      <ellipse cx="125" cy="100" rx={rx - (elongated ? 4 : 9)} ry={ry - (elongated ? 4 : 9)} fill={`url(#${uid}-cavity)`} fillOpacity=".87" stroke="#977945" strokeOpacity=".6" strokeWidth="1.2" />
    </g>
    {showInternal && stage === 'unfertilized' && <g role="group" aria-label="มวลเม็ดภายในไข่ไม่ปฏิสนธิ">
      {Array.from({ length: 63 }, (_, i) => {
        const angle = i * Math.PI * (3 - Math.sqrt(5));
        const radius = Math.sqrt((i + .5) / 63);
        return <ellipse key={i} cx={125 + Math.cos(angle) * radius * 82} cy={100 + Math.sin(angle) * radius * 31} rx={2.8 + i % 4 * .8} ry={2.5 + i % 3 * .65} fill={['#8e8c5a', '#b8aa72', '#c9bb84', '#a59d64'][i % 4]} stroke="#827a48" strokeOpacity=".35" strokeWidth=".6" />;
      })}
    </g>}
    {showInternal && stage === 'fertilized' && <g role="group" aria-label="เซลล์ไข่ในไข่ปฏิสนธิระยะต้น">
      <ellipse cx="125" cy="100" rx="52" ry="35" fill={`url(#${uid}-ovum)`} stroke="#7e8c60" strokeWidth="1.3" />
      {Array.from({ length: 23 }, (_, i) => {
        const angle = i * Math.PI * (3 - Math.sqrt(5)); const radius = Math.sqrt((i + .5) / 23);
        return <circle key={i} cx={125 + Math.cos(angle) * radius * 43} cy={100 + Math.sin(angle) * radius * 27} r={1.1 + i % 2 * .7} fill="#d1d5a5" opacity=".64" />;
      })}
    </g>}
    {showInternal && stage === 'cleavage' && <g role="group" aria-label="เซลล์แบ่งตัวของไข่ Ascaris ตัวอย่าง 4 เซลล์">
      {[[105, 81], [145, 81], [105, 119], [145, 119]].map(([cx, cy], i) => <ellipse key={i} cx={cx} cy={cy} rx="24" ry="22" fill={`url(#${uid}-ovum)`} stroke="#76875a" strokeWidth="1.5" />)}
    </g>}
    {showInternal && stage === 'embryonated' && <g role="group" aria-label="ตัวอ่อนขดภายในไข่ Ascaris ที่เจริญเต็มที่">
      <path d="M 167 120 C 180 95 157 70 123 70 C 86 69 69 92 83 117 C 96 140 148 141 161 119 C 174 96 151 84 126 84 C 101 84 92 103 106 116 C 117 127 142 124 144 110 C 146 99 130 96 123 104" fill="none" stroke="#66734b" strokeWidth="11" strokeLinecap="round" strokeLinejoin="round" opacity=".72" />
      <path d="M 167 119 C 180 94 157 69 123 69 C 86 68 69 91 83 116 C 96 139 148 140 161 118 C 174 95 151 83 126 83 C 101 83 92 102 106 115 C 117 126 142 123 144 109 C 146 98 130 95 123 103" fill="none" stroke="#c4c997" strokeWidth="7.5" strokeLinecap="round" strokeLinejoin="round" />
    </g>}
    <path d={`M ${125 - rx * .7} ${100 - ry * .45} Q ${125 - rx * .45} ${100 - ry * .85} ${125 - rx * .14} ${100 - ry * .85}`} fill="none" stroke="#fff0cf" strokeWidth="3" strokeLinecap="round" opacity=".45" />
  </svg>;
}
