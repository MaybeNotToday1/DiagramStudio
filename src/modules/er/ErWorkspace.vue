<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import ErCanvas from './components/ErCanvas.vue'
import StyleSettings from './components/StyleSettings.vue'
import EntityVisibilityDialog from './components/EntityVisibilityDialog.vue'
import SqlHelp from './components/SqlHelp.vue'
import SqlHistory from './components/SqlHistory.vue'
import ErHelp from './components/ErHelp.vue'
import { useStudio } from './store'
import { blankDocument, clone, defaultStyle, fieldDisplayName, uid, validateDocument, visibleDocument, visibleEntities, type CardinalityStyle, type Entity, type ErDocument, type Relationship } from './domain/model'
import { parseSql, SqlIssue, structureDiff } from './domain/sql'
import { sampleSql } from './domain/sample'
import { beautify, restoreDefaultLayout, type LayoutTemplate } from './domain/layout'
import { cardinalityStyle, defaultLayout, rearrangeAttributes } from './domain/scene'
import { download, entityArchive, rasterExport, renderDrawio, standaloneSvg, safeFilename } from './domain/export'

const studio = useStudio(), canvas = ref<InstanceType<typeof ErCanvas>>()
const mode = ref('sql'), search = ref(''), selectedIds = ref<string[]>([]), busy = ref(false), parseError = ref(''), activePanel = ref('entities')
const sqlInput = ref<HTMLTextAreaElement>(), sqlLines = ref<HTMLDivElement>(), sqlFile = ref<HTMLInputElement>(), projectFile = ref<HTMLInputElement>()
const entityOpen = ref(false), relationOpen = ref(false), styleOpen = ref(false), exportOpen = ref(false), historyOpen = ref(false)
const visibilityOpen = ref(false), sqlHelpOpen = ref(false), sqlHistoryOpen = ref(false), layoutTemplate = ref<LayoutTemplate>('horizontal')
const lastLayoutTemplate = ref<LayoutTemplate>()
const entityDraft = ref<Entity>({ id: '', name: '', label: '', fields: [] }), relationDraft = ref<Relationship>({ id: '', name: '', from: '', to: '', fromCardinality: 'N', toCardinality: '1' })
const cardinalityOpen = ref(false), cardinalityEdge = ref(''), cardinalityValue = ref('1')
const cardinalityDraft = ref<CardinalityStyle>({ fontSize: 15, fontFamily: 'Noto Serif SC', fontWeight: 'normal', color: '#303b42' })
const defaultExportSettings = () => ({ format: 'png', ratio: 2, padding: 40, transparent: false, paper: 'A4', orientation: 'landscape', paginate: false, individual: false })
const styleDraft = ref(defaultStyle()), exportSettings = reactive(defaultExportSettings())
const fullscreen = ref(false), exporting = ref(false), exportProgress = ref('')
let exportController: AbortController | undefined
const pdfStatus = ref(''), pdfJob = ref<{ id: string; state: string; error?: string }>(), pdfCreating = ref(false)
const entities = computed(() => studio.document.entities.filter(e => `${e.label} ${e.name} ${e.fields.map(f => f.label).join(' ')}`.toLowerCase().includes(search.value.toLowerCase())))
const fieldCount = computed(() => studio.document.entities.reduce((n, e) => n + e.fields.length, 0))
const fileBase = computed(() => safeFilename(studio.document.title))
const visibleCount = computed(() => visibleEntities(studio.document).length)
let polling: ReturnType<typeof setTimeout> | undefined
let requestGeneration = 0

