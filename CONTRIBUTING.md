# 开发与反馈

先阅读 [README](README.md)、[架构](docs/ARCHITECTURE.md) 和 [开发说明](docs/DEVELOPMENT.md)。当前只维护 ER；其他模块先讨论需求，再独立实现。

修改前端后运行 `npm test`、`npm run build` 和 `npm run test:smoke`。涉及 PDF、任务或服务启动时，还需运行 Java 测试及完整 `test:e2e`；没有对应环境时明确列出未验项，不能把前端 smoke 当作后台通过。

问题报告提供复现步骤、浏览器版本、预期与实际结果。SQL、项目文件和截图请使用合成或脱敏数据，禁止提交密码、Cookie、真实数据库结构或导出任务凭据。安全问题请参阅 [SECURITY.md](SECURITY.md)。

提交说明围绕具体行为和验证结果，可使用 `feat:`、`fix:`、`docs:`、`test:`、`chore:`。不把依赖、工具、运行数据或测试截图提交进仓库。
