# 构建 Vite 前端产物。
FROM oven/bun:1.3.13 AS web-build

WORKDIR /app/web
COPY web/package.json web/bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --cache-dir=/root/.bun/install/cache
COPY VERSION /app/VERSION
COPY CHANGELOG.md /app/CHANGELOG.md
COPY web ./
RUN bun run build

# 运行镜像：静态前端、状态文件 API 和图片同源代理。
FROM node:22-alpine

COPY --from=web-build /app/web/dist /usr/share/infinite-canvas
COPY server.mjs /usr/local/bin/infinite-canvas-server.mjs

EXPOSE 3000
VOLUME ["/data"]
CMD ["node", "/usr/local/bin/infinite-canvas-server.mjs"]
