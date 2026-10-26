export interface Field {
  id: string
  name: string
  label: string
  dataType: string
  primary: boolean
  nullable: boolean
}
export interface Entity { id: string; name: string; label: string; fields: Field[] }
export interface Relationship {
  id: string; name: string; from: string; to: string
  fromCardinality: string; toCardinality: string
  fieldPairs?: { from: string; to: string }[]
}
export interface Position { x: number; y: number }
export interface CardinalityPosition { distance: number; offset: Position }
export interface CardinalityStyle { fontSize: number; fontFamily: string; fontWeight: 'normal' | 'bold'; color: string }
export type NodeShape = 'rect' | 'ellipse' | 'diamond'
export interface DiagramStyle {
  showAttributes: boolean; fontSize: number; fontFamily: string
  showRelationships: boolean; showCardinalities: boolean; primaryUnderline: boolean; underlineWidth: number
  autoWidth: boolean; smartConnections: boolean; fontWeight: 'normal' | 'bold'
  entityFill: string; attributeFill: string; relationFill: string
  ink: string; background: string; lineWidth: number; radius: number; spacing: number; nodeScale: number
  lineColor: string; borderWidth: number; labelBackground: string
  entityWidth: number; entityHeight: number; attributeWidth: number; attributeHeight: number; relationWidth: number; relationHeight: number
  attributeShape: NodeShape; relationShape: NodeShape; attributeLayout: 'circular' | 'horizontal' | 'vertical'; attributeDistance: number
  cardinalities: Record<string, CardinalityStyle>
}
export interface ErDocument {
  schemaVersion: 1; id: string; title: string; sql: string
  entities: Entity[]; relationships: Relationship[]
  layout: Record<string, Position>; labelLayout: Record<string, CardinalityPosition>; style: DiagramStyle
  initialLayout: Record<string, Position>
  view: { entityIds: string[] | null; attributeNames: 'label' | 'name' }
}
export const uid = () => crypto.randomUUID()
export const defaultStyle = (): DiagramStyle => ({
  showAttributes: true, fontSize: 16, fontFamily: 'Noto Serif SC',
  showRelationships: true, showCardinalities: true, primaryUnderline: true, underlineWidth: 1,
  autoWidth: true, smartConnections: true, fontWeight: 'normal',
  entityFill: '#ffffff', attributeFill: '#ffffff', relationFill: '#ffffff',
  ink: '#303b42', background: '#ffffff', lineWidth: 1.5, radius: 3, spacing: 1, nodeScale: 1,
  lineColor: '#303b42', borderWidth: 1.5, labelBackground: '#ffffff',
  entityWidth: 108, entityHeight: 44, attributeWidth: 108, attributeHeight: 44, relationWidth: 92, relationHeight: 66,
  attributeShape: 'ellipse', relationShape: 'diamond', attributeLayout: 'circular', attributeDistance: 0,
  cardinalities: {},
})
export const blankDocument = (): ErDocument => ({
  schemaVersion: 1, id: uid(), title: '未命名 ER 图', sql: '',
  entities: [], relationships: [], layout: {}, labelLayout: {}, initialLayout: {}, view: { entityIds: null, attributeNames: 'label' }, style: defaultStyle(),
})
export function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T }
export function pruneLabelLayout(doc: ErDocument) {
  const ids = new Set(doc.relationships.flatMap(r => [`${r.id}-from`, `${r.id}-to`]))
  doc.labelLayout = Object.fromEntries(Object.entries(doc.labelLayout || {}).filter(([id]) => ids.has(id)))
  doc.style.cardinalities = Object.fromEntries(Object.entries(doc.style.cardinalities || {}).filter(([id]) => ids.has(id)))
  const nodeIds = new Set([...doc.entities.flatMap(e => [e.id, ...e.fields.map(f => f.id)]), ...doc.relationships.map(r => r.id)])
  doc.initialLayout = Object.fromEntries(Object.entries(doc.initialLayout || {}).filter(([id]) => nodeIds.has(id)))
  if (doc.view?.entityIds) doc.view.entityIds = doc.view.entityIds.filter(id => doc.entities.some(e => e.id === id))
}
export function visibleEntities(doc: ErDocument) { return doc.view?.entityIds === null || !doc.view ? doc.entities : doc.entities.filter(e => doc.view.entityIds!.includes(e.id)) }
export function visibleDocument(document: ErDocument): ErDocument {
  const doc = clone(document); doc.entities = visibleEntities(doc); doc.sql = ''
  const entities = new Set(doc.entities.map(e => e.id))
  doc.relationships = doc.relationships.filter(r => entities.has(r.from) && entities.has(r.to))
  const ids = new Set([...doc.entities.flatMap(e => [e.id, ...e.fields.map(f => f.id)]), ...doc.relationships.map(r => r.id)])
  doc.layout = Object.fromEntries(Object.entries(doc.layout).filter(([id]) => ids.has(id)))
  doc.view = { ...doc.view, entityIds: null }; pruneLabelLayout(doc)
  return doc
}
export function fieldDisplayName(field: Field, doc: ErDocument) { return doc.view?.attributeNames === 'name' ? field.name : field.label || field.name }

