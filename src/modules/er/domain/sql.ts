import sqlParser from 'node-sql-parser/build/mysql.js'
import { blankDocument, clone, pruneLabelLayout, uid, type ErDocument, type Entity, type Relationship } from './model'
import { defaultLayout } from './scene'

type Ast = Record<string, any>
export class SqlIssue extends Error {
  constructor(message: string, public line = 1, public column = 1) { super(message) }
}

function statements(sql: string) {
  const result: { text: string; offset: number }[] = []
  let start = 0, quote = '', comment = ''
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i], next = sql[i + 1]
    if (comment === 'line') { if (c === '\n') comment = ''; continue }
    if (comment === 'block') { if (c === '*' && next === '/') { comment = ''; i++ }; continue }
    if (quote) {
      if (c === '\\') { i++; continue }
      if (c === quote) { if (next === quote) i++; else quote = '' }
      continue
    }
    if (c === "'" || c === '"' || c === '`') quote = c
    else if (c === '#' || (c === '-' && next === '-' && /\s/.test(sql[i + 2] || ' '))) comment = 'line'
    else if (c === '/' && next === '*') { comment = 'block'; i++ }
    else if (c === ';') { result.push({ text: sql.slice(start, i + 1), offset: start }); start = i + 1 }
  }
  if (sql.slice(start).trim()) result.push({ text: sql.slice(start), offset: start })
  return result
}
function unquote(value: unknown): string {
  const s = String(value ?? '')
  return /^(['"]).*\1$/s.test(s) ? s.slice(1, -1).replace(/''/g, "'").replace(/\\'/g, "'") : s
}
function columns(value: Ast[]) { return (value || []).map(v => String(typeof v.column === 'object' ? v.column.expr?.value ?? v.column.value : v.column)) }
function tableName(value: Ast) { return [value.db, value.table].filter(Boolean).join('.') }

export function parseSql(sql: string, previous?: ErDocument): ErDocument {
  if (!sql.trim()) throw new SqlIssue('请先输入 CREATE TABLE 建表语句')
  if (sql.length > 2_000_000) throw new SqlIssue('SQL 文件超过 2 MB，请拆分后导入')
  const parser = new sqlParser.Parser(), entities: Entity[] = [], pending: { entity: Entity; definition: Ast; offset: number }[] = []
  const primary = new Map<string, string[]>(), unique = new Map<string, string[][]>()
  const issue = (message: string, offset: number, location?: { line?: number; column?: number }) => {
    const prefix = sql.slice(0, offset), line = prefix.split('\n').length + (location?.line || 1) - 1
    const column = location?.line && location.line > 1 ? location.column || 1 : (prefix.length - prefix.lastIndexOf('\n') - 1) + (location?.column || 1)
    return new SqlIssue(message, line, column)
  }
  for (const statement of statements(sql)) {
    if (!statement.text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*|#[^\n]*/g, '').trim().replace(/;$/, '').trim()) continue
    const leadingWhitespace = statement.text.length - statement.text.trimStart().length
    const parseOffset = statement.offset + leadingWhitespace
    const source = statement.text.trimStart()
    let ast: Ast
    try {
      const parsed = parser.astify(source, { database: 'MySQL', parseOptions: { includeLocations: true } })
      ast = (Array.isArray(parsed) ? parsed[0] : parsed) as Ast
    } catch (error) {
      const loc = (error as { location?: { start: { line: number; column: number } } }).location?.start
      throw issue('SQL 语法无法解析，请检查该位置的括号、逗号或关键字', parseOffset, loc)
    }
    if (ast.type === 'create' && String(ast.keyword).toLowerCase() === 'table') {
      if (ast.as || ast.query_expr || !Array.isArray(ast.create_definitions)) throw issue('暂不支持 CREATE TABLE AS / LIKE，请使用完整字段定义', statement.offset)
      const name = tableName(ast.table[0])
      if (entities.some(e => e.name.toLowerCase() === name.toLowerCase())) throw issue(`表 ${name} 重复定义`, statement.offset)
      const old = previous?.entities.find(e => e.name === name)
      const entity: Entity = { id: old?.id || uid(), name, label: unquote(ast.table_options?.find((o: Ast) => String(o.keyword).toLowerCase() === 'comment')?.value) || name, fields: [] }
      primary.set(entity.id, []); unique.set(entity.id, [])
      for (const def of ast.create_definitions as Ast[]) {
        if (def.resource === 'column') {
          const fieldName = String(def.column.column)
          if (entity.fields.some(f => f.name.toLowerCase() === fieldName.toLowerCase())) throw issue(`字段 ${fieldName} 重复定义`, statement.offset, def.column.loc?.start)
          if (def.reference_definition) throw issue('请将内联 REFERENCES 改为表级 FOREIGN KEY，避免 MySQL 忽略内联外键', statement.offset, def.column.loc?.start)
          const data = def.definition
          if (!data?.dataType) throw issue(`字段 ${fieldName} 缺少可识别的数据类型`, statement.offset, def.column.loc?.start)
          entity.fields.push({
            id: old?.fields.find(f => f.name === fieldName)?.id || uid(), name: fieldName,
            label: String(def.comment?.value?.value || fieldName),
            dataType: String(data.dataType) + (data.length !== undefined ? `(${data.length}${data.scale !== undefined ? `,${data.scale}` : ''})` : ''),
            primary: String(def.primary_key || '').toLowerCase().includes('primary'), nullable: def.nullable?.type !== 'not null',
          })
          if (String(def.primary_key || '').toLowerCase().includes('primary')) primary.get(entity.id)!.push(fieldName)
          if (def.unique) unique.get(entity.id)!.push([fieldName])
        } else if (def.resource === 'constraint') {
          const kind = String(def.constraint_type || '').toLowerCase()
          if (kind === 'primary key') primary.get(entity.id)!.push(...columns(def.definition))
          else if (kind === 'foreign key') pending.push({ entity, definition: def, offset: statement.offset })
          else if (kind.includes('unique')) unique.get(entity.id)!.push(columns(def.definition))
          else if (kind !== 'check') throw issue(`尚不支持约束 ${kind || '未知类型'}`, statement.offset)
        } else if (def.resource !== 'index') throw issue('存在尚不支持的建表定义，未覆盖当前图表', statement.offset)
      }
      if (!entity.fields.length) throw issue(`表 ${name} 没有字段`, statement.offset)
      entities.push(entity)
    } else if (ast.type === 'alter') {
      const name = tableName(ast.table[0]), entity = entities.find(e => e.name === name)
      if (!entity) throw issue(`ALTER TABLE 引用了未定义的表 ${name}`, statement.offset)
      for (const expr of ast.expr || []) {
        const def = expr.create_definitions
        if (expr.action === 'add' && def?.resource === 'constraint' && String(def.constraint_type).toLowerCase() === 'foreign key') pending.push({ entity, definition: def, offset: statement.offset })
        else throw issue('ALTER TABLE 目前仅支持 ADD FOREIGN KEY；其他修改请写入 CREATE TABLE', statement.offset)
      }
    } else throw issue('仅接受 CREATE TABLE 和 ALTER TABLE ADD FOREIGN KEY；其他语句不会执行或忽略', statement.offset)
  }
  if (!entities.length) throw new SqlIssue('没有找到可解析的 CREATE TABLE 语句')
  if (entities.length > 200 || entities.some(e => e.fields.length > 500)) throw new SqlIssue('结构超过当前支持范围：最多 200 张表、每表 500 个字段')
  for (const entity of entities) for (const name of primary.get(entity.id)!) {
    const field = entity.fields.find(f => f.name === name)
    if (!field) throw new SqlIssue(`主键字段 ${entity.name}.${name} 不存在`)
    field.primary = true; field.nullable = false
  }
  const relationships: Relationship[] = pending.map(({ entity, definition: def, offset }) => {
    const ref = def.reference_definition, targetName = ref && tableName(ref.table[0])
    const matches = entities.filter(e => e.name === targetName || (!ref?.table[0].db && e.name === [entity.name.includes('.') ? entity.name.slice(0, entity.name.lastIndexOf('.')) : '', targetName].filter(Boolean).join('.')))
    if (matches.length !== 1) throw issue(`外键引用的表 ${targetName || '未知'} 不存在或不明确`, offset)
    const target = matches[0], sourceNames = columns(def.definition), targetNames = columns(ref.definition)
    if (!sourceNames.length || sourceNames.length !== targetNames.length) throw issue('复合外键两端字段数量不一致', offset)
    if (sourceNames.some(n => !entity.fields.some(f => f.name === n)) || targetNames.some(n => !target.fields.some(f => f.name === n))) throw issue('外键引用了不存在的字段', offset)
    const fieldPairs = sourceNames.map((from, i) => ({ from, to: targetNames[i] }))
    const old = previous?.relationships.find(r => r.from === entity.id && r.to === target.id && JSON.stringify(r.fieldPairs) === JSON.stringify(fieldPairs))
    const keys = [primary.get(entity.id)!, ...unique.get(entity.id)!]
    const one = keys.some(key => key.length === sourceNames.length && key.every(k => sourceNames.includes(k)))
    return { id: old?.id || uid(), name: old?.name || '关联', from: entity.id, to: target.id, fromCardinality: old?.fromCardinality || (one ? '1' : 'N'), toCardinality: old?.toCardinality || '1', fieldPairs }
  })
  const doc = previous ? clone(previous) : blankDocument()
  doc.sql = sql; doc.entities = entities; doc.relationships = relationships
  const ids = new Set([...entities.flatMap(e => [e.id, ...e.fields.map(f => f.id)]), ...relationships.map(r => r.id)])
  doc.layout = Object.fromEntries(Object.entries(doc.layout).filter(([id]) => ids.has(id)))
  doc.initialLayout = defaultLayout(doc)
  doc.layout = { ...doc.initialLayout, ...doc.layout }
  pruneLabelLayout(doc)
  if (doc.view.entityIds !== null && !doc.view.entityIds.length) doc.view.entityIds = null
  return doc
}

export function structureDiff(before: ErDocument, after: ErDocument) {
  const old = new Set(before.entities.map(e => e.name)), next = new Set(after.entities.map(e => e.name))
  return {
    added: after.entities.filter(e => !old.has(e.name)).map(e => e.name),
    removed: before.entities.filter(e => !next.has(e.name)).map(e => e.name),
    changed: after.entities.filter(e => old.has(e.name) && JSON.stringify(e) !== JSON.stringify(before.entities.find(v => v.name === e.name))).map(e => e.name),
    relationshipDelta: after.relationships.length - before.relationships.length,
  }
}
