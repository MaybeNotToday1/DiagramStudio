import { attributePositions, defaultLayout, nodeSize, sceneFor, sceneBounds } from './scene'
import { clone, fieldDisplayName, visibleDocument, type Entity, type ErDocument, type Position } from './model'

export type LayoutTemplate = 'horizontal' | 'vertical'
function flowAttributes(entity: Entity, center: Position, doc: ErDocument, template: LayoutTemplate) {
  const count = entity.fields.length
  if (!count) return {}
  const displayed = { ...entity, fields: entity.fields.map(f => ({ ...f, label: fieldDisplayName(f, doc) })) }
  const axis = template === 'horizontal' ? 'y' : 'x', size = template === 'horizontal' ? 'height' : 'width'
  let phase = 0, best = -1
  if (doc.style.attributeLayout === 'circular') for (let i = 0; i < 64; i++) {
    const candidate = i * Math.PI * 2 / count / 64
    const clearance = Math.min(...entity.fields.map((_, n) => Math.abs((axis === 'y' ? Math.sin : Math.cos)(-Math.PI / 2 + candidate + n * Math.PI * 2 / count))))
    if (clearance > best + 1e-8) { best = clearance; phase = candidate }
  }
  const points = attributePositions(displayed, center, doc.style, phase)
  const sizes = displayed.fields.map(f => nodeSize(f.label, doc.style.fontSize, 'attribute', doc.style))
  if (doc.style.attributeLayout === 'circular') {
    const scale = Math.max(1, ...displayed.fields.map((f, i) => (sizes[i][size] / 2 + 30) / Math.max(1, Math.abs(points[f.id][axis] - center[axis]))))
    for (const p of Object.values(points)) p[axis] = center[axis] + (p[axis] - center[axis]) * scale
  } else {
    const shift = Math.max(0, 30 - Math.min(...displayed.fields.map((f, i) => points[f.id][axis] - center[axis] - sizes[i][size] / 2)))
    for (const p of Object.values(points)) p[axis] += shift
  }
  return points
}
export function restoreDefaultLayout(document: ErDocument): ErDocument {
  const doc = clone(document)
  doc.layout = { ...defaultLayout(doc), ...doc.initialLayout }
  doc.labelLayout = {}
  return doc
}
export async function beautify(document: ErDocument, template: LayoutTemplate = 'horizontal'): Promise<ErDocument> {
  const { default: ELK } = await import('elkjs/lib/elk.bundled.js')
  const doc = clone(document), visible = visibleDocument(doc), elk = new ELK(), layout = defaultLayout(visible)
  for (const entity of visible.entities) Object.assign(layout, flowAttributes(entity, layout[entity.id], doc, template))
  const scene = sceneFor({ ...visible, layout })
  const bounds = new Map(visible.entities.map(e => {
    const b = sceneBounds({ nodes: scene.nodes.filter(n => n.id === e.id || n.parent === e.id), edges: [] }, 0), center = layout[e.id]
    const width = Math.max(center.x - b.x, b.x + b.width - center.x) * 2, height = Math.max(center.y - b.y, b.y + b.height - center.y) * 2
    return [e.id, { x: center.x - width / 2, y: center.y - height / 2, width, height }]
  }))
  const relationships = doc.style.showRelationships ? visible.relationships : []
  // Diamonds occupy their own space between complete entity/attribute groups.
  const relationSizes = new Map(scene.nodes.filter(n => n.kind === 'relationship').map(n => [n.id, n]))
  const result = await elk.layout({
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered', 'elk.direction': template === 'horizontal' ? 'RIGHT' : 'DOWN',
      'elk.spacing.nodeNode': String(90 * doc.style.spacing), 'elk.spacing.componentComponent': String(100 * doc.style.spacing),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(90 * doc.style.spacing), 'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
    },
    children: [
      ...visible.entities.map(e => ({ id: e.id, width: bounds.get(e.id)!.width, height: bounds.get(e.id)!.height })),
      ...relationships.map(r => ({ id: r.id, width: relationSizes.get(r.id)!.width + 60, height: relationSizes.get(r.id)!.height + 40 })),
    ],
    edges: relationships.flatMap(r => [
      { id: `${r.id}-source`, sources: [r.from], targets: [r.id] },
      { id: `${r.id}-target`, sources: [r.id], targets: [r.to] },
    ]),
  })
  const boxes = new Map(result.children?.map(n => [n.id, n]))
  for (const entity of visible.entities) {
    const box = boxes.get(entity.id)!, original = bounds.get(entity.id)!
    const delta = { x: (box.x || 0) - original.x, y: (box.y || 0) - original.y }
    for (const id of [entity.id, ...entity.fields.map(f => f.id)]) {
      const p = layout[id]
      if (p) doc.layout[id] = { x: p.x + delta.x, y: p.y + delta.y }
    }
  }
  for (const rel of relationships) {
    const box = boxes.get(rel.id)!
    doc.layout[rel.id] = { x: (box.x || 0) + box.width! / 2, y: (box.y || 0) + box.height! / 2 }
  }
  return doc
}
