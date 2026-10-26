<script setup lang="ts">
defineEmits<{ sqlHelp: [] }>()
</script>

<template>
  <section class="workspace-help" aria-label="使用方法与常见问题">
    <article id="usage-guide" class="help-card usage-card" tabindex="-1" aria-labelledby="usage-title">
      <header class="help-heading"><div><span class="help-caption">从结构到图表</span><h2 id="usage-title">使用方法</h2></div><a href="#workspace">返回工作区 <span aria-hidden="true">↑</span></a></header>
      <ol class="usage-steps">
        <li><span aria-hidden="true">01</span><div><h3>输入 SQL，或从空白开始</h3><p>粘贴、导入 MySQL 建表语句，点击「生成 ER 图」。没有 SQL 时，可切换到「实体与关系」手工添加实体和关联。</p></div></li>
        <li><span aria-hidden="true">02</span><div><h3>调整结构与画面</h3><p>拖动节点和关系基数，双击修改内容。在「样式」中调整字体、颜色与尺寸，使用「美化排版」切换横向、纵向布局。</p></div></li>
        <li><span aria-hidden="true">03</span><div><h3>导出成果，保存设计</h3><p>图片适合报告展示，SVG 适合清晰缩放，Draw.io 可继续编辑，PDF 支持纸张与分页。下载项目备份，可保留完整结构、位置和样式。</p></div></li>
      </ol>
      <div class="usage-note"><strong>第一次使用？</strong><p>编辑器内的「载入示例」可以帮助你熟悉操作。项目保存在当前浏览器，换设备前记得下载备份。</p><button class="button button-outline" @click="$emit('sqlHelp')">查看完整 SQL 规范 <span aria-hidden="true">↗</span></button></div>
    </article>
    <article id="common-questions" class="help-card faq-card" tabindex="-1" aria-labelledby="faq-title">
      <header class="help-heading"><div><span class="help-caption">输入、编辑与导出</span><h2 id="faq-title">常见问题</h2></div><span class="faq-hint">点击展开</span></header>
      <div class="help-faqs">
        <details name="er-help-faq" open><summary>支持哪些数据库和 SQL 语法？<i aria-hidden="true"></i></summary><p>目前支持 MySQL CREATE TABLE 和 ALTER TABLE … ADD FOREIGN KEY，包含多表、注释、主键与复合主外键。其他数据库方言暂未支持；不支持的语句会提示位置，解析失败保留原图。完整范围见「SQL 格式说明」。</p></details>
        <details name="er-help-faq"><summary>为什么生成了实体，却没有关系连线？<i aria-hidden="true"></i></summary><p>只有明确声明的外键会生成关系，user_id 这样的字段名不会自动推断关联。没有外键时，可在「实体与关系」中手动添加关系，并按业务修改名称和基数。</p></details>
        <details name="er-help-faq"><summary>能只显示或导出一个实体吗？<i aria-hidden="true"></i></summary><p>点击「导出」右侧箭头，选择「指定显示实体」，仅勾选需要的实体后再导出。PNG / JPEG 还支持逐实体打包为 ZIP。筛选不删除其他实体，项目备份仍保留完整设计。</p></details>
        <details name="er-help-faq"><summary>美化排版后，怎样恢复原来的布局？<i aria-hidden="true"></i></summary><p>「默认布局」恢复最近一次 SQL 生成时的初始位置，清除基数的手动位置，保留样式；旧项目未记录初始位置时会按当前结构重建。只想回到上一步，可以撤销。美化排版首次横向、第二次纵向，之后交替。</p></details>
        <details name="er-help-faq"><summary>刷新后还在吗？换电脑如何继续编辑？<i aria-hidden="true"></i></summary><p>项目自动保存在当前浏览器，正常刷新可恢复；清理网站数据或结束隐私会话可能丢失记录。请下载 .diagram.json 项目备份，换设备后通过「导入项目」恢复。重置工作区会经二次确认清空当前设计、恢复点和 SQL 历史，已下载的备份不受影响。</p></details>
        <details name="er-help-faq"><summary>SQL 会上传吗？为什么 PDF 需要后台？<i aria-hidden="true"></i></summary><p>SQL 解析、编辑、保存和本地图形导出在浏览器中完成。创建 PDF 时，仅将当前可见图表快照提交后台，不包含原始 SQL 或 SQL 历史；临时输入和结果最多保存 24 小时，后台运行时自动清理。后台不可用时，其他本地导出仍可使用。</p></details>
      </div>
    </article>
  </section>
</template>

<style scoped>
.workspace-help{display:grid;grid-template-columns:minmax(0,42%) minmax(0,1fr);gap:18px;margin:28px 0 8px;align-items:stretch}.help-card{min-width:0;padding:26px;border:1px solid #e1e5da;border-radius:10px;background:#fffefa;scroll-margin-top:24px}.help-card:focus-visible{outline:2px solid #78966c;outline-offset:4px}.help-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:66px;padding-bottom:20px;border-bottom:1px solid #e8ebe2}.help-caption{font-size:12px;color:#8c987e;letter-spacing:1px}.help-heading h2{font-size:22px;line-height:1.4;font-weight:600;color:#3c5541;margin:7px 0 0}.help-heading a{font-size:13px;text-decoration:none;color:#56714a;white-space:nowrap}.help-heading a:hover{text-decoration:underline;text-underline-offset:4px}.faq-hint{font-size:12px;color:#8c987e}
.usage-card{display:flex;flex-direction:column}.usage-steps{list-style:none;padding:0;margin:24px 0;display:flex;flex-direction:column;gap:23px}.usage-steps li{display:flex;gap:17px;align-items:flex-start}.usage-steps li>span{font-family:Georgia,serif;font-size:24px;color:#a2b18e;line-height:1.3}.usage-steps h3{font-size:16px;line-height:1.6;color:#4b6548;margin:0;font-weight:600}.usage-steps p,.usage-note p{font-size:14px;line-height:1.9;color:#75836b;margin:7px 0 0}.usage-note{margin-top:auto;padding:18px 20px;background:#f2f5ec;border-radius:6px}.usage-note strong{font-size:14px;color:#607a50;font-weight:500}.usage-note .button{font-size:13px;padding:9px 12px;margin-top:14px;gap:18px}
.help-faqs details{border-bottom:1px solid #e8ebe2}.help-faqs details:last-child{border-bottom:0}.help-faqs summary{display:flex;justify-content:space-between;align-items:center;gap:16px;list-style:none;padding:20px 0;font-size:15px;font-weight:500;line-height:1.7;color:#4d6649;cursor:pointer}.help-faqs summary::-webkit-details-marker{display:none}.help-faqs summary:hover{color:#254c35}.help-faqs summary:focus-visible{outline:2px solid #8ba67b;outline-offset:4px;border-radius:3px}.help-faqs summary i{width:8px;height:8px;border-right:1.5px solid #8e9d7f;border-bottom:1.5px solid #8e9d7f;transform:rotate(45deg);margin-right:3px;flex-shrink:0}.help-faqs details[open] summary i{transform:rotate(225deg);margin-top:6px}.help-faqs p{font-size:14px;line-height:1.95;color:#7a866f;margin:0;padding:0 20px 22px 0;overflow-wrap:anywhere}
@media(min-width:1800px){.help-card{padding:30px}.usage-steps p,.usage-note p,.help-faqs p{font-size:15px}.usage-steps{gap:26px}}
@media(max-width:999px){.workspace-help{grid-template-columns:1fr}.help-card{padding:24px}.help-heading h2{font-size:21px}}
</style>
