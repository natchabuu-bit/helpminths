import { Component, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ComponentRef, type CSSProperties, type ErrorInfo, type ReactNode } from 'react';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { BufferGeometry, DoubleSide, Euler, Float32BufferAttribute, PerspectiveCamera, RingGeometry, SphereGeometry, Vector3 } from 'three';
import { Box } from 'lucide-react';
import type { ParasiteSpecies } from '../data/species';
import { getAtlasStructures } from '../data/atlasStructures';
import { getAscarisStructures, type AscarisStageId } from '../data/ascarisStages';
import EggIllustration from './EggIllustration';
import AscarisStageIllustration from './AscarisStageIllustration';

export interface AtlasModelProps {
  item: ParasiteSpecies;
  cutaway: boolean;
  autoRotate: boolean;
  resetKey: number;
  selectedStructureId: string | null;
  onSelectStructure: (id: string) => void;
  /** A relative magnification. Wheel and pinch gestures remain available. */
  zoom: number;
  labels: boolean;
  ascarisStage?: AscarisStageId;
  ascarisDecorticated?: boolean;
}

type Triple = [number, number, number];
const MODEL_ROTATION: Triple = [.09, -.08, -.18];
const SELECTION_COLOR = '#9debd8';

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
  componentDidCatch(_error: Error, _info: ErrorInfo) { /* The local illustration also works without WebGL. */ }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

function dimensions(id: string, ascarisStage: AscarisStageId = 'fertilized'): Triple {
  if (id === 'ascaris' && ascarisStage === 'unfertilized') return [1.72, .78, .72];
  if (id === 'taenia') return [1, 1, 1];
  if (id === 'trichuris') return [1.5, .62, .62];
  if (id === 'enterobius') return [1.55, .74, .64];
  if (id === 'opisthorchis') return [1.35, .68, .62];
  if (id === 'mif') return [1.27, .69, .62];
  if (id === 'hymenolepis-nana') return [.98, .94, .9];
  if (id === 'hymenolepis-diminuta') return [1.1, .95, .87];
  if (id === 'echinostoma') return [1.4, .8, .75];
  if (id === 'fasciolopsis') return [1.65, .76, .7];
  return [1.4, .86, .79];
}

/** The front hemisphere is omitted in section view; the outline is not a literal histological slice. */
function eggGeometry(id: string, cutaway: boolean, ascarisStage: AscarisStageId = 'fertilized') {
  const scale = dimensions(id, ascarisStage);
  const geometry = new SphereGeometry(1, 64, 40, cutaway ? Math.PI : 0, cutaway ? Math.PI : Math.PI * 2);
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
    let nextY = y;
    if (id === 'enterobius' && nextY < -.34) nextY = -.34 + (nextY + .34) * .075;
    const asymmetry = id === 'opisthorchis' ? 1 + x * .12 : id === 'mif' ? 1 + x * .08 : 1;
    const taper = id === 'trichuris' ? .88 + .12 * (1 - x * x) : asymmetry;
    positions.setXYZ(i, x * scale[0], nextY * scale[1] * taper, z * scale[2] * taper);
  }
  geometry.computeVertexNormals();
  return geometry;
}

interface PartProps {
  id: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  resolveId?: (event: ThreeEvent<MouseEvent>) => string;
  children: ReactNode;
}

/** Attach picking to the actual anatomical meshes, including every hook or filament. */
function Part({ id, onSelect, resolveId, children }: PartProps) {
  const { gl } = useThree();
  const select = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    onSelect(resolveId?.(event) ?? id);
  };
  return <group
    name={`atlas-structure-${id}`}
    onClick={select}
    onPointerOver={(event) => { event.stopPropagation(); gl.domElement.style.cursor = 'pointer'; }}
    onPointerOut={() => { gl.domElement.style.cursor = 'grab'; }}
  >{children}</group>;
}

function Surface({ color, selected = false, opacity = 1, shell = false }: { color: string; selected?: boolean; opacity?: number; shell?: boolean }) {
  return <meshPhysicalMaterial
    color={color}
    roughness={shell ? .45 : .69}
    clearcoat={shell ? .24 : .06}
    transparent={opacity < 1}
    opacity={opacity}
    depthWrite={opacity >= 1}
    side={DoubleSide}
    emissive={selected ? SELECTION_COLOR : '#000000'}
    emissiveIntensity={selected ? .4 : 0}
  />;
}

