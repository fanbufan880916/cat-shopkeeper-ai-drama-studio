# 安全说明

## API Key

API Key 只应通过工作台“API 设置”保存在用户本机。禁止把 Key 写进源码、提示词文档、截图、Issue、日志或 Git 提交。

Windows 下的 Key 使用当前用户 DPAPI 加密并保存在 `.data/cat-studio.sqlite`。`.data/`、`.backups/`、`.uploads/` 和本机 `.codex/config.toml` 均被 Git 忽略。

## 公开发布前检查

运行：

```powershell
npm run audit:release
```

检查失败时不得推送公开仓库。尤其不能发布：数据库、备份、上传媒体、临时提示词、日志、DPAPI 密文、真实 API Key或发布者本机绝对路径。

## 报告安全问题

发现疑似密钥或个人数据泄露时，不要创建公开 Issue。请通过仓库所有者 GitHub 主页提供的私密联系方式报告，并立即撤销相关密钥。
