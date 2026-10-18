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
  const isRound = speciesId === 'taenia' || speciesId === 'schistosoma-japonicum';
  const rx = isRound ? 58 : speciesId === 'trichuris' ? 83 : 88;
  const ry = speciesId === 'trichuris' ? 35 : isRound ? 55 : 48;
  const eggPath = speciesId === 'enterobius'
    ? 'M 40 134 C 40 52 208 52 208 134 Q 124 142 40 134 Z'
    : speciesId === 'trichuris'
      ? 'M 45 94 Q 61 65 125 65 Q 189 65 205 94 L 205 106 Q 189 135 125 135 Q 61 135 45 106 Z'
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
          <stop offset="0" stopColor="#a8b58c" />
          <stop offset="1" stopColor="#727c58" />
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
      {speciesId === 'schistosoma-mansoni' && <path d="M 90 58 L 68 26 L 108 53" fill="#d8b57c" stroke="#c19b64" strokeWidth="2" />}
      {speciesId === 'schistosoma-haematobium' && <path d="M 209 88 L 239 100 L 209 111" fill="#d4b985" stroke="#c0a36c" strokeWidth="2" />}
      {speciesId === 'schistosoma-japonicum' && <path d="M 87 58 Q 69 43 80 67" fill="#d1bf91" stroke="#c1ac7a" strokeWidth="2" />}
      {speciesId === 'taenia' && Array.from({ length: 36 }, (_, n) => {
        const a = n / 36 * Math.PI * 2;
        return <line key={n} x1={125 + Math.cos(a) * 48} y1={100 + Math.sin(a) * 45} x2={125 + Math.cos(a) * 61} y2={100 + Math.sin(a) * 58} stroke="#68452f" strokeWidth="2.5" />;
      })}
      {showInternal && <g opacity=".84">
        {speciesId === 'hookworm'
          ? [[104, 83], [130, 80], [151, 98], [127, 111], [101, 111], [151, 120]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="15" fill={`url(#${uid}-core)`} stroke="#e0d7ab" strokeWidth="1.5" />)
          : speciesId === 'enterobius'
            ? <path d="M 72 115 C 81 70 164 71 181 103 C 198 137 117 132 109 109 C 103 92 152 88 159 110" fill="none" stroke="#89946a" strokeWidth="10" strokeLinecap="round" />
            : <ellipse cx="125" cy="100" rx={isRound ? 28 : 46} ry={isRound ? 29 : 27} fill={`url(#${uid}-core)`} stroke="#ddd3aa" strokeWidth="1.5" />}
        {speciesId === 'taenia' && Array.from({ length: 6 }, (_, n) => {
          const a = n / 6 * Math.PI * 2;
          return <path key={n} d="M 0 7 Q 6 -3 0 -15" transform={`translate(${125 + Math.cos(a) * 10} ${100 + Math.sin(a) * 10}) rotate(${n * 60})`} fill="none" stroke="#e0d1a1" strokeWidth="2" />;
        })}
      </g>}
      <ellipse cx="104" cy="77" rx={isRound ? 22 : 33} ry="11" fill="#fff5db" opacity=".13" transform="rotate(-16 104 77)" />
    </svg>
  );
}