function CurveTube({ points, color, radius = .055, selected = false }: { points: Vector3[]; color: string; radius?: number; selected?: boolean }) {
  const geometry = useMemo(() => {
    const vertices: number[] = [], normals: number[] = [], indices: number[] = [];
    points.forEach((point, i) => {
      const tangent = points[Math.min(i + 1, points.length - 1)].clone().sub(points[Math.max(i - 1, 0)]).normalize();
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
  return <mesh geometry={geometry}><Surface color={color} selected={selected} /></mesh>;
}

/** The tinted annulus marks an empty space, rather than inventing another tissue layer. */
function SpaceRegion({ scale, selected, inner = .64, outer = .86, flattened = false }: { scale: Triple; selected: boolean; inner?: number; outer?: number; flattened?: boolean }) {
  const geometry = useMemo(() => {
    const value = new RingGeometry(inner, outer, 80);
    if (flattened) {
      const positions = value.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        const y = positions.getY(i);
        if (y < -.34) positions.setY(i, -.34 + (y + .34) * .075);
      }
    }
    return value;
  }, [inner, outer, flattened]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh geometry={geometry} position={[0, 0, .24]} scale={[scale[0], scale[1], 1]} renderOrder={7}>
    <meshBasicMaterial color={SELECTION_COLOR} transparent opacity={selected ? .29 : .035} side={DoubleSide} depthWrite={false} />
  </mesh>;
}

function Larva({ selected }: { selected: boolean }) {
  const points = useMemo(() => Array.from({ length: 105 }, (_, i) => {
    const progress = i / 104;
    const angle = progress * Math.PI * 3.4;
    const radius = .67 * (1 - i / 170);
    return new Vector3(Math.cos(angle) * radius * 1.35, Math.sin(angle) * radius * .38 + .04, .15 + Math.sin(progress * Math.PI) * .035);
  }), []);
  return <CurveTube points={points} color="#a7b281" radius={.076} selected={selected} />;
}

function Miracidium({ small, selected }: { small: boolean; selected: boolean }) {
  return <group scale={small ? [.92, 1, 1] : [1, 1, 1]}>
    <mesh scale={[.81, .34, .29]}><sphereGeometry args={[1, 44, 30]} /><Surface color="#b0a062" selected={selected} /></mesh>
  </group>;
}

/** A granular ovum is shown schematically, without unsupported nuclear or organelle detail. */
function Ovum({ selected, largeFluke = false }: { selected: boolean; largeFluke?: boolean }) {
  const scale: Triple = largeFluke ? [.19, .17, .15] : [.77, .46, .4];
  return <group position={largeFluke ? [-.13, .04, .34] : [0, 0, 0]}>
    <mesh scale={scale}><sphereGeometry args={[1, 40, 28]} /><Surface color={largeFluke ? '#c8bd85' : '#9da774'} selected={selected} /></mesh>
    {!largeFluke && Array.from({ length: 25 }, (_, i) => {
      const angle = i * Math.PI * (3 - Math.sqrt(5));
      const radius = Math.sqrt((i + .5) / 25);
      return <mesh key={i} position={[Math.cos(angle) * radius * .67, Math.sin(angle) * radius * .39, Math.sqrt(1 - radius * radius) * .38]}>
        <sphereGeometry args={[.027 + i % 3 * .006, 8, 6]} /><Surface color="#b9bf8e" selected={selected} />
      </mesh>;
    })}
  </group>;
}

/** Irregular refractile contents illustrate an unfertilized ovum, not blastomeres or organelles. */
function UnfertilizedContents({ selected }: { selected: boolean }) {
  const granules = useMemo(() => Array.from({ length: 73 }, (_, i) => {
    const angle = i * Math.PI * (3 - Math.sqrt(5));
    const radius = Math.sqrt((i + .5) / 73);
    return [Math.cos(angle) * radius * 1.27, Math.sin(angle) * radius * .53, .08 + Math.sin(i * 1.7) * .22] as Triple;
  }), []);
  return <group>{granules.map((position, i) => <mesh key={i} position={position} scale={[1.15 + i % 3 * .12, .8, .8]}>
    <sphereGeometry args={[.059 + i % 4 * .013, 12, 10]} /><Surface color={['#a39b69', '#d1bd8c', '#8d8c5b', '#b4a777'][i % 4]} selected={selected} />
  </mesh>)}</group>;
}

/** Four cells show one illustrative cleavage configuration, not a diagnostic fixed count. */
function AscarisBlastomeres({ selected }: { selected: boolean }) {
  return <group>{([[-.33, .23, .03], [.31, .23, -.03], [-.33, -.22, .08], [.31, -.22, .08]] as Triple[]).map((position, i) => <mesh key={i} position={position} scale={[1.15, .83, .87]}>
    <sphereGeometry args={[.34, 32, 24]} /><Surface color={i % 2 ? '#aeb68a' : '#919e70'} selected={selected} />
  </mesh>)}</group>;
}

function YolkCells({ scale, selected }: { scale: Triple; selected: boolean }) {
  const cells = useMemo(() => Array.from({ length: 68 }, (_, i) => {
    const angle = i * Math.PI * (3 - Math.sqrt(5));
    const distance = Math.sqrt((i + .5) / 68);
    return [Math.cos(angle) * distance * scale[0] * .68, Math.sin(angle) * distance * scale[1] * .7, .08 + Math.sin(i * 1.71) * .18] as Triple;
  }), [scale[0], scale[1], scale[2]]);
  return <group>{cells.map((position, i) => <mesh key={i} position={position} scale={[1.12, .9, .8]}>
    <sphereGeometry args={[.069 + i % 3 * .009, 12, 10]} /><Surface color={['#d7c18b', '#bba36c', '#9d8b58'][i % 3]} selected={selected} />
  </mesh>)}</group>;
}

function Oncosphere({ taenia, selectedId, onSelect }: { taenia: boolean; selectedId: string | null; onSelect: (id: string) => void }) {
  const hooks = useMemo(() => Array.from({ length: 6 }, (_, n) => Array.from({ length: 20 }, (_, j) => {
    const t = j / 19;
    const direction = n % 2 ? -1 : 1;
    const pair = Math.floor(n / 2) - 1;
    return new Vector3(pair * .17 + Math.sin(t * Math.PI) * .065, direction * (.025 + t * .23), .453 + Math.sin(t * Math.PI) * .025);
  })), []);
  return <group scale={taenia ? 1 : .86}>
    <Part id="embryo" selectedId={selectedId} onSelect={onSelect}>
      <mesh scale={[.49, .47, .44]}><sphereGeometry args={[1, 44, 30]} /><Surface color="#9faa79" selected={selectedId === 'embryo'} /></mesh>
    </Part>
    <Part id="hooks" selectedId={selectedId} onSelect={onSelect}>
      {hooks.map((points, i) => <CurveTube key={i} points={points} color="#f3e2ad" radius={.023} selected={selectedId === 'hooks'} />)}
    </Part>
  </group>;
}

function PolarFilaments({ selected }: { selected: boolean }) {
  const filaments = useMemo(() => [-1, 1].flatMap((direction) => Array.from({ length: 4 }, (_, n) => Array.from({ length: 65 }, (_, j) => {
    const t = j / 64;
    const angle = t * Math.PI * (1.7 + n * .14) + n * .72;
    return new Vector3(direction * (.59 + Math.sin(t * Math.PI) * .19 + Math.sin(angle) * .065), Math.sin(angle) * (.16 + t * .17), .18 + n * .025);
  }))), []);
  return <group>{filaments.map((points, i) => <CurveTube key={i} points={points} color="#f3e7c0" radius={selected ? .019 : .014} selected={selected} />)}</group>;
}

function Egg({ item, cutaway, selectedStructureId, onSelectStructure, labels, ascarisStage = 'fertilized', ascarisDecorticated = false }: Pick<AtlasModelProps, 'item' | 'cutaway' | 'selectedStructureId' | 'onSelectStructure' | 'labels' | 'ascarisStage' | 'ascarisDecorticated'>) {
  const shellGeometry = useMemo(() => eggGeometry(item.id, cutaway, ascarisStage), [item.id, cutaway, ascarisStage]);
  useEffect(() => () => shellGeometry.dispose(), [shellGeometry]);
  const scale = dimensions(item.id, ascarisStage);
  const terminalPatch = useMemo(() => {
    if (item.id !== 'mif') return null;
    // Reuse the actual shell contour at the end. A new knob is not a shared MIF feature.
    const geometry = shellGeometry.clone();
    const positions = geometry.attributes.position;
    const source = geometry.index;
    const indices: number[] = [];
    if (source) for (let i = 0; i < source.count; i += 3) {
      const triangle = [source.getX(i), source.getX(i + 1), source.getX(i + 2)];
      if (triangle.every((vertex) => positions.getX(vertex) > dimensions('mif')[0] * .89)) indices.push(...triangle);
    }
    geometry.setIndex(indices);
    return geometry;
  }, [item.id, shellGeometry]);
  useEffect(() => () => terminalPatch?.dispose(), [terminalPatch]);
  const structures = item.id === 'ascaris' ? getAscarisStructures(ascarisStage, ascarisDecorticated) : getAtlasStructures(item.id);
  const has = (id: string) => structures.some((structure) => structure.id === id);
  const selected = (id: string) => selectedStructureId === id;
  const partProps = { selectedId: selectedStructureId, onSelect: onSelectStructure };
  const isOV = item.id === 'opisthorchis';
  const isMIF = item.id === 'mif';
  const isNana = item.id === 'hymenolepis-nana';
  const isDiminuta = item.id === 'hymenolepis-diminuta';
  const isHymenolepis = isNana || isDiminuta;
  const isLargeFluke = item.id === 'echinostoma' || item.id === 'fasciolopsis';
  const shellId = isHymenolepis ? 'outer-membrane' : item.id === 'taenia' ? 'embryophore' : 'shell';
  const bumps = useMemo(() => Array.from({ length: 105 }, (_, i) => {
    const y = 1 - i / 104 * 2, radius = Math.sqrt(1 - y * y), theta = Math.PI * (3 - Math.sqrt(5)) * i;
    return new Vector3(Math.cos(theta) * radius * scale[0], y * scale[1], Math.sin(theta) * radius * scale[2]);
  }), [scale[0], scale[1], scale[2]]);
  return <group rotation={MODEL_ROTATION}>
    <Part id={shellId} {...partProps} resolveId={isMIF ? (event) => {
      // The terminal surface is the same shell, so resolve the actual hit point
      // instead of adding a raised object merely to make it pickable.
      const localPoint = event.object.worldToLocal(event.point.clone());
      return localPoint.x > scale[0] * .89 ? 'abopercular-end' : shellId;
    } : undefined}>
      <mesh geometry={shellGeometry} renderOrder={4}>
        <Surface color={item.color} shell selected={selected(shellId)} opacity={cutaway ? .77 : .44} />
      </mesh>
      {cutaway && item.id !== 'enterobius' && <mesh scale={[scale[0], scale[1], 1]} position={[0, 0, .005]}>
        {/* One schematic cut edge shows thickness without asserting histological layer counts. */}
        <ringGeometry args={[item.id === 'ascaris' && ascarisStage === 'unfertilized' ? .955 : item.id === 'taenia' || item.id === 'ascaris' ? .88 : .965, 1, 80]} /><Surface color={item.color} selected={selected(shellId)} />
      </mesh>}
    </Part>
    {item.id === 'ascaris' && !ascarisDecorticated && <Part id="mammillated-coat" {...partProps}>
      {bumps.filter((point) => !cutaway || point.z < .025).map((position, i) => <mesh key={i} position={position} scale={[1, .8, .8]}>
        <sphereGeometry args={[.08 + i % 3 * .012, 8, 7]} /><Surface color={i % 3 === 0 ? '#e2b57e' : '#c4945c'} selected={selected('mammillated-coat')} opacity={.95} />
      </mesh>)}
    </Part>}
    {item.id === 'trichuris' && <Part id="polar-plugs" {...partProps}>
      {[-1, 1].map((direction) => <group key={direction} position={[direction * 1.46, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <mesh scale={[.18, .24, .18]}><sphereGeometry args={[1, 28, 22]} /><Surface color="#ead6ad" shell selected={selected('polar-plugs')} opacity={.94} /></mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[.18, .031, 10, 32]} /><Surface color="#c49a61" selected={selected('polar-plugs')} /></mesh>
      </group>)}
    </Part>}
    {item.id === 'hookworm' && <>
      <Part id="blastomeres" {...partProps}>
        {([[-.48, .15, .02], [0, .25, -.06], [.45, .08, .01], [-.33, -.26, .12], [.18, -.21, .15], [.12, .03, -.25]] as Triple[]).map((position, i) => <mesh key={i} position={position} scale={[1, .91, .85]}>
          <sphereGeometry args={[.31, 28, 22]} /><Surface color={i % 2 ? '#aab487' : '#8e9c74'} selected={selected('blastomeres')} />
        </mesh>)}
      </Part>
      <Part id="ovoid-contour" {...partProps}><mesh scale={[scale[0], scale[1], 1]} position={[0, 0, .012]}>
        <torusGeometry args={[1, selected('ovoid-contour') ? .023 : .012, 8, 80]} /><Surface color="#e9dfc2" selected={selected('ovoid-contour')} />
      </mesh></Part>
    </>}
    {item.id === 'enterobius' && <>
      <Part id="larval-body" {...partProps}><Larva selected={selected('larval-body')} /></Part>
      <Part id="flattened-side" {...partProps}><mesh position={[0, -.282, .015]} scale={[1.34, .018, .48]}>
        <sphereGeometry args={[1, 40, 16]} /><Surface color="#dbd5b7" selected={selected('flattened-side')} opacity={selected('flattened-side') ? .85 : .4} />
      </mesh></Part>
    </>}
    {(item.id === 'trichuris' || (item.id === 'ascaris' && ascarisStage === 'fertilized')) && <Part id="ovum" {...partProps}><Ovum selected={selected('ovum')} /></Part>}
    {item.id === 'ascaris' && ascarisStage === 'unfertilized' && <Part id="granular-contents" {...partProps}><UnfertilizedContents selected={selected('granular-contents')} /></Part>}
    {item.id === 'ascaris' && ascarisStage === 'cleavage' && <Part id="blastomeres" {...partProps}><AscarisBlastomeres selected={selected('blastomeres')} /></Part>}
    {item.id === 'ascaris' && ascarisStage === 'embryonated' && <Part id="larval-body" {...partProps}><Larva selected={selected('larval-body')} /></Part>}
    {has('perivitelline-space') && <Part id="perivitelline-space" {...partProps}>
      <SpaceRegion scale={scale} selected={selected('perivitelline-space')} inner={item.id === 'enterobius' ? .67 : .64} flattened={item.id === 'enterobius'} />
    </Part>}
    {(isOV || isMIF) && <Part id="miracidium" {...partProps}><Miracidium small={isMIF} selected={selected('miracidium')} /></Part>}
    {isLargeFluke && <>
      <Part id="yolk-cells" {...partProps}><YolkCells scale={scale} selected={selected('yolk-cells')} /></Part>
      <Part id="ovum" {...partProps}><Ovum selected={selected('ovum')} largeFluke /></Part>
    </>}
    {(item.id === 'taenia' || isHymenolepis) && <Oncosphere taenia={item.id === 'taenia'} selectedId={selectedStructureId} onSelect={onSelectStructure} />}
    {isHymenolepis && <>
      <Part id="inner-membrane" {...partProps}>
        <mesh scale={isNana ? [.6, .65, .6] : [.66, .65, .59]} renderOrder={3}>
          <sphereGeometry args={[1, 48, 32, cutaway ? Math.PI : 0, cutaway ? Math.PI : Math.PI * 2]} />
          <Surface color={isNana ? '#e1d7b3' : '#d8be7e'} shell selected={selected('inner-membrane')} opacity={cutaway ? .56 : .24} />
        </mesh>
        {cutaway && <mesh scale={isNana ? [.6, .65, 1] : [.66, .65, 1]} position={[0, 0, .018]}>
          <ringGeometry args={[.965, 1, 72]} /><Surface color="#e2ce9b" selected={selected('inner-membrane')} />
        </mesh>}
      </Part>
      {isDiminuta && <>
        <Part id="outer-membrane" {...partProps}><mesh geometry={shellGeometry} scale={.94} renderOrder={3}>
          <Surface color="#e3c484" shell selected={selected('outer-membrane')} opacity={.24} />
        </mesh></Part>
        <Part id="intermembrane-space" {...partProps}><SpaceRegion scale={scale} inner={.7} outer={.91} selected={selected('intermembrane-space')} /></Part>
      </>}
      {isNana && <>
        <Part id="polar-thickenings" {...partProps}>{[-1, 1].map((direction) => <mesh key={direction} position={[direction * .59, 0, .1]} scale={[.055, .14, .1]}>
          <sphereGeometry args={[1, 24, 18]} /><Surface color="#e8dcb6" selected={selected('polar-thickenings')} />
        </mesh>)}</Part>
        <Part id="polar-filaments" {...partProps}><PolarFilaments selected={selected('polar-filaments')} /></Part>
      </>}
    </>}
    {(isOV || isMIF || isLargeFluke) && <>
      <Part id="operculum" {...partProps}><mesh position={[-scale[0] * .88, 0, 0]} scale={[scale[0] * .15, scale[1] * .49, scale[2] * .49]}>
        <sphereGeometry args={[1, 32, 24]} /><Surface color="#e4c689" shell selected={selected('operculum')} opacity={.94} />
      </mesh></Part>
      <Part id={isOV ? 'opercular-shoulders' : 'operculum'} {...partProps}>
        <mesh position={[-scale[0] * .88, 0, 0]} rotation={[0, Math.PI / 2, 0]} scale={[scale[2] / scale[1], 1, 1]}>
          <torusGeometry args={[scale[1] * .49, isOV ? .036 : .016, 12, 48]} />
          <Surface color={isOV ? '#91662e' : '#b59a60'} selected={selected(isOV ? 'opercular-shoulders' : 'operculum')} />
        </mesh>
      </Part>
    </>}
    {isOV && <Part id="abopercular-knob" {...partProps}><mesh position={[1.36, 0, 0]} scale={[.1, .075, .075]}>
      <sphereGeometry args={[1, 24, 18]} /><Surface color="#dfbd72" selected={selected('abopercular-knob')} />
    </mesh></Part>}
    {isMIF && terminalPatch && <Part id="abopercular-end" {...partProps}><mesh geometry={terminalPatch} scale={1.001} renderOrder={5}>
      <Surface color={item.color} selected={selected('abopercular-end')} opacity={selected('abopercular-end') ? .95 : .24} />
    </mesh></Part>}
    {item.id === 'taenia' && <Part id="radial-striations" {...partProps}>
      {Array.from({ length: 48 }, (_, i) => {
        const angle = i / 48 * Math.PI * 2;
        return <mesh key={i} position={[Math.cos(angle) * .955, Math.sin(angle) * .955, .01]} rotation={[0, 0, angle]} scale={[.075, .023, cutaway ? .11 : .19]}>
          <sphereGeometry args={[1, 10, 8]} /><Surface color={i % 3 ? '#d3a76d' : '#805831'} selected={selected('radial-striations')} />
        </mesh>;
      })}
    </Part>}
    {labels && structures.filter((structure) => !structure.internal || cutaway).map((structure) => <Part key={structure.id} id={structure.id} {...partProps}>
      <mesh position={structure.position} renderOrder={12}>
        <sphereGeometry args={[selected(structure.id) ? .052 : .029, 16, 12]} />
        <meshBasicMaterial color={selected(structure.id) ? '#effff9' : SELECTION_COLOR} depthTest={false} transparent opacity={selected(structure.id) ? 1 : .7} />
      </mesh>
      {selected(structure.id) && <mesh position={structure.position} renderOrder={13}>
        <torusGeometry args={[.105, .012, 8, 40]} /><meshBasicMaterial color={SELECTION_COLOR} depthTest={false} />
      </mesh>}
    </Part>)}
  </group>;
}

function Scene(props: AtlasModelProps) {
  const { item, resetKey, zoom, selectedStructureId, autoRotate, ascarisStage = 'fertilized', ascarisDecorticated = false } = props;
  const specimenKey = item.id === 'ascaris' ? `${item.id}:${ascarisStage}` : item.id;
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const previous = useRef<{ id: string; resetKey: number; width: number; height: number; zoom: number; selected: string | null } | null>(null);
  const { camera, size, gl } = useThree();
  const aspect = Math.max(size.width, 1) / Math.max(size.height, 1);
  const halfFov = (camera instanceof PerspectiveCamera ? camera.getEffectiveFOV() : 38) * Math.PI / 360;
  const limitingAngle = Math.atan(Math.tan(halfFov) * Math.min(aspect, 1));
  const framedRadius = Math.max(...dimensions(item.id, ascarisStage)) * 1.15;
  const frameDistance = Math.max(5.3, framedRadius / Math.sin(limitingAngle) * 1.06);
  const magnification = Math.max(.6, Math.min(2.5, zoom));
  const selectedPosition = useMemo(() => {
    const structures = item.id === 'ascaris' ? getAscarisStructures(ascarisStage, ascarisDecorticated) : getAtlasStructures(item.id);
    const structure = structures.find((entry) => entry.id === selectedStructureId);
    return structure ? new Vector3(...structure.position).applyEuler(new Euler(...MODEL_ROTATION)) : new Vector3();
  }, [item.id, selectedStructureId, ascarisStage, ascarisDecorticated]);
  useEffect(() => {
    const orbit = controls.current;
    if (!orbit) return;
    const prior = previous.current;
    const reframe = !prior || prior.id !== specimenKey || prior.resetKey !== resetKey || prior.width !== size.width || prior.height !== size.height;
    if (reframe) {
      // Reframing respects portrait stages; toggles never change the camera.
      camera.position.set(0, .15, frameDistance / magnification);
      orbit.target.set(0, 0, 0);
    } else if (prior.selected !== selectedStructureId) {
      // Keep the current viewing direction, and focus the actual selected structure.
      const offset = camera.position.clone().sub(orbit.target);
      const distance = selectedStructureId ? Math.min(offset.length(), frameDistance / magnification * .82) : frameDistance / magnification;
      orbit.target.copy(selectedPosition);
      camera.position.copy(selectedPosition).add(offset.normalize().multiplyScalar(Math.max(1.5, distance)));
    } else if (prior.zoom !== magnification) {
      const offset = camera.position.clone().sub(orbit.target);
      camera.position.copy(orbit.target).add(offset.multiplyScalar(prior.zoom / magnification));
    }
    orbit.update();
    previous.current = { id: specimenKey, resetKey, width: size.width, height: size.height, zoom: magnification, selected: selectedStructureId };
  }, [camera, specimenKey, resetKey, size.width, size.height, magnification, selectedStructureId, selectedPosition, frameDistance]);
  useEffect(() => {
    gl.domElement.style.cursor = 'grab';
    return () => { gl.domElement.style.cursor = ''; };
  }, [gl]);
  return <>
    <ambientLight intensity={1.15} />
    <directionalLight position={[-3, 4, 5]} intensity={2.6} color="#fff1d9" />
    <directionalLight position={[4, 1, -2]} intensity={2.2} color="#9de9dc" />
    <pointLight position={[0, -3, 2]} intensity={7} color="#80aaa1" />
    <Egg {...props} />
    <OrbitControls ref={controls} makeDefault enablePan={false} minDistance={1.5} maxDistance={Math.max(18, frameDistance * 2)} autoRotate={autoRotate} autoRotateSpeed={.7} enableDamping dampingFactor={.07} zoomSpeed={.8} />
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

export default function AtlasModel(props: AtlasModelProps) {
  const [available, setAvailable] = useState(webGLAvailable);
  const onContextLost = useCallback(() => setAvailable(false), [setAvailable]);
  const fallback = <div className="atlas-svg-fallback" style={{ '--atlas-fallback-zoom': Math.max(.6, Math.min(2.5, props.zoom)) } as CSSProperties}>
    {props.item.id === 'ascaris' ? <AscarisStageIllustration stage={props.ascarisStage ?? 'fertilized'} decorticated={props.ascarisDecorticated} showInternal={props.cutaway} /> : <EggIllustration speciesId={props.item.id} showInternal={props.cutaway} />}
    <span><Box size={14} /> ภาพวาดจำลอง 2 มิติ · อุปกรณ์นี้ไม่รองรับ WebGL</span>
  </div>;
  if (!available) return fallback;
  return <ModelBoundary fallback={fallback}>
    <Canvas camera={{ position: [0, .15, 5.3], fov: 38 }} dpr={[1, 1.7]} gl={{ antialias: true, alpha: true }} fallback={fallback}>
      <CanvasContextGuard onLost={onContextLost} />
      <Suspense fallback={null}><Scene {...props} /></Suspense>
    </Canvas>
  </ModelBoundary>;
}
