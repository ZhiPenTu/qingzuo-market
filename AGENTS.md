# AGENTS.md

本仓库维护轻作插件市场目录和发布审核器。它只审核、校验和签名插件制品，不执行插件代码，也不负责构建插件或桌面底座。

## 项目边界

- `publishers.json` 是允许提交稳定版本的注册表；未知仓库不能进入目录。
- `catalog.json` 是客户端读取的已签名目录；每个条目必须同时提供 `darwin-arm64` 和 `win32-x64` 制品。
- `scripts/verify.mjs` 校验 ZIP 安全性、manifest、身份、版本、摘要和制品大小，并对原始字节签名。
- `scripts/validate.mjs` 校验目录结构、API 范围、HTTPS 地址、摘要和 Ed25519 签名格式。
- `scripts/ingest.mjs` 从已注册插件的稳定 GitHub Release 下载两个平台制品，核对 Release provenance 后创建目录 PR。

## 开发与验证

使用 Node 24：

```sh
npm ci --ignore-scripts
npm test
npm run validate
```

变更审核规则时，优先补充 `tests/verify.test.mjs` 或 `tests/ai.test.mjs`，覆盖成功路径和恶意 ZIP、路径穿越、符号链接、重复路径、缺少入口、错误 API/身份等失败路径。工作流 `.github/workflows/validate.yml` 是提交和 PR 的最低检查。

## 安全与数据约束

- `COMMERCE_PLUGIN_SIGNING_KEY` 只允许存在于受保护的 Actions Secret 或受控操作环境；不要写入源码、日志、目录或 PR 内容。市场密钥必须是 Ed25519。
- 不要为了通过验证而放宽 `safeRelative`、ZIP 条目类型、大小上限、HTTPS、摘要、签名或 manifest 校验。
- 市场检查的是公开 Release 原始字节。不要解压后重打包，也不要在审核流程中启动插件、安装依赖或执行插件 backend。
- 平台元数据、版本、API、标题、描述和 release notes 必须在两个平台片段与插件 `package.json` 中一致；目录只保留稳定的语义化版本。
- SDK 来源固定在 `package.json` 和 lockfile。升级 SDK 要同步测试、锁文件和兼容性说明，不能改成浮动 `latest`。

## 目录摄入与发布

```sh
# 只读审核
npm test && npm run validate

# 需要 GitHub CLI、注册仓库、稳定 tag 和市场私钥；会创建并推送分支及 PR
PLUGIN_REPOSITORY=ZhiPenTu/<plugin-repository> PLUGIN_TAG=vX.Y.Z \
  COMMERCE_PLUGIN_SIGNING_KEY="$KEY" npm run ingest
```

`npm run ingest` 会调用 `gh`、切换/创建 `market/<id>-<version>` 分支、推送分支并创建 PR。除非用户明确要求进行市场摄入，不要运行它或修改线上目录。合并 PR 后目录更新，桌面底座不需要重新打包。

插件仓库负责构建和发布 `.ecplugin` 与 `catalog-*.json`；市场负责审核、签名和目录 PR。不要把插件私钥、桌面签名私钥、用户 API key 或跨仓库宽权限凭据放进本仓库。

## 变更流程

1. 先阅读 `README.md`、`publishers.json`、相关校验脚本和测试。
2. 对校验逻辑保持最小改动，明确说明新的安全或兼容边界。
3. 运行 `npm test && npm run validate`，再检查 `git diff --check` 和 `git status`。
4. 最终报告实际验证结果；不要把模拟 fixture 或静态校验描述成真实插件运行验收。
