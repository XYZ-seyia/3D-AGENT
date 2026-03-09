---
name: laser-cut-3d
description: Generate parametric laser-cut 3D structural assembly models using Three.js. Use when the user asks to create laser-cut boxes, enclosures, interlocking structures, finger joints, tab-and-slot joints, or any flat-pack assembly design.
---

# Laser-Cut 3D Structure Engine

## Project Context

Browser-based parametric engine for laser-cut assembly structures, built with vanilla HTML + Three.js (ES Modules via CDN importmap, no build tools).

## Architecture — Unified Core

The system is layered into four tiers. All model types (box, polyhedron, free panels) share the same primitives, joint kernel, and renderer.

```
UserCanvas ─────┐          ┌───── AI Agent
                │          │
                ▼          ▼
           ModelOps (js/core/model-ops.js)
           addRectPanel / addConnection / setOverride / movePrimitive
                │
                ▼
           PrimitiveLayer (js/core/schema.js)
           panel + connection — the two base primitives
                │
         ┌──────┼──────┐
         ▼      ▼      ▼
   JointKernel    Policies       Renderer
   (joint-kernel) (joint-policies) (assembly-renderer)
   finger/tab-slot  edge typing    ExtrudeGeometry + explode
   cross-slot stub  kerf policy
                ▲
                │
           MacroModels (js/core/macro-models.js)
           box → 6 panels + 12 connections
           polyhedron → N panels + shared-edge connections
```

## Code Organization

### Unified Core (js/core/)

```
js/core/
├── schema.js            # Model/primitive/connection data types, AI_WRITABLE vs SYSTEM_SOLVED fields
├── model-ops.js         # Stateless operations: addRectPanel, addConnection, setOverride, detectAutoConnections
├── joint-kernel.js      # Shape geometry: buildRectJointShape, buildPolygonJointShape, createPanelMesh
├── joint-policies.js    # Edge typing rules, kerf policy, getBoxEdgeStyles, computeSharedEdgeTypes
├── macro-models.js      # Compile box/polyhedron primitives into panel+connection assemblies
├── assembly-renderer.js # JSON assembly → THREE.Group, setExplodeFactor
└── index.js             # Re-exports everything for single-import convenience
```

### Legacy Generators (still functional, being migrated)

```
js/
├── box-generator.js        # Original box (standalone, uses joint-utils directly)
├── poly-generator.js       # Original polyhedron (standalone)
├── joint-utils.js          # Original joint shapes (superseded by core/joint-kernel.js)
├── polygon-joint-utils.js  # Original polygon joints (superseded by core/joint-kernel.js)
├── poly-data.js            # Platonic solid geometry data (shared by both old and new paths)
├── face-editor.js          # 2D canvas overlay for face decorations
├── face-decorations.js     # Decorations → Shape holes or engrave meshes
├── main.js / poly-main.js  # Scene setup for legacy pages
└── ui-controls.js / poly-ui.js  # UI bindings for legacy pages
```

### Pages

- `demo-v2.html` — AI+canvas collaborative demo (box + dividers)
- `mvp-box-demo.html` — JSON-centric MVP prototype
- `index.html` — Original box generator
- `polyhedra.html` / `polyhedra-standalone.html` — Polyhedron generators

## Key Concepts

### Primitives

Two base primitives that everything compiles down to:

- **`panel`** — A flat board with thickness, shape (rect or polygon or SVG path), pose (position + rotation), and edge information.
- **`connection`** — A relationship between two panel edges specifying joint kind (finger / tab-slot), A/B edge types, and kerf.

### Macro Models

Higher-level structures that compile into panels + connections:

- **`box`** — Compiles to 6 panels + 12 connections. Parameters: length, width, height, thickness, jointKind.
- **`polyhedron`** — Compiles to N panels + shared-edge connections. Parameters: solidType, edgeLength, thickness.

AI and users can work at either level — say "create a box" (macro) or "add a panel at position X" (primitive).

### Overrides

Manual adjustments stored separately from AI-generated data:
```json
{
  "overrides": {
    "box_1:top": { "removed": true },
    "box_1:front": { "position_offset": [0, 5, 0] }
  }
}
```
AI respects overrides and does not overwrite them.

### AI-Writable vs System-Solved Fields

Defined in `schema.js`:
- **AI can write**: primitive type, label, params, shape, thickness, pose, style, connection endpoints, joint kind
- **System solves**: compiled edge styles, mesh hints, world edge positions, auto-connection scoring

## Joint Generation Rules

### Zero-Thickness Box Model

1. Start with a zero-thickness box at dimensions L × W × H
2. Each face extrudes outward by material thickness T
3. At shared edges, both panels grow complementary (staggered) tabs

### Edge Types A and B

- **Type A**: tabs at even-indexed segments (0, 2, 4, …)
- **Type B**: tabs at odd-indexed segments (1, 3, 5, …)
- Adjacent panels always use opposite types

Box convention (from `joint-policies.js` → `getBoxEdgeStyles`):
- Front / Back: all edges A
- Left / Right: top/bottom A, front/back B
- Top / Bottom: all edges B

Polyhedra convention (from `poly-data.js`):
- For shared edge between face F1 and F2 (F1 < F2): F1 gets A, F2 gets B

### Supported Joint Kinds

| Kind | Description | Implementation |
|------|-------------|---------------|
| `finger` | Interlocking finger tabs along entire edge | `buildFingerEdgePoints` in joint-kernel.js |
| `tab-slot` | Spaced rectangular tabs | `buildTabSlotEdgePoints` in joint-kernel.js |
| `flat` | Straight edge, no joint | Returns start point only |
| `cross-slot` | Perpendicular slit (metadata only in MVP) | `buildCrossSlotMetadata` in joint-kernel.js |

## Design Constraints

1. **Material thickness (T)** is a global parameter; all joints account for it
2. **Kerf compensation**: configurable per connection (default 0)
3. **Minimum tooth width**: >= 2 × T for structural integrity
4. **No undercuts**: all geometry must be cuttable by a vertical laser beam (2D profiles only)

## Adding New Structure Types

With the unified core, adding new structures means:

1. Add a new macro compiler function in `macro-models.js` (e.g., `compileShelfMacro`)
2. It returns `{ panels: [...], connections: [...] }` — same format as box/polyhedron
3. Register the new primitive type in `compileModelToAssembly`'s switch
4. The joint kernel, renderer, and model-ops layer require NO changes

## Irregular / Custom Panels

Custom shapes are stored as panel primitives with `shape.type = 'path'`:

```json
{
  "id": "panel_7",
  "primitive": "panel",
  "shape": { "type": "path", "pathData": "M 0 0 L 40 0 ..." },
  "thickness": 3
}
```

In MVP: recordable, referenceable, movable, connectable via anchors. AI does NOT reshape arbitrary SVG paths.

## MVP Boundary

### In Scope
- Unified JSON schema (panel + connection + override)
- Box and polyhedron as macro models compiling to primitives
- Manual placement of rect panels on canvas
- Edge-snapping with auto-connection generation
- Finger joint and tab-slot joint support
- Agent outputs structured ModelOps calls only
- Override mechanism (manual edits preserved)

### Deferred
- Arbitrary irregular edge auto-jointing
- Gear/cam mechanisms
- Full SVG path editor
- Generic parametric constraint system
- AI editing arbitrary SVG paths

## Additional Resources

- For joint dimension formulas and material parameters, see [reference.md](reference.md)
