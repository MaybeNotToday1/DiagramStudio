# 第三方软件

本工程通过包依赖组合实现，没有复制参考网站源代码。依赖的精确版本由 package-lock.json / Maven 依赖管理确定。分发时保留相应软件的 LICENSE、版权和 NOTICE；完整许可文本在依赖包和官方仓库中。

| 软件 | 本次版本 | 协议与来源 |
|---|---|---|
| Vue | 3.5.44 | MIT · https://github.com/vuejs/core |
| Pinia | 3.0.4 | MIT · https://github.com/vuejs/pinia |
| Element Plus | 2.14.7 | MIT · https://github.com/element-plus/element-plus |
| AntV X6 | 3.1.8 | MIT · https://github.com/antvis/X6 |
| ELK.js | 0.11.1 | EPL-2.0 · https://github.com/kieler/elkjs |
| node-sql-parser | 5.4.0 | Apache-2.0 · https://github.com/taozhi8833998/node-sql-parser |
| idb | 8.0.4 | ISC · https://github.com/jakearchibald/idb |
| fflate | 0.8.3 | MIT · https://github.com/101arrowz/fflate ，用于本地实体图片 ZIP；原协议在 node_modules/fflate/LICENSE |
| Vite | 7.3.7 | MIT · https://github.com/vitejs/vite |
| Playwright | 1.64.1 | Apache-2.0 · https://github.com/microsoft/playwright |
| Spring Boot | 4.1.2 | Apache-2.0 · https://github.com/spring-projects/spring-boot |
| Noto Serif CJK SC | 已附字体 | SIL OFL 1.1 · https://github.com/notofonts/noto-cjk ，完整协议位于 public/fonts/LICENSE.txt |
| MySQL Community Server | 8.4.13 | GPL-2.0 · https://dev.mysql.com/downloads/mysql/8.4.html ，开发工具仅放于忽略目录，服务器使用官方独立镜像 |
| PDF.js / pdf-lib | 测试依赖 | Apache-2.0 / MIT |
| wawoff2 | 构建字体工具 | MIT，含上游 WOFF2 组件许可，见依赖包 |
| Docker Compose CLI | 5.6.1，独立校验工具 | Apache-2.0 · https://github.com/docker/compose |

ELK.js 保持作为独立依赖使用，未修改其源文件。若未来修改或重新分发其覆盖源码，需继续遵守 EPL-2.0 的对应源码要求。容器和便携工具自身的第三方许可也需保留，不能只携带本文件代替原协议。
