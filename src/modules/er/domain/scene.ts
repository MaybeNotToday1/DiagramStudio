import type { CardinalityPosition, CardinalityStyle, DiagramStyle, Entity, ErDocument, NodeShape, Position } from './model'
import { fieldDisplayName, visibleEntities } from './model'

export interface SceneNode { id: string; kind: 'entity' | 'attribute' | 'relationship'; shape: NodeShape; label: string; primary: boolean; x: number; y: number; width: number; height: number; parent?: string }
export interface SceneEdge { id: string; from: string; to: string; label: string; bend?: Position; labelPosition?: CardinalityPosition; labelPoint?: Position; labelStyle?: CardinalityStyle; labelSize?: { width: number; height: number } }
export interface Scene { nodes: SceneNode[]; edges: SceneEdge[] }
export const defaultCardinalityPosition = (): CardinalityPosition => ({ distance: .8, offset: { x: 0, y: 0 } })
export function cardinalityStyle(doc: ErDocument, edgeId: string): CardinalityStyle {
  const s = doc.style
  return s.cardinalities?.[edgeId] || { fontSize: s.fontSize - 1, fontFamily: s.fontFamily, fontWeight: s.fontWeight, color: s.ink }
}
export function edgePoints(edge: SceneEdge, byId: Map<string, SceneNode>, smart = true): Position[] {
  const a = byId.get(edge.from)!, b = byId.get(edge.to)!
  return [borderPoint(a, edge.bend || b, smart), ...(edge.bend ? [edge.bend] : []), borderPoint(b, edge.bend || a, smart)]
}
export function cardinalityPoint(points: Position[], position: CardinalityPosition): Position {
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y))
  let remaining = lengths.reduce((sum, length) => sum + length, 0) * position.distance
  for (let i = 0; i < lengths.length; i++) {
    if (remaining <= lengths[i] || i === lengths.length - 1) {
      const ratio = lengths[i] ? remaining / lengths[i] : 0
      return { x: points[i].x + (points[i + 1].x - points[i].x) * ratio + position.offset.x, y: points[i].y + (points[i + 1].y - points[i].y) * ratio + position.offset.y }
    }
    remaining -= lengths[i]
  }
  return { x: points[0].x + position.offset.x, y: points[0].y + position.offset.y }
}
export function labelWidth(width: number, shape: NodeShape | SceneNode['kind']) {
  return shape === 'ellipse' || shape === 'attribute' ? width * .7 : shape === 'diamond' || shape === 'relationship' ? width * .55 : width - 30
}
export const nodeShape = (kind: SceneNode['kind'], style: DiagramStyle): NodeShape => kind === 'entity' ? 'rect' : kind === 'attribute' ? style.attributeShape : style.relationShape
export function nodeSize(label: string, fontSize: number, kind: SceneNode['kind'], style?: DiagramStyle) {
  const shape = style ? nodeShape(kind, style) : kind === 'entity' ? 'rect' : kind === 'attribute' ? 'ellipse' : 'diamond'
  const baseWidth = style ? (kind === 'entity' ? style.entityWidth : kind === 'attribute' ? style.attributeWidth : style.relationWidth) : kind === 'relationship' ? 92 : 108
  const baseHeight = style ? (kind === 'entity' ? style.entityHeight : kind === 'attribute' ? style.attributeHeight : style.relationHeight) : kind === 'relationship' ? 66 : 44
  const lengths = label.split('\n').map(line => [...line].reduce((sum, ch) => sum + (/[^\x00-\xff]/.test(ch) ? 1 : .58), 0) * fontSize * (style?.fontWeight === 'bold' ? 1.08 : 1))
  const content = Math.max(0, ...lengths)
  const width = style?.autoWidth === false ? baseWidth : Math.max(baseWidth, Math.min(260, shape === 'ellipse' ? content / .7 + 20 : shape === 'diamond' ? content / .55 + 20 : content + 36))
  const lines = lengths.reduce((total, length) => total + Math.max(1, Math.ceil(length / labelWidth(width, shape))), 0)
  const factor = lines > 1 ? shape === 'ellipse' ? 1.5 : shape === 'diamond' ? 2 : 1 : 1
  const scale = style?.nodeScale ?? 1
  return { width: width * scale, height: Math.max(baseHeight, lines * fontSize * 1.35 * factor + 22) * scale }
}
export function attributePositions(entity: Entity, center: Position, style: DiagramStyle, angleOffset = 0): Record<string, Position> {
  const entitySize = nodeSize(entity.label || entity.name, style.fontSize, 'entity', style)
  const sizes = entity.fields.map(f => nodeSize(f.label || f.name, style.fontSize, 'attribute', style))
  const maxW = Math.max(0, ...sizes.map(s => s.width)), maxH = Math.max(0, ...sizes.map(s => s.height))
  const count = Math.max(4, entity.fields.length), gap = 45 * style.spacing
  const radiusX = Math.max((style.attributeDistance || Math.max(210, count * 28)) * style.spacing, (entitySize.width + maxW) / 2 + gap)
  const radiusY = Math.max((style.attributeDistance || Math.max(160, count * 17)) * style.spacing, (entitySize.height + maxH) / 2 + gap)
  return Object.fromEntries(entity.fields.map((field, i) => {
    const angle = -Math.PI / 2 + angleOffset + i * Math.PI * 2 / Math.max(entity.fields.length, 1), offset = i - (entity.fields.length - 1) / 2
    const p = style.attributeLayout === 'horizontal' ? { x: center.x + offset * (maxW + gap), y: center.y + radiusY }
      : style.attributeLayout === 'vertical' ? { x: center.x + radiusX, y: center.y + offset * (maxH + gap) }
      : { x: center.x + Math.cos(angle) * radiusX, y: center.y + Math.sin(angle) * radiusY }
    return [field.id, p]
  }))
}
export function rearrangeAttributes(doc: ErDocument) {
  const fallback = defaultLayout(doc)
  for (const entity of doc.entities) Object.assign(doc.layout, attributePositions(entity, doc.layout[entity.id] || fallback[entity.id], doc.style))
}
export function constrainToOrbit(center: Position, start: Position, target: Position): Position {
  const radius = Math.hypot(start.x - center.x, start.y - center.y), length = Math.hypot(target.x - center.x, target.y - center.y)
  return length ? { x: center.x + (target.x - center.x) * radius / length, y: center.y + (target.y - center.y) * radius / length } : start
}
export function selfRelationshipBend(entity: Position, relationship: Position, side: number): Position {
  const dx = relationship.x - entity.x, dy = relationship.y - entity.y, length = Math.hypot(dx, dy)
  return { x: (entity.x + relationship.x) / 2 + (length ? -dy / length : 1) * side * 120, y: (entity.y + relationship.y) / 2 + (length ? dx / length : 0) * side * 120 }
}
export function defaultLayout(doc: ErDocument): Record<string, Position> {
  const layout: Record<string, Position> = {}
  const columns = Math.ceil(Math.sqrt(doc.entities.length || 1))
  const maxCount = Math.max(4, ...doc.entities.map(e => e.fields.length))
  const entitySize = doc.entities.map(e => nodeSize(e.label || e.name, doc.style.fontSize, 'entity', doc.style))
  const fieldSize = doc.entities.flatMap(e => e.fields.map(f => nodeSize(f.label || f.name, doc.style.fontSize, 'attribute', doc.style)))
  const max = (sizes: { width: number; height: number }[], key: 'width' | 'height') => sizes.reduce((value, size) => Math.max(value, size[key]), 0) / 2
  const radiusX = Math.max(Math.max(210, maxCount * 28) * doc.style.spacing, max(entitySize, 'width') + max(fieldSize, 'width') + 50)
  const radiusY = Math.max(Math.max(160, maxCount * 17) * doc.style.spacing, max(entitySize, 'height') + max(fieldSize, 'height') + 50)
  doc.entities.forEach((entity, index) => {
    const x = (index % columns) * (radiusX * 2 + 240) + radiusX + 160
    const y = Math.floor(index / columns) * (radiusY * 2 + 180) + radiusY + 100
    layout[entity.id] = { x, y }
    Object.assign(layout, attributePositions(entity, { x, y }, doc.style))
  })
  const pairs = new Map<string, number>()
  doc.relationships.forEach(rel => {
    const a = layout[rel.from], b = layout[rel.to]
    if (!a || !b) return
    const key = [rel.from, rel.to].sort().join(':'); const n = pairs.get(key) || 0; pairs.set(key, n + 1)
    const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy) || 1
    const offset = n * 90 + (rel.from === rel.to ? 150 : 0)
    layout[rel.id] = { x: (a.x + b.x) / 2 - dy / length * offset, y: (a.y + b.y) / 2 + dx / length * offset - (rel.from === rel.to ? 260 : 0) }
  })
  return layout
}
export function sceneFor(doc: ErDocument): Scene {
  const fallback = defaultLayout(doc), nodes: SceneNode[] = [], edges: SceneEdge[] = []
  const entities = visibleEntities(doc), entityIds = new Set(entities.map(e => e.id))
  const node = (id: string, kind: SceneNode['kind'], label: string, primary = false, parent?: string) => {
    const p = doc.layout[id] || fallback[id] || { x: 0, y: 0 }
    const size = nodeSize(label, doc.style.fontSize, kind, doc.style)
    nodes.push({ id, kind, shape: nodeShape(kind, doc.style), label, primary: primary && doc.style.primaryUnderline, parent, ...p, ...size })
  }
  for (const entity of entities) {
    node(entity.id, 'entity', entity.label || entity.name)
    if (doc.style.showAttributes) for (const field of entity.fields) {
      node(field.id, 'attribute', fieldDisplayName(field, doc), field.primary, entity.id)
      edges.push({ id: `attr-${field.id}`, from: entity.id, to: field.id, label: '' })
    }
  }
  for (const rel of doc.style.showRelationships ? doc.relationships.filter(r => entityIds.has(r.from) && entityIds.has(r.to)) : []) {
    node(rel.id, 'relationship', rel.name)
    const entity = nodes.find(n => n.id === rel.from)!, relationship = nodes.at(-1)!
    const bend = (side: number) => rel.from === rel.to ? selfRelationshipBend(entity, relationship, side) : undefined
    edges.push({ id: `${rel.id}-from`, from: rel.from, to: rel.id, label: doc.style.showCardinalities ? rel.fromCardinality : '', bend: bend(-1) })
    edges.push({ id: `${rel.id}-to`, from: rel.to, to: rel.id, label: doc.style.showCardinalities ? rel.toCardinality : '', bend: bend(1) })
  }
  const byId = new Map(nodes.map(n => [n.id, n]))
  for (const edge of edges.filter(e => e.label)) {
    edge.labelPosition = doc.labelLayout?.[edge.id] || defaultCardinalityPosition()
    edge.labelPoint = cardinalityPoint(edgePoints(edge, byId, doc.style.smartConnections), edge.labelPosition)
    edge.labelStyle = cardinalityStyle(doc, edge.id)
    edge.labelSize = { width: edge.label.length * edge.labelStyle.fontSize * (edge.labelStyle.fontWeight === 'bold' ? .9 : .8) + 12, height: edge.labelStyle.fontSize + 12 }
  }
  return { nodes, edges }
}
export function sceneBounds(scene: Scene, padding = 40) {
  if (!scene.nodes.length) return { x: 0, y: 0, width: 600, height: 400 }
  const bends = scene.edges.flatMap(e => [ ...(e.bend ? [e.bend] : []), ...(e.labelPoint && e.labelSize ? [
    { x: e.labelPoint.x - e.labelSize.width / 2, y: e.labelPoint.y - e.labelSize.height / 2 },
    { x: e.labelPoint.x + e.labelSize.width / 2, y: e.labelPoint.y + e.labelSize.height / 2 },
  ] : []) ])
  const left = Math.min(...scene.nodes.map(n => n.x - n.width / 2), ...bends.map(p => p.x)), top = Math.min(...scene.nodes.map(n => n.y - n.height / 2), ...bends.map(p => p.y))
  const right = Math.max(...scene.nodes.map(n => n.x + n.width / 2), ...bends.map(p => p.x)), bottom = Math.max(...scene.nodes.map(n => n.y + n.height / 2), ...bends.map(p => p.y))
  return { x: left - padding, y: top - padding, width: right - left + padding * 2, height: bottom - top + padding * 2 }
}
export function borderPoint(node: SceneNode, target: Position, smart = true): Position {
  const dx = target.x - node.x, dy = target.y - node.y
  if (!dx && !dy) return { x: node.x, y: node.y }
  const a = node.width / 2, b = node.height / 2
  if (!smart) return Math.abs(dx / a) > Math.abs(dy / b) ? { x: node.x + Math.sign(dx) * a, y: node.y } : { x: node.x, y: node.y + Math.sign(dy) * b }
  const scale = node.shape === 'ellipse' ? 1 / Math.sqrt(dx * dx / (a * a) + dy * dy / (b * b))
    : node.shape === 'diamond' ? 1 / (Math.abs(dx) / a + Math.abs(dy) / b)
    : 1 / Math.max(Math.abs(dx) / a, Math.abs(dy) / b)
  return { x: node.x + dx * scale, y: node.y + dy * scale }
}
