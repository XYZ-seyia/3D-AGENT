# Laser-Cut Joint Reference

## Finger Joint Formulas

Given edge length `L` and material thickness `T`:

- **Tooth count** `N`: choose odd number so both ends are the same type
- **Tooth width** `w = L / N`
- **Tooth depth** = `T` (material thickness) + kerf/2
- **Minimum recommended tooth width**: `max(2 * T, 3mm)`
- **Recommended N**: `floor(L / (3 * T))`, then adjust to nearest odd number >= 3

### Edge Type Assignment (Complementary A / B)

Both panels at a shared edge grow tabs outward, but staggered:
- Type A: tabs at even segments → type B: tabs at odd segments

Box edge type table (from `getBoxEdgeStyles` in `joint-policies.js`):

| Panel | bottom | right | top | left |
|-------|--------|-------|-----|------|
| Front | A | A | A | A |
| Back | A | A | A | A |
| Left | A | B | A | B |
| Right | A | B | A | B |
| Bottom | B | B | B | B |
| Top | B | B | B | B |

## Tab & Slot Formulas

- **Tab count** `M`: `max(2, floor(edgeLength / 30))`
- **Divisions**: `2 * M + 1`
- **Tab depth** = `T` + kerf/2
- Type A: tabs at odd-indexed divisions; Type B: tabs at even-indexed divisions

## Material Parameters

| Material | Typical Thickness | Kerf | Min Detail |
|----------|------------------|------|------------|
| Plywood | 3mm, 5mm | 0.15mm | 1mm |
| Acrylic | 3mm, 5mm | 0.10mm | 0.5mm |
| MDF | 3mm, 6mm | 0.20mm | 1mm |
| Cardboard | 1.5mm, 2mm | 0.30mm | 2mm |

## Panel Dimension Rules

Zero-thickness box model: L × W × H are the inner box dimensions.
Each face extrudes outward by T. All panels are **full face size**:

- **Front/Back panels**: width = `L`, height = `H`
- **Left/Right panels**: width = `W`, height = `H`
- **Top/Bottom panels**: width = `L`, depth = `W`

Staggered tabs at every edge resolve corner overlaps automatically.

## Platonic Solids — Edge Type Assignment

For polyhedra, edge types are assigned globally per shared edge:
- Each edge is shared by exactly two faces, F1 and F2
- The face with the **lower index** gets type **A**; the other gets type **B**
- This guarantees complementary tabs on every shared edge regardless of the solid type

### Outward Normal for Polygon Edges (2D)

For a CCW polygon, the outward normal of edge `v[i] → v[i+1]` is:

```
edgeDx = v[i+1].x - v[i].x
edgeDy = v[i+1].y - v[i].y
len = √(edgeDx² + edgeDy²)
outX =  edgeDy / len    // rotate -90°
outY = -edgeDx / len
```

## Unified Data Model Reference

### Model JSON Structure

```json
{
  "version": "0.2.0",
  "primitives": [
    {
      "id": "box_1",
      "primitive": "box",
      "params": { "length": 200, "width": 150, "height": 100, "thickness": 3, "jointKind": "finger" }
    },
    {
      "id": "panel_7",
      "primitive": "panel",
      "shape": { "type": "rect", "width": 80, "height": 60 },
      "thickness": 3,
      "pose": { "position": [0, 0, 0], "rotation": [0, 0, 0] },
      "style": { "color": 11326081 }
    }
  ],
  "connections": [
    {
      "id": "conn_1",
      "panelA": "panel_7", "edgeA": "right",
      "panelB": "panel_8", "edgeB": "left",
      "joint": { "kind": "finger", "kerf": 0, "edgeTypes": ["A", "B"] }
    }
  ],
  "overrides": {
    "box_1:top": { "removed": true, "note": "open-top box" }
  },
  "decorations": {
    "box_1:front": [
      { "type": "circle", "cx": 50, "cy": 30, "radius": 10, "mode": "cut" }
    ]
  },
  "meta": { "name": "My Structure", "source": "agent+manual", "tags": ["box"] }
}
```

### Compiled Assembly Panel Format

After `compileModelToAssembly(model)`, each panel in the assembly has:

```javascript
{
  id: "box_1:front",
  label: "前面板",
  thickness: 3,
  color: 0xef9a9a,
  position: [-100, 0, -78],
  rotation: [0, 0, 0],
  explodeDir: [0, 0, -1],
  shape: { type: "rect", width: 200, height: 100 },
  edgeStyles: {
    bottom: { jointKind: "finger", edgeType: "A", kerf: 0 },
    right:  { jointKind: "finger", edgeType: "A", kerf: 0 },
    top:    { jointKind: "finger", edgeType: "A", kerf: 0 },
    left:   { jointKind: "finger", edgeType: "A", kerf: 0 },
  },
  holes: null,
  removed: false,
  meta: { sourcePrimitive: "box_1", panelKey: "front", kind: "macro-panel" }
}
```

### Face Decoration Modes

| Mode | Effect | Implementation |
|------|--------|---------------|
| Cut (切割) | Through-hole in the panel | `THREE.Path` added to `shape.holes` |
| Engrave (雕刻) | Shallow depression on surface | Separate `THREE.Mesh` with depth ≈ T/6 |

### Decoration Data Schema

```javascript
{ type: 'circle', cx, cy, radius, rotation, mode: 'cut'|'engrave' }
{ type: 'rect', x, y, width, height, rotation, mode: 'cut'|'engrave' }
{ type: 'star', cx, cy, outerR, innerR, points, rotation, mode: 'cut'|'engrave' }
{ type: 'text', x, y, content, fontSize, rotation, mode: 'cut'|'engrave' }
```
