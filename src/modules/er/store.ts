import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { openDB } from 'idb'
import { blankDocument, clone, pruneLabelLayout, uid, validateDocument, type CardinalityPosition, type ErDocument } from './domain/model'
import { defaultCardinalityPosition, defaultLayout, sceneFor } from './domain/scene'
import { parseSql } from './domain/sql'
import { sampleSql } from './domain/sample'

interface Snapshot { label: string; document: ErDocument; time: string }
export interface SqlHistoryEntry { id: string; sql: string; title: string; time: string; entities: number }
function sqlRecords(value: unknown): SqlHistoryEntry[] {
  if (!Array.isArray(value)) return []
  let length = 0
  return value.filter(v => v && typeof v.id === 'string' && typeof v.sql === 'string' && v.sql.length <= 2_000_000 && typeof v.title === 'string' && typeof v.time === 'string' && Number.isInteger(v.entities) && v.entities >= 0 && v.entities <= 200).slice(0, 20).filter(v => { length += v.sql.length; return length <= 4_000_000 })
}
function exampleDocument() { const doc = parseSql(sampleSql); doc.title = '班级与学生关系图'; return doc }
const db = () => openDB('diagram-studio', 1, { upgrade(db) { db.createObjectStore('workspace') } })
export const useStudio = defineStore('studio', () => {
  const document = ref<ErDocument>(blankDocument()), ready = ref(false), saved = ref('正在准备工作区'), storageError = ref('')
  const past = ref<Snapshot[]>([]), future = ref<Snapshot[]>([]), restorePoints = ref<Snapshot[]>([])
  const sqlHistory = ref<SqlHistoryEntry[]>([]), resetting = ref(false)
  let timer: ReturnType<typeof setTimeout>, queue = Promise.resolve()
  const snapshot = (label: string): Snapshot => ({ label, document: clone(document.value), time: new Date().toISOString() })
  async function persist() {
    if (resetting.value) return queue
    const state = { document: clone(document.value), restorePoints: clone(restorePoints.value), sqlHistory: clone(sqlHistory.value) }
    queue = queue.catch(() => {}).then(async () => {
      try { const connection = await db(); await connection.put('workspace', state, 'current'); saved.value = `已保存 ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`; storageError.value = '' }
      catch { storageError.value = '浏览器存储不可用，请立即下载项目备份'; saved.value = '保存失败' }
    })
    return queue
  }
  async function initialize() {
    try {
      const connection = await db(), value = await connection.get('workspace', 'current')
      if (value) { document.value = validateDocument(value.document); restorePoints.value = (value.restorePoints || []).slice(-20).map((s: Snapshot) => ({ ...s, document: validateDocument(s.document) })); sqlHistory.value = sqlRecords(value.sqlHistory); saved.value = '已恢复上次编辑' }
      else { document.value = exampleDocument(); saved.value = '示例工作区' }
    } catch { document.value = exampleDocument(); storageError.value = '无法恢复浏览器数据，请检查或导入项目备份' }
    ready.value = true
  }
  function apply(next: ErDocument, label: string) {
    past.value.push(snapshot(label)); if (past.value.length > 60) past.value.shift()
    future.value = []; const clean = clone(next); pruneLabelLayout(clean); document.value = clean
  }
  function edit(label: string, fn: (doc: ErDocument) => void) { const next = clone(document.value); fn(next); apply(next, label) }
  function checkpoint(label: string) { restorePoints.value.push(snapshot(label)); if (restorePoints.value.length > 20) restorePoints.value.shift() }
  function applySql(next: ErDocument) {
    checkpoint('SQL 更新前'); apply(next, '解析 SQL')
    sqlHistory.value = sqlRecords([{ id: uid(), sql: next.sql, title: next.title, time: new Date().toISOString(), entities: next.entities.length }, ...sqlHistory.value])
  }
  async function resetWorkspace() {
    resetting.value = true; clearTimeout(timer)
    const next = exampleDocument()
    try {
      // Serialize after older autosaves; commit the cleared workspace before changing memory.
      queue = queue.catch(() => {}).then(async () => { const connection = await db(); await connection.put('workspace', { document: clone(next), restorePoints: [], sqlHistory: [] }, 'current') })
      await queue
      document.value = next; restorePoints.value = []; sqlHistory.value = []; past.value = []; future.value = []; clipboard = undefined
      storageError.value = ''; saved.value = '已重置并保存'
    } catch (error) { storageError.value = '重置未完成，原工作区仍保留，请下载项目备份或重试'; saved.value = '重置失败'; throw error }
    finally { resetting.value = false }
  }
  function undo() { const previous = past.value.pop(); if (!previous) return; future.value.push(snapshot(previous.label)); document.value = clone(previous.document) }
  function redo() { const next = future.value.pop(); if (!next) return; past.value.push(snapshot(next.label)); document.value = clone(next.document) }
  function remove(ids: string[]) {
    edit('删除元素', doc => {
      const entities = new Set(ids.filter(id => doc.entities.some(e => e.id === id)))
      const deletedFields = new Map<string, Set<string>>()
      doc.entities.forEach(e => deletedFields.set(e.id, new Set(e.fields.filter(f => ids.includes(f.id)).map(f => f.name))))
      doc.entities = doc.entities.filter(e => !entities.has(e.id)).map(e => ({ ...e, fields: e.fields.filter(f => !ids.includes(f.id)) }))
      doc.relationships = doc.relationships.filter(r => !ids.includes(r.id) && !entities.has(r.from) && !entities.has(r.to) && !r.fieldPairs?.some(p => deletedFields.get(r.from)?.has(p.from) || deletedFields.get(r.to)?.has(p.to)))
      const valid = new Set([...doc.entities.flatMap(e => [e.id, ...e.fields.map(f => f.id)]), ...doc.relationships.map(r => r.id)])
      doc.layout = Object.fromEntries(Object.entries(doc.layout).filter(([id]) => valid.has(id)))
    })
  }
  function move(id: string, x: number, y: number) {
    edit('移动节点', doc => {
      const current = doc.layout[id] || defaultLayout(doc)[id]; if (!current) return
      const dx = x - current.x, dy = y - current.y
      const entity = doc.entities.find(e => e.id === id), fallback = defaultLayout(doc)
      if (entity) for (const f of entity.fields) { const p = doc.layout[f.id] || fallback[f.id]; doc.layout[f.id] = { x: p.x + dx, y: p.y + dy } }
      doc.layout[id] = { x, y }
    })
  }
  function moveCardinality(edgeId: string, position: CardinalityPosition) {
    if (!document.value.relationships.some(r => edgeId === `${r.id}-from` || edgeId === `${r.id}-to`)) return
    const current = document.value.labelLayout[edgeId] || defaultCardinalityPosition()
    if (Math.abs(current.distance - position.distance) < 1e-8 && Math.hypot(current.offset.x - position.offset.x, current.offset.y - position.offset.y) < 1e-8) return
    edit('移动关系基数', doc => { doc.labelLayout[edgeId] = clone(position) })
  }
  let clipboard: ErDocument | undefined
  function copy(ids: string[]) {
    clipboard = clone(document.value); clipboard.entities = clipboard.entities.filter(e => ids.includes(e.id))
    const included = new Set(clipboard.entities.map(e => e.id)); clipboard.relationships = clipboard.relationships.filter(r => included.has(r.from) && included.has(r.to))
  }
  function paste() {
    if (!clipboard?.entities.length) return false
    const fragment = clone(clipboard)
    edit('粘贴实体', doc => {
      const ids = new Map<string, string>(), fallback = defaultLayout(fragment)
      const remap = (id: string) => { const next = uid(); ids.set(id, next); const p = fragment.layout[id] || fallback[id]; if (p) doc.layout[next] = { x: p.x + 60, y: p.y + 60 }; return next }
      doc.entities.push(...fragment.entities.map(e => ({ ...e, id: remap(e.id), name: `${e.name}_copy_${doc.entities.length + 1}`, label: `${e.label} 副本`, fields: e.fields.map(f => ({ ...f, id: remap(f.id) })) })))
      if (doc.view.entityIds) doc.view.entityIds.push(...fragment.entities.map(e => ids.get(e.id)!))
      doc.relationships.push(...fragment.relationships.map(r => {
        const id = remap(r.id)
        for (const side of ['from', 'to']) {
          if (fragment.labelLayout[`${r.id}-${side}`]) doc.labelLayout[`${id}-${side}`] = clone(fragment.labelLayout[`${r.id}-${side}`])
          if (fragment.style.cardinalities[`${r.id}-${side}`]) doc.style.cardinalities[`${id}-${side}`] = clone(fragment.style.cardinalities[`${r.id}-${side}`])
        }
        return { ...r, id, from: ids.get(r.from)!, to: ids.get(r.to)! }
      }))
    })
    return true
  }
  function align(ids: string[], kind: 'horizontal' | 'vertical' | 'distribute') {
    const nodes = sceneFor(document.value).nodes.filter(n => ids.includes(n.id))
    if (nodes.length < 2) return
    edit('对齐节点', doc => {
      const sorted = [...nodes].sort((a, b) => a.x - b.x), averageX = nodes.reduce((v, n) => v + n.x, 0) / nodes.length, averageY = nodes.reduce((v, n) => v + n.y, 0) / nodes.length
      for (const [i, n] of sorted.entries()) {
        const x = kind === 'vertical' ? averageX : kind === 'distribute' ? sorted[0].x + (sorted.at(-1)!.x - sorted[0].x) * i / (sorted.length - 1) : n.x
        const y = kind === 'horizontal' ? averageY : n.y, dx = x - n.x, dy = y - n.y
        const entity = doc.entities.find(e => e.id === n.id), fallback = defaultLayout(doc)
        if (entity) for (const f of entity.fields) { const p = doc.layout[f.id] || fallback[f.id]; doc.layout[f.id] = { x: p.x + dx, y: p.y + dy } }
        doc.layout[n.id] = { x, y }
      }
    })
  }
  watch([document, restorePoints, sqlHistory], () => { if (!ready.value || resetting.value) return; saved.value = '正在保存…'; clearTimeout(timer); timer = setTimeout(() => void persist(), 500) }, { deep: true })
  return { document, ready, saved, storageError, past, future, restorePoints, sqlHistory, resetting, initialize, apply, applySql, resetWorkspace, edit, checkpoint, undo, redo, remove, move, moveCardinality, copy, paste, align, persist }
})
