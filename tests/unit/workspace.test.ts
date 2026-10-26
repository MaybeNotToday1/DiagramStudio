import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { clone, validateDocument, visibleDocument } from '../../src/modules/er/domain/model'
import { parseSql } from '../../src/modules/er/domain/sql'
import { sampleSql } from '../../src/modules/er/domain/sample'
import { sceneBounds, sceneFor } from '../../src/modules/er/domain/scene'
import { beautify, restoreDefaultLayout } from '../../src/modules/er/domain/layout'
import { renderDrawio, renderSvg } from '../../src/modules/er/domain/export'
import { useStudio } from '../../src/modules/er/store'

const storage = vi.hoisted(() => ({ value: undefined as any, hold: undefined as Promise<void> | undefined, fail: false }))
vi.mock('idb', () => ({ openDB: async () => ({
  get: async () => storage.value,
  put: async (_store: string, value: unknown) => { const hold = storage.hold; storage.hold = undefined; if (hold) await hold; if (storage.fail) throw new Error('storage unavailable'); storage.value = clone(value) },
}) }))
beforeEach(() => { setActivePinia(createPinia()); storage.value = undefined; storage.hold = undefined; storage.fail = false })

describe('entity scope and naming', () => {
  it('filters scenes and all export documents without deleting model data, layout or styles', () => {
    const doc = parseSql(sampleSql), before = clone(doc), entity = doc.entities[0]
    doc.view.entityIds = [entity.id]
    expect(sceneFor(doc).nodes).toHaveLength(1 + entity.fields.length)
    expect(sceneFor(doc).edges.every(e => !e.label)).toBe(true)
    expect(renderSvg(doc)).not.toContain('>学生<'); expect(renderDrawio(doc)).not.toContain(`id="${doc.entities[1].id}"`)
    const exportDoc = visibleDocument(doc); validateDocument(exportDoc)
    expect(exportDoc.entities).toEqual([entity]); expect(exportDoc.relationships).toEqual([]); expect(exportDoc.sql).toBe('')
    expect(doc.entities).toEqual(before.entities); expect(doc.layout).toEqual(before.layout)
    doc.view.entityIds = null; expect(sceneFor(doc).nodes).toHaveLength(11)
  })
  it('shows self relations only when their entity is visible and permits an empty scope after deletion', () => {
    const doc = parseSql('CREATE TABLE a(id INT PRIMARY KEY, parent INT, FOREIGN KEY(parent) REFERENCES a(id)); CREATE TABLE b(id INT);')
    doc.view.entityIds = [doc.entities[0].id]; expect(sceneFor(doc).nodes.some(n => n.kind === 'relationship')).toBe(true)
    doc.view.entityIds = []; expect(sceneFor(doc).nodes).toEqual([]); validateDocument(doc)
  })
  it('switches field comments/raw names without changing labels, IDs or coordinates; missing comments keep names', () => {
    const doc = parseSql("CREATE TABLE t(id INT PRIMARY KEY, name VARCHAR(50) COMMENT '姓名');"), before = clone(doc)
    doc.view.attributeNames = 'name'; expect(sceneFor(doc).nodes.filter(n => n.kind === 'attribute').map(n => n.label)).toEqual(['id', 'name'])
    doc.view.attributeNames = 'label'; expect(sceneFor(doc).nodes.filter(n => n.kind === 'attribute').map(n => n.label)).toEqual(['id', '姓名'])
    expect(doc.entities).toEqual(before.entities); expect(doc.layout).toEqual(before.layout)
  })
  it('migrates old files and validates scope, naming and initial coordinates', () => {
    const doc = parseSql(sampleSql), old = clone(doc) as any; delete old.view; delete old.initialLayout
    expect(validateDocument(old).view).toEqual({ entityIds: null, attributeNames: 'label' })
    for (const view of [null, { entityIds: ['missing'], attributeNames: 'label' }, { entityIds: null, attributeNames: 'other' }]) expect(() => validateDocument({ ...doc, view })).toThrow('显示设置')
    expect(() => validateDocument({ ...doc, initialLayout: { missing: { x: 0, y: 0 } } })).toThrow('坐标')
  })
  it('reveals pasted entities in a filtered view and resets an obsolete scope on unrelated SQL generation', () => {
    const store = useStudio(); store.document = parseSql(sampleSql)
    store.document.view.entityIds = [store.document.entities[0].id]; store.copy(store.document.view.entityIds); store.paste()
    expect(store.document.view.entityIds).toHaveLength(2); expect(sceneFor(store.document).nodes.filter(n => n.kind === 'entity')).toHaveLength(2)
    const next = parseSql('CREATE TABLE fresh(id INT PRIMARY KEY);', store.document)
    expect(next.view.entityIds).toBe(null); expect(sceneFor(next).nodes).toHaveLength(2)
  })
})
describe('beautification and original layout', () => {
  it('keeps self-relation arms separated when layout or dragging aligns their endpoints horizontally', async () => {
    const doc = await beautify(parseSql('CREATE TABLE employee(id INT PRIMARY KEY, manager INT, FOREIGN KEY(manager) REFERENCES employee(id));'))
    const a = doc.layout[doc.entities[0].id], b = doc.layout[doc.relationships[0].id]
    b.x = a.x + 400; b.y = a.y
    const edges = sceneFor(doc).edges.filter(e => e.label)
    expect(edges[0].bend!.y).toBeLessThan(a.y); expect(edges[1].bend!.y).toBeGreaterThan(a.y)
    expect(edges[0].labelPoint).not.toEqual(edges[1].labelPoint)
  })
  it('separates entity/attribute groups and diamonds in both horizontal and vertical templates', async () => {
    const doc = parseSql(sampleSql)
    for (const template of ['horizontal', 'vertical'] as const) {
      const next = await beautify(doc, template), scene = sceneFor(next), rel = scene.nodes.find(n => n.kind === 'relationship')!
      const groups = next.entities.map(e => sceneBounds({ nodes: scene.nodes.filter(n => n.id === e.id || n.parent === e.id), edges: [] }, 0))
      for (const b of groups) expect(rel.x + rel.width / 2 < b.x || rel.x - rel.width / 2 > b.x + b.width || rel.y + rel.height / 2 < b.y || rel.y - rel.height / 2 > b.y + b.height).toBe(true)
      const [a, b] = next.entities.map(e => next.layout[e.id])
      expect(template === 'horizontal' ? Math.abs(a.x - b.x) > Math.abs(a.y - b.y) : Math.abs(a.y - b.y) > Math.abs(a.x - b.x)).toBe(true)
      for (const attribute of scene.nodes.filter(n => n.parent)) {
        const center = next.layout[attribute.parent!]
        expect(template === 'horizontal' ? Math.abs(attribute.y - center.y) > attribute.height / 2 + 10 : Math.abs(attribute.x - center.x) > attribute.width / 2 + 10).toBe(true)
      }
      expect(next.entities).toEqual(doc.entities); expect(next.style).toEqual(doc.style)
    }
  })
  it('restores the exact initial SQL coordinates after movement/beautification and remains undoable', async () => {
    const store = useStudio(); store.document = parseSql(sampleSql)
    const initial = clone(store.document.initialLayout)
    store.move(store.document.entities[0].id, -1000, -800)
    store.apply(await beautify(store.document), '美化'); const moved = clone(store.document)
    store.apply(restoreDefaultLayout(store.document), '默认布局'); expect(store.document.layout).toEqual(initial)
    expect(store.document.style).toEqual(moved.style); store.undo(); expect(store.document).toEqual(moved)
  })
  it('beautifies only the visible subset while retaining hidden positions and the reset baseline', async () => {
    const doc = parseSql(sampleSql), hidden = doc.entities[1]; doc.view.entityIds = [doc.entities[0].id]
    const next = await beautify(doc)
    for (const id of [hidden.id, ...hidden.fields.map(f => f.id)]) expect(next.layout[id]).toEqual(doc.layout[id])
    expect(next.initialLayout).toEqual(doc.initialLayout); validateDocument(next)
  })
})
describe('SQL history and permanent reset', () => {
  it('records successful generations newest first and limits history without storing whole projects', () => {
    const store = useStudio()
    for (let i = 0; i < 23; i++) store.applySql(parseSql(`CREATE TABLE t_${i}(id INT PRIMARY KEY);`))
    expect(store.sqlHistory).toHaveLength(20); expect(store.sqlHistory[0].sql).toContain('t_22')
    expect(store.sqlHistory[0]).not.toHaveProperty('document')
    expect(() => parseSql('invalid sql')).toThrow(); expect(store.sqlHistory).toHaveLength(20)
  })
  it('persists history and durably resets after an earlier pending autosave, clearing undo/clipboard', async () => {
    const store = useStudio(); store.applySql(parseSql('CREATE TABLE custom(id INT PRIMARY KEY);'))
    store.copy(store.document.entities.map(e => e.id)); store.checkpoint('old')
    let release!: () => void; storage.hold = new Promise(resolve => { release = resolve })
    const earlier = store.persist(); const reset = store.resetWorkspace()
    expect(store.resetting).toBe(true); release(); await earlier; await reset
    expect(storage.value.document.sql).toBe(sampleSql); expect(storage.value.restorePoints).toEqual([]); expect(storage.value.sqlHistory).toEqual([])
    expect(store.past).toEqual([]); expect(store.future).toEqual([]); expect(store.restorePoints).toEqual([]); expect(store.sqlHistory).toEqual([])
    const resetDoc = clone(store.document); store.undo(); expect(store.document).toEqual(resetDoc); expect(store.paste()).toBe(false)
    await store.initialize(); expect(store.document).toEqual(resetDoc); expect(store.sqlHistory).toEqual([])
  })
  it('keeps the old workspace when the durable reset write fails', async () => {
    const store = useStudio(); store.applySql(parseSql('CREATE TABLE custom(id INT);'))
    const before = clone(store.document), points = clone(store.restorePoints); storage.fail = true
    await expect(store.resetWorkspace()).rejects.toThrow('storage unavailable')
    expect(store.document).toEqual(before); expect(store.restorePoints).toEqual(points); expect(store.sqlHistory).toHaveLength(1); expect(store.resetting).toBe(false)
  })
})