async function confirm(message: string, title = '确认操作') { try { await ElMessageBox.confirm(message, title, { confirmButtonText: '确认', cancelButtonText: '取消', type: 'warning' }); return true } catch { return false } }
function fail(error: unknown) { ElMessage.error(error instanceof Error ? error.message : '操作失败，请重试') }
async function generate() {
  const start = performance.now()
  try {
    const next = parseSql(studio.document.sql, studio.document)
    if (studio.document.entities.length) {
      const diff = structureDiff(studio.document, next)
      if (!await confirm(`新增 ${diff.added.length} 张表，移除 ${diff.removed.length} 张表，更新 ${diff.changed.length} 张表；关系数量变化 ${diff.relationshipDelta > 0 ? '+' : ''}${diff.relationshipDelta}。确认后保留同名表及字段的布局，现有手工关系以 SQL 定义为准。`, '检查 SQL 结构变化')) return
    }
    studio.applySql(next); parseError.value = ''; resetLayoutCycle()
    setTimeout(() => canvas.value?.fit(), 40)
    ElMessage.success(`已解析 ${next.entities.length} 个实体 · ${Math.round(performance.now() - start)} ms`)
  } catch (error) {
    if (error instanceof SqlIssue) {
      parseError.value = `第 ${error.line} 行，第 ${error.column} 列：${error.message}`
      const lines = studio.document.sql.split('\n'), offset = lines.slice(0, error.line - 1).reduce((n, l) => n + l.length + 1, 0) + error.column - 1
      sqlInput.value?.focus(); sqlInput.value?.setSelectionRange(offset, offset + 1)
    } else fail(error)
  }
}
async function loadSample() {
  if (!await confirm('载入班级与学生示例？当前图表会先保存恢复点。')) return
  studio.checkpoint('载入示例前'); const doc = parseSql(sampleSql); doc.title = '班级与学生关系图'; studio.apply(doc, '载入示例'); parseError.value = ''; resetLayoutCycle(); setTimeout(() => canvas.value?.fit(), 40)
}
async function newProject() {
  if (!await confirm('新建空白 ER 图？当前图表会先保存恢复点。')) return
  studio.checkpoint('新建项目前'); studio.apply(blankDocument(), '新建项目'); mode.value = 'manual'; parseError.value = ''; resetLayoutCycle()
}
function showEntities(ids: string[] | null) {
  studio.edit('指定显示实体', doc => { doc.view.entityIds = ids })
  setTimeout(() => canvas.value?.fit(), 40)
}
function loadHistorySql(sql: string) { studio.edit('载入历史 SQL', doc => { doc.sql = sql }); mode.value = 'sql'; parseError.value = ''; ElMessage.info('已载入 SQL，点击生成 ER 图后更新画布') }
function resetLayoutCycle() { layoutTemplate.value = 'horizontal'; lastLayoutTemplate.value = undefined }
function defaultPosition() { studio.apply(restoreDefaultLayout(studio.document), '恢复默认布局'); resetLayoutCycle(); setTimeout(() => canvas.value?.fit(), 40); ElMessage.success('已恢复生成时的默认位置，样式保持不变；可撤销') }
async function resetWorkspace() {
  try {
    await ElMessageBox.confirm('当前设计、样式、实体筛选、恢复点、SQL 历史和撤销记录将永久清空，无法通过本网页恢复。重置后回到班级与学生示例。已下载的项目备份文件不会删除。', '重置整个工作区', { confirmButtonText: '确认重置并清空', cancelButtonText: '取消', type: 'warning', distinguishCancelAndClose: true })
  } catch { return }
  try {
    await studio.resetWorkspace(); requestGeneration++; clearTimeout(polling); pdfJob.value = undefined; pdfStatus.value = ''
    parseError.value = ''; mode.value = 'sql'; search.value = ''; activePanel.value = 'entities'; selectedIds.value = []; resetLayoutCycle()
    styleDraft.value = defaultStyle(); Object.assign(exportSettings, defaultExportSettings()); exportProgress.value = ''
    historyOpen.value = sqlHistoryOpen.value = visibilityOpen.value = sqlHelpOpen.value = false
    if (fullscreen.value) await toggleFullscreen()
    setTimeout(() => canvas.value?.fit(), 40); ElMessage.success('工作区已重置，旧恢复点和 SQL 历史已清空')
  } catch { ElMessage.error('无法保存重置结果，已保留原工作区；请检查浏览器存储后重试') }
}
async function importSql(event: Event) {
  const input = event.target as HTMLInputElement, file = input.files?.[0]
  if (!file) return
  try { if (file.size > 2_000_000) throw new Error('SQL 文件不能超过 2 MB'); studio.document.sql = await file.text(); parseError.value = ''; ElMessage.info('已读取 SQL，请点击生成检查并应用') } catch (e) { fail(e) } finally { input.value = '' }
}
async function importProject(event: Event) {
  const input = event.target as HTMLInputElement, file = input.files?.[0]
  if (!file) return
  try {
    if (file.size > 10_000_000) throw new Error('项目文件不能超过 10 MB')
    const doc = validateDocument(JSON.parse(await file.text()))
    if (!await confirm(`导入「${doc.title}」？当前项目会先保存恢复点。`)) return
    studio.checkpoint('导入项目前'); studio.apply(doc, '导入项目'); parseError.value = ''; resetLayoutCycle(); setTimeout(() => canvas.value?.fit(), 30); ElMessage.success('项目已恢复')
  } catch (e) { fail(e) } finally { input.value = '' }
}
async function backup() { await studio.persist(); download(JSON.stringify(studio.document, null, 2), `${fileBase.value}.diagram.json`, 'application/json'); ElMessage.success('项目备份已下载') }
function addField() { entityDraft.value.fields.push({ id: uid(), name: `field_${entityDraft.value.fields.length + 1}`, label: '', dataType: 'VARCHAR(100)', primary: false, nullable: true }) }
function editEntity(entity?: Entity) { entityDraft.value = entity ? clone(entity) : { id: uid(), name: `table_${studio.document.entities.length + 1}`, label: '', fields: [] }; entityOpen.value = true }
function saveEntity() {
  const draft = clone(entityDraft.value); draft.name = draft.name.trim(); draft.label = draft.label.trim() || draft.name
  if (!draft.name) return ElMessage.warning('请输入实体原名称')
  if (studio.document.entities.some(e => e.id !== draft.id && e.name.toLowerCase() === draft.name.toLowerCase())) return ElMessage.warning('实体原名称不能重复，显示名称可以重复')
  const names = new Set<string>()
  for (const field of draft.fields) { field.name = field.name.trim(); field.label = field.label.trim() || field.name; if (!field.name || names.has(field.name.toLowerCase())) return ElMessage.warning('字段原名称不能为空或重复'); names.add(field.name.toLowerCase()); if (field.primary) field.nullable = false }
  studio.edit('编辑实体', doc => {
    const index = doc.entities.findIndex(e => e.id === draft.id), old = doc.entities[index]
    if (index < 0) doc.entities.push(draft); else doc.entities[index] = draft
    if (old) doc.relationships = doc.relationships.filter(rel => {
      if (!rel.fieldPairs) return true
      for (const pair of rel.fieldPairs) {
        if (rel.from === draft.id) { const id = old.fields.find(f => f.name === pair.from)?.id, next = draft.fields.find(f => f.id === id); if (!next) return false; pair.from = next.name }
        if (rel.to === draft.id) { const id = old.fields.find(f => f.name === pair.to)?.id, next = draft.fields.find(f => f.id === id); if (!next) return false; pair.to = next.name }
      }
      return true
    })
    const validIds = new Set([...doc.entities.flatMap(e => [e.id, ...e.fields.map(f => f.id)]), ...doc.relationships.map(r => r.id)])
    doc.layout = Object.fromEntries(Object.entries(doc.layout).filter(([id]) => validIds.has(id)))
    doc.layout = { ...defaultLayout(doc), ...doc.layout }
  })
  entityOpen.value = false
}
function editRelation(rel?: Relationship) {
  if (!studio.document.entities.length) return ElMessage.warning('请先添加实体')
  relationDraft.value = rel ? clone(rel) : { id: uid(), name: '关联', from: studio.document.entities[0].id, to: studio.document.entities[1]?.id || studio.document.entities[0].id, fromCardinality: 'N', toCardinality: '1' }; relationOpen.value = true
}
function saveRelation() {
  const draft = clone(relationDraft.value); if (!draft.from || !draft.to || !draft.name.trim()) return ElMessage.warning('请完整填写关系')
  const old = studio.document.relationships.find(r => r.id === draft.id)
  if (old && (old.from !== draft.from || old.to !== draft.to)) delete draft.fieldPairs
  studio.edit('编辑关系', doc => { const index = doc.relationships.findIndex(r => r.id === draft.id); if (index < 0) doc.relationships.push(draft); else doc.relationships[index] = draft; doc.layout = { ...defaultLayout(doc), ...doc.layout } }); relationOpen.value = false
}
function editCardinality(edgeId: string) {
  const rel = studio.document.relationships.find(r => edgeId === `${r.id}-from` || edgeId === `${r.id}-to`)
  if (!rel) return
  cardinalityEdge.value = edgeId; cardinalityValue.value = edgeId.endsWith('-from') ? rel.fromCardinality : rel.toCardinality
  cardinalityDraft.value = clone(cardinalityStyle(studio.document, edgeId)); cardinalityOpen.value = true
}
function saveCardinality(inherit = false) {
  studio.edit('编辑关系基数', doc => {
    const rel = doc.relationships.find(r => cardinalityEdge.value === `${r.id}-from` || cardinalityEdge.value === `${r.id}-to`)!
    if (cardinalityEdge.value.endsWith('-from')) rel.fromCardinality = cardinalityValue.value; else rel.toCardinality = cardinalityValue.value
    if (inherit) delete doc.style.cardinalities[cardinalityEdge.value]
    else doc.style.cardinalities[cardinalityEdge.value] = clone(cardinalityDraft.value)
  })
  cardinalityOpen.value = false
}
async function remove(ids: string[]) { if (ids.length && await confirm('删除所选元素及相关连线？可通过撤销恢复。')) studio.remove(ids) }
async function onEdit(id: string) {
  const entity = studio.document.entities.find(e => e.id === id), relation = studio.document.relationships.find(r => r.id === id)
  if (entity) return editEntity(entity)
  if (relation) return editRelation(relation)
  const parent = studio.document.entities.find(e => e.fields.some(f => f.id === id)), field = parent?.fields.find(f => f.id === id)
  if (field) try { const result = await ElMessageBox.prompt('修改画布显示名称，数据库字段原名称保持不变。', '编辑属性文字', { inputValue: field.label, confirmButtonText: '保存', cancelButtonText: '取消', inputValidator: value => !!value?.trim() || '名称不能为空' }); studio.edit('修改属性文字', doc => { doc.entities.find(e => e.id === parent!.id)!.fields.find(f => f.id === id)!.label = result.value.trim() }) } catch { /* cancelled */ }
}
async function layout() {
  busy.value = true
  const baseline = JSON.stringify(studio.document), start = performance.now()
  const direction = layoutTemplate.value
  try {
    const next = await beautify(studio.document, direction)
    if (JSON.stringify(studio.document) !== baseline) { ElMessage.warning('排版期间图表已修改，已保留新内容；请再次点击排版'); return }
    studio.apply(next, '美化排版'); lastLayoutTemplate.value = direction; layoutTemplate.value = direction === 'horizontal' ? 'vertical' : 'horizontal'; setTimeout(() => canvas.value?.fit(), 30)
    ElMessage.success(`${direction === 'horizontal' ? '横向' : '纵向'}排版完成 · ${Math.round(performance.now() - start)} ms`)
  } catch (e) { fail(e) } finally { busy.value = false }
}
function applyStyle() {
  try {
    const style = validateDocument({ ...clone(studio.document), style: clone(styleDraft.value) }).style
    studio.edit('修改样式', doc => {
      const rearrange = style.attributeLayout !== doc.style.attributeLayout || style.attributeDistance !== doc.style.attributeDistance || style.spacing !== doc.style.spacing
      doc.style = style
      if (rearrange) rearrangeAttributes(doc)
    })
    styleOpen.value = false
  } catch (e) { fail(e) }
}
async function toggleFullscreen() {
  if (fullscreen.value) { if (document.fullscreenElement) await document.exitFullscreen(); fullscreen.value = false }
  else {
    fullscreen.value = true
    try { if (document.fullscreenEnabled) await document.documentElement.requestFullscreen() } catch { ElMessage.info('浏览器未允许全屏，已切换到窗口内放大模式') }
  }
  setTimeout(() => canvas.value?.fit(), 50)
}
function onFullscreenChange() { if (!document.fullscreenElement) { fullscreen.value = false; setTimeout(() => canvas.value?.fit(), 50) } }
function onEscape(event: KeyboardEvent) { if (event.key === 'Escape' && fullscreen.value && !styleOpen.value && !exportOpen.value && !entityOpen.value && !relationOpen.value && !cardinalityOpen.value && !visibilityOpen.value && !sqlHelpOpen.value && !sqlHistoryOpen.value && !historyOpen.value) void toggleFullscreen() }
async function exportDiagram() {
  if (!visibleCount.value) return ElMessage.warning('当前没有显示实体，请先调整显示范围或创建实体')
  if (exporting.value || pdfCreating.value) return
  const snapshot = visibleDocument(studio.document), settings = { ...exportSettings }
  exporting.value = true; exportProgress.value = ''; exportController = new AbortController()
  try {
    if (settings.format === 'pdf') return await createPdf()
    await studio.persist()
    if (settings.individual && ['png', 'jpeg'].includes(settings.format)) {
      exportProgress.value = `正在生成 0 / ${snapshot.entities.length}`
      const bytes = await entityArchive(snapshot, { ...settings, format: settings.format as 'png' | 'jpeg' }, (done, total) => { exportProgress.value = `正在生成 ${done} / ${total}` }, exportController.signal)
      download(bytes as Uint8Array<ArrayBuffer>, `${safeFilename(snapshot.title)}-独立实体图.zip`, 'application/zip')
      exportProgress.value = `已导出 ${snapshot.entities.length} 张独立实体图`
    } else if (settings.format === 'svg') download(await standaloneSvg(snapshot, settings), `${safeFilename(snapshot.title)}.svg`, 'image/svg+xml')
    else if (settings.format === 'drawio') download(renderDrawio(snapshot, settings.padding), `${safeFilename(snapshot.title)}.drawio`, 'application/xml')
    else await rasterExport(snapshot, settings.format as 'png' | 'jpeg', settings.ratio, settings.padding, settings.transparent)
    ElMessage.success('导出文件已下载')
  } catch (e) { exportProgress.value = ''; if (exportController.signal.aborted) ElMessage.info('已取消批量导出'); else fail(e) } finally { exporting.value = false; exportController = undefined }
}
async function readResponse(response: Response) { if (!response.ok) { const body = await response.json().catch(() => null); throw new Error(body?.message || `服务请求失败（${response.status}）`) }; return response.json() }
async function createPdf() {
  const generation = requestGeneration
  pdfCreating.value = true; pdfStatus.value = '正在提交…'; pdfJob.value = undefined; clearTimeout(polling)
  try {
    const response = await fetch('/api/v1/export-jobs', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Diagram-Request': '1' }, body: JSON.stringify({ requestId: uid(), document: visibleDocument(studio.document), paper: exportSettings.paper, orientation: exportSettings.orientation, paginate: exportSettings.paginate, padding: exportSettings.padding }) })
    const job = await readResponse(response); if (generation !== requestGeneration) return
    pdfJob.value = job; pollPdf()
  } catch (e) { pdfStatus.value = ''; fail(e instanceof TypeError ? new Error('PDF 后台暂不可用，请启动完整服务；本地图形导出仍可使用') : e) } finally { pdfCreating.value = false }
}
async function pollPdf() {
  if (!pdfJob.value) return
  const generation = requestGeneration, id = pdfJob.value.id
  try {
    const job = await readResponse(await fetch(`/api/v1/export-jobs/${id}`))
    if (generation !== requestGeneration || pdfJob.value?.id !== id) return
    pdfJob.value = job
    const state = pdfJob.value!.state; pdfStatus.value = ({ QUEUED: '正在排队', RUNNING: '正在生成 PDF', SUCCEEDED: 'PDF 已生成，可以下载', FAILED: pdfJob.value!.error || '生成失败' } as Record<string, string>)[state] || state
    if (state === 'QUEUED' || state === 'RUNNING') polling = setTimeout(pollPdf, 800)
  } catch (e) { if (generation === requestGeneration && pdfJob.value?.id === id) { pdfStatus.value = '无法查询任务，请检查后台连接'; fail(e) } }
}
function beforeUnload(event: BeforeUnloadEvent) { void studio.persist(); if (studio.saved === '正在保存…' || studio.storageError) { event.preventDefault(); event.returnValue = '' } }
onMounted(() => { void studio.initialize(); window.addEventListener('beforeunload', beforeUnload); document.addEventListener('fullscreenchange', onFullscreenChange); window.addEventListener('keydown', onEscape) })
onBeforeUnmount(() => { clearTimeout(polling); exportController?.abort(); window.removeEventListener('beforeunload', beforeUnload); document.removeEventListener('fullscreenchange', onFullscreenChange); window.removeEventListener('keydown', onEscape) })
</script>

<template>
  <div class="studio-app">
    <aside class="rail"><a class="brand-mark" aria-label="Diagram Studio" href="/">d<span>·</span></a><div class="rail-item active" title="ER 工作台"><span>◇</span><small>ER 图</small></div><div class="rail-bottom"><span class="online-dot"></span><small>本地工作区</small></div></aside>
    <main class="main-shell" :inert="studio.resetting">
      <div id="workspace" class="first-screen" tabindex="-1">
      <header class="topbar"><div class="brand-name">DIAGRAM <b>STUDIO</b><span class="version-tag">ER WORKSPACE</span></div><div class="topbar-actions"><button class="text-button reset-workspace" :disabled="busy || exporting || pdfCreating || studio.resetting" @click="resetWorkspace">重置工作区</button><button class="text-button" @click="historyOpen = true">↶ 恢复记录</button><button class="text-button" @click="projectFile?.click()">导入项目</button><button class="button button-outline" @click="backup">↓ 项目备份</button></div></header>
      <section class="workspace-heading"><div><div class="eyebrow">DATABASE DESIGN / 实体关系 <span class="small-badge">CHEN ER</span></div><div class="title-row"><h1>让数据关系，一目了然<span>。</span></h1></div><p>从 MySQL 建表语句到可编辑的实体关系图。</p></div><div class="heading-overview"><strong>一份结构，多种表达。</strong><p>SQL 解析 · 手工建模 · 排版与导出</p><nav aria-label="帮助导航"><a href="#usage-guide">使用方法 <span aria-hidden="true">↗</span></a><a href="#common-questions">常见问题 <span aria-hidden="true">↗</span></a></nav></div><div class="workspace-stats"><div><strong>{{ studio.document.entities.length.toString().padStart(2, '0') }}</strong><span>实体 ENTITIES</span></div><div><strong>{{ fieldCount.toString().padStart(2, '0') }}</strong><span>属性 ATTRIBUTES</span></div><div><strong>{{ studio.document.relationships.length.toString().padStart(2, '0') }}</strong><span>关系 RELATIONS</span></div></div></section>
      <div v-if="studio.storageError" class="storage-warning">{{ studio.storageError }} <button @click="backup">下载备份</button></div>
      <div class="project-bar"><div class="project-title"><span class="folder-icon">▱</span><input aria-label="项目名称" v-model="studio.document.title" maxlength="80"><span class="save-state"><i></i>{{ studio.saved }}</span></div><div class="project-actions"><button class="icon-button" aria-label="撤销" :disabled="!studio.past.length" @click="studio.undo">↶</button><button class="icon-button" aria-label="重做" :disabled="!studio.future.length" @click="studio.redo">↷</button><span class="divider"></span><button class="text-button" @click="newProject">＋ 新建</button></div></div>
      <section class="workbench">
        <aside class="editor-panel"><div class="panel-heading"><div><span class="section-index">01</span><strong>结构编辑器</strong><button class="header-help" @click="sqlHelpOpen = true">ⓘ SQL 格式说明</button></div><span class="muted-label">INPUT</span></div>
          <div class="mode-tabs"><button :class="{ active: mode === 'sql' }" @click="mode = 'sql'">SQL 建表语句</button><button :class="{ active: mode === 'manual' }" @click="mode = 'manual'">实体与关系</button></div>
          <template v-if="mode === 'sql'"><div class="sql-toolbar"><span><i class="mysql-dot"></i>MySQL</span><div><button @click="sqlHistoryOpen = true">◷ SQL 历史</button><button :title="studio.document.view.attributeNames === 'label' ? '点击切换为数据库字段原名' : '点击切换为注释或显示名称；无注释时使用原名'" @click="studio.edit('切换属性名称', doc => { doc.view.attributeNames = doc.view.attributeNames === 'label' ? 'name' : 'label' })">属性名：{{ studio.document.view.attributeNames === 'label' ? '注释' : '原名' }}</button><button @click="sqlFile?.click()">↑ 导入 SQL</button><button @click="loadSample">载入示例</button></div></div><div class="sql-editor"><div ref="sqlLines" class="line-numbers" aria-hidden="true">{{ studio.document.sql.split('\n').map((_, i) => i + 1).join('\n') }}</div><textarea ref="sqlInput" aria-label="SQL 建表语句" v-model="studio.document.sql" spellcheck="false" placeholder="CREATE TABLE …" @input="parseError = ''" @scroll="sqlLines && (sqlLines.scrollTop = ($event.target as HTMLTextAreaElement).scrollTop)"></textarea></div><div v-if="parseError" class="parse-error" role="alert">{{ parseError }}</div><div class="sql-footer"><span>只解析结构，不连接或执行数据库</span><button class="button button-primary" @click="generate">生成 ER 图 <span>↗</span></button></div></template>
          <template v-else><div class="manual-toolbar"><div class="sub-tabs"><button :class="{ active: activePanel === 'entities' }" @click="activePanel = 'entities'">实体 {{ studio.document.entities.length }}</button><button :class="{ active: activePanel === 'relations' }" @click="activePanel = 'relations'">关系 {{ studio.document.relationships.length }}</button></div><button class="small-add" @click="activePanel === 'entities' ? editEntity() : editRelation()">＋ 添加</button></div><div class="search-box"><span>⌕</span><input v-model="search" aria-label="搜索实体" placeholder="查找实体、名称或属性…"></div><div class="structure-list"><template v-if="activePanel === 'entities'"><article v-for="entity in entities" :key="entity.id" class="entity-card"><div class="entity-card-heading"><button @click="canvas?.focus(entity.id)"><span class="entity-symbol">▭</span><strong>{{ entity.label || entity.name }}</strong><small>{{ entity.fields.length }}</small></button><div><button :aria-label="`编辑实体 ${entity.label}`" @click="editEntity(entity)">编辑</button><button class="danger-text" :aria-label="`删除实体 ${entity.label}`" @click="remove([entity.id])">×</button></div></div><span class="technical-name">{{ entity.name }}</span><div v-for="field in entity.fields" :key="field.id" class="field-row" @dblclick="onEdit(field.id)"><span :class="['field-key', { primary: field.primary }]">{{ field.primary ? 'PK' : '·' }}</span><span>{{ fieldDisplayName(field, studio.document) }}</span><small>{{ field.dataType }}</small></div><button class="add-attribute" @click="editEntity(entity)">＋ 编辑属性</button></article><div v-if="!entities.length" class="list-empty">没有匹配实体，点击添加开始建模</div></template><template v-else><article v-for="rel in studio.document.relationships" :key="rel.id" class="relation-card"><div><strong>{{ rel.name }}</strong><button @click="editRelation(rel)">编辑</button><button class="danger-text" @click="remove([rel.id])">删除</button></div><p>{{ studio.document.entities.find(e => e.id === rel.from)?.label }} <b>{{ rel.fromCardinality }} : {{ rel.toCardinality }}</b> {{ studio.document.entities.find(e => e.id === rel.to)?.label }}</p></article><div v-if="!studio.document.relationships.length" class="list-empty">尚无关系，可手动添加关联</div></template></div></template>
          <div class="editor-note"><span>⌁</span><div><strong>你的结构，由你掌控</strong><p>项目自动保存在此浏览器。下载项目备份，可在其他设备继续编辑。</p></div></div>
        </aside>
        <section class="preview-panel" :class="{ 'preview-fullscreen': fullscreen }"><div class="panel-heading"><div><span class="section-index">02</span><strong>ER 图预览</strong><span class="live-tag">LIVE CANVAS</span></div><div class="canvas-actions"><button class="text-button" @click="studio.edit('属性显隐', d => { d.style.showAttributes = !d.style.showAttributes })">{{ studio.document.style.showAttributes ? '◉ 隐藏属性' : '◉ 显示属性' }}</button><button class="button button-outline compact" @click="styleDraft = clone(studio.document.style); styleOpen = true">⚙ 样式</button><button class="button button-soft compact" :disabled="busy || !visibleCount" :title="`下次：${layoutTemplate === 'horizontal' ? '横向' : '纵向'}展开。每次点击自动交替方向；为关系菱形保留独立空间。`" @click="layout">{{ busy ? '排版中…' : '✧ 美化排版' }}</button><button class="button button-outline compact" :disabled="busy" title="恢复最近一次 SQL 生成时的初始坐标，清除基数的手动位置；保留样式，支持撤销" @click="defaultPosition">默认布局</button><div class="export-split"><button class="button button-primary compact" @click="exportOpen = true">↓ 导出</button><el-dropdown trigger="click" @command="$event === 'scope' ? visibilityOpen = true : showEntities(null)"><button class="export-menu-button" aria-label="显示与导出选项"><svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button><template #dropdown><el-dropdown-menu><el-dropdown-item command="scope">指定显示实体</el-dropdown-item><el-dropdown-item command="all">显示全部实体</el-dropdown-item></el-dropdown-menu></template></el-dropdown></div><button class="fullscreen-button" :aria-label="fullscreen ? '退出全屏' : '全屏画布'" :title="fullscreen ? '退出全屏（Esc）' : '全屏画布'" @click="toggleFullscreen">{{ fullscreen ? '↙' : '⛶' }}</button></div></div><div class="layout-note"><span class="layout-direction">{{ lastLayoutTemplate ? `上次美化：${lastLayoutTemplate === 'horizontal' ? '横向' : '纵向'}；下次：${layoutTemplate === 'horizontal' ? '横向' : '纵向'}` : '美化方向交替切换，首次横向，再次纵向。' }}</span><span>默认布局恢复生成时坐标，保留样式，可撤销。</span><span v-if="studio.document.view.entityIds !== null" class="scope-status">显示 {{ visibleCount }} / {{ studio.document.entities.length }} 个实体 <button @click="showEntities(null)">显示全部</button></span></div><div v-if="selectedIds.length > 1" class="selection-toolbar"><span>已选择 {{ selectedIds.length }} 个节点</span><button @click="studio.align(selectedIds, 'horizontal')">水平对齐</button><button @click="studio.align(selectedIds, 'vertical')">垂直对齐</button><button @click="studio.align(selectedIds, 'distribute')">水平分布</button><button @click="studio.copy(selectedIds)">复制</button><button @click="studio.paste">粘贴</button></div><ErCanvas v-if="studio.ready" ref="canvas" @edit="onEdit" @edit-cardinality="editCardinality" @selection="selectedIds = $event" @remove="remove"/><div v-else class="loading-workspace">正在恢复工作区…</div></section>
      </section>
      </div>
      <ErHelp @sql-help="sqlHelpOpen = true"/>
      <footer class="page-footer"><span><b>◆</b> DESIGNED FOR CLARITY</span><span>实体 · 属性 · 关系 <i>/</i> 数据的结构，思考的起点</span><span>Diagram Studio · 2026</span></footer>
    </main>
    <input ref="sqlFile" type="file" accept=".sql,.txt" hidden @change="importSql"><input ref="projectFile" type="file" accept=".json" hidden @change="importProject">

    <EntityVisibilityDialog v-model="visibilityOpen" :entities="studio.document.entities" :selected-ids="studio.document.view.entityIds" @apply="showEntities"/>
    <SqlHelp v-model="sqlHelpOpen"/>
    <SqlHistory v-model="sqlHistoryOpen" :entries="studio.sqlHistory" @load="loadHistorySql"/>
    <el-dialog v-model="entityOpen" title="编辑实体与属性" width="min(900px, 95vw)" :close-on-click-modal="false"><div class="form-grid"><label>数据库原名称<el-input v-model="entityDraft.name" placeholder="例如 t_student"/></label><label>画布显示名称<el-input v-model="entityDraft.label" placeholder="例如 学生"/></label></div><div class="dialog-section-heading"><strong>属性</strong><el-button size="small" @click="addField">＋ 添加属性</el-button></div><div class="field-editor-head"><span>原名称</span><span>显示名称</span><span>类型</span><span>主键</span><span>可空</span><span></span></div><div v-for="(field, index) in entityDraft.fields" :key="field.id" class="field-editor-row"><el-input v-model="field.name" placeholder="字段原名称"/><el-input v-model="field.label" placeholder="画布显示名称"/><el-input v-model="field.dataType" placeholder="VARCHAR(50)"/><el-checkbox v-model="field.primary" aria-label="主键"/><el-checkbox v-model="field.nullable" :disabled="field.primary" aria-label="允许空"/><button class="danger-text" aria-label="删除属性" @click="entityDraft.fields.splice(index, 1)">×</button></div><p class="form-help">修改原字段名会同步外键映射；删除外键字段时会移除对应关系。操作可撤销。画布显示名称可与原名称不同。</p><template #footer><el-button @click="entityOpen = false">取消</el-button><el-button type="primary" @click="saveEntity">保存实体</el-button></template></el-dialog>
    <el-dialog v-model="relationOpen" title="编辑关联关系" width="560px"><label class="form-label">关系名称<el-input v-model="relationDraft.name" placeholder="例如 属于、选修"/></label><div class="form-grid"><label>起始实体<el-select v-model="relationDraft.from"><el-option v-for="entity in studio.document.entities" :key="entity.id" :label="`${entity.label}（${entity.name}）`" :value="entity.id"/></el-select></label><label>目标实体<el-select v-model="relationDraft.to"><el-option v-for="entity in studio.document.entities" :key="entity.id" :label="`${entity.label}（${entity.name}）`" :value="entity.id"/></el-select></label><label>起始基数<el-select v-model="relationDraft.fromCardinality"><el-option v-for="c in ['1', 'N', 'M', '0..1', '0..N']" :key="c" :label="c" :value="c"/></el-select></label><label>目标基数<el-select v-model="relationDraft.toCardinality"><el-option v-for="c in ['1', 'N', 'M', '0..1', '0..N']" :key="c" :label="c" :value="c"/></el-select></label></div><p class="form-help">外键只提供结构依据，请按实际业务确认关系名称和基数。</p><template #footer><el-button @click="relationOpen = false">取消</el-button><el-button type="primary" @click="saveRelation">保存关系</el-button></template></el-dialog>
    <el-dialog v-model="cardinalityOpen" title="关系基数设置" width="500px">
      <el-form label-position="top"><div class="form-grid">
        <el-form-item label="基数值"><el-select v-model="cardinalityValue" aria-label="基数值"><el-option v-for="c in ['1', 'N', 'M', '0..1', '0..N']" :key="c" :label="c" :value="c"/></el-select></el-form-item>
        <el-form-item label="基数字号"><el-input-number v-model="cardinalityDraft.fontSize" aria-label="基数字号" :min="8" :max="72" :value-on-clear="15"/></el-form-item>
        <el-form-item label="基数字体"><el-select v-model="cardinalityDraft.fontFamily" aria-label="基数字体"><el-option label="思源宋体" value="Noto Serif SC"/><el-option label="系统无衬线字体" value="sans-serif"/><el-option label="宋体（需本机安装）" value="SimSun"/></el-select></el-form-item>
        <el-form-item label="基数粗细"><el-select v-model="cardinalityDraft.fontWeight" aria-label="基数粗细"><el-option label="正常" value="normal"/><el-option label="加粗" value="bold"/></el-select></el-form-item>
      </div><div class="color-grid"><label>基数颜色<input type="color" v-model="cardinalityDraft.color" aria-label="基数颜色"></label></div></el-form>
      <p class="form-help">只调整当前基数，位置保持不变。导出图片、Draw.io 和 PDF 使用此设置。</p>
      <template #footer><el-button @click="saveCardinality(true)">使用全局样式</el-button><el-button @click="cardinalityOpen = false">取消</el-button><el-button type="primary" @click="saveCardinality()">保存基数</el-button></template>
    </el-dialog>
    <el-drawer v-model="styleOpen" title="图表样式" size="min(580px, 100vw)"><StyleSettings v-model="styleDraft"/><template #footer><div class="style-footer"><span>Ctrl 拖动属性，保持圆周半径</span><el-button @click="styleDraft = defaultStyle()">恢复默认</el-button><el-button @click="styleOpen = false">关闭</el-button><el-button type="primary" @click="applyStyle">应用样式</el-button></div></template></el-drawer>
    <el-dialog v-model="exportOpen" title="导出图表" width="min(570px, 95vw)" :close-on-click-modal="!exporting" :close-on-press-escape="!exporting" :show-close="!exporting"><p class="export-intro">导出当前显示范围的完整图形，包含画布之外的内容。当前显示 {{ visibleCount }} / {{ studio.document.entities.length }} 个实体。</p><div class="export-format-grid"><button v-for="format in ['png', 'jpeg', 'svg', 'drawio', 'pdf']" :key="format" :disabled="exporting" :class="{ active: exportSettings.format === format }" @click="exportSettings.format = format"><strong>{{ format === 'drawio' ? 'Draw.io' : format.toUpperCase() }}</strong><small>{{ ({ png: '透明图片', jpeg: '通用图片', svg: '矢量图形', drawio: '可编辑图形', pdf: '文档交付' } as Record<string, string>)[format] }}</small></button></div><div v-if="['png', 'jpeg'].includes(exportSettings.format)" class="individual-export"><el-checkbox v-model="exportSettings.individual" :disabled="exporting">一键单独导出每个实体（ZIP）</el-checkbox><p>只导出当前显示的实体。每张图包含一个实体及全部属性，不含跨实体关系。保留当前样式与位置，重名实体自动编号。</p></div><div class="form-grid"><label>画布边距<el-input-number v-model="exportSettings.padding" :min="10" :max="200"/></label><label v-if="['png', 'jpeg'].includes(exportSettings.format)">图片清晰度<el-select v-model="exportSettings.ratio" aria-label="图片清晰度" :disabled="exporting"><el-option label="标清（1 倍）" :value="1"/><el-option label="高清（2 倍）" :value="2"/><el-option label="超清（3 倍）" :value="3"/></el-select></label></div><p v-if="['png', 'jpeg'].includes(exportSettings.format)" class="export-quality-help">标清为原始尺寸，高清宽高各 2 倍，超清各 3 倍。导出不受当前画布缩放影响。</p><el-checkbox v-if="['png', 'svg'].includes(exportSettings.format)" v-model="exportSettings.transparent">透明背景</el-checkbox><template v-if="exportSettings.format === 'pdf'"><div class="form-grid"><label>纸张<el-select v-model="exportSettings.paper"><el-option label="A4" value="A4"/><el-option label="A3" value="A3"/></el-select></label><label>方向<el-select v-model="exportSettings.orientation"><el-option label="横向" value="landscape"/><el-option label="纵向" value="portrait"/></el-select></label></div><el-checkbox v-model="exportSettings.paginate">按原始比例分页（适合大图）</el-checkbox><p class="form-help">PDF 使用当前图表快照生成。提交的数据和结果最多保留 24 小时。</p><div v-if="pdfStatus" class="pdf-state" role="status">{{ pdfStatus }} <a v-if="pdfJob?.state === 'SUCCEEDED'" :href="`/api/v1/export-jobs/${pdfJob.id}/download`">下载 PDF ↓</a></div></template><div v-if="exportProgress" class="pdf-state" role="status">{{ exportProgress }}</div><template #footer><el-button v-if="exporting && exportSettings.individual && ['png', 'jpeg'].includes(exportSettings.format)" @click="exportController?.abort()">取消导出</el-button><el-button v-else :disabled="exporting" @click="exportOpen = false">关闭</el-button><el-button type="primary" :loading="exporting || pdfCreating" @click="exportDiagram">{{ exportSettings.format === 'pdf' ? '生成 PDF' : '导出文件' }}</el-button></template></el-dialog>
    <el-drawer v-model="historyOpen" title="恢复记录" size="420px"><p class="form-help">保留最近 20 个关键操作恢复点。恢复前也会备份当前图表。</p><div v-for="(point, index) in [...studio.restorePoints].reverse()" :key="point.time + index" class="restore-card"><div><strong>{{ point.label }}</strong><small>{{ new Date(point.time).toLocaleString('zh-CN') }}</small><p>{{ point.document.entities.length }} 个实体 · {{ point.document.title }}</p></div><el-button size="small" @click="studio.checkpoint('手动恢复前'); studio.apply(point.document, '恢复记录'); historyOpen = false; canvas?.fit()">恢复</el-button></div><div v-if="!studio.restorePoints.length" class="list-empty">生成、导入或新建时会自动保留恢复点</div><el-button @click="studio.checkpoint('手动保存'); ElMessage.success('恢复点已保存')">＋ 保存当前恢复点</el-button></el-drawer>
  </div>
</template>
