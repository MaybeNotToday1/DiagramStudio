# 开发说明

## 环境和隔离

开发验证使用 Node 24.13.0 / npm 11.6.2、Git 和已有 Chrome。环境脚本只影响当前进程，不改变系统环境变量、不覆盖其他项目的 Java、Maven 或 MySQL，也不注册 Windows 服务。克隆后的 `.tools/` 为空，工具需按需准备。

后台使用项目 `.tools/` 内 Temurin JDK 21.0.12.1、Maven 3.9.16、MySQL 8.4.13。`Prepare-Backend.ps1` 先检测 PATH 上兼容版本，否则下载官方压缩包、校验摘要后解压到项目。Maven 从官方仓库下载依赖。

此数据库只存临时导出任务，独立实例关闭二进制日志，避免删除任务后额外保留快照日志；不用于复制或增量恢复。不修改其他 MySQL 实例的日志设置。[MySQL 官方配置说明](https://dev.mysql.com/doc/refman/8.4/en/binary-log.html)。

| 目录 | 用途 |
|---|---|
| `.tools/` | 便携工具，不提交 |
| `.cache/npm` / `.cache/maven` | 依赖缓存，不提交 |
| `.runtime/tmp` | 临时文件、浏览器临时配置 |
| `.runtime/logs` | 本项目日志 |
| `.runtime/mysql-data` | 独立 MySQL 数据目录，127.0.0.1:3307 |
| `.runtime/exports` | 临时 PDF，默认最多保留 24 小时 |
| `.runtime/local.json` | 本机随机凭据，忽略提交；不要分享 |
| `.runtime/processes.json` | 本项目 PID、启动时间、程序路径 |

脚本仅设置当前脚本进程及子进程的环境。Node 不在 PATH 时会检查 `D:\develop\nodejs` 和 `.tools/node`。其他电脑没有 Node 时，可将官方 Node 22.12+ 的 Windows ZIP 解压到 `.tools/node`；无需全局安装。使用 PowerShell 7。新端口被占用时脚本报错，不停止占用者。

Vite 明确拒绝运行目录、工具、缓存、服务端和部署配置的静态访问。本项目本地凭据可用 `scripts/Rotate-LocalSecrets.ps1` 轮换；脚本只修改已核实的独立实例并重启对应服务。轮换结果不包含凭据值。

## 工程结构

- `src/modules/er/domain/model.ts`：独立业务模型、稳定 ID 和项目校验。
- `sql.ts`：MySQL 方言解析及前后结构差异。只读取结构；不运行 SQL。
- `scene.ts`：实体/属性/关系的几何信息，画布和导出共用。
- `layout.ts`：按实际属性范围计算实体包围盒，再用 ELK 排列。
- `export.ts`：完整范围 SVG/图片和独立 mxCell 的 Draw.io 映射。
- `src/modules/er/store.ts`：统一编辑模型、撤销/重做、快照和 IndexedDB。
- `ErCanvas.vue`：X6 3.x，节点移动后同步业务模型。
- `server/api`：Spring Boot 4.1.2 / JDBC / Flyway / MySQL，仅管理临时导出任务。
- `server/worker.mjs`：Playwright 独立浏览器上下文，复用 `scene.ts` 和 `export.ts` 生成 PDF；禁止图表触发远程资源加载。

业务结构、布局、样式分别存储在文档的 `entities/relationships`、`layout/labelLayout`、`style` 中。基数使用连线长度比例及坐标偏移，独立字体放在 `style.cardinalities`，键为稳定的关系边 ID。旧版本 1 文件自动补空映射；删除、复制及 SQL 匹配更新同步清理或映射这些设置。显示名称修改不更换 ID。SQL 再解析按表/字段原名称匹配，保留可匹配节点的布局；原名称改变视为新结构。解析失败保留原图。再次解析前显示变化数量，需要确认。

## 日常操作

```powershell
./scripts/Start.ps1 -FrontendOnly
./scripts/Start.ps1 -Build
./scripts/Stop.ps1 -Service api
./scripts/Stop.ps1
npm test
npm run build
npm run test:e2e
```

测试浏览器使用已有 Chrome/Edge。运行测试时也应设置 `TEMP`、`TMP` 为 `.runtime/tmp`；推荐使用 `scripts/Test.ps1`。`test:e2e` 要求完整服务正在运行，包含一次受控的本项目 API 重启。

## PDF API

| 方法与路径 | 结果 |
|---|---|
| `POST /api/v1/export-jobs` | 202，返回 `id/state/expiresAt/error` |
| `GET /api/v1/export-jobs/{id}` | 查询状态，其他会话和到期任务统一 404 |
| `GET /api/v1/export-jobs/{id}/download` | 成功返回 PDF；未完成 409，结果丢失 410 |
| `GET /api/health` | 进程存活状态 |

POST 必须为 JSON 并有 `X-Diagram-Request: 1`；浏览器请求来源需与 Host 一致。提交包含 `requestId`、`document`、`paper`、`orientation`、`paginate`、`padding`。同一匿名会话的同一 requestId 返回原任务，不重复创建。

会话为随机 HttpOnly、SameSite=Lax Cookie；数据库只存其 SHA-256 摘要。正式 HTTPS 开启 Secure Cookie。服务只允许本会话读取任务，不提供全局任务列表。限制 8 MB 请求、每会话 20 个未到期任务、全局 50 个待处理任务、1000 个未到期任务；Nginx 另限制提交频率。任务按序渲染，最多 64 页、5000 个显示节点和 30 MB PDF。复杂图建议 A3 或分页。

快照写入数据库后与浏览器后续编辑无关。成功/渲染失败后清除输入快照。服务重启把运行中任务标为失败，排队任务继续处理。已完成结果可继续下载。默认有效期 86280 秒，每分钟清理，预留两分钟保证正常运行时不超过 24 小时；停机期间无法执行清理，启动后首先清理过期记录和无主结果文件。所有已过期任务立即拒绝访问。

## 字体

`public/fonts/diagram-serif.woff2` 是官方 Noto Serif CJK SC 的压缩形式，保留 OFL 协议。`scripts/prepare-font.mjs` 可从官方源重新准备。SVG 内嵌字体，因此文件约 22 MB；图片/PDF 使用同一字体，PDF 会子集嵌入。服务器未安装宋体时使用 Noto 替代；需要字体完全相同时选择 Noto。ELK 按需加载，首次点击排版会加载约 1.4 MB 模块。

## 样式、全屏与实体独立导出

- `StyleSettings.vue` 只编辑样式草稿，「应用样式」统一校验并写入一条历史记录。「关闭」丢弃草稿，「恢复默认」仍需应用后生效。
- 扩展样式继续使用 schemaVersion 1，`validateDocument` 为旧文件补齐新增设置，并将旧文字/边框共用颜色和线宽迁移为等价的独立设置。IndexedDB、恢复点、原生文件与 PDF worker 使用同一验证方法。
- `scene.ts` 统一尺寸、形状、显隐、换行安全区和连接端点，X6、SVG、位图、Draw.io、PDF 共用业务模型。设定高度是最小高度，长文字增加高度；关闭自适应宽度时仍完整换行。节点倍率在设定尺寸之上生效。
- 改变属性排列、连接长度或间距时，围绕已有实体中心排列属性，不移动实体与关系。连接长度为中心距离基准，保留容纳形状所需的最小间隔；0 表示自动。
- Ctrl 属性拖动固定起始圆周半径，暂时关闭吸附以避免改写位置；普通拖动自由移动。拖动实体时属性实时跟随（包含定位吸附修正），松手后统一写入可撤销的模型修改。多选只使用 Shift 点击或 Ctrl+A；不使用 X6 框选插件，不生成节点/整体选中框。
- 空白区域直接平移，不再提供拖动模式开关。节点移动精度为 1 个单位，背景 20 单位点阵独立绘制并随平移缩放；定位线为虚线，吸附容差降为 3 个单位。纯位置更新（含撤销重做）复用原有节点和边，避免每次松手清空重建整张图。
- 基数使用 X6 原生标签拖动，松手只写一条历史记录，沿完整折线路径定位；移动实体或关系时，基数保留手动偏移并实时跟随，自关联的中间折点也同步更新。双击基数打开独立设置，支持 8–72 号、三种字体、正常/加粗及颜色；取消不改变文档，「使用全局样式」删除当前覆盖。
- 基数中心、字体和包含文字的边界由共享 scene 计算；适应画布及完整范围导出包含拖到远处的基数。SVG/位图/PDF 复用这些坐标，Draw.io 使用相对标签几何和偏移，仍可单独编辑。PDF 页面 CSS 不覆盖 SVG 内的独立字体，避免前端和后台字体不一致。
- 全屏请求作用于文档根元素，确保弹窗仍可操作；预览区域使用全屏布局，拒绝原生全屏时保留窗口内放大。ResizeObserver 观察画布父区域，不能观察被 X6 设置了固定宽高的宿主，否则会发生全屏后画布仍只有原宽度的问题。
- 实体 ZIP 只支持 PNG/JPEG，每个独立图包含一个实体及全部属性，不含跨实体关系；按开始时的快照导出，不修改主图。使用编号与安全文件名避免重名覆盖，按完整包围盒逐张渲染，保留倍率、边距、透明选项。fflate 将已压缩图片直接存入 ZIP，避免重复压缩。累计图片超过 150 MB 时明确失败，单张仍限制 6400 万像素；取消时不下载残缺 ZIP。
- Draw.io 原生下划线标记可编辑；下划线具体粗细由目标编辑器决定。PNG/JPEG/SVG/PDF 使用设置的下划线粗细。

新增验收集中在 `tests/unit/style.test.ts` 和 `tests/e2e/style-interaction.spec.ts`，包括真实像素解码、后端 PDF、30 实体下载与取消。通过 `scripts/Test.ps1` 运行全套回归，无需安装新浏览器或修改全局环境。

## 实体范围、SQL 历史、重置与界面

- `view.entityIds` 是显示范围，null 表示全部；`view.attributeNames` 只决定字段文字取 label 还是 name，不修改模型或坐标。scene 和所有导出共用规则，关系只在两端实体都显示时出现。旧项目迁移为全部显示、注释名称。筛选时粘贴会显示新实体；SQL 换成无匹配的新结构时恢复全部显示。
- `visibleDocument` 为导出构造可见子图，清理隐藏坐标、关系及其字体配置，并移除渲染不需要的原始 SQL；原生项目备份保留全部数据。PDF 后台只收到当前可见图形快照，SQL 历史不会提交后台。
- `initialLayout` 保存生成时的坐标。移动和美化不改写基线；默认布局恢复基线、重置基数手动位置，并保留样式。旧文件缺少基线时按当前结构计算，不能声称还原了旧文件从未保存的历史坐标。
- ELK 对完整实体属性群和关系菱形分别布局，属性群以实体为中心取对称范围；环形属性按关系主方向留出通道。自关联折点沿实体与关系连线的法向偏移，横向对齐时两臂仍然分开。隐藏实体位置保持不变。
- 美化按钮在横向/纵向之间交替，初次、导入、新建、重新生成 SQL 和默认布局后从横向开始。仅成功应用布局后切换下一次方向；异步期间文档变化仍拒绝旧结果。提示使用“上次美化”，避免把撤销后的布局误标成当前方向。
- SQL 历史独立保存在 IndexedDB 工作区，最近 20 条、总计最多 400 万字符，只记录成功生成；预览转义文本，载入不替换画布。原生项目文件不含浏览器级 SQL 历史。
- 全局重置排在待执行自动保存之后，先成功提交示例及空历史/恢复点，再清理内存撤销栈与复制缓存；写入失败保留原工作区并报错。重置不会建立恢复点，旧 PDF 状态轮询不会重新填回已清空的界面。
- 界面统一增大正文、SQL、提示与工具字号，功能按钮使用边框、背景、悬停和键盘焦点。主要工具组等宽等高，导出箭头采用居中 SVG；左侧约 42%、画布约 58%，窄窗口转为上下排列。SQL 行号随编辑器同步滚动。
- 新增 `workspace.test.ts`、`workspace-tools.spec.ts` 和 `ui-readability.spec.ts`，分别验证模型/存储边界、真实操作/导出及 1280/1600/1920 窗口下的尺寸与对齐。仅使用独立浏览器测试工作区，不重置用户正在编辑的数据。
