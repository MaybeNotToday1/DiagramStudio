import { describe, expect, it } from 'vitest'
import { parseSql, SqlIssue } from '../../src/modules/er/domain/sql'
import { sampleSql } from '../../src/modules/er/domain/sample'
import { validateDocument } from '../../src/modules/er/domain/model'
import { sceneFor } from '../../src/modules/er/domain/scene'
import { renderDrawio, renderSvg } from '../../src/modules/er/domain/export'
import { beautify } from '../../src/modules/er/domain/layout'

describe('MySQL structure parsing', () => {
  it('preserves Chinese comments, primary keys, FK fields and direction', () => {
    const doc = parseSql(sampleSql)
    expect(doc.entities.map(e => e.label)).toEqual(['班级', '学生'])
    expect(doc.entities[0].fields[0]).toMatchObject({ primary: true, nullable: false, label: '班级ID' })
    expect(doc.relationships[0]).toMatchObject({ from: doc.entities[1].id, to: doc.entities[0].id, fromCardinality: 'N', toCardinality: '1', fieldPairs: [{ from: 'class_id', to: 'class_id' }] })
    expect(validateDocument(doc)).toEqual(doc)
  })
  it('supports composite keys and ALTER ADD FOREIGN KEY', () => {
    const doc = parseSql('CREATE TABLE a(x INT,y INT,PRIMARY KEY(x,y)); CREATE TABLE b(x INT,y INT, PRIMARY KEY(x,y)); ALTER TABLE b ADD CONSTRAINT fk FOREIGN KEY(x,y) REFERENCES a(x,y);')
    expect(doc.entities[0].fields.every(f => f.primary)).toBe(true)
    expect(doc.relationships[0].fieldPairs).toHaveLength(2)
    expect(doc.relationships[0].fromCardinality).toBe('1')
  })
  it('accepts semicolons in comments and falls back to raw column names', () => {
    const doc = parseSql("CREATE TABLE t(id INT PRIMARY KEY, name VARCHAR(30) COMMENT '姓;名'); -- finish\n")
    expect(doc.entities[0].fields.map(f => f.label)).toEqual(['id', '姓;名'])
    expect(doc.relationships).toEqual([])
  })
  it('does not silently ignore non-DDL or unsupported ALTER statements', () => {
    expect(() => parseSql('CREATE TABLE a(id INT); SELECT * FROM a;')).toThrow('仅接受')
    expect(() => parseSql('CREATE TABLE a(id INT); ALTER TABLE a ADD COLUMN x INT;')).toThrow('仅支持')
    expect(() => parseSql('CREATE TABLE a(id INT, FOREIGN KEY(id) REFERENCES b(id));')).toThrow('不存在')
  })
  it('reports a syntax location on the correct source line', () => {
    try { parseSql('CREATE TABLE a(id INT);\n\nCREATE TABLE b(,);'); throw new Error('expected failure') }
    catch (error) { expect(error).toBeInstanceOf(SqlIssue); expect((error as SqlIssue).line).toBeGreaterThanOrEqual(3) }
  })
  it('retains stable IDs, relationship naming and manual positions on reimport', () => {
    const old = parseSql(sampleSql), id = old.entities[0].id
    old.layout[id] = { x: -100, y: 250 }; old.relationships[0].name = '属于'
    const next = parseSql(sampleSql.replace('班级名称', '班级标题'), old)
    expect(next.entities[0].id).toBe(id); expect(next.layout[id]).toEqual({ x: -100, y: 250 }); expect(next.relationships[0].name).toBe('属于')
  })
})
describe('project validation and complete export', () => {
  it('renders two distinct arms and cardinalities for a self-referencing foreign key', () => {
    const doc = parseSql("CREATE TABLE employee(id INT PRIMARY KEY, manager_id INT, FOREIGN KEY(manager_id) REFERENCES employee(id));")
    const scene = sceneFor(doc), arms = scene.edges.filter(e => e.label)
    expect(arms).toHaveLength(2); expect(arms[0].bend).not.toEqual(arms[1].bend)
    expect(arms.map(e => e.label).sort()).toEqual(['1', 'N'])
    expect(renderDrawio(doc).match(/<Array as="points">/g)).toHaveLength(2)
    expect(renderSvg(doc)).toContain('>N</text>')
  })
  it('rejects dangling relations, duplicate IDs, invalid versions and injected colors', () => {
    const doc = parseSql(sampleSql)
    expect(() => validateDocument({ ...doc, schemaVersion: 2 })).toThrow('版本')
    expect(() => validateDocument({ ...doc, relationships: [{ ...doc.relationships[0], to: 'missing' }] })).toThrow('不存在')
    expect(() => validateDocument({ ...doc, style: { ...doc.style, ink: 'red; onclick=alert(1)' } })).toThrow('颜色')
  })
  it('exports outside viewport bounds, escapes text and emits editable Draw.io cells', () => {
    const doc = parseSql(sampleSql); doc.layout[doc.entities[0].id] = { x: -800, y: -600 }; doc.entities[0].label = '<script> & 实体'
    const svg = renderSvg(doc), drawio = renderDrawio(doc)
    expect(svg).toContain('&lt;script&gt; &amp; 实体'); expect(svg).not.toContain('<script>')
    expect(svg).toContain('viewBox="-'); expect(drawio.match(/vertex="1"/g)?.length).toBe(sceneFor(doc).nodes.length)
    expect(drawio.match(/edge="1"/g)?.length).toBe(sceneFor(doc).edges.length)
    expect(drawio).not.toContain('data:image')
  })
  it('handles the 30-table / 600-field acceptance fixture', async () => {
    const start = performance.now()
    const sql = Array.from({ length: 30 }, (_, i) => `CREATE TABLE table_${i}(id INT PRIMARY KEY,${Array.from({ length: 19 }, (_, f) => `field_${f} VARCHAR(100) COMMENT '字段${f}'`).join(',')}${i ? `,FOREIGN KEY(field_0) REFERENCES table_${i - 1}(id)` : ''});`).join('\n')
    const doc = await beautify(parseSql(sql))
    expect(sceneFor(doc).nodes).toHaveLength(659)
    expect(renderSvg(doc)).toContain('字段18')
    expect(validateDocument(doc).entities).toHaveLength(30)
    console.info(`30 tables / 600 fields / 29 relationships: parse + layout + SVG ${Math.round(performance.now() - start)} ms`)
  })
})
