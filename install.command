#!/bin/zsh

set -u

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_ROOT" || exit 1

pause_before_exit() {
  if [[ "${PLAINIFY_NONINTERACTIVE:-0}" != "1" && -t 0 ]]; then
    read -r "reply?按 Enter 键关闭这个窗口..."
  fi
}

fail() {
  echo
  echo "安装未完成：$1"
  pause_before_exit
  exit 1
}

echo "加简大白话 · Plainify"
echo "正在准备本机服务..."
echo

[[ "$(uname -s)" == "Darwin" ]] || fail "一键安装目前仅支持 macOS，其他系统请运行 npm run dev。"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "需要先安装 Node.js 20.19 或更高版本。"
  open "https://nodejs.org/zh-cn/download"
  fail "已为你打开 Node.js 下载页面，安装完成后请重新运行 install.command。"
fi

node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 20 || (major === 20 && minor >= 19) ? 0 : 1)' \
  || fail "Node.js 版本过低，请升级到 20.19 或更高版本。"

npm -v >/dev/null 2>&1 || fail "没有找到可用的 npm。"

echo "[1/3] 安装项目依赖"
npm ci || fail "依赖安装失败，请检查网络后重试。"

echo
echo "[2/3] 安装开机自动启动的本机服务"
npm run service:install || fail "本机服务安装失败。"

echo
echo "[3/3] 检查服务并打开网站"
service_ready=0
for _ in {1..40}; do
  if curl -fsS "http://127.0.0.1:8787/api/health" >/dev/null 2>&1 \
    && curl -fsS "http://127.0.0.1:5173/" >/dev/null 2>&1; then
    service_ready=1
    break
  fi
  sleep 0.25
done

[[ "$service_ready" == "1" ]] || fail "服务没有按时启动，请运行 npm run service:status 查看状态。"

open "http://127.0.0.1:5173/"
echo
echo "安装完成。网站已经打开，请按页面上的三步上手提示继续。"
pause_before_exit
