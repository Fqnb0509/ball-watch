# FIELDWATCH

一个面向个人使用的球赛赛程、收藏与观看页前端。当前版本不接入任何未经授权的直播源，并保留 Demo 回退与一个已核验的官方 YouTube 测试源。

## 技术栈

- React 19 + TypeScript
- Vite 8
- 原生 CSS 响应式布局
- 无第三方播放器、广告或统计脚本

## 本地命令

```bash
pnpm install --frozen-lockfile --offline
pnpm run lint
pnpm run typecheck:functions
pnpm run build
pnpm run test:stage3
pnpm run dev
```

生产构建输出到 `dist/`。

## Cloudflare Pages

- Framework preset：React / Vite
- Build command：`pnpm run build`
- Build output directory：`dist`
- Production branch：`main`

`public/_headers` 提供 CSP、禁止被第三方页面嵌入、MIME sniffing 防护、Referrer Policy、Permissions Policy 和 HTTPS HSTS。构建时该文件会复制到 `dist/_headers`。

当前应用没有独立 URL 路由；首页、详情页和观看页均由同一个 SPA 入口内的状态切换完成，因此不需要额外重写规则。

### API-Football 赛事 Function

浏览器只请求同源的 `GET /api/matches?from=YYYY-MM-DD&to=YYYY-MM-DD`。Cloudflare Pages Function 在服务端访问固定的 API-Football fixtures endpoint，前端不会直接连接上游。

在 Cloudflare Pages 的生产环境变量和密钥中配置：

- `API_FOOTBALL_KEY`：必须配置为 Secret，只在 Pages Function 服务端读取。不要使用 `VITE_*` 名称，也不要写入前端源码、日志或 Git。
- `API_FOOTBALL_LEAGUE_ID`：普通变量，可选，默认 `39`。
- `API_FOOTBALL_SEASON`：普通变量，可选，默认 `2026`。

本地 Functions 调试如需凭据，只能使用被 Git 忽略的 `.dev.vars`；该文件不得提交。Stage 3 的 `pnpm run test:stage3` 使用假凭据和模拟响应，完全离线，不会消耗 API 配额。

## 数据与直播源

- 赛事 Provider：`src/match-providers/`；API-Football 用于足球，`src/matches-data.ts` 作为 Demo/fallback fixture
- 赛事聚合、缓存与容错：`src/services/match-service.ts`
- Demo 直播源：`src/stream-data.ts`
- 数据缓存：`src/services/match-service.ts`
- 直播 URL 策略：`src/services/stream-url-policy.ts`
- 直播 provider：`src/stream-providers/`

直播 URL 默认留空，当前没有接入任何真实直播。只有在确认来源合法并明确授权后，才可以在 provider 配置中添加来源。provider 会按比赛 ID、provider event ID，或联赛/球队/开赛时间窗口进行严格匹配；不满足完整身份条件的配置不会匹配任何比赛。

当前支持的扩展类型包括 `official`、`youtube`、`external-api` 和 `manual`：

- 官方页面只能作为经过来源白名单校验的“官方观看入口”，不会提取 manifest、绕过登录、地区限制或 DRM。
- YouTube 手动配置位于 `src/stream-providers/youtube-provider.ts`，字段包括 `matchId`、`provider: 'youtube'`、`videoId`、`title`、`legalStatus` 和 `enabled`；只有已核验的 11 位官方 Video ID、`legalStatus: 'authorized'` 且启用时才会生成 iframe。省略或留空 `videoId`、填写普通 YouTube 页面 URL 或其他协议都会继续显示“暂无合法直播源”。当前仅配置 Savannah Bananas 官方测试源。
- HLS、DASH、MP4 直链还需要把经过审核的媒体 origin 加入 `stream-url-policy.ts` 的明确白名单；当前白名单为空。
- `external-api` 仅保留服务端 provider 边界，API Key 不会读取或暴露在前端。

没有合法来源时，界面显示“暂无合法直播源”；Demo 源只用于展示安全回退状态，不会参与播放器或自动 failover。

不要把 API Key、token、密码或其他 secret 放入前端源码或提交到仓库。
