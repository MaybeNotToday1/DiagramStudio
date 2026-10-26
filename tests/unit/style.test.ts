import { describe, expect, it } from 'vitest'
import { parseSql } from '../../src/modules/er/domain/sql'
import { sampleSql } from '../../src/modules/er/domain/sample'
import { clone, defaultStyle, validateDocument } from '../../src/modules/er/domain/model'
import { attributePositions, borderPoint, constrainToOrbit, rearrangeAttributes, sceneFor } from '../../src/modules/er/domain/scene'
import { entityDocument, renderDrawio, renderSvg } from '../../src/modules/er/domain/export'

describe('extended ER styles and entity export', () => {
  it('migrates original version-1 styles without changing existing colors, borders or positions', () => {
    const doc = parseSql(sampleSql), before = clone(doc.layout)
    const legacy = { showAttributes: false, fontSize: 20, fontFamily: 'SimSun', entityFill: '#ededed', attributeFill: '#ffffff', relationFill: '#ffffff', ink: '#abcdef', background: '#eeeeee', lineWidth: 3, radius: 4, spacing: 1 }
    const result = validateDocument({ ...doc, style: legacy })
    expect(result.style).toMatchObject({ ...legacy, lineColor: '#abcdef', borderWidth: 3, labelBackground: '#eeeeee', primaryUnderline: true, nodeScale: 1 })
    expect(result.layout).toEqual(before)
    expect(result.style.attributeShape).toBe('ellipse')
  })
  it('rejects malformed extended styles instead of passing unsafe or invalid values into renderers', () => {
    const doc = parseSql(sampleSql)
    for (const patch of [{ showRelationships: 'yes' }, { lineColor: 'url(https://example.org)' }, { labelBackground: '<svg>' }, { fontWeight: 'other' }, { relationShape: 'script' }, { attributeLayout: 'other' }, { entityWidth: 0 }, { attributeDistance: 9999 }, { borderWidth: null }, { underlineWidth: 0 }]) {
      expect(() => validateDocument({ ...doc, style: { ...doc.style, ...patch } })).toThrow()
    }
  })
  it('hides relationships and cardinalities without deleting their definitions or positions', () => {
    const doc = parseSql(sampleSql), before = clone(doc)
    doc.style.showCardinalities = false
    expect(sceneFor(doc).edges.every(e => !e.label)).toBe(true)
    doc.style.showRelationships = false
    expect(sceneFor(doc).nodes.some(n => n.kind === 'relationship')).toBe(false)
    expect(doc.relationships).toEqual(before.relationships); expect(doc.layout).toEqual(before.layout)
    expect(renderDrawio(doc)).not.toContain(`id="${doc.relationships[0].id}"`)
  })
  it('renders shapes, independent line styles, typography and primary underline identically in SVG and scene', () => {
    const doc = parseSql(sampleSql)
    Object.assign(doc.style, { attributeShape: 'rect', relationShape: 'ellipse', primaryUnderline: false, autoWidth: false, entityWidth: 200, entityHeight: 80, ink: '#112233', lineColor: '#556677', borderWidth: 4, lineWidth: 2, fontWeight: 'bold', labelBackground: 'transparent' })
    const scene = sceneFor(doc), svg = renderSvg(doc), drawio = renderDrawio(doc)
    expect(scene.nodes[0]).toMatchObject({ width: 200, height: 80, shape: 'rect' })
    expect(scene.nodes.filter(n => n.kind === 'attribute').every(n => n.shape === 'rect')).toBe(true)
    expect(scene.nodes.find(n => n.kind === 'relationship')?.shape).toBe('ellipse')
    expect(svg).not.toContain('text-decoration="underline"'); expect(svg).toContain('font-weight="bold"')
    expect(svg).toContain('fill="#112233"'); expect(svg).toContain('stroke="#556677" stroke-width="4"')
    expect(drawio).toContain('strokeColor=#556677;strokeWidth=4;fontStyle=1;'); expect(drawio).toContain('labelBackgroundColor=none;')
  })
  it('fixed widths wrap long text by increasing height while adaptive widths expand only when needed', () => {
    const doc = parseSql(sampleSql); doc.entities[0].fields[0].label = '很长的属性名称需要完整呈现'.repeat(5)
    doc.style.autoWidth = false; doc.style.attributeWidth = 90; doc.style.attributeHeight = 40
    const fixed = sceneFor(doc).nodes.find(n => n.id === doc.entities[0].fields[0].id)!
    expect(fixed.width).toBe(90); expect(fixed.height).toBeGreaterThan(200)
    doc.style.autoWidth = true
    const auto = sceneFor(doc).nodes.find(n => n.id === fixed.id)!
    expect(auto.width).toBeGreaterThan(fixed.width); expect(auto.height).toBeLessThan(fixed.height)
  })
  it('rearranges attributes around the existing entity center and preserves relationship positions', () => {
    const doc = parseSql(sampleSql), original = clone(doc.layout), entity = doc.entities[0]
    doc.style.attributeLayout = 'horizontal'; doc.style.attributeDistance = 300
    rearrangeAttributes(doc)
    expect(doc.layout[entity.id]).toEqual(original[entity.id]); expect(doc.layout[doc.relationships[0].id]).toEqual(original[doc.relationships[0].id])
    const points = entity.fields.map(f => doc.layout[f.id])
    expect(new Set(points.map(p => p.y)).size).toBe(1); expect(points[0].y).toBe(original[entity.id].y + 300)
    doc.style.attributeLayout = 'vertical'
    const vertical = Object.values(attributePositions(entity, original[entity.id], doc.style))
    expect(new Set(vertical.map(p => p.x)).size).toBe(1)
  })
  it('projects Ctrl-drag onto the original radius and handles dragging through the center', () => {
    const center = { x: -30, y: 80 }, start = { x: -30, y: -20 }, target = { x: 160, y: 220 }
    const projected = constrainToOrbit(center, start, target)
    expect(Math.hypot(projected.x - center.x, projected.y - center.y)).toBeCloseTo(100, 8)
    expect(constrainToOrbit(center, start, center)).toEqual(start)
  })
  it('connects to actual shape boundaries, with a distinct four-direction anchor mode', () => {
    const node = sceneFor(parseSql(sampleSql)).nodes.find(n => n.kind === 'attribute')!, target = { x: node.x + 400, y: node.y + 100 }
    const smart = borderPoint(node, target), fixed = borderPoint(node, target, false)
    expect(((smart.x - node.x) / (node.width / 2)) ** 2 + ((smart.y - node.y) / (node.height / 2)) ** 2).toBeCloseTo(1)
    expect(fixed).toEqual({ x: node.x + node.width / 2, y: node.y }); expect(smart).not.toEqual(fixed)
  })
  it('extracts one entity with every attribute and its current style/layout, without mutating the source', () => {
    const doc = parseSql(sampleSql); doc.style.showAttributes = false; doc.style.attributeFill = '#ffeecc'
    const before = clone(doc), entity = doc.entities[0], isolated = entityDocument(doc, entity.id)
    expect(isolated.entities).toEqual([entity]); expect(isolated.relationships).toEqual([])
    expect(sceneFor(isolated).nodes).toHaveLength(1 + entity.fields.length)
    expect(isolated.style).toEqual({ ...doc.style, showAttributes: true })
    expect(Object.keys(isolated.layout).sort()).toEqual([entity.id, ...entity.fields.map(f => f.id)].sort())
    expect(doc).toEqual(before); expect(() => entityDocument(doc, 'missing')).toThrow('实体不存在')
    expect(validateDocument(isolated).style).toEqual(isolated.style)
  })
  it('keeps the default style itself valid through backup validation', () => {
    const doc = parseSql(sampleSql); doc.style = defaultStyle()
    expect(validateDocument(doc)).toEqual(doc)
  })
})
