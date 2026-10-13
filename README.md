# chrome-cdp-pa

轻量 Chrome DevTools Protocol 命令行。通过 WebSocket 直连已打开的 Chrome，不依赖 Puppeteer，上百个标签页也能马上连上。

它是浏览器探查工具，不是 UI 自动化测试引擎。页面回归仍走 Midscene。

## 使用前

- Chrome、Chromium、Brave、Edge 或 Vivaldi 已打开远程调试：在 `chrome://inspect/#remote-debugging` 打开开关
- Node.js 22+（使用内置 WebSocket）
- 调试端口文件不在默认位置时，把 `CDP_PORT_FILE` 设成 `DevToolsActivePort` 的完整路径

## 常用命令

在仓库根目录执行。`<target>` 必须是 `list` 输出里的唯一 targetId 前缀。

```bash
node scripts/cdp.mjs list
node scripts/cdp.mjs nav <target> <url>
node scripts/cdp.mjs eval <target> "$(cat scripts/dom-extract.js)"
node scripts/cdp.mjs shot <target>
node scripts/cdp.mjs click <target> <selector>
node scripts/cdp.mjs clickxy <target> <x> <y>
node scripts/cdp.mjs type <target> <text>
```

理解页面优先用 `dom-extract.js`。它返回 `elementTree`、`selectorMap`、`pageInfo` 和 `stats`，不再提供旧的 `inputs` / `buttons` 分组。密码、邮箱、手机号默认打码。

截图是视口，坐标按 CSS 像素。`shot` 会打印 DPR，Retina 上截图像素要除以 DPR 再传给 `clickxy`。

每个标签页第一次连接时，Chrome 会弹出一次允许调试。之后由后台进程保持会话，空闲 20 分钟自动退出。

## 目录

| 路径 | 内容 |
|---|---|
| `SKILL.md` | 给 Agent 的操作规程 |
| `scripts/cdp.mjs` | CDP 命令行 |
| `scripts/dom-extract.js` | 可见可操作元素提取 |

## 安装

```bash
git clone https://github.com/sika-deer-w/chrome-cdp-pa.git \
  ~/.cursor/skills/chrome-cdp-pa
```
