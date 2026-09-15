# 部署说明（先看这个）

## 这个项目是什么

这是一个**前端静态页面 + GitHub Actions 后端任务执行器**项目，不是传统的 Node.js Web API 服务。

- `index.html`：网页面板，可部署到 GitHub Pages / 任意静态托管。
- `.github/workflows/panel.yaml`：接收面板请求并执行任务。
- `.github/workflows/daily.yaml`：每天自动执行。
- `actions/run.js`：真正执行登录、签到、续期、任务和气泡领取。
- `data/accounts.enc`：加密账号仓库。

因此，**最完整、最正确的部署方式是 GitHub Repository + GitHub Pages + GitHub Actions**。

## GitHub 部署

1. 新建 GitHub 仓库，建议 Private。
2. 把本压缩包**解压后的所有文件直接放到仓库根目录**。注意：`index.html` 必须就在根目录，不要再套一层 `yun139_export/`。
3. Settings → Secrets and variables → Actions → New repository secret：
   - `PANEL_DATA_KEY`：与面板 DATA_KEY 完全一致。
   - `YUN139_AUTHORIZATION`：可选的单账号兜底 authorization。
   - `YUN139_PHONE`：与上一个 Secret 对应的手机号。
4. Settings → Pages：选择 GitHub Actions（或按仓库实际 Pages 设置发布根目录）。
5. 打开 Pages 地址，在“连接配置”中填写：
   - Repository：`owner/repository`
   - DATA_KEY：与 `PANEL_DATA_KEY` 相同
   - PAT：一个有权限触发 Actions、读取仓库内容并查看 Actions 的 GitHub PAT。
6. 首次添加账号后点击“同步到仓库”，确认 Actions 成功执行。
7. 以后定时任务会从 `data/accounts.enc` 读取加密账号。

## 本地/普通 Node 平台预览

如果 AI 部署工具要求 `start` 命令，本项目已经提供：

```bash
npm install
npm start
```

默认监听 `0.0.0.0:3000`，健康检查为 `/healthz`。

**注意：普通 Node 平台只能托管网页，不能替代 GitHub Actions。** 如果没有 GitHub Actions，面板按钮无法执行后端任务。

## 常见错误

### 1. 找不到 index.html
说明你把整个 `yun139_export` 文件夹上传成了仓库中的一个子目录。必须把 `index.html`、`actions/`、`.github/`、`data/` 等直接放在仓库根目录。

### 2. 页面能打开，但按钮全部失败
通常是 PAT、Repository 或 Actions 权限没有配置正确。

### 3. Actions 提示 PANEL_DATA_KEY 错误
面板中的 DATA_KEY 与 GitHub Secret `PANEL_DATA_KEY` 不一致。

### 4. 气泡领取失败
气泡领取需要 Playwright/Chromium，相关 Workflow 会自动安装；如果官方页面结构发生变化，需要更新 `actions/run.js` 中的页面流程。

### 5. 不要把 PAT / DATA_KEY 放到公开仓库
本项目不会把它们写入分享链接。若旧版本曾经泄露 DATA_KEY，应使用 `tools/rotate-data-key.js` 轮换。
