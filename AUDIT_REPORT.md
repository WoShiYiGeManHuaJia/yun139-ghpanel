# 逐文件深度审计与修复报告

审计对象：`yun139-ghpanel-源码包.zip`

原始源码主要代码/配置文本共 2188 行：

- `actions/run.js`：973 行
- `index.html`：953 行
- 两个 workflow：146 行
- `README_部署说明.md`：116 行

本次不是只针对已知故障点修补，而是对上述代码、工作流、数据读写、前端状态机、加密边界和错误处理进行了完整静态审计，并对能在本地验证的路径进行了实际测试。

## 高危/核心逻辑问题

1. **结果串任务**：前端只用 `ts` 判断结果，触发新任务后主动把 `lastTs` 清空，旧的同类型 `result.json` 可能立即被当成新任务结果。
   - 修复：每次任务生成唯一 `requestId`，后端原样回写，前端必须严格匹配。

2. **`rtask` pending 类型错误**：前端发送 `rtask`，但 pending 保存的是 `task`，导致结果到达后无法正确结束等待状态。
   - 修复：统一为 `rtask`。

3. **任务列表按钮错误恢复**：拉取任务列表使用 `kind=task`，结果处理会恢复“执行任务”按钮，而不是“拉取任务列表”按钮。
   - 修复：增加独立 `list` kind。

4. **验证码发送没有进入 pending 状态**：验证码倒计时与后台任务生命周期脱节。
   - 修复：发送验证码建立 `send_code` pending，成功/失败均结束倒计时。

5. **气泡领取结果函数存在不可达代码**：`return` 后仍有更新缓存的代码，成功领取后 UI 不更新。
   - 修复：重写结果渲染流程并统一刷新缓存。

6. **签到接口 HTTP 200 即被当成成功**：业务层失败也可能显示“签到成功”。
   - 修复：同时检查业务 code/success。

7. **云豆状态接口异常仍可能显示账号成功**：原代码 `cloudStatus()` 即使两个接口都失败，外层仍把 row 标记为成功。
   - 修复：增加 `st.ok`。

8. **多个后台操作可以并行写同一个 `result.json`**：前端只有部分按钮有锁，任务/状态/列表/领取可以互相覆盖结果。
   - 修复：统一 pending 锁，单页面同时只允许一个后台操作。

## 网络与协议问题

9. 网络请求大量没有统一超时。
10. 多个请求直接 `.json()`，HTTP 错误/HTML 错误页会产生难定位异常。
11. Set-Cookie 原先按逗号切割，遇到复杂 cookie 属性存在解析风险。
12. authorization Base64 校验过弱，Node `Buffer.from()` 对部分非法输入具有宽松行为。
13. RSA PKCS#1 v1.5 padding 使用 `Math.random()`，随机源不安全。
14. RSA 明文长度没有检查。
15. AES-GCM 密文长度没有检查。
16. AES-ECB 密文块长度没有检查。
17. PKCS#7 去填充原先遇到非法 padding 会静默放行。
18. 十六进制转换没有严格校验奇数长度和非法字符。
19. refresh 返回的新 token/过期时间没有充分验证。
20. 任务/点击接口缺少统一 HTTP 状态检查。

## 数据一致性问题

21. 账号列表允许重复手机号进入本地/后端数据。
22. 损坏账号对象可能一直进入执行链，直到深层 API 才失败。
23. `accounts.enc` 写入直接覆盖，写入中断可能留下损坏文件。
24. 账号仓库加载失败原先完全静默，排障困难。
25. 登录同手机号可能追加重复账号，而不是更新已有账号。
26. `cloudType` 为字符串时原来的严格 `=== 2` 无法统计下月数据。
27. 任务 payload 没有大小/数量限制。

## 浏览器/前端问题

28. 多处动态 HTML 原先没有统一转义，存在 DOM 注入风险。
29. PAT 原先长期写入 localStorage。
30. 分享链接原先把 PAT 和 DATA_KEY 放进 URL。
31. 大数组使用 `String.fromCharCode(...all)`，数据较大时可能触发参数栈限制。
32. GitHub API 错误信息处理不统一。
33. 多个操作缺少统一并发锁。
34. 领取结果成功/失败 UI 状态不完整。
35. 列表、任务、验证码、领取等按钮的 pending 生命周期不统一。

## 自动化/工作流问题

36. Playwright 版本固定过旧，统一升级到 `1.63.0`。
37. 增加 CI：Node 语法检查、HTML 脚本语法检查、smoke tests。
38. 增加 `package.json` 明确依赖版本。
39. 保留 workflow concurrency，避免结果文件并发 push。
40. 增加数据密钥轮换工具。

## 安全处理

旧源码 README 中存在 DATA_KEY 明文。新版本已从 README 中移除，不再放入分享链接。

为了不在没有用户确认的情况下让现有 `accounts.enc` 立即失效，本次没有静默替换其加密密钥；同时增加：

```text
tools/rotate-data-key.js
```

如果旧密钥曾经公开过，建议在部署新版本后立即执行密钥轮换，并同步修改 GitHub Secret 与面板配置。

原来的 `data/result.json` 含账号手机号，本版本已替换为无账号信息的 bootstrap 结果，避免把历史运行结果继续公开在仓库中。

## 已执行验证

- `node --check actions/run.js`：PASS
- `node --check index.html` 中脚本：PASS
- `node --check tests/smoke.js`：PASS
- `node --check tools/rotate-data-key.js`：PASS
- 三个 GitHub workflow YAML：PASS
- HTML DOM 解析：PASS
- DOM 引用检查：无缺失 ID
- 现有 `accounts.enc`：成功解密并验证 3 个账号 authorization 与手机号一致
- AES-GCM 加解密往返：PASS
- RSA 输出长度/authorization 解析：PASS
- 非法 Hex / PKCS#7 输入拒绝：PASS
- 前端 requestId、pending、rtask/list/send_code 关键状态机检查：PASS
- `npm test`：PASS
