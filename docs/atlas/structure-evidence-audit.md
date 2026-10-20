# HelpMinths Atlas structure evidence audit

Prepared 20 October 2026. Implementation: `src/data/atlasStructures.ts`.

## Scope

The catalogue covers eleven existing reference species/groups, with 48 selectable
features (4–6 per entry). These are egg/larval morphological structures and a few
explicit shape landmarks, **not a cellular organelle map**. There is no claim that
all structures can be resolved in a single routine light-microscopy image.
Colours, representative cell counts, hook arrangements, cut surfaces and layer
spacing are schematic. Dimensions cannot be compared across model displays.

## Evidence status

CDC DPDx disease-specific pages are authoritative reference pointers for the
diagnostic morphology and developmental stages. Direct requests to CDC, NCBI,
PubMed and Europe PMC from this environment received proxy CONNECT HTTP 403.
Their live pages were **not read in this session**. Each corresponding source
record says so; do not describe these links as independently live-verified.

Actual source text was read from the local clone of the author-maintained
teaching collection:

- Repository: <https://github.com/tombuckelew/parasitology-images>
- Commit: `901b77d18f847eedc36e9c653bddb121224ff1c8`
- Author biography in its README: Dr. Thomas P. Buckelew, Professor Emeritus,
  California University of Pennsylvania.
- The `.htm` files below preserve historical teaching captions, some wrapped in
  Wayback markup. This is teaching evidence, not contemporary clinical validation.
- Image rights/provenance are handled by the photo agents separately; inclusion
  as a textual citation does not establish the rights to any image elsewhere.

## Captions actually read

All paths are under `site/Buckelew/` in that repository.

| File | Caption evidence actually present | Use/qualification |
|---|---|---|
| `Ascaris lumbricoides ova.htm` | “warty surface and developed larva inside”; fertilized and unfertilized eggs | Supports mammillated exterior and stage variation; the selectable model represents an earlier fertilized, nonlarvated egg, not every photographed stage. |
| `Trichuris trichiura ova.htm` | “easily identified by the plugged ends” | Supports bipolar plug landmark; final identification still requires full morphology. |
| `Ancylostoma duodenale ova.htm` | “The egg capsules of the hookworms are indistinguishable.” | Supports group-level hookworm classification rather than a species claim. |
| `Necator americanus ova.htm` | “bag of grapefruits” appearance | Supports the segmented cell-mass comparison. |
| `Enterobius vermicularis ova.htm` | “one side ... somewhat flattened” | Supports the planoconvex/flattened-side landmark. |
| `egg_capsule_of_a_typical_taeniid.htm` | Outer capsular wall may be lost; radiating embryophore features give striated appearance; taeniid ova indistinguishable | Supports embryophore and radial landmark; no species separation from egg alone. |
| `Vampirolepis nana ova.htm` | Filaments around embryo; visible hooks in hexacanth | Supports polar filaments and hooks. Caption describes “two polar filaments”; the catalogue does **not** adopt that number as a modern fixed count, referring to CDC for the 4–8 description. |
| `Hymenolepis diminuta ova.htm` | Capsular wall separated from embryophore; enclosed hexacanth; “no polar filaments” | Supports two-envelope structure and absence of polar filaments. |
| `egg_capsule_of_hymenolepis_dimin.htm` | “6 hooked hexacanth larva” | Supports six hooks. |
| `Fasciolopsis buski ova.htm` | “indistinguishable from Fasciola hepatica” | Supports explicit diagnostic limitation. |

`Clonorchis sinensis egg capsule.htm` was also read and describes opercular
shoulders, but is **not** cited as species evidence for O. viverrini: those are
different taxa and no image/caption is relabelled as OV.

## Decisions preventing unsupported anatomy

- **Ascaris:** outer mammillated coat, thick shell, ovum, surrounding space.
  Molecular chitin/lipid layers, exact layer counts, nuclei and mitochondria were
  not added because sufficient species-specific ultrastructure evidence was not
  accessed. Decorative cut-edge bands must not be labelled as proven molecular
  layers.
- **Trichuris:** smooth shell, bipolar plugs, unembryonated ovum and inner space.
- **Hookworm:** thin shell, blastomeres, surrounding clear space and an explicitly
  geometric ovoid-contour landmark. Selected cell count is illustrative.
- **OV:** shell, operculum, shoulders, possible abopercular knob and a developed
  miracidium. No invented organs or claim that larval cilia are identifiable in
  routine egg images.
- **MIF:** this is a heterogeneous reference group. Shell, operculum, miracidium
  and the opposite-end landmark are described at group level. A fixed OV-like
  knob/shoulder is not imposed on all MIF species. Heterophyes and Metagonimus
  sources are representative, not evidence that all MIF taxa are identical.
- **Taenia:** embryophore, radial striations, oncosphere, six hooks. No claim to
  distinguish T. solium/T. saginata from eggs.
- **Enterobius:** transparent shell, flattened side, larva, surrounding space.
- **H. nana:** outer envelope, inner embryophore, polar thickenings, polar
  filaments, oncosphere, hooks.
- **H. diminuta:** outer/inner envelopes, space between them, oncosphere, hooks;
  **no** polar filaments.
- **Echinostoma/Fasciolopsis:** shell, operculum, unembryonated ovum, vitelline
  cells for freshly passed eggs; **no developed miracidium** or adult collar
  spines. Vitelline cell counts and positions are illustrative. Egg overlap and
  the limits of species confirmation remain explicit.

## Verification completed

- Standalone TypeScript no-emit check passed.
- Runtime catalogue inspection passed: 11 expected ids, 48 features, unique
  feature ids per species, nonempty labels/descriptions, finite 3D positions,
  all source ids resolve to the 21 source records.
- Unknown species returns an empty structure list.
- Guard checks confirmed H. diminuta has no polar-filament feature and the
  freshly passed large-fluke entries have no miracidium feature.

## Renderer review follow-up (20 October 2026)

Review against `src/components/AtlasModel.tsx` identified and resolved three
visual features that could imply more evidence than the catalogue supports:

- The generic miracidium's decorative cones were removed. It now represents
  only the whole larval body, without asserting that cilia or microscopic organs
  are resolved in these species' egg images.
- Ascaris' three nested shells and extra boundary rings were removed. A single
  generic thick cut edge represents shell thickness without asserting a verified
  fixed count of molecular layers.
- The MIF opposite-end landmark no longer adds a protruding spheroid. A surface
  patch follows the actual shell contour, without giving every member of this
  heterogeneous group an OV-like knob.

The renderer owner confirmed these corrections; final browser rendering and
application integration are verified separately by the root agent.

Before clinical teaching release, a local parasitology specialist should review
the final 3D rendering and current primary sources. The catalogue alone is not a
validated diagnostic device or a clinical performance study.

## Subsequent Ascaris stage extension

`ascarisStages.ts` now provides stage-specific anatomy and an independent
decorticated state. Ascaris has seven distinct anatomical feature ids across all
variants, with only two to four shown for a given selection. The complete Atlas
therefore has 51 distinct selectable features across its developmental variants;
the static catalogue's original 48-feature audit above describes the baseline.
An actually read OpenStax reference was added alongside the earlier sources.
See [stage evidence](./ascaris-stages-evidence.md) and
[stage validation](./ascaris-stages-validation.md) for the extension's scope.
