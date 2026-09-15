# yun139-ghpanel

139 云盘自动签到与任务面板：GitHub Pages + GitHub Actions。

> **部署前先阅读 `DEPLOY.md`。**

## 快速开始

1. 将本目录所有文件直接放到 GitHub 仓库根目录。
2. 设置 Actions Secret：`PANEL_DATA_KEY`。
3. 启用 GitHub Pages。
4. 打开 Pages 页面，填写 Repository、DATA_KEY、PAT。
5. 添加账号并同步到仓库。

本项目也提供 `npm start` 用于本地/普通 Node 平台托管网页，但后端任务仍依赖 GitHub Actions。
