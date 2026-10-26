<script setup lang="ts">
import { ref } from 'vue'
import type { SqlHistoryEntry } from '../store'
const open = defineModel<boolean>({ required: true })
defineProps<{ entries: SqlHistoryEntry[] }>()
const emit = defineEmits<{ load: [sql: string] }>()
const selected = ref<string>()
</script>

<template>
  <el-drawer v-model="open" title="SQL 生成历史" size="min(560px, 100vw)">
    <p class="form-help">仅保存在当前浏览器，记录最近 20 次成功生成的 SQL，累计最多 400 万字符，较早记录自动移除。载入只替换编辑器内容，点击生成后才更新画布。全局重置会永久清空这些记录。</p>
    <article v-for="entry in entries" :key="entry.id" class="sql-history-card"><div><strong>{{ entry.title }}</strong><small>{{ new Date(entry.time).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) }} · {{ entry.entities }} 个实体</small></div><div class="sql-history-actions"><el-button size="small" @click="selected = selected === entry.id ? undefined : entry.id">{{ selected === entry.id ? '收起 SQL' : '查看 SQL' }}</el-button><el-button size="small" type="primary" @click="emit('load', entry.sql); open = false">载入 SQL</el-button></div><pre v-if="selected === entry.id">{{ entry.sql }}</pre></article>
    <div v-if="!entries.length" class="list-empty">暂无生成历史。成功点击“生成 ER 图”后会记录在此。</div>
  </el-drawer>
</template>

<style scoped>
.sql-history-card{border:1px solid #e2e7d9;border-radius:8px;padding:16px;margin:18px 0;background:#fafbf7}.sql-history-card strong{font-size:13px}.sql-history-card small{display:block;font-size:11px;color:#86917d;line-height:1.8;margin-top:5px}.sql-history-actions{display:flex;justify-content:flex-end;margin-top:12px}.sql-history-card pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:300px;overflow:auto;background:#eff3e8;padding:12px;border-radius:5px;font-size:11px;line-height:1.8}
</style>
