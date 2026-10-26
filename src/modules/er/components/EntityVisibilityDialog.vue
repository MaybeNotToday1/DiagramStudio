<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Entity } from '../domain/model'

const open = defineModel<boolean>({ required: true })
const props = defineProps<{ entities: Entity[]; selectedIds: string[] | null }>()
const emit = defineEmits<{ apply: [ids: string[] | null] }>()
const selected = ref<string[]>([]), search = ref('')
const filtered = computed(() => props.entities.filter(e => `${e.label} ${e.name}`.toLowerCase().includes(search.value.toLowerCase())))
watch(open, value => { if (value) { selected.value = props.selectedIds ? [...props.selectedIds] : props.entities.map(e => e.id); search.value = '' } })
function apply() { emit('apply', selected.value.length === props.entities.length ? null : [...selected.value]); open.value = false }
</script>

<template>
  <el-dialog v-model="open" title="选择显示实体" width="min(550px, 95vw)">
    <p class="form-help">画布和所有图形导出只包含勾选实体。关系仅在两端实体同时显示时出现；完整项目备份仍保留全部实体。</p>
    <el-input v-model="search" aria-label="筛选实体名称" placeholder="查找实体或数据库表名" clearable/>
    <div class="visibility-actions"><el-checkbox :model-value="selected.length === entities.length && entities.length > 0" :indeterminate="selected.length > 0 && selected.length < entities.length" @change="selected = $event ? entities.map(e => e.id) : []">全选</el-checkbox><span>{{ selected.length }} / {{ entities.length }}</span><el-button text @click="selected = entities.filter(e => !selected.includes(e.id)).map(e => e.id)">反选</el-button></div>
    <el-checkbox-group v-model="selected" class="entity-options"><el-checkbox v-for="entity in filtered" :key="entity.id" :value="entity.id" :aria-label="`${entity.label || entity.name}（${entity.name}）`"><strong>{{ entity.label || entity.name }}</strong><small>{{ entity.name }} · {{ entity.fields.length }} 个属性</small></el-checkbox></el-checkbox-group>
    <p v-if="!filtered.length" class="form-help">没有匹配的实体。</p><p v-if="!selected.length" class="form-help">请至少选择一个实体。</p>
    <template #footer><el-button @click="open = false">取消</el-button><el-button type="primary" :disabled="!selected.length" @click="apply">应用显示范围</el-button></template>
  </el-dialog>
</template>

<style scoped>
.visibility-actions{display:flex;align-items:center;gap:16px;margin:12px 0}.visibility-actions>span{margin-left:auto;font-size:12px;color:#829074}.entity-options{display:flex;flex-direction:column;max-height:350px;overflow:auto;border:1px solid #e4e8de;border-radius:6px;padding:6px 12px}.entity-options .el-checkbox{height:auto;min-height:56px;margin:0;padding:8px 0;white-space:normal;align-items:center}.entity-options strong{display:block;font-size:13px;line-height:1.5}.entity-options small{display:block;font-size:11px;color:#829074;line-height:1.6;overflow-wrap:anywhere}
</style>
