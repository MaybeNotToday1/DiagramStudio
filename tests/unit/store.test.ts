import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useStudio } from '../../src/modules/er/store'
import { parseSql } from '../../src/modules/er/domain/sql'
import { sampleSql } from '../../src/modules/er/domain/sample'
import { clone, validateDocument } from '../../src/modules/er/domain/model'
import { sceneFor } from '../../src/modules/er/domain/scene'
import { beautify } from '../../src/modules/er/domain/layout'

beforeEach(() => setActivePinia(createPinia()))
function workspace() { const store = useStudio(); store.document = parseSql(sampleSql); return store }
describe('business model editing invariants', () => {
  it('keeps stable IDs and positions across edits, undo and redo', () => {
    const store = workspace(), before = clone(store.document), id = before.entities[0].id
    store.edit('改名', doc => { doc.entities[0].label = '新显示名称' })
    expect(store.document.entities[0].id).toBe(id); expect(store.document.layout).toEqual(before.layout)
    store.undo(); expect(store.document).toEqual(before); store.redo(); expect(store.document.entities[0].label).toBe('新显示名称')
  })
  it('deleting a referenced field removes the relationship and stale layout entries', () => {
    const store = workspace(), relationship = store.document.relationships[0], source = store.document.entities.find(e => e.id === relationship.from)!
    const field = source.fields.find(f => f.name === relationship.fieldPairs![0].from)!
    store.remove([field.id]); expect(store.document.relationships).toHaveLength(0); expect(store.document.layout[field.id]).toBeUndefined()
    expect(() => validateDocument(store.document)).not.toThrow(); store.undo(); expect(store.document.relationships).toHaveLength(1)
  })
  it('deleting entities never leaves dangling relationships', () => {
    const store = workspace(); store.remove([store.document.entities[0].id]); expect(store.document.entities).toHaveLength(1); expect(store.document.relationships).toHaveLength(0); validateDocument(store.document)
  })
  it('hidden attributes move with their entity and reappear without losing edits', () => {
    const store = workspace(), entity = store.document.entities[0], field = entity.fields[0], before = clone(store.document.layout[field.id])
    store.edit('隐藏属性', d => { d.style.showAttributes = false; d.entities[0].fields[0].label = '自定义属性' })
    expect(sceneFor(store.document).nodes).toHaveLength(3)
    store.move(entity.id, store.document.layout[entity.id].x + 90, store.document.layout[entity.id].y + 45)
    store.edit('展开属性', d => { d.style.showAttributes = true })
    expect(store.document.layout[field.id]).toEqual({ x: before.x + 90, y: before.y + 45 }); expect(sceneFor(store.document).nodes.find(n => n.id === field.id)?.label).toBe('自定义属性')
  })
  it('copy/paste generates unique IDs, keeps internal relationships and is undoable', () => {
    const store = workspace(), before = clone(store.document); store.copy(store.document.entities.map(e => e.id)); expect(store.paste()).toBe(true)
    expect(store.document.entities).toHaveLength(4); expect(store.document.relationships).toHaveLength(2); validateDocument(store.document)
    const rel = store.document.relationships[1]; expect(rel.from).not.toBe(before.relationships[0].from); expect(rel.to).not.toBe(before.relationships[0].to)
    store.undo(); expect(store.document).toEqual(before)
  })
  it('automatic layout is explicit, reversible and preserves structure and labels', async () => {
    const store = workspace(), before = clone(store.document), after = await beautify(store.document)
    expect(after.entities).toEqual(before.entities); expect(after.relationships).toEqual(before.relationships)
    store.apply(after, '自动排版'); store.undo(); expect(store.document).toEqual(before); store.redo(); expect(store.document).toEqual(after)
  })
  it('size changes affect canvas and exports while old version-1 projects remain readable', () => {
    const store = workspace(), before = sceneFor(store.document).nodes[0], legacy = clone(store.document) as any
    delete legacy.style.nodeScale; expect(validateDocument(legacy).style.nodeScale).toBe(1)
    store.edit('节点尺寸', doc => { doc.style.nodeScale = 1.5 })
    const resized = sceneFor(store.document).nodes[0]; expect(resized.width).toBe(before.width * 1.5); expect(resized.height).toBe(before.height * 1.5); expect(resized.x).toBe(before.x)
  })
})
