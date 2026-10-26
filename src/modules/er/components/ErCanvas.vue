<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Graph, Point, Snapline, type Edge } from '@antv/x6'
import { useStudio } from '../store'
import { sceneFor, sceneBounds, labelWidth, borderPoint, constrainToOrbit, selfRelationshipBend, type SceneNode } from '../domain/scene'
import type { CardinalityPosition, Position } from '../domain/model'
import { visibleEntities } from '../domain/model'

Graph.registerAnchor('studio-border', function(view, _magnet, _ref, args, type) {
  const box = view.cell.getBBox(), vertices = this.cell.getVertices()
  const other = this.graph.getCellById(type === 'source' ? this.cell.getTargetCellId()! : this.cell.getSourceCellId()!)
  const target = (type === 'source' ? vertices[0] : vertices.at(-1)) || other?.getBBox().center || box.center
  const p = borderPoint({ x: box.center.x, y: box.center.y, width: box.width, height: box.height, shape: view.cell.getData().shape } as SceneNode, target, args.smart)
  return new Point(p.x, p.y)
}, true)

const studio = useStudio(), host = ref<HTMLDivElement>(), zoom = ref(100), minZoom = ref(.2)
const hasVisibleEntities = computed(() => visibleEntities(studio.document).length > 0)
const emit = defineEmits<{ edit: [id: string]; editCardinality: [edgeId: string]; selection: [ids: string[]]; remove: [ids: string[]] }>()
let graph: Graph, observer: ResizeObserver, syncing = false
let renderedStructure = ''
let selection = new Set<string>()
let labelDrag: string | undefined
let drag: { id: string; start: Position; parent?: Position; attributes: { id: string; point: Position; width: number; height: number }[] } | undefined
function render() {
  if (!graph || !studio.ready) return
  const selectedIds = selected(), scene = sceneFor(studio.document), s = studio.document.style
  const structure = JSON.stringify([studio.document.entities, studio.document.relationships, studio.document.view, s])
  syncing = true
  // Position edits reuse the existing SVG nodes, including on undo/redo.
  if (structure === renderedStructure) {
    for (const n of scene.nodes) {
      const cell = graph.getCellById(n.id)
      if (!cell?.isNode()) continue
      const position = cell.getPosition(), x = n.x - n.width / 2, y = n.y - n.height / 2
      if (Math.abs(position.x - x) > 1e-8 || Math.abs(position.y - y) > 1e-8) cell.setPosition(x, y)
    }
    for (const e of scene.edges) {
      const cell = graph.getCellById(e.id)
      if (!cell?.isEdge()) continue
      const vertices = cell.getVertices()
      if (e.bend ? vertices.length !== 1 || vertices[0].x !== e.bend.x || vertices[0].y !== e.bend.y : vertices.length > 0) cell.setVertices(e.bend ? [e.bend] : [])
      if (e.labelPosition && JSON.stringify(cell.getLabelAt(0)?.position) !== JSON.stringify(canvasLabelPosition(e.labelPosition))) cell.setLabelAt(0, { ...cell.getLabelAt(0), position: canvasLabelPosition(e.labelPosition) })
    }
    syncing = false
    return
  }
  renderedStructure = structure
  graph.clearCells()
  graph.drawBackground({ color: s.background })
  for (const n of scene.nodes) graph.addNode({
    id: n.id, shape: n.shape === 'diamond' ? 'polygon' : n.shape,
    x: n.x - n.width / 2, y: n.y - n.height / 2, width: n.width, height: n.height, zIndex: 2,
    data: { kind: n.kind, parent: n.parent, shape: n.shape },
    attrs: {
      body: { fill: n.kind === 'entity' ? s.entityFill : n.kind === 'attribute' ? s.attributeFill : s.relationFill, stroke: s.lineColor, strokeWidth: s.borderWidth, rx: s.radius, ry: s.radius, ...(n.shape === 'diamond' ? { refPoints: '0,10 10,0 20,10 10,20' } : {}) },
      label: { text: n.label, fill: s.ink, fontSize: s.fontSize, fontWeight: s.fontWeight, fontFamily: `${s.fontFamily}, SimSun, serif`, textDecoration: n.primary ? 'underline' : 'none', style: { textDecorationThickness: `${s.underlineWidth}px` }, textWrap: { width: labelWidth(n.width, n.shape) / (s.fontWeight === 'bold' ? 1.08 : 1), height: n.height - 12, breakWord: true, ellipsis: false } },
    },
  })
  for (const edge of scene.edges) graph.addEdge({
    id: edge.id, source: { cell: edge.from, anchor: { name: 'studio-border', args: { smart: s.smartConnections } } }, target: { cell: edge.to, anchor: { name: 'studio-border', args: { smart: s.smartConnections } } }, zIndex: 1,
    vertices: edge.bend ? [edge.bend] : [], data: { self: !!edge.bend },
    attrs: { line: { stroke: s.lineColor, strokeWidth: s.lineWidth, sourceMarker: null, targetMarker: null } },
    labels: edge.label ? [{ position: canvasLabelPosition(edge.labelPosition!), attrs: { label: { text: edge.label, fontSize: edge.labelStyle!.fontSize, fill: edge.labelStyle!.color, fontFamily: `${edge.labelStyle!.fontFamily}, Noto Serif SC, SimSun, serif`, fontWeight: edge.labelStyle!.fontWeight }, body: { fill: s.labelBackground === 'transparent' ? 'none' : s.labelBackground, stroke: 'none' } } }] : [],
  })
  select(selectedIds)
  syncing = false
}
function canvasLabelPosition(position: CardinalityPosition) { return { ...position, options: { absoluteOffset: true } } }
function saveCardinality(edge: Edge) {
  if (syncing || labelDrag !== edge.id) return
  labelDrag = undefined
  const p = edge.getLabelAt(0)?.position
  if (p && typeof p === 'object' && p.offset && typeof p.offset === 'object') studio.moveCardinality(edge.id, { distance: p.distance, offset: { x: p.offset.x || 0, y: p.offset.y || 0 } })
}
function fit() {
  if (!graph) return
  graph.zoomToRect(sceneBounds(sceneFor(studio.document), 0), { padding: 70, maxScale: 1.15, minScale: .03 })
  // Large diagrams may need a smaller fitted view; manual zoom stops there.
  minZoom.value = Math.min(.2, graph.zoom()); graph.options.mousewheel.minScale = minZoom.value
  zoom.value = Math.round(graph.zoom() * 100)
}
function focus(id: string) { const cell = graph?.getCellById(id); if (!cell) return; select([id]); graph.centerCell(cell); if (graph.zoom() < .55) graph.zoomTo(.65) }
function selected() { return [...selection].filter(id => graph?.getCellById(id)?.isNode()) }
function select(ids: string[]) { selection = new Set(ids.filter(id => graph?.getCellById(id)?.isNode())); emit('selection', selected()) }
function changeZoom(delta: number) { if (graph && !(delta < 0 && graph.zoom() <= minZoom.value)) graph.zoom(delta, { minScale: minZoom.value, maxScale: 3 }) }
function updateGrid() {
  const layer = host.value?.querySelector<HTMLElement>('.x6-graph-grid')
  if (!layer) return
  const matrix = graph.matrix()
  layer.style.backgroundImage = matrix.a < .4 ? 'none' : ''
  layer.style.backgroundSize = `${20 * matrix.a}px ${20 * matrix.d}px`
  layer.style.backgroundPosition = `${matrix.e}px ${matrix.f}px`
}
function onKey(e: KeyboardEvent) {
  if (studio.resetting) return
  if ((e.target as HTMLElement).closest('input,textarea,[contenteditable],.el-dialog,.el-drawer')) return
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); if (selected().length) emit('remove', selected()) }
  if (e.ctrlKey || e.metaKey) {
    if (e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? studio.redo() : studio.undo() }
    if (e.key.toLowerCase() === 'y') { e.preventDefault(); studio.redo() }
    if (e.key.toLowerCase() === 'c') { e.preventDefault(); studio.copy(selected()) }
    if (e.key.toLowerCase() === 'v') { e.preventDefault(); studio.paste() }
    if (e.key.toLowerCase() === 'a') { e.preventDefault(); select(graph.getNodes().map(n => n.id)) }
  }
}
onMounted(() => {
  // The decorative 20-unit dot grid is independent from 1-unit drag precision.
  graph = new Graph({ container: host.value!, async: false, background: { color: '#fff' }, grid: { visible: false, size: 1 },
    panning: { enabled: true, modifiers: null }, mousewheel: { enabled: true, modifiers: null, minScale: .2, maxScale: 3 },
    interacting: { edgeMovable: false, edgeLabelMovable: true, arrowheadMovable: false, vertexMovable: false }, connecting: { connectionPoint: 'anchor' },
  })
  graph.use(new Snapline({ enabled: true, tolerance: 3 }))
  graph.on('node:click', ({ node, e }) => {
    if (!e.shiftKey) select([node.id])
    else select(selection.has(node.id) ? selected().filter(id => id !== node.id) : [...selected(), node.id])
  })
  graph.on('blank:click', () => select([]))
  graph.on('node:move', ({ node }) => {
    const scene = sceneFor(studio.document), n = scene.nodes.find(n => n.id === node.id)!
    drag = { id: node.id, start: { x: n.x, y: n.y }, parent: scene.nodes.find(p => p.id === n.parent), attributes: scene.nodes.filter(p => p.parent === node.id).map(p => ({ id: p.id, point: { x: p.x, y: p.y }, width: p.width, height: p.height })) }
  })
  graph.on('node:moving', ({ node, e }) => {
    if (!drag || syncing) return
    graph.getPlugin<Snapline>('snapline')?.toggleEnabled(!(e.ctrlKey && drag.parent))
    const b = node.getBBox()
    if (e.ctrlKey && drag.parent) { const p = constrainToOrbit(drag.parent, drag.start, b.center); node.setPosition(p.x - b.width / 2, p.y - b.height / 2) }
  })
  // Also follows a position correction made by the alignment guide plugin.
  graph.on('node:change:position', ({ node }) => {
    if (syncing || !drag || drag.id !== node.id) return
    const b = node.getBBox()
    for (const attr of drag.attributes) {
      const cell = graph.getCellById(attr.id)
      if (cell?.isNode()) cell.setPosition({ x: attr.point.x + b.center.x - drag.start.x - attr.width / 2, y: attr.point.y + b.center.y - drag.start.y - attr.height / 2 })
    }
    for (const edge of graph.getConnectedEdges(node)) {
      if (!edge.getData()?.self) continue
      const a = edge.getSourceCell()!.getBBox().center, b = edge.getTargetCell()!.getBBox().center
      edge.setVertices([selfRelationshipBend(a, b, edge.id.endsWith('-from') ? -1 : 1)])
    }
  })
  graph.on('node:moved', ({ node, e }) => {
    if (syncing) return
    const b = node.getBBox(), point = e.ctrlKey && drag?.parent ? constrainToOrbit(drag.parent, drag.start, b.center) : b.center
    studio.move(node.id, point.x, point.y); drag = undefined; graph.getPlugin<Snapline>('snapline')?.enable()
    if (!selection.has(node.id)) select([node.id])
  })
  graph.on('node:dblclick', ({ node }) => emit('edit', node.id))
  graph.on('edge:dblclick', ({ edge, e }) => {
    if ((e.target as Element).closest('.x6-edge-label')) emit('editCardinality', edge.id)
    else if (!edge.id.startsWith('attr-')) emit('edit', edge.id.replace(/-(from|to)$/, ''))
  })
  graph.on('edge:mousedown', ({ edge, e }) => { if ((e.target as Element).closest('.x6-edge-label')) labelDrag = edge.id })
  graph.on('edge:mouseup', ({ edge }) => saveCardinality(edge))
  graph.on('scale', () => { zoom.value = Math.round(graph.zoom() * 100); updateGrid() })
  graph.on('translate', updateGrid)
  const shell = host.value!.parentElement!
  observer = new ResizeObserver(() => graph.resize(shell.clientWidth, shell.clientHeight)); observer.observe(shell)
  window.addEventListener('keydown', onKey)
  render(); fit(); updateGrid()
})
watch(() => [studio.document.entities, studio.document.relationships, studio.document.layout, studio.document.labelLayout, studio.document.view, studio.document.style], render, { deep: true })
watch(() => studio.ready, () => { render(); fit() })
onBeforeUnmount(() => { observer?.disconnect(); graph?.dispose(); window.removeEventListener('keydown', onKey) })
defineExpose({ fit, focus, selected })
</script>

