# Azure 图片代理

把 `.env.example` 复制为 `.env`，填写 Azure 主机地址和密钥，然后执行 `docker compose up -d`。`.env` 不得提交到 Git。

画布渠道填写 `http://127.0.0.1:8787`，使用 OpenAI 格式和实际部署的模型名，API Key 可填写占位值；真实密钥由此代理注入。Nginx 将 `/v1/images/generations` 和 `/v1/images/edits` 转为 Azure 的 `/openai/v1/...` 路径。

画布运行在 Docker Desktop 时，画布的 Compose 中需要以下配置（仓库根目录已配置）：

```yaml
environment:
  IMAGE_PROXY_ORIGIN_OVERRIDES: '{"http://127.0.0.1:8787":"http://host.docker.internal:8787"}'
```

标准生图和改图都通过画布服务转发，因此局域网浏览器无需访问自己的回环地址。映射只对已保存渠道的指定 origin 生效；其他私网目标仍拒绝转发。Codex2API 等公网渠道保持原上游地址，不经过 Azure 代理。

图片请求默认最多等待 30 分钟，可在画布容器用 `IMAGE_PROXY_TIMEOUT_MS` 调整；上游自身仍可能提前超时。Nginx 明确允许 `Authorization` 预检请求头。转换服务使用 Node 标准 multipart 解析器移除 `response_format`，保留多张参考图、蒙版及其他字段。

修改代理文件后执行 `docker compose up -d --force-recreate`，同时重新加载 Nginx 和转换服务。该代理使用挂载配置与官方 Nginx/Node 镜像，不需要单独发布自定义镜像。
