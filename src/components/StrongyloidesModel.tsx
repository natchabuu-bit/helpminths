import { useEffect, useMemo, type ReactNode } from 'react';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { BufferGeometry, CatmullRomCurve3, DoubleSide, Float32BufferAttribute, TubeGeometry, Vector3 } from 'three';
import { getAtlasStructures } from '../data/atlasStructures';

interface StrongyloidesModelProps {
  cutaway: boolean;
  labels: boolean;
  selectedStructureId: string | null;
  onSelectStructure: (id: string) => void;
}

const ROTATION: [number, number, number] = [.09, -.08, -.18];
const HIGHLIGHT = '#ffe6ac';
const centerY = (x: number) => .12 * Math.sin((x + 2.5) * Math.PI / 2.5);
const bodyRadius = (x: number) => {
  if (x > 1.86) return Math.max(.003, .18 * Math.pow((2.5 - x) / .64, 1.1));
  const head = Math.max(0, Math.min(1, (x + 2.45) / .3));
  return .11 + .115 * head + .007 * Math.sin((x + 2.45) * 1.7);
};

/** A tapered cuticle around a gently curved rhabditiform larva, not an egg. */
function cuticleGeometry(start: number, end: number, cutaway: boolean) {
  const along = Math.max(24, Math.ceil((end - start) * 30));
  const around = cutaway ? 18 : 32;
  const vertices: number[] = [], indices: number[] = [];
  for (let i = 0; i <= along; i++) {
    const x = start + (end - start) * i / along;
    const radius = bodyRadius(x);
    for (let j = 0; j <= around; j++) {
      const angle = (cutaway ? Math.PI : 0) + j / around * (cutaway ? Math.PI : Math.PI * 2);
      vertices.push(x, centerY(x) + Math.cos(angle) * radius, Math.sin(angle) * radius);
      if (i && j) {
        const a = (i - 1) * (around + 1) + j - 1, b = a + 1, c = i * (around + 1) + j - 1, d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function Material({ color, selected, opacity = 1 }: { color: string; selected: boolean; opacity?: number }) {
  return <meshPhysicalMaterial color={color} roughness={.48} clearcoat={.18} transparent={opacity < 1} opacity={opacity} depthWrite={opacity >= 1} side={DoubleSide} emissive={selected ? HIGHLIGHT : '#000000'} emissiveIntensity={selected ? .48 : 0} />;
}

function Part({ id, onSelect, children }: { id: string; onSelect: (id: string) => void; children: ReactNode }) {
  const { gl } = useThree();
  return <group name={`atlas-structure-${id}`} onClick={(event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); onSelect(id); }} onPointerOver={(event) => { event.stopPropagation(); gl.domElement.style.cursor = 'pointer'; }} onPointerOut={() => { gl.domElement.style.cursor = 'grab'; }}>{children}</group>;
}

function Tube({ points, radius, color, selected, opacity = 1 }: { points: Vector3[]; radius: number; color: string; selected: boolean; opacity?: number }) {
  const geometry = useMemo(() => new TubeGeometry(new CatmullRomCurve3(points), 64, radius, 16, false), [points, radius]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh geometry={geometry}><Material color={color} selected={selected} opacity={opacity} /></mesh>;
}

const axis = (start: number, end: number, yOffset = 0, z = .025, count = 32) => Array.from({ length: count }, (_, i) => {
  const x = start + (end - start) * i / (count - 1);
  return new Vector3(x, centerY(x) + yOffset, z);
});

export default function StrongyloidesModel({ cutaway, labels, selectedStructureId, onSelectStructure }: StrongyloidesModelProps) {
  const body = useMemo(() => cuticleGeometry(-2.45, 1.86, cutaway), [cutaway]);
  const tail = useMemo(() => cuticleGeometry(1.86, 2.5, cutaway), [cutaway]);
  useEffect(() => () => { body.dispose(); tail.dispose(); }, [body, tail]);
  const buccal = useMemo(() => axis(-2.43, -2.25, 0, .035, 8), []);
  const corpus = useMemo(() => axis(-2.23, -1.6, 0, .025), []);
  const isthmus = useMemo(() => axis(-1.6, -1.35, 0, .025, 12), []);
  const intestine = useMemo(() => axis(-1.13, 1.94, .055, .03, 64), []);
  const lumen = useMemo(() => axis(-1.13, 1.94, .055, .083, 64), []);
  const edges = useMemo(() => [-1, 1].map((direction) => axis(-2.45, 2.5, 0, .004, 100).map((point) => new Vector3(point.x, centerY(point.x) + direction * bodyRadius(point.x), .004))), []);
  const selected = (id: string) => selectedStructureId === id;
  const structures = getAtlasStructures('strongyloides');
  return <group rotation={ROTATION}>
    <Part id="cuticle" onSelect={onSelectStructure}>
      <mesh geometry={body} renderOrder={3}><Material color="#d7dfb8" selected={selected('cuticle')} opacity={cutaway ? .30 : .24} /></mesh>
      {cutaway && edges.map((points, index) => <Tube key={index} points={points} radius={.006} color="#cfddb2" selected={selected('cuticle')} opacity={.7} />)}
      <mesh position={[-2.45, centerY(-2.45), 0]} rotation={[0, Math.PI / 2, 0]}><torusGeometry args={[.105, .008, 8, 40]} /><Material color="#d8dfbd" selected={selected('cuticle')} opacity={.75} /></mesh>
    </Part>
    <Part id="pointed-tail" onSelect={onSelectStructure}>
      <mesh geometry={tail} renderOrder={3}><Material color="#cfdbb0" selected={selected('pointed-tail')} opacity={cutaway ? .48 : .42} /></mesh>
    </Part>
    <Part id="buccal-cavity" onSelect={onSelectStructure}>
      <Tube points={buccal} radius={.025} color="#efe9c9" selected={selected('buccal-cavity')} />
      <mesh position={[-2.34, centerY(-2.34), .038]} scale={[.08, .031, .025]}><sphereGeometry args={[1, 24, 18]} /><Material color="#f5e3b3" selected={selected('buccal-cavity')} /></mesh>
    </Part>
    <Part id="rhabditoid-esophagus" onSelect={onSelectStructure}>
      <Tube points={corpus} radius={.045} color="#a9c795" selected={selected('rhabditoid-esophagus')} />
      <Tube points={isthmus} radius={.026} color="#b9d09e" selected={selected('rhabditoid-esophagus')} />
      <mesh position={[-1.3, centerY(-1.3), .025]} scale={[.17, .105, .10]}><sphereGeometry args={[1, 36, 24]} /><Material color="#bbd7a4" selected={selected('rhabditoid-esophagus')} /></mesh>
    </Part>
    <Part id="intestine" onSelect={onSelectStructure}>
      <Tube points={intestine} radius={.062} color="#739c81" selected={selected('intestine')} />
      <Tube points={lumen} radius={.014} color="#b8d4ac" selected={selected('intestine')} />
    </Part>
    <Part id="genital-primordium" onSelect={onSelectStructure}>
      {/* Prominent internal fusiform primordium; no invented nucleus or external gonad. */}
      <mesh position={[.35, -.12, .065]} scale={[.34, .105, .10]} renderOrder={2}>
        <sphereGeometry args={[1, 48, 32]} /><Material color="#e9a684" selected={selected('genital-primordium')} />
      </mesh>
      <mesh position={[.35, -.12, .065]} scale={[.349, .113, .108]} renderOrder={3}>
        <sphereGeometry args={[1, 48, 32]} /><Material color="#f4d19b" selected={selected('genital-primordium')} opacity={selected('genital-primordium') ? .24 : .12} />
      </mesh>
    </Part>
    {labels && structures.map((part) => <Part key={part.id} id={part.id} onSelect={onSelectStructure}>
      <mesh position={part.position} renderOrder={12}><sphereGeometry args={[selected(part.id) ? .037 : .024, 16, 12]} /><meshBasicMaterial color={selected(part.id) ? '#9b4d20' : '#146b55'} depthTest={false} /></mesh>
      {selected(part.id) && <mesh position={part.position} renderOrder={13}><torusGeometry args={[part.id === 'genital-primordium' ? .15 : .095, .009, 8, 48]} /><meshBasicMaterial color="#9b4d20" depthTest={false} /></mesh>}
    </Part>)}
  </group>;
}
