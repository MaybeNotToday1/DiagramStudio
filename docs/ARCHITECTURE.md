# 项目结构与模块边界

当前只有 ER 模块。数据流图等工具在用户确定需求后逐个增加；没有占位页面、AI、登录、支付或永久云端项目。

```text
src/
  App.vue                  应用入口，目前挂载 ER 工作台
  main.ts / styles.css     Vue 初始化及站点样式
  modules/er/
    ErWorkspace.vue        ER 页面及操作流程
    components/            画布、表单和样式面板
    domain/                模型、SQL、布局、场景及导出
    store.ts               Pinia 编辑状态及 IndexedDB
server/
  api/                     Java 临时 PDF 任务与数据库迁移
  worker.mjs               Node/Playwright PDF 渲染
tests/unit/                ER 模型、SQL、样式和存储
tests/smoke/               无后台的克隆运行验证
tests/e2e/                 完整服务和真实文件验收
scripts/                   环境、进程、发布检查及验证脚本
deploy/                    Linux Dockerfile、Compose、Nginx 模板
public/fonts/              ER 中文字体及 OFL 许可证
docs/                      开发、验证、部署和发布说明
```

ER 的业务结构、坐标和样式分别存储；名称修改保留 ID。画布与所有导出共享 `domain/scene.ts` 的几何信息。原生文档继续使用现有 `schemaVersion: 1`，本次整理目录不改变文件格式、浏览器数据库或用户数据。

普通编辑和本地导出完全在浏览器进行。PDF 才将可见图表快照提交 Java API，API 管理匿名任务、MySQL 元数据和临时文件，内部 worker 复用 ER 渲染代码生成 PDF。不执行用户输入的 SQL；不连接用户数据库。

后续真实模块放在 `src/modules/<模块名>/`，自行维护业务模型、存储版本和导出适配。第二个模块落地时再提取确实共用的工作区布局、导航和基础组件，避免现在为未实现工具建立抽象。SQL 解析、Chen 节点和 ER 文件校验仍由 ER 模块负责。新增图种需要独立验证快照格式与 worker 渲染边界，再接入后台；当前 API 只接受 ER，不能直接把其他文档当 ER 提交。

新增模块前应先保留现有 ER 回归；模块单测、无后台 smoke 和完整导出测试分别归入对应目录。新增依赖提交锁文件并记录许可证；真实配置、工具和运行数据始终排除出仓库。
