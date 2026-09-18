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
- 直播 provider：`src/stream-providers/`

直播 URL 默认留空，当前没有接入任何真实直播。只有在确认来源合法并明确授权后，才可以在 provider 配置中添加来源。provider 会按比赛 ID、provider event ID，或联赛/球队/开赛时间窗口进行严格匹配；不满足完整身份条件的配置不会匹配任何比赛。

当前支持的扩展类型包括 `official`、`youtube`、`external-api` 和 `manual`：

- 官方页面只能作为经过来源白名单校验的“官方观看入口”，不会提取 manifest、绕过登录、地区限制或 DRM。
- YouTube 只接受经过人工核验的 11 位视频 ID，并要求使用官方 embed 域名；当前配置为空。
- HLS、DASH、MP4 直链还需要把经过审核的媒体 origin 加入 `stream-url-policy.ts` 的明确白名单；当前白名单为空。
- `external-api` 仅保留服务端 provider 边界，API Key 不会读取或暴露在前端。

没有合法来源时，界面显示“暂无合法直播源”；Demo 源只用于展示安全回退状态，不会参与播放器或自动 failover。

不要把 API Key、token、密码或其他 secret 放入前端源码或提交到仓库。
