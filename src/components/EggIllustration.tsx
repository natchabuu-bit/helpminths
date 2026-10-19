import { useId } from 'react';
import { getSpeciesById } from '../data/species';

export interface EggIllustrationProps {
  speciesId: string;
  className?: string;
  showInternal?: boolean;
}

/** A deliberately schematic drawing; never presented as a microscopy image. */
export default function EggIllustration({ speciesId, className, showInternal = true }: EggIllustrationProps) {
  const item = getSpeciesById(speciesId);
  const uid = useId().replace(/:/g, '');
  const isHymenolepis = speciesId === 'hymenolepis-nana' || speciesId === 'hymenolepis-diminuta';
  const isNana = speciesId === 'hymenolepis-nana';
  const isRound = speciesId === 'taenia' || isHymenolepis;
  const isOV = speciesId === 'opisthorchis';
  const isMIF = speciesId === 'mif';
  const isLargeFluke = speciesId === 'echinostoma' || speciesId === 'fasciolopsis';
  const rx = speciesId === 'hymenolepis-diminuta' ? 69 : isRound ? 58 : speciesId === 'trichuris' ? 83 : speciesId === 'fasciolopsis' ? 94 : isMIF ? 78 : 88;
  const ry = speciesId === 'trichuris' ? 35 : isRound ? 55 : speciesId === 'echinostoma' ? 57 : isMIF ? 43 : 48;
  const eggPath = speciesId === 'enterobius'
    ? 'M 40 134 C 40 52 208 52 208 134 Q 124 142 40 134 Z'
    : speciesId === 'trichuris'
      ? 'M 45 94 Q 61 65 125 65 Q 189 65 205 94 L 205 106 Q 189 135 125 135 Q 61 135 45 106 Z'
      : isOV
        ? 'M 56 79 C 76 48 166 42 199 76 C 222 101 205 133 173 143 C 121 158 74 145 56 121 Z'
        : null;
  return (
    <svg className={className} viewBox="0 0 250 200" role="img" aria-label={`ภาพวาดจำลองไข่ ${item.name}`}>
      <defs>
        <radialGradient id={`${uid}-shell`} cx="35%" cy="25%">
          <stop offset="0" stopColor="#f0dfbb" stopOpacity=".9" />
          <stop offset=".6" stopColor={item.color} stopOpacity=".73" />
          <stop offset="1" stopColor="#6e492d" stopOpacity=".8" />
        </radialGradient>
        <radialGradient id={`${uid}-core`}>
          <stop offset="0" stopColor={isOV || isMIF ? '#c4b777' : '#a8b58c'} />
          <stop offset="1" stopColor={isOV || isMIF ? '#94834b' : '#727c58'} />
        </radialGradient>
        <filter id={`${uid}-shadow`}><feGaussianBlur stdDeviation="5" /></filter>
      </defs>
      <ellipse cx="125" cy="164" rx="75" ry="7" fill="#000" opacity=".28" filter={`url(#${uid}-shadow)`} />
      {speciesId === 'ascaris' && Array.from({ length: 30 }, (_, n) => {
        const a = n / 30 * Math.PI * 2;
        return <ellipse key={n} cx={125 + Math.cos(a) * 87} cy={100 + Math.sin(a) * 49} rx="6" ry="5" fill="#a7794d" stroke="#dfb67d" strokeWidth="1.5" />;
      })}
      {eggPath
        ? <path d={eggPath} fill={`url(#${uid}-shell)`} stroke={item.color} strokeWidth="3" />
        : <ellipse cx="125" cy="100" rx={rx} ry={ry} fill={`url(#${uid}-shell)`} stroke={item.color} strokeWidth={speciesId === 'taenia' ? 9 : 2} />}
      {speciesId === 'trichuris' && <g fill="#e7d3a9" stroke="#a57447" strokeWidth="2"><ellipse cx="44" cy="100" rx="10" ry="13" /><ellipse cx="206" cy="100" rx="10" ry="13" /></g>}
      {isOV && <>
        <g role="group" aria-label="ฝาปิดและบ่าของไข่ OV" fill="#dfbc72" stroke="#91662e" strokeWidth="2.5">
          <path d="M 56 79 Q 35 100 56 121 Q 60 100 56 79 Z" />
          <path d="M 56 79 L 65 74 M 56 121 L 65 126" fill="none" strokeWidth="3.5" strokeLinecap="round" />
        </g>
        <g role="group" aria-label="ปุ่มเล็กที่ขั้วตรงข้ามฝา (abopercular knob)"><ellipse cx="209" cy="100" rx="6" ry="4" fill="#dfbd72" stroke="#a47937" strokeWidth="1.5" /></g>
      </>}
      {isMIF && <g role="group" aria-label="ฝาปิดของไข่ MIF" fill="#e8cb88" stroke="#a78143" strokeWidth="2">
        <path d="M 58 77 Q 38 100 58 123 Q 64 100 58 77 Z" />
        <path d="M 58 77 Q 65 100 58 123" fill="none" />
      </g>}
      {isLargeFluke && <g role="group" aria-label={`ฝาปิดของไข่ ${speciesId === 'echinostoma' ? 'Echinostoma spp.' : 'Fasciolopsis buski'}`} fill="#ead4a2" stroke="#a78954" strokeWidth="1.7">
        <path d={`M ${125 - rx + 12} ${100 - ry * .51} Q ${125 - rx - 8} 100 ${125 - rx + 12} ${100 + ry * .51} Q ${125 - rx + 17} 100 ${125 - rx + 12} ${100 - ry * .51} Z`} />
      </g>}
      {speciesId === 'hymenolepis-diminuta' && <g role="group" aria-label="ผนังสองชั้นของไข่ Hymenolepis diminuta"><ellipse cx="125" cy="100" rx="62" ry="48" fill="none" stroke="#edc977" strokeWidth="2" /><ellipse cx="125" cy="100" rx="67" ry="53" fill="none" stroke="#997b41" strokeWidth="2" /></g>}
      {speciesId === 'taenia' && Array.from({ length: 36 }, (_, n) => {
        const a = n / 36 * Math.PI * 2;
        return <line key={n} x1={125 + Math.cos(a) * 48} y1={100 + Math.sin(a) * 45} x2={125 + Math.cos(a) * 61} y2={100 + Math.sin(a) * 58} stroke="#68452f" strokeWidth="2.5" />;
      })}
      {showInternal && <g opacity=".84">
        {speciesId === 'hookworm'
          ? [[104, 83], [130, 80], [151, 98], [127, 111], [101, 111], [151, 120]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="15" fill={`url(#${uid}-core)`} stroke="#e0d7ab" strokeWidth="1.5" />)
          : speciesId === 'enterobius'
            ? <path d="M 72 115 C 81 70 164 71 181 103 C 198 137 117 132 109 109 C 103 92 152 88 159 110" fill="none" stroke="#89946a" strokeWidth="10" strokeLinecap="round" />
            : isLargeFluke
              ? <g role="group" aria-label="กลุ่มเซลล์ไข่แดง ไข่ยังไม่เจริญเป็นตัวอ่อน">
                <ellipse cx="128" cy="100" rx={rx - 24} ry={ry - 14} fill="#bda66b" stroke="#e6d5a5" strokeWidth="1" />
                {Array.from({ length: 33 }, (_, n) => {
                  const angle = n * 2.39996;
                  const distance = Math.sqrt((n + .5) / 33);
                  return <ellipse key={n} cx={128 + Math.cos(angle) * distance * (rx - 33)} cy={100 + Math.sin(angle) * distance * (ry - 21)} rx={4.5 + n % 3} ry={4 + n % 2} fill={['#ddc98f', '#9c8a57', '#c7b376'][n % 3]} stroke="#daca96" strokeWidth=".6" />;
                })}
              </g>
              : <ellipse cx="125" cy="100" rx={isHymenolepis ? 24 : isRound ? 28 : isMIF ? 42 : 46} ry={isHymenolepis ? 24 : isRound ? 29 : isMIF ? 24 : 27} fill={`url(#${uid}-core)`} stroke="#ddd3aa" strokeWidth="1.5" />}
        {isHymenolepis && <ellipse cx="125" cy="100" rx={isNana ? 40 : 38} ry={isNana ? 37 : 35} fill="none" stroke="#efdfb0" strokeWidth={isNana ? 1.8 : 3} />}
        {isNana && <g role="group" aria-label="เส้นใยขั้วของไข่ Hymenolepis nana" fill="none" stroke="#f0e5c4" strokeWidth="1.6" strokeLinecap="round">
          <path d="M 85 94 Q 74 80 80 71 Q 86 65 88 76 M 85 100 Q 70 92 74 111 Q 80 122 83 110 M 85 106 Q 82 125 92 129 Q 101 131 98 120" />
          <path d="M 165 94 Q 176 80 170 71 Q 164 65 162 76 M 165 100 Q 180 92 176 111 Q 170 122 167 110 M 165 106 Q 168 125 158 129 Q 149 131 152 120" />
          <path d="M 85 92 L 85 108 M 165 92 L 165 108" stroke="#e3d8ae" strokeWidth="4" />
        </g>}
        {(speciesId === 'taenia' || isHymenolepis) && <g role="group" aria-label="ตะขอ 3 คู่">{Array.from({ length: 6 }, (_, n) => {
          const a = n / 6 * Math.PI * 2;
          return <path key={n} d="M 0 7 Q 6 -3 0 -15" transform={`translate(${125 + Math.cos(a) * 10} ${100 + Math.sin(a) * 10}) rotate(${n * 60})`} fill="none" stroke="#f1e5b8" strokeWidth="2" />;
        })}</g>}
        {isOV && <g role="group" aria-label="ตัวอ่อน miracidium ของไข่ OV" stroke="#e0d6a1" strokeWidth="1.5">{Array.from({ length: 20 }, (_, n) => {
          const a = n / 20 * Math.PI * 2;
          return <line key={n} x1={125 + Math.cos(a) * 45} y1={100 + Math.sin(a) * 26} x2={125 + Math.cos(a) * 50} y2={100 + Math.sin(a) * 31} />;
        })}</g>}
        {isMIF && <g role="group" aria-label="ตัวอ่อน miracidium ของไข่ MIF" stroke="#e5d9a6" strokeWidth="1.4">{Array.from({ length: 18 }, (_, n) => {
          const a = n / 18 * Math.PI * 2;
          return <line key={n} x1={125 + Math.cos(a) * 41} y1={100 + Math.sin(a) * 24} x2={125 + Math.cos(a) * 45} y2={100 + Math.sin(a) * 28} />;
        })}<ellipse cx="127" cy="100" rx="16" ry="12" fill="#afad74" stroke="#cfc58e" /></g>}
      </g>}
      <ellipse cx="104" cy="77" rx={isRound ? 22 : 33} ry="11" fill="#fff5db" opacity=".13" transform="rotate(-16 104 77)" />
    </svg>
  );
}