<template>
  <div class="canvas-shell">
    <div ref="host" class="graph-host" data-testid="er-canvas"></div>
    <div v-if="!hasVisibleEntities" class="canvas-empty"><span class="empty-diagram">◇</span><h3>{{ studio.document.entities.length ? '当前筛选没有可显示实体' : '从一个实体开始' }}</h3><p>{{ studio.document.entities.length ? '从导出菜单调整实体显示范围' : '粘贴建表语句，或在左侧添加实体' }}</p></div>
    <div class="canvas-legend"><span class="legend-rect"></span> 实体 <span class="legend-ellipse"></span> 属性 <span class="legend-diamond"></span> 关系</div>
    <div class="zoom-tools"><button aria-label="缩小画布" :disabled="zoom <= Math.round(minZoom * 100)" :title="`最低 ${Math.round(minZoom * 100)}%；复杂图按适应画布结果保留全图`" @click="changeZoom(-.1)">−</button><span data-testid="zoom-value">{{ zoom }}%</span><button aria-label="放大画布" @click="changeZoom(.1)">＋</button><i></i><button class="fit-button" @click="fit">适应画布</button></div>
    <div class="canvas-hint">拖动空白处平移 · 基数可拖动 · Shift 点选多选 · Ctrl 拖动属性沿圆周移动</div>
  </div>
</template>
