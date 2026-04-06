# ClaudeChrome

<p align="center">
  <img src="assets/logo-with-texts.png" alt="ClaudeChrome logo" width="420" />
</p>

ClaudeChrome 是一个浏览器原生框架，目标是把 Agent 智能真正带进 Chrome，而不是让 Agent 停留在你正在使用的页面之外。

目前它已经把 Claude、Codex 和 shell 工作流直接嵌入 Chrome；长期来看也计划支持更多主流浏览器。它的核心价值并不只是 Web 调试：ClaudeChrome 会让 Agent 持续绑定到真实页面，因此它可以抓取网站、执行 JavaScript、模仿现有网站的原生风格、把内容摄入知识系统，并在不依赖手动上下文搬运的前提下维持更长的交互式工作流。

主 README 语言：中文  
English version: [README.en.md](README.en.md)

落地页: [https://natsufox.github.io/ClaudeChrome/](https://natsufox.github.io/ClaudeChrome/)

友情链接: [LINUX DO](https://linux.do)

## 演示画廊

GitHub 的 README 渲染并不能稳定展示内联 `<video>` 或 `<iframe>` 播放器，因此这里继续使用可点击的 GIF 预览图，并跳转到仓库内附带的 MP4 录屏。每个条目都同时保留了快速预览 GIF、README 尺寸 MP4 和高清宣传版 MP4。

<table>
  <tr>
    <td valign="top" width="50%">
      <strong>Demo 1 · 2048</strong><br>
      这个演示重点展示 ClaudeChrome 在游戏场景中持续处理复杂视觉交互的能力。它说明 ClaudeChrome 可以一直停留在一个长时运行、带状态的循环里，而不是只做一次性的页面读取。<br><br>
      <a href="assets/demo/readme_mp4/demo%202048_readme.mp4"><img src="assets/demo/gif/demo%202048.gif" alt="ClaudeChrome demo 2048 preview" width="100%" /></a><br>
      README MP4: <a href="assets/demo/readme_mp4/demo%202048_readme.mp4">demo 2048_readme.mp4</a><br>
      Quick view GIF: <a href="assets/demo/gif/demo%202048.gif">demo 2048.gif</a><br>
      HD promo MP4: <a href="assets/demo/promo_mp4/demo%202048_promo.mp4">demo 2048_promo.mp4</a>
    </td>
    <td valign="top" width="50%">
      <strong>Demo 2 · Amazon</strong><br>
      这个演示主要展示 ClaudeChrome 的网页抓取能力，以及它在真实商业页面中处理跳转、滚动等页面交互时的表现。<br><br>
      <a href="assets/demo/readme_mp4/demo%20amazon_readme.mp4"><img src="assets/demo/gif/demo%20amazon.gif" alt="ClaudeChrome demo Amazon preview" width="100%" /></a><br>
      README MP4: <a href="assets/demo/readme_mp4/demo%20amazon_readme.mp4">demo amazon_readme.mp4</a><br>
      Quick view GIF: <a href="assets/demo/gif/demo%20amazon.gif">demo amazon.gif</a><br>
      HD promo MP4: <a href="assets/demo/promo_mp4/demo%20amazon_promo.mp4">demo amazon_promo.mp4</a>
    </td>
  </tr>
  <tr>
    <td valign="top" width="50%">
      <strong>Demo 3 · LINUX DO</strong><br>
      这个演示针对 LINUX DO 论坛场景，展示 ClaudeChrome 如何在保持与当前帖子绑定的同时抓取论坛内容，并按照用户指令执行 JavaScript 命令。<br><br>
      <a href="assets/demo/readme_mp4/demo%20linuxdo_readme.mp4"><img src="assets/demo/gif/demo%20linuxdo.gif" alt="ClaudeChrome demo LINUX DO preview" width="100%" /></a><br>
      README MP4: <a href="assets/demo/readme_mp4/demo%20linuxdo_readme.mp4">demo linuxdo_readme.mp4</a><br>
      Quick view GIF: <a href="assets/demo/gif/demo%20linuxdo.gif">demo linuxdo.gif</a><br>
      HD promo MP4: <a href="assets/demo/promo_mp4/demo%20linuxdo_promo.mp4">demo linuxdo_promo.mp4</a>
    </td>
    <td valign="top" width="50%">
      <strong>Demo 4 · OpenClaw</strong><br>
      这个演示强调 ClaudeChrome 的浏览器扩展能力。它可以直接参考现有网站并原生拟合相似风格，这比手动复制样式表之类的传统方式更方便也更准确。<br><br>
      <a href="assets/demo/readme_mp4/demo%20openclaw_readme.mp4"><img src="assets/demo/gif/demo%20openclaw.gif" alt="ClaudeChrome demo OpenClaw preview" width="100%" /></a><br>
      README MP4: <a href="assets/demo/readme_mp4/demo%20openclaw_readme.mp4">demo openclaw_readme.mp4</a><br>
      Quick view GIF: <a href="assets/demo/gif/demo%20openclaw.gif">demo openclaw.gif</a><br>
      HD promo MP4: <a href="assets/demo/promo_mp4/demo%20openclaw_promo.mp4">demo openclaw_promo.mp4</a>
    </td>
  </tr>
  <tr>
    <td valign="top" width="50%">
      <strong>Demo 5 · Tapestry & Text Selection</strong><br>
      这个演示聚焦于与我们更早的 Tapestry 项目的集成：它无需调用 Tapestry 自带爬虫，就能把页面内容直接写入知识库，同时也展示了由页面选中文本驱动的一系列操作。<br><br>
      <a href="assets/demo/readme_mp4/demo%20tapestry%20%26%20texts%20selection_readme.mp4"><img src="assets/demo/gif/demo%20tapestry%20%26%20texts%20selection.gif" alt="ClaudeChrome demo Tapestry and text selection preview" width="100%" /></a><br>
      README MP4: <a href="assets/demo/readme_mp4/demo%20tapestry%20%26%20texts%20selection_readme.mp4">demo tapestry &amp; texts selection_readme.mp4</a><br>
      Quick view GIF: <a href="assets/demo/gif/demo%20tapestry%20%26%20texts%20selection.gif">demo tapestry &amp; texts selection.gif</a><br>
      HD promo MP4: <a href="assets/demo/promo_mp4/demo%20tapestry%20%26%20texts%20selection_promo.mp4">demo tapestry &amp; texts selection_promo.mp4</a>
    </td>
    <td valign="top" width="50%">
      <strong>Demo 6 · V2EX</strong><br>
      这是第二个论坛场景演示，与 LINUX DO 的示例互相补充。它展示了 ClaudeChrome 如何抓取 V2EX 内容，并根据用户指令在页面内执行 JavaScript 命令。<br><br>
      <a href="assets/demo/readme_mp4/demo%20v2ex_readme.mp4"><img src="assets/demo/gif/demo%20v2ex.gif" alt="ClaudeChrome demo V2EX preview" width="100%" /></a><br>
      README MP4: <a href="assets/demo/readme_mp4/demo%20v2ex_readme.mp4">demo v2ex_readme.mp4</a><br>
      Quick view GIF: <a href="assets/demo/gif/demo%20v2ex.gif">demo v2ex.gif</a><br>
      HD promo MP4: <a href="assets/demo/promo_mp4/demo%20v2ex_promo.mp4">demo v2ex_promo.mp4</a>
    </td>
  </tr>
</table>

## 安装与本地使用

ClaudeChrome 当前由两个本地组件协同工作：

- 一个构建到 `dist/` 中的 Chrome 扩展
- 一个运行在 `native-host/dist/main.js` 的本地 Node.js host，侧边栏通过 WebSocket 与它连接

如果你只是想在本地运行项目，请优先参考面向普通使用者的指南。如果你准备修改代码、执行测试，或者研究 host / extension 的内部实现，再看下面的开发者指南。

### 1. 普通使用者指南

这一路径适合希望以最少环节完成可靠本地部署的人。

#### 前置条件

- Google Chrome，并且可以访问 `chrome://extensions`
- 较新的 Node.js LTS 版本，以及 `npm`
- `PATH` 中可调用的 `bash`
- 可选：如果你想启动 Claude pane，需要 `PATH` 中可调用的 `claude`
- 可选：如果你想启动 Codex pane，需要 `PATH` 中可调用的 `codex`

说明：

- macOS 和 Linux 的常规环境通常已经自带 `bash`。
- 在 Windows 上，请安装 Git Bash 或 WSL，并确保 `bash` 可以从 `PATH` 调用。
- 如果你只是想先验证本地桥接是否正常，建议先启动一个 Shell pane，这样就不依赖 `claude` 或 `codex`。

#### 第 1 步：安装依赖并构建本地产物

```bash
npm install
npm install --prefix native-host
npm run package
```

完成后，你应当看到：

- `dist/manifest.json`，用于 Chrome 的未打包扩展
- `native-host/dist/main.js`，用于本地 host 进程

#### 第 2 步：在固定端口上启动本地 host

侧边栏默认连接 `127.0.0.1:9999`，因此直接使用端口 `9999` 可以避免额外的 UI 配置。

macOS / Linux / Git Bash:

```bash
CLAUDECHROME_WS_PORT=9999 npm --prefix native-host run start
```

PowerShell:

```powershell
$env:CLAUDECHROME_WS_PORT=9999
npm --prefix native-host run start
```

让这个进程保持运行。启动成功后，host 日志中应当能看到 `ws_listening` 和 `ipc_listening` 等事件。

#### 第 3 步：把构建好的扩展加载进 Chrome

1. 打开 `chrome://extensions`。
2. 开启 Developer mode。
3. 点击 Load unpacked。
4. 选择仓库里的 `dist/` 目录。
5. 固定或打开 ClaudeChrome 扩展。

#### 第 4 步：让侧边栏连接到运行中的 host

1. 在 Chrome 中打开你希望 ClaudeChrome 检查的页面。
2. 打开 ClaudeChrome 侧边栏。
3. 确认 `Port` 字段显示为 `9999`，或者改成你启动 host 时使用的端口。
4. 点击 `Apply`。
5. 等待状态文字从 `Disconnected` 变成 `Connected: ws://127.0.0.1:9999`，或者 `Connected to ClaudeChrome host`。

#### 第 5 步：启动第一个 pane

1. 保持目标浏览器标签页处于激活状态。
2. 先点击 `+ Shell`，这是最稳妥的第一轮 smoke test。
3. Shell 正常后，如果相关 CLI 已安装，再尝试 `+ Claude` 或 `+ Codex`。
4. 新建 pane 会在创建会话时绑定到当前激活的标签页。

至此，ClaudeChrome 就已经在本地运行，并且附着在你选中的真实浏览器标签页上了。

#### 可选：安装本仓库附带的 native-messaging manifest

上面的 WebSocket 流程已经足够让 ClaudeChrome 在本地运行。如果你还想注册 `native-host/src/install.ts` 中附带的 native-messaging manifest，可以执行：

```bash
npm run install:host
```

这个命令会写入 `com.anthropic.claudechrome.json`，但不会自动填充 `allowed_origins`。你需要手动加入自己未打包扩展的 ID。

查看你的扩展 ID：

1. 打开 `chrome://extensions`。
2. 找到 ClaudeChrome。
3. 复制扩展卡片上显示的 extension ID。

Manifest 位置：

- macOS: `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.anthropic.claudechrome.json`
- Linux: `~/.config/google-chrome/NativeMessagingHosts/com.anthropic.claudechrome.json`
- Windows: `%LOCALAPPDATA%\\Google\\Chrome\\User Data\\NativeMessagingHosts\\com.anthropic.claudechrome.json`

编辑生成出的 JSON 文件，把 `allowed_origins` 改成下面这样：

```json
"allowed_origins": [
  "chrome-extension://YOUR_EXTENSION_ID/"
]
```

随后在 `chrome://extensions` 中点击 ClaudeChrome 扩展的 Reload。如果你因为从不同的未打包目录重新加载而导致 extension ID 变化，就需要再次更新 `allowed_origins`。

#### 首次运行排错

- 侧边栏显示 `Cannot connect to ws://127.0.0.1:9999`：host 没有运行、host 使用了别的端口，或者你改了端口字段但没有点击 `Apply`。
- 你启动 host 时没有设置 `CLAUDECHROME_WS_PORT=9999`：native host 默认会使用随机端口，因此侧边栏除非手动填写该端口，否则无法自动连上。
- `+ Shell` 正常，但 `+ Claude` 或 `+ Codex` 启动失败：对应 CLI 没有出现在 login shell 的 `PATH` 中。
- 在 Windows 上 pane 启动后立刻失败：`bash` 不在 `PATH` 中。
- `native-host` 里的 `npm run package` 失败：重新执行 `npm install --prefix native-host`。
- `npm run test:live` 找不到浏览器：设置 `CLAUDECHROME_LIVE_BROWSER=/absolute/path/to/chrome` 后再重试。

### 2. 开发者指南

如果你准备修改扩展、调整 native host，或者跑完整验证流程，请看这一部分。

#### 仓库结构

- `extension/` 存放 Chrome 扩展源码
- `native-host/` 存放本地 host、会话管理器和 MCP bridge
- `dist/` 是 Chrome 通过 Load unpacked 加载的构建后扩展
- `scripts/` 存放仓库测试脚本，包括真实浏览器验证

#### 一次性初始化

```bash
npm install
npm install --prefix native-host
npm run package
```

#### 推荐开发循环

终端 1，监听扩展构建：

```bash
npm run dev
```

终端 2，当 host 侧代码发生变化时重建 native host：

```bash
npm run build:host
```

如果你希望在编辑 `native-host/` 时持续重建，现有 TypeScript 构建脚本也支持 watch 模式：

```bash
npm --prefix native-host run build -- --watch
```

终端 3，在侧边栏预期的相同端口上运行 host：

```bash
CLAUDECHROME_WS_PORT=9999 npm --prefix native-host run start
```

Chrome 侧循环：

1. 从 `dist/` 执行 Load unpacked。
2. 每次 `npm run dev` 生成新的扩展 bundle 后，在 `chrome://extensions` 中点击 Reload。
3. 保持侧边栏端口与 host 端口一致。

#### 验证命令

核心脚本化检查：

```bash
npm test
```

真实端到端检查：

```bash
npm run test:live
```

`npm run test:live` 会启动一个隔离的 host，把未打包扩展加载进临时 Chrome / Chromium profile，连接侧边栏，并覆盖以下真实浏览器能力：

- `browser__list_tabs`
- 页面文本抓取
- cookies 与 storage 抓取
- 基于选择器和基于坐标的点击
- console 抓取

实测常用环境变量覆盖项：

- `CLAUDECHROME_LIVE_BROWSER=/absolute/path/to/chrome`：强制指定 Chrome 或 Chromium 可执行文件
- 在 Linux 上如果没有 `DISPLAY`，请安装 `xvfb-run` 或提供图形化会话

#### 开发者备注与关键约束

- 侧边栏默认地址是 `127.0.0.1:9999`；如果不设置 `CLAUDECHROME_WS_PORT`，host 默认会使用随机端口。
- `npm run install:host` 会注册一个 Chrome native-messaging manifest，但当前仓库本地开发和 `npm run test:live` 的主路径仍然是直接启动 host，并通过 WebSocket 连接侧边栏。
- `bash` 是 Shell、Claude 和 Codex pane 的统一启动器。如果目标平台没有 `bash`，需要先安装。
- Claude pane 会调用 `claude --setting-sources user,project,local --mcp-config ...`，并附带 ClaudeChrome 的会话级系统引导。
- Codex pane 会调用 `codex`，并注入 ClaudeChrome 浏览器桥接所需的 MCP server 配置；启动时还会带上一条会话引导，提醒 Agent 优先围绕当前绑定标签页和 `claudechrome-browser` MCP 工具工作。
- Windows 下可以直接使用 `scripts/start-windows.cmd` 或 `powershell -ExecutionPolicy Bypass -File scripts/start-windows.ps1` 启动 host；脚本会复用与 runtime 一致的 Git Bash 探测逻辑，并在缺少依赖或构建产物时自动补全安装与构建。
- 如果你需要同时运行多个本地 host 实例，请用 `CLAUDECHROME_WS_PORT`、`CLAUDECHROME_RUNTIME_DIR` 等环境变量把它们隔离开，而不是共享同一个 runtime 目录。

## ClaudeChrome 是为了解决什么问题

ClaudeChrome 面向的是那些日常工作里本来就离不开浏览器的开发、调试、研究与验证场景。

它试图补上两个通常彼此割裂的世界之间的断层：

- 浏览器，真实产品行为发生的地方
- 编码 Agent，推理、调试与执行发生的地方

这个项目存在的意义，就是让这条回路更快、更实用，也更可靠。

## 实际价值

ClaudeChrome 的设计目标，是让“浏览器感知型工作流”从别扭变成直接。

有了 ClaudeChrome，你可以：

- 让 Agent 紧贴你正在检查的页面，而不是频繁来回切换上下文
- 直接基于你眼前的真实标签页工作，而不是依靠回忆去描述它
- 更快地从“这里看起来不对劲”走到“问题的确切位置和下一步动作是什么”
- 减少浏览器、终端和笔记之间重复的手工复制粘贴
- 让浏览器辅助开发保持本地化，并贴近你的真实工作流

核心承诺很简单：Agent 应该理解你正在工作的页面，而不是只接收关于它的二手总结。

## 你可以用它做什么

ClaudeChrome 面向的是实际、日常的浏览器工作，例如：

- 当 UI 出现异常时，让 Agent 持续附着在对应标签页上进行调试
- 在修改代码或内容之前，先确认页面当前到底呈现了什么
- 在排查问题时检查真实页面文本、console 行为以及浏览器侧状态
- 为不同页面、环境或任务同时保留多个有明确分工的 pane
- 把浏览器变成工作环境的一部分，而不是一个必须手工描述给 Agent 的独立工具

当浏览器不只是查看输出的地方，而是真实运行时的一部分时，这个项目会尤其有价值。

## 适合谁

ClaudeChrome 面向的是那些确实能从“懂浏览器的编码 Agent”中获得实际收益的人。

典型用户包括：

- 调试真实页面与流程的前端工程师
- 需要跨越 UI 与应用行为追踪问题的全栈开发者
- 希望更快完成调查闭环的 QA 与产品型构建者
- 长时间待在浏览器里工作、希望助手始终贴着任务现场的独立开发者
- 想获得更强浏览器侧工作流的研究者、折腾者与高阶用户

如果你的工作经常从“看看这个标签页”或“这个页面哪里不对”开始，那么 ClaudeChrome 就是为你准备的。

## 为什么它的体验不一样

大多数编码 Agent 仍然把浏览器当成一个遥远的目标。ClaudeChrome 的出发点则是：浏览器本身就应该成为工作界面的一部分。

这会在几个关键层面改变使用体验：

- Agent 贴着真实页面工作，而不是依赖脱离现场的描述
- 浏览器变成主动工作空间，而不是一个需要来回切换的对象
- 多个 pane 与 workspace 让任务拆分更自然，也更不容易丢上下文
- 整体工作流更像是在页面旁边协作，而不是在远程操控一个工具

最终结果，就是一个更贴地气、更好用的浏览器重度工作助手。

## 示例场景

### 调试一个产品页面

你正在查看一个行为异常的页面。此时你无需从头解释问题，而是让 Agent 直接附着在该页面上，与你一起在同一个现场里完成排查。

### 改代码前先验证流程

你想先确认页面现在到底在做什么，再决定是否修改代码。ClaudeChrome 会把整个调查过程锁定在真实浏览器状态上，让判断基于产品事实而不是猜测。

### 并行运行多个浏览器感知任务

你可能希望一个 pane 盯着面向用户的页面，一个 pane 盯着后台流程，还有一个 pane 作为通用 shell。ClaudeChrome 让这种工作方式显得自然，而不是临时拼凑出来的。

## 项目方向

ClaudeChrome 聚焦于一个非常务实的目标：让本地编码 Agent 在浏览器优先的工作流中真正发挥作用。

这个项目并不想做成一个挂着 AI 标识的普通浏览器扩展。它真正想成为的，是一个严肃、可工作的浏览器原生工作界面，让 Agent 始终连接页面、任务和真实运行时上下文。

## 当前状态

ClaudeChrome 仍在积极开发中，但已经足以清楚展示它的核心产品方向：

- 面向本地 Agent 的浏览器侧工作界面
- 具备会话感知的页面绑定
- 面向真实任务的浏览器感知工作流
- 更强的观察、推理与执行闭环

它还会继续向更强、更完整、更精致的浏览器原生 Agent 体验演进，但核心价值主张今天已经可以看得很清楚。

## 一句话总结

ClaudeChrome 面向的是那些希望编码 Agent 能真正与自己正在使用的浏览器协同工作，而不是绕开浏览器工作的人。
