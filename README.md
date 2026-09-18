# FIELDWATCH

一个面向个人使用的球赛赛程、收藏与观看页前端。当前版本不接入任何未经授权的直播源，播放器保持 Demo / 待配置状态。

## 技术栈

- React 19 + TypeScript
- Vite 8
- 原生 CSS 响应式布局
- 无第三方播放器、广告或统计脚本

## 本地命令

```bash
pnpm install
pnpm run lint
pnpm run build
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

## 数据与直播源

- 赛事数据：`src/matches-data.ts`
- Demo 直播源：`src/stream-data.ts`
- 数据缓存：`src/services/match-service.ts`
- 直播 URL 策略：`src/services/stream-url-policy.ts`

直播 URL 默认留空。只有在确认来源合法并明确授权后才可配置。当前策略只接受不含登录凭据的 HTTPS 地址；第三方 iframe 来源默认全部禁用，授权来源时还需要同步最小化调整 `public/_headers` 的 `frame-src`。

不要把 API Key、token、密码或其他 secret 放入前端源码或提交到仓库。
