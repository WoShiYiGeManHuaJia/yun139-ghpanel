# 移动云盘自动签到（GitHub Actions 定时任务 + 钉钉推送）

纯后端定时任务，无前端面板。到点自动执行，结果推送到钉钉。

## 定时任务

| 任务 | 时间（北京） | 说明 |
|---|---|---|
| `yun139-daily` | 每天 09:05 | 令牌续期 → 推进任务 → 领取云豆气泡 |
| `yun139-mday16` | 每月 16 号 09:20 | 会员日（星动日）抢奖品，默认优先星巴克 |

两个任务都支持在 Actions 页面手动点「Run workflow」立即执行。

## 必配 Secrets

仓库 → Settings → Secrets and variables → Actions

| Secret | 必填 | 说明 |
|---|---|---|
| `PANEL_DATA_KEY` | ✅ | 解密 `data/accounts.enc` 的数据密钥（32 位） |
| `DINGTALK_WEBHOOK` | ⬜ | 钉钉机器人 Webhook；不填则不推送（其余功能不受影响） |
| `DINGTALK_SECRET` | ⬜ | 机器人安全设置为「加签」时填；使用「自定义关键词」时留空 |

### 钉钉机器人怎么建

1. 钉钉群 → 群设置 → 智能群助手 → 添加机器人 → 自定义
2. 安全设置二选一：
   - **加签**（推荐）：复制 `SEC` 开头的串，填到 `DINGTALK_SECRET`
   - **自定义关键词**：填关键词如 `云盘`，`DINGTALK_SECRET` 留空
3. 复制 Webhook 地址，填到 `DINGTALK_WEBHOOK`

> 安全设置若选「IP 地址段」，GitHub Actions 的出口 IP 不固定，会推送失败，不建议。

## 推送内容

每日报告包含：每个账号的令牌续期情况、**任务完成情况（逐条列出任务名与成功/失败）**、云豆气泡领取前后数量。

会员日报告包含：各账号会员等级、预约状态、奖品数量、抢购结果。

## 账号管理

账号加密存放在 `data/accounts.enc`，由 `PANEL_DATA_KEY` 解密。改密钥用：

```bash
node tools/rotate-data-key.js
```

## 本地执行

```bash
npm install
EVENT_TYPE=daily PAYLOAD='{}' PANEL_DATA_KEY=你的密钥 node actions/run.js
```
