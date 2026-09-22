# opencode-english-kit

把 OpenCode 变成「带中文注释的英文阅读器」。

- 回复里自动给生词加中文注释：`stale(过时的)`
- `/dict` 离线单词卡、`/zh` 整句翻译、`/word` 学习型词条
- 卡片渲染在输入框上方，**不进对话上下文，查询不花 token**

## 安装

Linux / macOS / WSL：

```bash
git clone https://github.com/liudaohui404/opencode-english-kit.git
cd opencode-english-kit
./install.sh --with-dict
```

Windows（PowerShell）：

```powershell
git clone https://github.com/liudaohui404/opencode-english-kit.git
cd opencode-english-kit
powershell -ExecutionPolicy Bypass -File .\install.ps1 -WithDict
```

访问不了 `github.com` 时：

```bash
gh api /repos/liudaohui404/opencode-english-kit/tarball/HEAD | tar xz
cd liudaohui404-opencode-english-kit-* && ./install.sh --with-dict
```

装完重启 OpenCode 生效。被覆盖的旧文件会先移进 `~/.config/opencode/.backup-<时间戳>/`。

### 参数

| 参数 | 说明 |
| --- | --- |
| `--with-dict` · `-WithDict` | 构建 327 MB 离线词典（下载约 207 MB，需要 `bun` + `unzip`） |
| `--key sk-x` · `-Key sk-x` | 写入翻译 key，可选 |
| `--link` · `-Link` | 软链接安装，而不是复制 |
| `--config-dir DIR` · `-ConfigDir DIR` | 装到别的目录，测试用 |

## 用法

| 命令 | 作用 |
| --- | --- |
| `/dict ubiquitous` | 单词卡：音标 · 中文释义 · 英英解释（离线） |
| `/zh <句子>` | 中文翻译卡，长文本自动换行 |
| `/word resilient` | 学习型词条：意思 · 音标 · 定义 · 例句 |
| `alt+x` 或卡片上的 `✕ 关闭` | 关闭卡片 |

## 不放进仓库的东西

| 排除 | 原因 |
| --- | --- |
| `lookup.key` | 你的翻译 key |
| `service.json` | 含 OpenCode 服务密码 |
| `dict.db` | 327 MB，超过 GitHub 单文件限制，改为安装时重建 |

`publish.sh` 上传前会扫描这些内容，命中任何一项就整次中止。

## 目录

```text
install.sh · install.ps1     一键安装（bash / PowerShell）
publish.sh                   推送：优先 git push，API 仅兜底
scripts/merge-cli.*          安全合并 cli.json，不破坏其它设置
opencode/                    要装到 ~/.config/opencode 的内容
```

## 发布更新

```bash
./publish.sh --dry-run     # 先看要传哪些文件
./publish.sh               # 推送（仓库为 public）
```

## 更多

- 验证记录：哪些实测过、哪些还没测 → [docs/verification.md](docs/verification.md)
- 插件细节与实现 → [opencode/plugins/lookup/README.md](opencode/plugins/lookup/README.md)