export function validateDocument(value: unknown): ErDocument {
  if (!value || typeof value !== 'object') throw new Error('项目文件内容无效')
  const doc = clone(value) as ErDocument
  if (doc.schemaVersion !== 1) throw new Error('暂不支持此项目文件版本')
  if (typeof doc.id !== 'string' || typeof doc.title !== 'string' || typeof doc.sql !== 'string') throw new Error('项目缺少必要信息')
  if (!Array.isArray(doc.entities) || !Array.isArray(doc.relationships) || !doc.layout || typeof doc.layout !== 'object') throw new Error('项目结构不完整')
  if (doc.entities.length > 200 || doc.relationships.length > 1000) throw new Error('项目超过当前支持的结构规模')
  const ids = new Set<string>()
  const checkId = (id: unknown) => {
    if (typeof id !== 'string' || !/^[\w-]{1,100}$/.test(id) || ids.has(id)) throw new Error('项目包含无效或重复的元素 ID')
    ids.add(id)
  }
  const text = (s: unknown) => { if (typeof s !== 'string' || s.length > 10000) throw new Error('项目文字内容无效') }
  for (const entity of doc.entities) {
    checkId(entity.id); text(entity.name); text(entity.label)
    if (!Array.isArray(entity.fields) || entity.fields.length > 500) throw new Error('实体字段结构无效')
    for (const field of entity.fields) {
      checkId(field.id); text(field.name); text(field.label); text(field.dataType)
      if (typeof field.primary !== 'boolean' || typeof field.nullable !== 'boolean') throw new Error('字段标记无效')
    }
  }
  const entityIds = new Set(doc.entities.map(e => e.id))
  if (doc.view === undefined) doc.view = { entityIds: null, attributeNames: 'label' }
  if (!doc.view || !['label', 'name'].includes(doc.view.attributeNames) || (doc.view.entityIds !== null && (!Array.isArray(doc.view.entityIds) || doc.view.entityIds.some(id => !entityIds.has(id)) || new Set(doc.view.entityIds).size !== doc.view.entityIds.length))) throw new Error('实体显示设置无效')
  for (const rel of doc.relationships) {
    checkId(rel.id); text(rel.name)
    if (!entityIds.has(rel.from) || !entityIds.has(rel.to)) throw new Error('关系引用了不存在的实体')
    for (const cardinal of [rel.fromCardinality, rel.toCardinality]) if (!['1', 'N', 'M', '0..1', '0..N'].includes(cardinal)) throw new Error('关系基数无效')
    if (rel.fieldPairs !== undefined) {
      if (!Array.isArray(rel.fieldPairs)) throw new Error('外键映射无效')
      const from = doc.entities.find(e => e.id === rel.from)!, to = doc.entities.find(e => e.id === rel.to)!
      for (const pair of rel.fieldPairs) if (!from.fields.some(f => f.name === pair.from) || !to.fields.some(f => f.name === pair.to)) throw new Error('外键字段不存在')
    }
  }
  if (doc.initialLayout === undefined) doc.initialLayout = {}
  if (!doc.initialLayout || typeof doc.initialLayout !== 'object' || Array.isArray(doc.initialLayout)) throw new Error('默认布局无效')
  for (const [id, point] of [...Object.entries(doc.layout), ...Object.entries(doc.initialLayout)]) {
    if (!ids.has(id) || !point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || Math.abs(point.x) > 1e6 || Math.abs(point.y) > 1e6) throw new Error('节点坐标无效')
  }
  // Older version-1 projects did not save cardinality positions.
  if (doc.labelLayout === undefined) doc.labelLayout = {}
  const labelIds = new Set(doc.relationships.flatMap(r => [`${r.id}-from`, `${r.id}-to`]))
  if (!doc.labelLayout || typeof doc.labelLayout !== 'object' || Array.isArray(doc.labelLayout)) throw new Error('基数位置无效')
  for (const [id, p] of Object.entries(doc.labelLayout)) {
    if (!labelIds.has(id) || !p || !Number.isFinite(p.distance) || p.distance < 0 || p.distance > 1 || !p.offset || !Number.isFinite(p.offset.x) || !Number.isFinite(p.offset.y) || Math.abs(p.offset.x) > 1e6 || Math.abs(p.offset.y) > 1e6) throw new Error('基数位置无效')
  }
  let style = doc.style
  if (!style || typeof style.showAttributes !== 'boolean') throw new Error('项目样式缺失')
  // Version 1 files written before the extended style panel retain their original appearance.
  doc.style = style = Object.assign(defaultStyle(), { lineColor: style.ink, borderWidth: style.lineWidth, labelBackground: style.background }, style)
  if (!style.cardinalities || typeof style.cardinalities !== 'object' || Array.isArray(style.cardinalities)) throw new Error('基数字体样式无效')
  for (const [id, font] of Object.entries(style.cardinalities)) {
    if (!labelIds.has(id) || !font || !Number.isFinite(font.fontSize) || font.fontSize < 8 || font.fontSize > 72 || !['Noto Serif SC', 'sans-serif', 'SimSun'].includes(font.fontFamily) || !['normal', 'bold'].includes(font.fontWeight) || !/^#[\da-f]{6}$/i.test(font.color)) throw new Error('基数字体样式无效')
  }
  for (const key of ['showAttributes', 'showRelationships', 'showCardinalities', 'primaryUnderline', 'autoWidth', 'smartConnections'] as const) if (typeof style[key] !== 'boolean') throw new Error('项目显示选项无效')
  for (const key of ['entityFill', 'attributeFill', 'relationFill', 'ink', 'background', 'lineColor'] as const) if (!/^#[\da-f]{6}$/i.test(style[key])) throw new Error('项目颜色无效')
  if (style.labelBackground !== 'transparent' && !/^#[\da-f]{6}$/i.test(style.labelBackground)) throw new Error('连线文字背景无效')
  if (!['normal', 'bold'].includes(style.fontWeight) || !['rect', 'ellipse', 'diamond'].includes(style.attributeShape) || !['rect', 'ellipse', 'diamond'].includes(style.relationShape) || !['circular', 'horizontal', 'vertical'].includes(style.attributeLayout)) throw new Error('项目节点样式无效')
  if (!['Noto Serif SC', 'sans-serif', 'SimSun'].includes(style.fontFamily)) throw new Error('项目字体无效')
  for (const [v, min, max] of [[style.fontSize, 10, 36], [style.lineWidth, .5, 5], [style.borderWidth, .5, 5], [style.underlineWidth, .5, 5], [style.radius, 0, 24], [style.spacing, .6, 2], [style.nodeScale, 1, 2], [style.attributeDistance, 0, 600], ...[style.entityWidth, style.attributeWidth, style.relationWidth].map(v => [v, 60, 500]), ...[style.entityHeight, style.attributeHeight, style.relationHeight].map(v => [v, 30, 300])]) if (!Number.isFinite(v) || v < min || v > max) throw new Error('项目样式参数无效')
  return clone(doc)
}
