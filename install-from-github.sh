#!/bin/bash

set -u

REPOSITORY="Joanna-Beauty/Plainify"
ARCHIVE_URL="https://github.com/${REPOSITORY}/archive/refs/heads/main.zip"
INSTALL_DIR="${PLAINIFY_INSTALL_DIR:-${HOME}/Applications/Plainify}"
TEMP_DIR=""

cleanup() {
  if [[ -n "$TEMP_DIR" && -d "$TEMP_DIR" ]]; then
    rm -rf "$TEMP_DIR"
  fi
}

fail() {
  echo
  echo "安装未完成：$1" >&2
  exit 1
}

run_project_installer() {
  chmod +x "$INSTALL_DIR/install.command" || fail "无法设置安装脚本权限。"
  PLAINIFY_NONINTERACTIVE=1 /bin/zsh "$INSTALL_DIR/install.command" \
    || fail "项目已下载到 $INSTALL_DIR，但本机服务安装失败。"
}

trap cleanup EXIT

echo "加简大白话 · Plainify"
echo "正在从 GitHub 准备安装..."
echo

[[ "$(uname -s)" == "Darwin" ]] || fail "GitHub 一键安装目前仅支持 macOS。"
command -v curl >/dev/null 2>&1 || fail "没有找到 curl，无法从 GitHub 下载项目。"
command -v unzip >/dev/null 2>&1 || fail "没有找到 unzip，无法解压项目。"
[[ -x /bin/zsh ]] || fail "没有找到 macOS 系统终端。"

if [[ -d "$INSTALL_DIR" && -f "$INSTALL_DIR/package.json" && -f "$INSTALL_DIR/install.command" ]]; then
  echo "已检测到项目：$INSTALL_DIR"
  echo "将复用现有文件并重新检查本机服务。"
  run_project_installer
  exit 0
fi

[[ ! -e "$INSTALL_DIR" ]] || fail "目标路径已存在且不是完整的 Plainify 项目：$INSTALL_DIR"

TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/plainify-install.XXXXXX")" \
  || fail "无法创建临时目录。"
ARCHIVE_PATH="$TEMP_DIR/plainify.zip"
SOURCE_DIR="$TEMP_DIR/Plainify-main"

echo "[1/2] 下载最新源码"
curl --proto '=https' --tlsv1.2 --fail --location --silent --show-error --retry 3 \
  --output "$ARCHIVE_PATH" "$ARCHIVE_URL" \
  || fail "无法从 GitHub 下载项目，请检查网络后重试。"

echo "[2/2] 解压到 $INSTALL_DIR"
unzip -q "$ARCHIVE_PATH" -d "$TEMP_DIR" || fail "下载的项目压缩包无法解压。"
[[ -f "$SOURCE_DIR/package.json" && -f "$SOURCE_DIR/install.command" ]] \
  || fail "下载的项目结构不完整。"

mkdir -p "$(dirname "$INSTALL_DIR")" || fail "无法创建安装目录。"
mv "$SOURCE_DIR" "$INSTALL_DIR" || fail "无法把项目移动到安装目录。"

echo
run_project_installer
echo "项目位置：$INSTALL_DIR"
echo "浏览器扩展位置：$INSTALL_DIR/extension"
