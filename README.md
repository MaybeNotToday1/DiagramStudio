# Diagram Studio · ER 工作台

在本地浏览器解析 MySQL 建表语句和手工建模，生成可编辑的 Chen ER 图。当前只实现 ER 模块；AI、登录、支付、永久云端项目和其他图种延期。

## 克隆与启动（只运行 ER 编辑器）

需要 Node.js **22.12+**（建议 24 LTS）、npm、Git 和现代浏览器。Windows、macOS、Linux 均可运行前端；不需要 Java、MySQL 或 Docker。

```sh
git clone https://github.com/MaybeNotToday1/DiagramStudio.git
cd DiagramStudio
npm ci
npm run dev
```

打开 [http://127.0.0.1:5173/](http://127.0.0.1:5173/)，自动载入班级与学生示例。编辑、自动保存、PNG/JPEG/SVG/Draw.io 和项目备份都可直接测试。未启动后台时 PDF 会提示服务不可用。不要用文件管理器直接打开 `index.html`。

仓库不包含依赖、便携工具或本机数据。锁文件使用 npm 官方源；npm 缓存在项目 `.cache/npm`。有兼容 Node 时优先复用，缺少时可把官方便携版放在 `.tools/node`。不修改系统环境变量。

## 测试

```sh
npm test
npm run build
# 测试浏览器：Windows 优先已有 Chrome/Edge；其他系统安装 Playwright Chromium。
# 如需安装，将浏览器缓存放入项目：PLAYWRIGHT_BROWSERS_PATH=.tools/playwright
npx playwright install chromium
npm run test:smoke
```

`test:smoke` 自动启动独立的 5187 端口前端，验证示例、错误 SQL 保留原图、拖动、刷新恢复和实际文件导出，不需要后台。完整 `test:e2e` 还包含 PDF、任务隔离、清理和受控 API 重启，需要完整本地服务；详见 [开发说明](docs/DEVELOPMENT.md)。测试使用独立浏览器上下文，不读取日常浏览器项目。CI 分别执行前端测试和 Java 单测，容器上线另行验收。

Windows PowerShell 7 可先执行 `. ./scripts/Common.ps1`，再用 `& $npmExe ...`；这样也会把临时文件及浏览器缓存放入项目。已有 Chrome/Edge 时可省略浏览器安装。Linux CI 使用 `npx playwright install --with-deps chromium`。

## 可选：完整 PDF 后台

Windows PowerShell 7：

```powershell
./scripts/Check-Environment.ps1
./scripts/Prepare-Backend.ps1
./scripts/Start.ps1 -Build
# 停止本项目服务
./scripts/Stop.ps1
```

准备脚本优先复用兼容的 JDK 21、Maven 3.9 和 MySQL 8.4，否则从官方源下载到 `.tools/`；MySQL 使用本项目独立实例和随机凭据，不操作其他项目数据库。`Start.ps1 -FrontendOnly` 仅启动前端。停止脚本只管理记录并核实归属的本项目进程。

Linux 服务器使用 [Docker Compose / Nginx / HTTPS 部署说明](docs/DEPLOYMENT.md)。当前提供部署配置，尚未在真实服务器完成容器及公网验收。

## 已实现

- MySQL CREATE TABLE / ALTER TABLE ADD FOREIGN KEY，多表、中文注释、复合主外键、错误位置及结构变化确认。
- 实体、属性、关系表单；实体与属性联动拖动、Ctrl 固定半径拖动属性、平移缩放、全屏与 Esc 返回、搜索、双击编辑、复制粘贴、撤销重做、显隐、对齐及自动排版。
- 分组样式：字体字号与粗细、主键下划线、节点宽高/形状、独立文字与线条颜色、连线文字背景、圆角、自适应宽度、连接方式和属性排列。
- 1 / N / M 等关系基数可单独拖动、随端点实时跟随；双击设置当前基数值、字体、字号、粗细和颜色，可恢复全局样式，支持保存与撤销。
- IndexedDB 自动保存和恢复点；带版本信息的 `.diagram.json` 原生项目备份/恢复。
- 指定显示实体，图形与导出只包含所选实体及两端可见的关系；属性名称可在注释与数据库原名间切换。
- SQL 格式说明、最近成功生成历史、横纵交替美化、默认布局恢复，以及经确认后清空本机工作区的重置。
- 紧凑功能介绍、三步使用方法和可用键盘展开的常见问题；电脑双栏工作区按窗口高度分配空间，两框完整保留在首屏，说明卡片沿相同列宽和边线对齐。
- 完整范围 PNG、JPEG、内嵌中文字体 SVG、可编辑 Draw.io XML；一键将每个实体及全部属性分别导出为 PNG/JPEG，打包 ZIP 下载。
- Spring Boot 临时 PDF 任务，Node/Playwright 渲染；A4/A3、方向、分页，匿名会话隔离及到期清理。

SQL 只在浏览器解析，**不会连接或执行用户数据库**。只有点击生成 PDF 时，当前图表快照才提交后台。

画布右上角 ⛶ 进入全屏；浏览器不允许原生全屏时使用窗口内放大。直接拖动空白区域平移，滚轮缩放，Shift 点击可多选；不提供拖框框选和选中边框，定位线使用虚线。样式在点击「应用样式」后生效；变更属性排列、连线长度或间距会重新排列属性，其余样式保留位置，全部可以撤销。批量导出入口：「导出 → PNG / JPEG → 一键单独导出每个实体（ZIP）」。

导出按钮右侧箭头 →「指定显示实体」可全选、反选或搜索。只选一个实体后，画布及 PNG/JPEG/SVG/Draw.io/PDF 都只包含该实体；项目备份仍保存完整模型。批量图片也只处理当前显示的实体。

美化首次点击为横向，第二次为纵向，之后交替；提示行显示上次及下次方向。排版为属性群、关系菱形预留空间及连线通道。「默认布局」恢复 SQL 生成时的初始坐标，保留样式且可撤销；旧项目未记录初始坐标时按当前结构重建。

普通图手动缩小最低 20%，按钮与滚轮使用同一限制。大图「适应画布」允许使用更小的倍率显示完整内容，此时不再允许继续缩小。低倍率隐藏过密点阵，避免白色画布变成灰色；手工设置的背景颜色保持有效。

PNG/JPEG 导出可选标清（1 倍）、高清（2 倍，默认）和超清（3 倍），逐实体 ZIP 使用相同清晰度。倍率作用于导出图像的宽高，不取决于预览缩放；SVG、Draw.io 和 PDF 不使用位图清晰度选项。

页面上方提供使用方法和常见问题入口；常见问题每次最多展开一项，支持鼠标与键盘操作。

结构编辑器标题旁可查看 SQL 规范和示例。SQL 历史只记录成功点击生成的版本，载入历史只替换编辑器内容。属性名切换不会覆盖 COMMENT 或手工显示名；没有注释时仍显示原名称。

顶部「重置工作区」会提示确认，执行后回到班级与学生示例，并清空当前浏览器的恢复点、SQL 历史、撤销/重做和复制缓存，刷新也无法通过这些记录找回。已下载的项目文件不删除。

## 验证与交付

- [架构与后续模块接入](docs/ARCHITECTURE.md)
- [公开上传范围与检查步骤](docs/PUBLISHING.md)
- [贡献和问题反馈](CONTRIBUTING.md)
- [开发、目录和环境说明](docs/DEVELOPMENT.md)
- [测试记录与已知限制](docs/VERIFICATION.md)
- [Linux / Docker Compose / HTTPS 部署](docs/DEPLOYMENT.md)
- [阶段记录及后续事项](docs/PROGRESS.md)
- [第三方软件与协议](THIRD_PARTY_NOTICES.md)

本地通过与服务器上线分别验收；尚未连接真实服务器，不能把部署文件当作已经上线。

本仓库尚未指定项目整体的再分发许可证；公开可见不等于授予任意商业使用或再许可权。第三方依赖和字体按各自许可证使用，参见 [第三方软件与协议](THIRD_PARTY_NOTICES.md)。
