# opencode-english-kit

把 OpenCode 变成一个「带中文注释的英文阅读器」。

两条规则：

1. **回复里自动带中文注释** —— 超出基础词汇的单词后面直接跟一个短中文释义，例如 `stale(过时的)`，读的时候不用切出去查词典。
2. **一个按键之外的深度查询** —— `/dict` 看单词卡、`/zh` 翻译整句、`/word` 学习型词条。卡片免费、离线、不进入对话上下文。

配套文章见 `docs/`（本仓库默认不包含，见下文「可选内容」）。

---

## 包含什么

```text
opencode/
├── AGENTS.md                回复风格规则：英文、短句、行内注释
├── commands/word.md         /word 命令的提示词模板
└── plugins/lookup/          TUI 插件（9 个文件，约 88 KB）
    ├── index.ts             服务端入口（不注册任何东西）
    ├── tui.tsx              卡片渲染、斜杠命令、快捷键
    ├── card.ts              卡片数据、翻译链路
    ├── local.ts             离线词典查询
    ├── build-db.ts          重建离线词典
    ├── card.test.ts         54 个测试
    └── bun-sqlite.d.ts / package.json / tsconfig.json / README.md
```

插件不需要 `node_modules`，它依赖的 `@opentui/*`、`solid-js` 都由 OpenCode 自己提供。

## 不包含什么（重要）

| 排除项 | 原因 |
| --- | --- |
| `lookup.key` | 你的翻译 API key |
| `service.json` | 里面有 OpenCode 服务密码 |
| `dict.db` | 327 MB，超过 GitHub 单文件 100 MB 限制，改为在新设备上重建 |
| `plugins/stock-monitor` | 与英语学习无关 |

`publish.sh` 在每次上传前会扫描这些内容，发现密钥就直接中止。

---

## 一键安装（新设备）

```bash
git clone https://github.com/<you>/opencode-english-kit.git
cd opencode-english-kit
./install.sh --with-dict
```

如果新设备也访问不了 `github.com`，改用 API 拉取：

```bash
gh api /repos/<you>/opencode-english-kit/tarball/main | tar xz
cd opencode-english-kit-main
./install.sh --with-dict
```

### 安装脚本做了什么

1. 把文件**复制**进 `~/.config/opencode/`（默认复制，安装后与仓库相互独立）；
2. 把 `./plugins/lookup` 合并进 `cli.json`，不动其它设置；
3. 把被覆盖的旧文件移到 `~/.config/opencode/.backup-<时间戳>/`；
4. 提示你录入 API key（可选）；
5. 跑一遍 54 个测试确认没坏。

### 参数

| 参数 | 作用 |
| --- | --- |
| `--link` | 改用软链接安装（`git pull` 后立即生效，但仓库不能删） |
| `--with-dict` | 同时构建 327 MB 离线词典（下载约 207 MB 压缩包，需要 `bun` 和 `unzip`） |
| `--key sk-xxx` | 写入翻译 key（等价于环境变量 `OPENCODE_LOOKUP_KEY`） |
| `--config-dir DIR` | 装到别的目录，方便先试一遍 |
| `-h` | 查看帮助 |

### 已验证

**文件层面**（用 `--config-dir` 装进临时目录，不碰本机配置）：

- 合并 `cli.json` 不会破坏已有插件条目；空目录会自动创建 `cli.json`；
- 被覆盖的旧文件会移进 `.backup-<时间戳>/`；
- `--copy` 产出的文件与仓库 `diff -r` 完全一致；
- 软链接装完后改用 `--copy` 能正确切换（旧链接被移进备份目录）；
- 重复执行 copy 安装提示 `up to date`，不再产生备份；
- 54 个测试全部通过。

**界面层面**（只能装在真实的 `~/.config/opencode` 上测）：

> 踩坑记录：临时配置目录**不能**用来做界面测试。OpenCode 的后台服务持有配置，
> 设置 `XDG_CONFIG_HOME` 并不生效。实测时我在临时目录里放了一个只存在于该目录的探针命令，
> TUI 里显示 "No matching commands" —— 证明它读的一直是真实配置。
> 也就是说，只靠临时目录测出来的「插件能加载」是无效结论。

