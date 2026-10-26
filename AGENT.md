# Repository Guidelines

## 开发范围与执行顺序

REA 已按用户要求卸载并暂停使用。不得根据历史计划自动重装或调用 REA；恢复使用需用户明确要求。

项目根目录为当前克隆的仓库目录。先完成 ER：SQL 生成 → 编辑/排版/本地保存 → 图形导出 → 服务端 PDF。检查现有实现和验证记录后继续，禁止重新搭建已有模块或把占位界面当作完成。

最终规划八类工具；其余七类等待 ER 验收及用户后续安排。首发免费、无需用户登录，项目保存在浏览器并支持文件备份。暂不实现 AI、用户账号、云同步、支付或多人协作；未来接入边界保持清晰，不创建空模块。

## 项目结构

- `src/modules/er/components/`：Vue 画布组件；`src/modules/er/domain/`：ER 模型、SQL、布局和导出；`src/modules/er/store.ts`：编辑状态及本地保存。
- `server/api/`：Java 21、Spring Boot 4、JDBC、Flyway；`server/worker.mjs`：PDF 渲染进程。遵循现有实现，不因旧计划改成另一套数据访问方案。
- `tests/unit/`：Vitest；`tests/e2e/`：Playwright；Java 测试在 `server/api/src/test/`。
- `public/fonts/`：字体及许可证；`scripts/`：Windows 环境和进程管理；`deploy/`：Linux 容器及 Nginx 配置。
- `.tools/`、`.cache/`、`.runtime/`：工具、缓存、运行数据；不提交这些目录、`node_modules/`、`dist/` 或 Java `target/`。

## 环境与磁盘约束

优先复用本机兼容软件。缺失版本从官方来源下载到 `.tools/`，记录版本和校验结果；依赖缓存放 `.cache/`，日志、临时文件、浏览器配置及数据库数据放 `.runtime/`。

不修改系统环境变量，不覆盖已有 JDK/Maven/MySQL，不升级其他项目数据库。允许调用已有 C 盘程序，但新增可控文件尽量留在项目目录。Windows 本地运行不强制安装 Docker/WSL；系统级改动需说明并获授权。停止服务只处理本项目记录的进程。

## 构建、运行与测试

在根目录使用 PowerShell 7，先执行 `. ./scripts/Common.ps1` 初始化进程级环境：

| 命令 | 用途 |
|---|---|
| `& $npmExe ci` | 按锁文件安装依赖 |
| `& $npmExe run dev` | 启动前端，默认端口 5173 |
| `& $npmExe test` | 运行 Vitest 单元测试 |
| `& $npmExe run build` | TypeScript 检查及生产构建 |
| `pwsh -File scripts/Start.ps1 -FrontendOnly` | 后台启动前端 |
| `pwsh -File scripts/Start.ps1 -Build` | 构建并启动完整本地服务 |
| `& $npmExe run test:e2e` | 服务启动后运行浏览器测试；PDF 测试需要完整服务 |
| `pwsh -File scripts/Stop.ps1` | 停止本项目服务 |

Java 测试先执行 `Use-Java`，再运行 `& $mavenExe "-Dmaven.repo.local=$projectRoot/.cache/maven" -f server/api/pom.xml test`。缺失后台环境时按需检查 `scripts/Prepare-Backend.ps1`；不要为文档修改安装环境或启动服务。

## 编码与数据约定

前端使用两空格、单引号并遵循现有无分号风格；Java 使用四空格。Vue 组件用 PascalCase，变量/函数用 camelCase。当前没有 ESLint/Prettier 命令，不虚构检查项或全局格式化。

业务结构、布局、样式分离；保留稳定 ID 和格式版本。改名保持关系，解析失败保留原图，重排可以撤销。只修改任务所需代码，避免无关重构；重要歧义先澄清。

## 验收与交付

单元测试命名 `*.test.ts`，浏览器测试命名 `*.spec.ts`，Java 测试沿用 `*Test.java`。缺陷修复添加可复现测试；覆盖 SQL、复合键、编辑恢复、布局及导出。没有既定覆盖率百分比，不以数量代替关键行为验证。

检查实际 PNG/JPEG/SVG/Draw.io/PDF：中文完整、无裁切，Draw.io 可编辑。PDF 验证匿名任务隔离、失败、超时和清理；H2 单测不能代替 MySQL 联调。30 表、每表约 20 字段作为复杂样本，记录实际耗时。

报告改动、已运行检查、结果和未验项；未运行的测试不得声称通过。尚无 Git 历史约定，后续采用 `feat:`、`fix:`、`docs:`、`test:`、`chore:`。PR 写明行为变化、验证结果、相关需求及界面截图；提交、推送和公网发布按用户授权执行。

## 配置与安全

不执行用户 SQL，不加载任意外部渲染页面。密码、密钥、Cookie 和令牌不得输出或提交；禁止完整打印 `.runtime/local.json`、数据库初始化日志及真实部署配置。示例使用占位符，真实配置保持忽略。

Linux 部署保留 HTTPS、健康检查、持久卷、资源限制和清理机制。不得把本地可运行等同于服务器验收通过；依赖与字体需保留许可证。
