import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { blankDocument, clone, validateDocument } from '../../src/modules/er/domain/model'
import { cardinalityPoint, sceneBounds, sceneFor } from '../../src/modules/er/domain/scene'
import { entityDocument, renderDrawio, renderSvg } from '../../src/modules/er/domain/export'
import { parseSql } from '../../src/modules/er/domain/sql'
import { sampleSql } from '../../src/modules/er/domain/sample'
import { useStudio } from '../../src/modules/er/store'

beforeEach(() => setActivePinia(createPinia()))
const position = { distance: .35, offset: { x: -18, y: -84 } }
function workspace() {
  const store = useStudio(); store.document = parseSql(sampleSql)
  return { store, edge: `${store.document.relationships[0].id}-from` }
}
describe('editable cardinality positions', () => {
  it('reads older projects and rejects dangling, nonfinite or out-of-range label positions', () => {
    const doc = parseSql(sampleSql), edge = `${doc.relationships[0].id}-from`, legacy = clone(doc) as any
    delete legacy.labelLayout; expect(validateDocument(legacy).labelLayout).toEqual({})
    for (const value of [null, [], { missing: position }, { [edge]: null }, { [edge]: { ...position, distance: -1 } }, { [edge]: { ...position, distance: 1.1 } }, { [edge]: { ...position, offset: { x: 1e7, y: 0 } } }, { [edge]: { distance: .5 } }]) expect(() => validateDocument({ ...doc, labelLayout: value })).toThrow('基数位置无效')
    doc.labelLayout[edge] = position; doc.relationships[0].fromCardinality = 'M'
    expect(validateDocument(doc)).toEqual(doc)
  })
  it('records one position edit with undo/redo and retains it when endpoints move', () => {
    const { store, edge } = workspace(), original = clone(store.document)
    store.moveCardinality(edge, position); store.moveCardinality(edge, position)
    expect(store.past).toHaveLength(1); expect(store.document.labelLayout[edge]).toEqual(position)
    const before = sceneFor(store.document).edges.find(e => e.id === edge)!.labelPoint!
    store.move(store.document.relationships[0].id, 900, 750)
    expect(sceneFor(store.document).edges.find(e => e.id === edge)!.labelPoint).not.toEqual(before)
    expect(store.document.labelLayout[edge]).toEqual(position)
    store.undo(); store.undo(); expect(store.document).toEqual(original)
    store.redo(); expect(store.document.labelLayout[edge]).toEqual(position)
  })
  it('removes orphaned positions on field/entity/relationship deletion and restores them on undo', () => {
    for (const kind of ['field', 'entity', 'relationship']) {
      const { store, edge } = workspace(), rel = store.document.relationships[0]
      store.moveCardinality(edge, position)
      const id = kind === 'field' ? store.document.entities.find(e => e.id === rel.from)!.fields.find(f => f.name === rel.fieldPairs![0].from)!.id : kind === 'entity' ? rel.from : rel.id
      store.remove([id]); expect(store.document.labelLayout).toEqual({}); validateDocument(store.document)
      store.undo(); expect(store.document.labelLayout[edge]).toEqual(position)
    }
  })
  it('retains positions across matching SQL imports and remaps positions for copied relationships', () => {
    const { store, edge } = workspace(); store.moveCardinality(edge, position)
    store.document.style.cardinalities[edge] = { fontSize: 34, fontFamily: 'sans-serif', fontWeight: 'bold', color: '#be123c' }
    expect(parseSql(sampleSql, store.document).labelLayout[edge]).toEqual(position)
    expect(parseSql(sampleSql, store.document).style.cardinalities[edge]).toEqual(store.document.style.cardinalities[edge])
    expect(parseSql('CREATE TABLE alone(id INT PRIMARY KEY);', store.document).labelLayout).toEqual({})
    expect(parseSql('CREATE TABLE alone(id INT PRIMARY KEY);', store.document).style.cardinalities).toEqual({})
    store.copy(store.document.entities.map(e => e.id)); store.paste()
    const copiedEdge = `${store.document.relationships[1].id}-from`
    expect(store.document.labelLayout[copiedEdge]).toEqual(position)
    expect(store.document.style.cardinalities[copiedEdge]).toEqual(store.document.style.cardinalities[edge]); validateDocument(store.document)
    expect(entityDocument(store.document, store.document.entities[0].id).labelLayout).toEqual({})
    expect(entityDocument(store.document, store.document.entities[0].id).style.cardinalities).toEqual({})
  })
  it('validates independent cardinality styles and migrates old global styles', () => {
    const { store, edge } = workspace(), doc = store.document, legacy = clone(doc) as any
    delete legacy.style.cardinalities; expect(validateDocument(legacy).style.cardinalities).toEqual({})
    const font = { fontSize: 36, fontFamily: 'SimSun', fontWeight: 'bold', color: '#aa1234' }
    for (const patch of [{ fontSize: null }, { fontSize: 73 }, { fontWeight: 'bolder' }, { fontFamily: 'url(x)' }, { color: '<svg>' }]) expect(() => validateDocument({ ...doc, style: { ...doc.style, cardinalities: { [edge]: { ...font, ...patch } } } })).toThrow('基数字体样式无效')
    doc.style.cardinalities[edge] = font as any
    expect(sceneFor(doc).edges.find(e => e.id === edge)?.labelStyle).toEqual(font)
    expect(validateDocument(doc)).toEqual(doc)
    store.remove([doc.relationships[0].id]); expect(store.document.style.cardinalities).toEqual({})
    store.undo(); expect(store.document.style.cardinalities[edge]).toEqual(font)
  })
  it('places labels by full polyline length, including endpoints and zero-length connections', () => {
    const points = [{ x: -100, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 200 }]
    expect(cardinalityPoint(points, { distance: .5, offset: { x: 8, y: -10 } })).toEqual({ x: 8, y: 40 })
    expect(cardinalityPoint(points, { distance: 1, offset: { x: 0, y: 0 } })).toEqual(points[2])
    expect(cardinalityPoint([points[0], points[0]], position)).toEqual({ x: -118, y: -84 })
  })
  it('includes distant labels in export bounds and maps the same positions into SVG and editable Draw.io', () => {
    const { store, edge } = workspace(), doc = store.document
    doc.labelLayout[edge] = { distance: .25, offset: { x: -2000, y: -1500 } }
    const scene = sceneFor(doc), label = scene.edges.find(e => e.id === edge)!, bounds = sceneBounds(scene, 0)
    expect(bounds.x).toBeLessThan(label.labelPoint!.x); expect(bounds.y).toBeLessThan(label.labelPoint!.y)
    const svg = renderSvg(doc), drawio = renderDrawio(doc)
    expect(svg).toContain(`x="${label.labelPoint!.x}" y="${label.labelPoint!.y}" text-anchor="middle" dominant-baseline="central"`)
    expect(drawio).toContain('<mxGeometry x="-0.5" y="0" relative="1" as="geometry"><mxPoint x="-2000" y="-1500" as="offset"/>')
    doc.style.showCardinalities = false
    expect(renderSvg(doc)).not.toContain(`x="${label.labelPoint!.x}"`); expect(doc.labelLayout[edge]).toBeDefined()
  })
  it('keeps self-relationship labels on separate bent paths and follows changes to either endpoint', () => {
    const doc = blankDocument(); doc.entities = [{ id: 'e', name: 'e', label: '实体', fields: [] }]
    doc.relationships = [{ id: 'r', name: '自关联', from: 'e', to: 'e', fromCardinality: 'M', toCardinality: 'N' }]
    doc.layout = { e: { x: 300, y: 400 }, r: { x: 300, y: 100 } }
    const original = sceneFor(doc); expect(original.edges[0].labelPoint).not.toEqual(original.edges[1].labelPoint)
    doc.layout.e.x += 80; doc.layout.r.y -= 60
    expect(sceneFor(doc).edges[0].labelPoint).not.toEqual(original.edges[0].labelPoint)
  })
})
