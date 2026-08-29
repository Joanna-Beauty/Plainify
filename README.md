# 加简大白话 · Plainify

加简大白话是一个本地运行的个人术语库。网站负责收藏、分组和复习术语，Chrome/Edge 扩展负责在阅读网页时解释和收录陌生词。术语数据和 API Key 都保存在本机。

## 运行要求

- Node.js 20.19 或更高版本
- npm 10 或更高版本
- Chrome 或 Edge
- macOS 可安装开机自启的本机服务；其他系统可使用前台开发命令

## 下载与安装

从 [GitHub 仓库](https://github.com/Joanna-Beauty/baihuaben) 下载 ZIP，或执行：

```bash
git clone https://github.com/Joanna-Beauty/baihuaben.git
cd baihuaben
npm ci
```

### 前台运行

```bash
npm run dev
```

网站默认地址是 `http://127.0.0.1:5173/`，本机后端默认地址是 `http://127.0.0.1:8787/`。这个命令需要在使用期间保持运行。

### macOS 常驻运行

```bash
npm run service:install
npm run service:status
```

安装后网站和后端会在 macOS 登录后自动启动，日志保存在 `.logs/`。更新项目代码后，重新执行 `npm ci` 和 `npm run service:install`。

## 配置模型

1. 打开网站，进入“设置 → 模型”。
2. 点击“添加提供方”，选择 DeepSeek 或 OpenAI。
3. API Key 为必填项；如需代理或兼容接口，可在“自定义设置”中覆盖提供方的官方 API 地址。
4. “获取可用模型”在未填写 Key 时也可使用；未选择模型或未获取清单时使用提供方的官方默认模型。
5. 保存时本机后端会优先使用自定义 API 地址验证连接，成功后才替换旧配置。需要更换或删除配置时，编辑对应提供方。

Key 会写入权限为 `0600` 的 `.env.local`。该文件已被 Git 忽略，网站和扩展只能看到“已配置”及 Key 末四位，不会获得完整 Key。`.env.example` 仅用于展示可用配置，不要在其中填写真实 Key。

## 安装浏览器扩展

1. Chrome 打开 `chrome://extensions`；Edge 打开 `edge://extensions`。
2. 开启“开发者模式”。
3. 点击“加载已解压的扩展程序”，选择项目中的 `extension/` 目录。
4. 返回网站“设置 → 通用设置”，点击“同步术语与插件设置”。

更新扩展时，在扩展管理页点击“重新加载”，再刷新已打开的普通网页。

## 数据与安全

- 网站术语和复习记录：浏览器 `localStorage`
- 扩展术语和偏好：`chrome.storage.local`
- API Key：项目根目录 `.env.local`

当前版本没有云同步。更换浏览器或清理浏览器数据前，请先备份重要术语。

## 验证发布

```bash
npm run lint
npm run build
npm run test:release
```

更完整的操作说明见 [outputs/加简大白话使用说明.md](outputs/加简大白话使用说明.md)。