| 项目 | 结果 |
| --- | --- |
| 插件从软链接加载 | 通过，`/dict` 正常出卡片 |
| 插件从复制目录加载 | 通过，`/dict` 正常出卡片 |
| `/zh` 联网链路 | 通过 |
| `/word` 命令文件 | 通过，命令面板可见 |
| 鼠标点 `✕ 关闭` | 卡片关闭 |
| 文件内容 | md5 与仓库一致，`diff -r` 无差异 |
| 重复执行 install.sh | 链接模式提示 `already linked`，不再产生备份 |
| `cli.json` 其它设置 | 主题、tabs、stock symbols 全部保留 |
| 装完后修改仓库 | 实际配置不受影响（复制模式已解耦） |
| 词典构建（`bun build-db.ts`） | 11 秒生成 3,402,564 条 / 327,118,848 字节，用插件自身的查询代码验证可查 |
| ECDICT 下载地址 | 可访问（206 分片，PK 压缩包头，约 207 MB） |

**未完整验证**：ECDICT 压缩包的「完整下载 + 解压」一次性流程。测试时机器温度过高被主动中止，
但下载地址、解压工具、构建步骤、查询结果都单独验证过了。

---

## 翻译 key（可选）

不放 key 也能用：`/dict` 完全离线，`/zh` 会走免费链路（有道 → MyMemory → 离线逐词）。

想要更好的翻译质量，就放一个 key：

```bash
echo 'YOUR_KEY' > ~/.config/opencode/lookup.key
chmod 600 ~/.config/opencode/lookup.key
```

也可以用 `OPENCODE_LOOKUP_MODEL` 换模型（默认 `hy-mt2-lite`）。

**key 永远不进仓库**，所以每台新设备都要单独录一次。

## 离线词典

`/dict` 的数据来自 [ECDICT](https://github.com/skywind3000/ECDICT)（MIT 许可），转成 SQLite 快照：

- 340 万词条，327 MB，查询约 0.013 ms
- 支持词形变化（`running` → `run`）
- 全程不联网

重建（`install.sh --with-dict` 等价于）：

```bash
cd opencode/plugins/lookup
bun build-db.ts                              # 自动下载 ECDICT，走 gh-proxy.com 镜像
bun build-db.ts /path/to/stardict.db         # 用本地已有的 ECDICT 文件
```

输出默认写到 `~/.local/share/lookup/dict.db`，可用 `OPENCODE_LOOKUP_DB` 改。

---

## 发布与更新

在**本机**改完之后推上去：

```bash
./publish.sh --dry-run     # 先看要传哪些文件
./publish.sh               # 真正上传
```

脚本走 GitHub REST API（`gh api`），不是 `git push`。原因是部分网络下 `github.com:443` 不通，但 `api.github.com` 正常。上传前会做密钥扫描。

> 如果以后网络恢复正常，也可以直接用 git：
> `git init && git add . && git commit -m init && git remote add origin git@github.com:<you>/opencode-english-kit.git && git push -u origin main`

---

## 目录结构

```text
opencode-english-kit/
├── install.sh               一键安装
├── publish.sh               通过 API 推送到私有仓库
├── scripts/merge-cli.mjs    安全合并 cli.json
├── .gitignore               排除密钥与词典
├── opencode/                要安装到 ~/.config/opencode 的内容
└── README.md
```

## 可选内容

本仓库默认不包含文章和截图。如果需要，把本机的 `~/.config/opencode/docs/`
（两篇文章 + 5 张截图，约 140 KB）复制进来即可。

---

## 常见问题

**安装完没反应？**
重启 OpenCode。插件在启动时加载。

**`/dict` 说找不到词典？**
还没构建。跑 `./install.sh --with-dict`。

**`/zh` 走的哪个通道？**
配置了 key 就用 key，否则用免费接口，全失败则退到离线逐词翻译（卡片标题会说明）。

**复制还是软链接？**
默认是**复制**：装完之后 `~/.config/opencode` 与仓库没有任何关系，删掉仓库也不会影响 OpenCode。
代价是仓库更新后要重新执行一次 `./install.sh`。
想要「`git pull` 即生效」就用 `--link`，但那样仓库不能删、也不能移走。

两种模式可以随时互相切换，`./install.sh` 和 `./install.sh --link` 各跑一次即可；
被换掉的旧文件都会先移进 `.backup-<时间戳>/`。

**卸载？**
删掉 `~/.config/opencode/plugins/lookup`、`~/.config/opencode/commands/word.md`，
再从 `cli.json` 的 `plugins` 里移除 `./plugins/lookup`。
`AGENTS.md` 从 `.backup-*` 目录里恢复。
