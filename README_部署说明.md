# 元宝部署兼容说明

本版本已彻底移除 `.mjs` / ES Module 入口，所有 Node.js 脚本均使用 CommonJS `.js` 格式。

- 入口：`server.js`
- Actions：`actions/run.js`
- 测试：`tests/smoke.js`
- 工具：`tools/rotate-data-key.js`
- `package.json` 已移除 `type: module`
- 启动：`npm start` 或 `node server.js`
- 检查：`npm run check`
- 测试：`npm test`

如果元宝要求“项目入口文件”，请选择 `server.js`；如果要求“启动命令”，填写 `npm start`。

# 移动云盘（139 云盘）自动签到面板 — 稳定优化版

导出时间：2026-09-15

## 1. 功能

- 网页面板（GitHub Pages）
- 多账号本地加密保存
- 短信登录 / authorization 粘贴登录
- 签到、令牌续期、任务列表、可自动任务、气泡领取
- GitHub Actions 定时任务
- 账号数据 AES-256-GCM 加密
- 任务结果带 requestId，避免旧结果串到新任务

## 2. 文件结构

```text
index.html
actions/run.js
.github/workflows/panel.yaml
.github/workflows/daily.yaml
.github/workflows/ci.yaml
data/accounts.enc
data/result.json
tests/smoke.js
tools/rotate-data-key.js
export-btn.png
```

## 3. DATA_KEY

`PANEL_DATA_KEY` 必须与面板里的 DATA_KEY 完全一致。

**不要把 DATA_KEY 写进 README、网页、GitHub Actions 日志或分享链接。**

本版本没有再把 DATA_KEY 明文写进说明文件。

如果你正在使用旧版本，而旧版本的 DATA_KEY 曾经暴露过，建议立即轮换：

```bash
node tools/rotate-data-key.js <旧DATA_KEY> <新DATA_KEY>
```

然后同步修改：

- GitHub Secret：`PANEL_DATA_KEY`
- 面板：高级配置 → DATA_KEY

## 4. GitHub Secrets

建议至少配置：

| Secret | 用途 |
|---|---|
| `PANEL_DATA_KEY` | 加解密账号文件 |
| `YUN139_AUTHORIZATION` | 单账号兜底令牌，可选 |
| `YUN139_PHONE` | 与兜底令牌对应的手机号，可选 |

面板操作需要 GitHub PAT。PAT 仅保存在当前浏览器会话的 `sessionStorage`，不会再写入 `localStorage`，也不会被生成到分享链接中。

## 5. 部署

1. 将全部文件上传到 GitHub 仓库。
2. 建议仓库设置为 **Private**。
3. GitHub Pages 使用 `main` 分支根目录。
4. 在 Actions Secrets 中设置 `PANEL_DATA_KEY`。
5. 打开 Pages 页面，在高级配置中填写仓库、DATA_KEY 和 PAT。
6. 使用“方式二”粘贴 authorization 添加账号。
7. 添加/更新账号后执行同步，使定时任务使用最新账号数据。

## 6. 重要修复

本版本重点处理了以下原始问题：

- 修复任务结果仅依赖时间戳导致的旧结果误判。
- 修复 `rtask` 与前端 pending 类型不一致导致任务完成后按钮不恢复。
- 修复任务列表完成后错误释放“任务执行”按钮而不是“拉取列表”按钮。
- 修复发送验证码没有进入 pending 状态，验证码倒计时可能无法正确结束。
- 修复领取气泡结果渲染函数中的不可达代码，导致成功结果没有更新云豆缓存。
- 修复签到接口 HTTP 200 就被误判为成功的问题。
- 修复状态查询接口失败仍可能显示为成功的问题。
- 修复多个操作可同时运行、覆盖同一个全局 result.json 的竞态。
- 修复 authorization Base64 校验过弱的问题。
- 修复 Set-Cookie 按逗号粗暴切分的问题。
- 修复 RSA PKCS#1 v1.5 padding 使用 `Math.random()` 的问题，改用安全随机数。
- 修复 AES/Hex/PKCS#7 边界数据未严格校验的问题。
- 修复账号重复、手机号格式异常、损坏账号数据没有及时拒绝的问题。
- 修复账号仓库写入过程中可能留下半写入文件的问题，改为临时文件 + 原子替换。
- 修复网络请求缺少统一超时和 HTTP 状态检查的问题。
- 修复任务 payload 可无限制增长的问题。
- 修复 cloudType 为字符串时无法正确统计下月云豆的问题。
- 修复气泡领取在“存在可领取气泡但云豆没有增加”时仍返回成功的问题。
- 修复前端多个动态 `innerHTML` 未进行必要转义的问题。
- 修复 PAT 长期保存在 localStorage 的问题。
- 修复分享链接把 PAT / DATA_KEY 放进 URL 的安全问题。
- 修复前端任务状态与后端实际命令不一致的问题。
- 增加 CI 语法检查和 smoke tests。
- Playwright 统一升级到 `1.63.0`。

## 7. 当前限制

部分需要真实 App 行为的累计任务（例如长期通知、连续上传、AI 功能等）仍不能仅靠接口一次性完成；这属于业务侧限制，不应伪装成“自动完成”。

气泡领取依赖真实浏览器页面及设备/登录态，页面改版时仍可能需要更新选择器和流程。

## 8. 安全建议

- 强烈建议使用 Private 仓库。
- 不要把 PAT、DATA_KEY、authorization 放进 README 或截图。
- 不要把 PAT 放进 URL 分享链接。
- 旧版本如果曾经公开过 DATA_KEY，应使用 `tools/rotate-data-key.js` 立即轮换。
- authorization 失效后不要反复自动重试无限次，应重新抓取有效凭据。
