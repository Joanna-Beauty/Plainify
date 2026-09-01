# 加简大白话 · Plainify

加简大白话是一个本地运行的个人术语库。网站负责收藏、分组和复习术语，Chrome/Edge 扩展负责在阅读网页时解释和收录陌生词。术语数据和 API Key 都保存在本机。

## 5 分钟开始使用

准备一台安装了 Chrome 或 Edge 的 Mac，并安装 [Node.js 20.19 或更高版本](https://nodejs.org/zh-cn/download)。

### macOS 一键安装（推荐）

1. 从 [GitHub 仓库](https://github.com/Joanna-Beauty/baihuaben) 下载 ZIP 并解压。
2. 双击项目中的 `install.command`。
3. 安装完成后网站会自动打开，按页面上的“三步上手”继续。

macOS 首次运行时如果提示无法验证开发者，请右键点击 `install.command`，选择“打开”并再次确认。

也可以在终端执行：

```bash
git clone https://github.com/Joanna-Beauty/baihuaben.git
cd baihuaben
./install.command
```

安装脚本会检查 Node.js、执行 `npm ci`、安装 macOS 常驻服务并打开 `http://127.0.0.1:5173/`。Node.js 尚未安装时，脚本会打开官方下载页面，不会修改或回显 API Key。

### 手动运行与其他系统

```bash
npm ci
npm run dev
```

网站默认地址是 `http://127.0.0.1:5173/`，本机后端默认地址是 `http://127.0.0.1:8787/`。这个命令需要在使用期间保持运行。

macOS 也可以手动安装和检查常驻服务：

```bash
npm run service:install
npm run service:status
```

安装后网站和后端会在 macOS 登录后自动启动，日志保存在 `.logs/`。更新项目代码后，重新执行 `npm ci` 和 `npm run service:install`。

## 第一次使用

网站首屏会显示三步上手进度：

1. 连接一个模型服务。
2. 安装浏览器扩展并刷新网站，直到页面显示“插件已连接”。
3. 输入或在网页选中第一个陌生词，生成解释后加入术语库。

完成这三步后，上手提示会自动隐藏。暂时收起后仍可从首屏继续。

## 配置模型

1. 打开网站，进入“设置 → 模型”。
2. 点击“添加模型服务”，选择 DeepSeek、OpenAI、阿里云百炼、Moonshot AI 或智谱 AI。
3. 从输入框旁的“获取 API Key”进入厂商官方控制台，填入 Key；使用中转站或兼容接口时切换到“自定义地址”。
4. 点击“联通测试并获取模型”。测试只读取模型目录，不发送对话请求；成功后才会显示当前账号实际可用的文本模型。
5. 系统优先选择厂商推荐型号；推荐型号不可用时选择目录中的第一个型号，随后可自由切换。完成测试前不能保存配置。
6. 第一个模型服务保存后自动开始使用；继续添加其他服务不会改变当前服务，可从服务列表手动切换、编辑或删除。

保存或切换当前模型后，网页悬停卡片和扩展弹窗会自动同步，并以“提供方 · 具体模型”显示后端实际使用的模型。

Key 会写入权限为 `0600` 的 `.env.local`。该文件已被 Git 忽略，网站和扩展只能看到“已配置”及 Key 末四位，不会获得完整 Key。`.env.example` 仅用于展示可用配置，不要在其中填写真实 Key。

## 安装浏览器扩展

1. Chrome 打开 `chrome://extensions`；Edge 打开 `edge://extensions`。
2. 开启“开发者模式”。
3. 点击“加载已解压的扩展程序”，选择项目中的 `extension/` 目录。
4. 返回网站“设置 → 通用设置”，确认扩展显示“已连接”。术语、网页悬停偏好和当前模型会在保存设置后自动同步。

扩展需要网页访问权限，才能读取你主动选中的文字并显示术语高亮。API Key 只由本机后端读取，不会进入扩展。

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
