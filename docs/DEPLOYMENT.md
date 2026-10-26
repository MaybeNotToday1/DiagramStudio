# Linux 服务器部署

交付了 Compose、四个服务和 Nginx HTTPS 配置；官方 Compose CLI 已通过 HTTP/HTTPS 配置静态检查。本机没有 Docker 引擎，尚未进行容器实机或公网验收。不要把本文件当作上线成功记录。

## 准备

建议初期至少 2 核、4 GB 内存及充足磁盘；这是资源预算建议，尚未做并发容量压测。服务器安装 Docker Engine 与 Compose 插件。把源代码和锁文件、`public/fonts` 上传到专用目录；不要上传本机 `.tools`、`.cache`、`.runtime` 或真实凭据。

在项目根目录：

```sh
node scripts/create-deployment-env.mjs
chmod 600 deploy/.env
```

生成器只创建文件，不打印或覆盖凭据。编辑 `deploy/.env` 的 DOMAIN 为实际域名。没有 Node 的服务器可先在本地运行生成器，再通过安全方式传输生成的文件。不要使用 `.env.example` 中的示例值上线。

## 内部试运行

```sh
docker compose --env-file deploy/.env -f deploy/compose.yml up -d --build
docker compose --env-file deploy/.env -f deploy/compose.yml ps
```

默认 HTTP 只用于部署验证。数据库和 worker 没有映射宿主端口，API 也只通过 Nginx 访问。需要检查浏览器能打开、生成并下载 PDF。`/api/health` 表示 API 进程存活；还应实际创建 PDF 验证 worker 和数据库链路。

## HTTPS

先将域名 DNS 指向服务器并开放 80/443。用可信 CA 或 Let's Encrypt 获取域名证书，把 fullchain.pem 和 privkey.pem 放入 `deploy/certs/`；限制私钥文件权限，证书目录不要提交。证书申请与续期由服务器运维安排，例如 Certbot DNS challenge 或反向代理已有证书。无需把私钥交给开发者。

```sh
docker compose --env-file deploy/.env -f deploy/compose.yml -f deploy/compose.https.yml up -d --build
```

HTTPS 覆盖会把 HTTP 重定向到域名 HTTPS，并开启 Secure Cookie。证书更新后执行相同 compose 参数的 `exec web nginx -s reload`。只有在证书有效且自动续期已安排后才能标记正式上线。

## 运行与恢复

- `mysql-data` 保存临时任务元数据，`export-data` 保存临时 PDF，均为独立命名卷。永久项目仍保存在用户浏览器及用户下载的原生项目文件。
- 更新前保存源代码/镜像版本和 `.env`；可对数据库卷做受控备份，备份也包含临时输入，需遵循相同保留策略。不要无限期备份导出卷。
- API 设计为单实例；不要增加副本数。扩容前需要重新实现分布式恢复/租约和队列策略。
- worker 失败会让当前任务显示失败。重启 API 后，运行中任务显示“服务重启中断”，排队任务继续，成功文件仍可下载。
- 不要用 `docker compose down -v` 做普通升级，否则会删除运行数据。普通停止使用 `stop` 或 `down`。
- 日志不包含请求快照、Cookie 或凭据；检查日志时仍不要公开实际配置文件。

## 上线验收

1. 用两个独立浏览器会话确认任务与下载隔离。
2. 对 A4/A3、横竖、分页实际下载 PDF，检查中文及完整范围。
3. 重启 API 验证已完成任务及中断任务状态；临时停 worker 检查明确失败。
4. 核对 24 小时清理、磁盘占用、资源限制、证书续期和日志保留。
5. 生产负载下测并发和响应时间，依据实测调节队列限制；当前本机单用户测试不能替代服务器容量测试。
