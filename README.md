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

1. 把文件放进 `~/.config/opencode/`（默认用软链接，`git pull` 后立即生效）；
2. 把 `./plugins/lookup` 合并进 `cli.json`，不动其它设置；
3. 把被覆盖的旧文件移到 `~/.config/opencode/.backup-<时间戳>/`；
4. 提示你录入 API key（可选）；
5. 跑一遍 54 个测试确认没坏。

### 参数

| 参数 | 作用 |
| --- | --- |
| `--copy` | 复制文件而不是软链接 |
| `--with-dict` | 同时构建 327 MB 离线词典（下载约 850 MB，需要 `bun` 和 `unzip`） |
| `--key sk-xxx` | 写入翻译 key（等价于环境变量 `OPENCODE_LOOKUP_KEY`） |
| `--config-dir DIR` | 装到别的目录，方便先试一遍 |
| `-h` | 查看帮助 |

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

**软链接和复制怎么选？**
软链接（默认）适合「只在这一台机器上维护、`git pull` 即生效」；复制适合「装完就把仓库删掉」。

**卸载？**
删掉 `~/.config/opencode/plugins/lookup`、`~/.config/opencode/commands/word.md`，
再从 `cli.json` 的 `plugins` 里移除 `./plugins/lookup`。
`AGENTS.md` 从 `.backup-*` 目录里恢复。
