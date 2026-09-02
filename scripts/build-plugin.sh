#!/usr/bin/env bash
# 把本仓打成一个 Claude Code 插件 zip。
#
#   scripts/build-plugin.sh [输出目录]        # 默认 ~/Desktop
#
# 版本单一来源 = package.json 的 version。脚本会实跑打出来的产物,断言它
# 自报的 serverInfo.version 与之一致 —— src/index.ts 里那个写死的版本号
# 一旦忘了跟着改,这里就会失败,而不是静默发出一个版本号说谎的包。
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${1:-$HOME/Desktop}"
NAME=fastbound
ESBUILD=esbuild@0.24.0

cd "$REPO"
VERSION="$(node -p 'require("./package.json").version')"
echo "==> $NAME $VERSION"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
PLUGIN="$STAGE/$NAME"
mkdir -p "$PLUGIN/.claude-plugin" "$PLUGIN/dist"

# 依赖全部 bundle 进单文件:装插件时不联网、不受 npm 安装 60 秒超时影响,
# 也避开 node_modules 里 @scope 路径被 claude.ai 上传校验拒收的问题。
npx --yes "$ESBUILD" src/index.ts \
  --bundle --platform=node --target=node20 --format=esm \
  --outfile="$PLUGIN/dist/$NAME-mcp.mjs" \
  --log-level=warning \
  --banner:js="import{createRequire as __cr}from'node:module';const require=__cr(import.meta.url);" \
  >/dev/null

sed "s/__VERSION__/$VERSION/" plugin/plugin.json.in > "$PLUGIN/.claude-plugin/plugin.json"
cp plugin/mcp.json "$PLUGIN/.mcp.json"
cp plugin/INSTALL.md README.md LICENSE NOTICE .env.example "$PLUGIN/"

# --- 冒烟:用假凭据实跑一次,确认产物能起来且版本号不说谎 -----------------
echo "==> 冒烟测试"
SMOKE_VERSION="$(printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"build","version":"1"}}}' \
  | env -i PATH="$PATH" \
      FASTBOUND_ACCOUNT_NUMBER=000000 FASTBOUND_API_KEY=smoke-test \
      FASTBOUND_ALLOW_WRITES=false \
      node "$PLUGIN/dist/$NAME-mcp.mjs" 2>/dev/null \
  | python3 -c 'import sys,json
for l in sys.stdin:
    l=l.strip()
    if l:
        print(json.loads(l).get("result",{}).get("serverInfo",{}).get("version",""))
        break')"
if [ "$SMOKE_VERSION" != "$VERSION" ]; then
  echo "✘ 产物自报版本 '$SMOKE_VERSION' ≠ package.json 的 '$VERSION'" >&2
  echo "  改 src/index.ts 里 new McpServer({... version: \"$VERSION\" }) 后重跑。" >&2
  exit 1
fi

claude plugin validate "$PLUGIN" >/dev/null || { echo "✘ claude plugin validate 失败" >&2; exit 1; }

mkdir -p "$OUT_DIR"
ZIP="$OUT_DIR/$NAME-plugin.zip"
rm -f "$ZIP"
( cd "$STAGE" && zip -qr "$ZIP" "$NAME" -x '*/.DS_Store' '*/.env' )

# --- 上传前的硬闸门(每条都对应一次真实被拒/装不上的经历) -----------------
python3 - "$ZIP" "$NAME" <<'PY'
import re, subprocess, sys, os
zip_path, name = sys.argv[1], sys.argv[2]
entries = subprocess.run(["unzip", "-Z1", zip_path], capture_output=True, text=True, check=True).stdout.split()
fail = []
# claude.ai 上传校验会拒非法字符;npm @scope 目录就是踩这条
bad = {c for e in entries for c in e if not re.match(r"[A-Za-z0-9._/-]", c)}
if bad: fail.append(f"路径含非法字符 {bad}")
# 顶层必须是单个文件夹,.claude-plugin/plugin.json 只能在它下面一层
tops = {e.split("/")[0] for e in entries}
if tops != {name}: fail.append(f"顶层不是单个文件夹 {name}/:{tops}")
if f"{name}/.claude-plugin/plugin.json" not in entries: fail.append("缺 .claude-plugin/plugin.json")
# claude.ai 明文拒收顶层 bin/
if any(e.startswith(f"{name}/bin/") for e in entries): fail.append("有顶层 bin/(claude.ai 会拒)")
if any(e.endswith("/.env") or e == ".env" for e in entries): fail.append("打进了 .env")
size = os.path.getsize(zip_path)
if size > 50 * 1024 * 1024: fail.append(f"超过 50 MB 上传上限({size/1e6:.1f} MB)")
if fail:
    print("✘ " + "\n✘ ".join(fail), file=sys.stderr); sys.exit(1)
print(f"   {len(entries)} 个条目,{size/1024:.0f} KB")
PY

echo "✔ $ZIP"
