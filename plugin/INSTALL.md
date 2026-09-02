# fastbound —— Claude Code 插件

FastBound 火器 A&D 账簿 MCP 服务器。`dist/fastbound-mcp.mjs` 是把全部依赖打进去的
单文件 bundle,**不需要 npm install / 构建**,只要机器上有 **Node ≥ 20.12**(bundle 用 `process.loadEnvFile`)。
Windows / Linux / macOS 通用:启动就是 `node <bundle>`,不经 shell。

## 安装

- **组织分发**:在 claude.ai 组织设置的插件页上传本 zip。
- **本机试用**:`claude --plugin-dir /路径/fastbound.zip`(也可指向解压后的目录)。

## 配置密钥(二选一)

包内**不含任何密钥**,格式见同目录 `.env.example`。

**A. 指向一个 .env 文件(推荐,换机器只拷一个文件)** —— `~/.claude/settings.json`:

```json
{ "env": { "FASTBOUND_ENV_FILE": "/绝对路径/fastbound.env" } }
```

**B. 直接把变量写进 settings.json 的 `env` 块**:`FASTBOUND_ACCOUNTS`、
`FASTBOUND_DEFAULT_ACCOUNT`,以及每个账户别名的 `FASTBOUND_<别名>_ACCOUNT_NUMBER` /
`_API_KEY` / `_AUDIT_USER` / `_ALLOW_WRITES` / `_LABEL`。

两者都不配也能启动,但没有账户可用。

## 注意

- 工具名带插件前缀:`mcp__plugin_fastbound_fastbound__*`。写死旧名 `mcp__fastbound__*`
  的 agent frontmatter / permissions / hooks 需同步改。
- 装上后把 `~/.claude.json` 里原来的 `mcpServers.fastbound` 删掉,避免两份重复。
- 写操作按账户开关(`_ALLOW_WRITES`)。连真实 ATF 账簿时,每次写都是一条真 A&D 记录。
