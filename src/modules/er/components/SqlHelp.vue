<script setup lang="ts">
import { ref } from 'vue'
import { sampleSql } from '../domain/sample'
const open = defineModel<boolean>({ required: true }), tab = ref('format')
</script>

<template>
  <el-dialog v-model="open" title="SQL 格式说明" width="min(800px, 95vw)">
    <el-tabs v-model="tab"><el-tab-pane label="支持的格式" name="format"><div class="sql-help-content">
      <h3>MySQL 建表语句</h3><p>这里只解析数据库结构，不连接数据库，也不会执行输入的 SQL。</p>
      <ul><li>支持多条 <code>CREATE TABLE</code>，以分号分隔。表名、字段名可用反引号包裹；关键字大小写均可。</li><li>支持字段类型、<code>NULL / NOT NULL</code>、字段和表的 <code>COMMENT '注释'</code>。显示名称优先使用注释，没有注释时使用原名。</li><li>支持字段内 <code>PRIMARY KEY</code>、表级主键及复合主键；主键字段会显示下划线。</li><li>支持表级 <code>FOREIGN KEY (...) REFERENCES ... (...)</code> 和 <code>ALTER TABLE ... ADD FOREIGN KEY</code>；<code>CONSTRAINT 外键名</code> 可选。</li><li>支持 <code>-- 注释</code>（双横线后加空格）、<code># 注释</code> 和 <code>/* 注释 */</code>。</li><li>默认值、自增、唯一约束、检查约束、普通索引可随建表语句输入，但本 Chen 图不逐项展示它们。唯一键用于判断外键基数。</li></ul>
      <h3>目前不接受</h3><p><code>SELECT / INSERT / UPDATE / DELETE</code>、<code>DROP</code>、<code>SET</code>、<code>CREATE DATABASE</code>、<code>CREATE TABLE AS / LIKE</code> 和其他 ALTER 修改会报错。导入数据库转储前，请仅保留受支持的建表和外键语句。</p>
      <p>内联 <code>字段 INT REFERENCES ...</code> 不接受，请改成表级 FOREIGN KEY。错误会定位到 SQL 输入区域，解析失败保留现有图表。</p>
      <p class="form-help">单次最多 200 张表、每表 500 个字段。SQL 文件上限 2 MB；SQL 文本最多 200 万字符。旧项目如果没有保存初始坐标，“默认布局”会按当前结构重新计算位置。</p>
    </div></el-tab-pane><el-tab-pane label="示例 SQL" name="example"><pre class="sql-help-example">{{ sampleSql }}</pre></el-tab-pane><el-tab-pane label="外键与基数" name="relations"><div class="sql-help-content">
      <h3>显式外键生成关系</h3><p>被引用的表和两端字段必须在同一份输入中定义；复合外键两端字段数量须相同。只有 <code>user_id</code> 这样的字段名不会自动推断出关系。</p>
      <p>外键字段组成主键或唯一键时，起始端默认 1，否则默认 N；目标端默认 1。关系名称、1 / N / M / 0..1 / 0..N 都可按业务手动修改，双击基数可设置字体。</p>
      <p>同表自引用与多重外键受支持；没有外键也能生成实体，之后可在“实体与关系”中手动添加关联。</p>
      <p>示例使用学生的 <code>class_id</code> 指向班级的主键。基数是可调整的设计表达，不会检查或执行真实数据库约束。</p>
    </div></el-tab-pane></el-tabs>
    <template #footer><el-button @click="open = false">关闭</el-button></template>
  </el-dialog>
</template>

<style scoped>
.sql-help-content{max-height:55vh;overflow:auto;font-size:13px;line-height:1.9;color:#58634f;padding-right:10px}.sql-help-content h3{font-size:15px;color:#3d5638;margin:14px 0}.sql-help-content li{margin:10px 0}.sql-help-content code{background:#f0f4eb;color:#375b46;padding:2px 4px;border-radius:3px;overflow-wrap:anywhere}.sql-help-example{max-height:55vh;overflow:auto;padding:18px;background:#f4f6ef;border-radius:6px;line-height:1.8;font-size:12px;white-space:pre-wrap}
</style>
