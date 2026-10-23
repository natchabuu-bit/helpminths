import { useId } from 'react';

export interface StrongyloidesIllustrationProps {
  className?: string;
  showInternal?: boolean;
  selectedStructureId?: string | null;
}

const axisY = (x: number) => 100 + 12 * Math.sin((x - 28) / 308 * Math.PI * 2);
const radius = (x: number) => x > 294 ? Math.max(.4, 16 * Math.pow((336 - x) / 42, 1.1)) : 10 + 8 * Math.min(1, (x - 28) / 22);
const outline = (start: number, end: number) => {
  const xs = Array.from({ length: 81 }, (_, i) => start + (end - start) * i / 80);
  return `M ${xs.map((x) => `${x},${axisY(x) - radius(x)}`).join(' L ')} L ${xs.reverse().map((x) => `${x},${axisY(x) + radius(x)}`).join(' L ')}${start === 28 ? ' Q 15,100 28,90' : ''} Z`;
};
const tract = (start: number, end: number, offset = -3) => `M ${Array.from({ length: 40 }, (_, i) => {
  const x = start + (end - start) * i / 39;
  return `${x},${axisY(x) + offset}`;
}).join(' L ')}`;

/** Original teaching diagram of a rhabditiform larva; anatomical colours are explanatory. */
export default function StrongyloidesIllustration({ className, showInternal = true, selectedStructureId = null }: StrongyloidesIllustrationProps) {
  const uid = useId().replace(/:/g, '');
  const selected = (id: string) => selectedStructureId === id;
  const stroke = (id: string, normal: string) => selected(id) ? '#fff0b8' : normal;
  return <svg className={className} viewBox="0 0 360 200" role="img" aria-label="ภาพวาดจำลองตัวอ่อนระยะ rhabditiform ของ Strongyloides stercoralis" data-selected-structure={selectedStructureId ?? undefined}>
    <defs>
      <linearGradient id={`${uid}-body`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#dfebc4" stopOpacity=".82" /><stop offset=".5" stopColor="#adcaab" stopOpacity=".42" /><stop offset="1" stopColor="#729b7f" stopOpacity=".75" /></linearGradient>
      <radialGradient id={`${uid}-primordium`} cx="32%" cy="25%"><stop offset="0" stopColor="#ffe6b8" /><stop offset=".5" stopColor="#efb88e" /><stop offset="1" stopColor="#cb846b" /></radialGradient>
      <filter id={`${uid}-glow`} x="-40%" y="-80%" width="180%" height="260%"><feGaussianBlur stdDeviation="2.4" /></filter>
    </defs>
    <g role="group" aria-label="ผิวหุ้มตัวอ่อน (cuticle)">
      <path d={outline(28, 336)} fill={`url(#${uid}-body)`} stroke={stroke('cuticle', '#cbddaf')} strokeWidth={selected('cuticle') ? 2.6 : 1.7} />
    </g>
    <g role="group" aria-label="ปลายหางแหลมของตัวอ่อน rhabditiform">
      <path d={outline(294, 336)} fill="#a9c69c" fillOpacity=".45" stroke={stroke('pointed-tail', '#c3d6aa')} strokeWidth={selected('pointed-tail') ? 2.8 : 1} />
    </g>
    {showInternal && <>
      <g role="group" aria-label="ช่องปากสั้น (short buccal cavity)">
        <path d="M 25 100 L 40 102" fill="none" stroke={stroke('buccal-cavity', '#f1e8bb')} strokeWidth={selected('buccal-cavity') ? 4 : 2.8} strokeLinecap="round" />
      </g>
      <g role="group" aria-label="หลอดอาหารแบบ rhabditoid และกระเปาะท้าย">
        <path d={tract(42, 100, 0)} fill="none" stroke={stroke('rhabditoid-esophagus', '#9cc28d')} strokeWidth="5" strokeLinecap="round" />
        <path d={tract(100, 112, 0)} fill="none" stroke={stroke('rhabditoid-esophagus', '#b7d29a')} strokeWidth="2.8" strokeLinecap="round" />
        <ellipse cx="117" cy={axisY(117)} rx="11" ry="7" fill="#bddaa3" stroke={stroke('rhabditoid-esophagus', '#668862')} strokeWidth={selected('rhabditoid-esophagus') ? 2 : 1} />
      </g>
      <g role="group" aria-label="ลำไส้ของตัวอ่อน">
        <path d={tract(129, 305)} fill="none" stroke={stroke('intestine', '#6c9677')} strokeWidth={selected('intestine') ? 7 : 6} strokeLinecap="round" />
        <path d={tract(129, 305)} fill="none" stroke="#c8dba9" strokeWidth="1.6" strokeLinecap="round" />
      </g>
      <g role="group" aria-label="Genital primordium ขนาดใหญ่ภายในตัวอ่อน" data-selected={selected('genital-primordium')}>
        {selected('genital-primordium') && <ellipse cx="206" cy="101" rx="22" ry="10" fill="#f5d6a2" opacity=".75" filter={`url(#${uid}-glow)`} />}
        <ellipse cx="206" cy="101" rx="19" ry="7.3" fill={`url(#${uid}-primordium)`} stroke={stroke('genital-primordium', '#f4d4a5')} strokeWidth={selected('genital-primordium') ? 2.3 : 1.2} />
        <path d="M 206 112 L 206 144 L 169 144" fill="none" stroke="#d6bb8a" strokeWidth="1" />
        <text x="112" y="162" fill="#e0d4ab" fontSize="11" fontFamily="inherit">Genital primordium</text>
      </g>
    </>}
  </svg>;
}
