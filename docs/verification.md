# 验证记录

这里记录哪些功能真的实测过、哪些没有。写下来是为了以后自己不被「看起来能跑」骗到。

## 装完之后能得到什么

| 情况 | 结果 |
| --- | --- |
| 只跑 `./install.sh` | 插件和规则装好。`/dict` 会联网兜底（`dict.youdao.com/jsonapi`，实测 200），拿到的是网页式释义，没有音标和词形变化 |
| 加 `--with-dict` | `/dict` 变成完整离线词卡：340 万词条，327 MB |
| 加 `--key` | `/zh` 用自己的模型（Hy-MT2） |
| 不加 `--key` | `/zh` 走免费链路：有道 → MyMemory → 离线逐词 |

词典和 key 不进仓库：词典太大，key 是凭据。仓库本身只有约 120 KB。

### 前置要求

| 需要 | 用途 |
| --- | --- |
| OpenCode | 必须 |
| `node` / `bun` / `python3` 之一 | 合并 `cli.json`。都没有时脚本会打印需要手工添加的那一行 |
| `bun` + `unzip` | 只有 `--with-dict` 用得到 |

OpenCode 官方安装脚本装的是独立二进制，不保证机器上有 node 或 bun，所以多了 `python3` 兜底
（`scripts/merge-cli.mjs` 与 `scripts/merge-cli.py` 输出完全一致，已对比验证）。

## 已经实测

**文件层面**（用 `--config-dir` 装进临时目录，不碰本机配置）

- `cli.json` 合并不会破坏已有插件条目；空目录会自动创建
- 被覆盖的旧文件会移进 `.backup-<时间戳>/`
- `--copy` 产出的文件与仓库 `diff -r` 一致
- 软链接装完改用 `--copy` 能正确切换；重复执行提示 `up to date`，不再产生备份
- 54 个单元测试通过

**界面层面**（只能装在真实的 `~/.config/opencode` 上测）

> 临时配置目录**不能**用来做界面测试。OpenCode 的后台服务持有配置，`XDG_CONFIG_HOME`
> 不生效。实验：在临时目录里放一个只属于该目录的探针命令，TUI 里显示
> "No matching commands" —— 证明它读的一直是真实配置。

| 项目 | 结果 |
| --- | --- |
| 插件从软链接 / 复制目录加载 | 均通过，`/dict` 正常出卡片 |
| `/zh`、`/word` | 通过 |
| 鼠标点 `✕ 关闭` | 卡片关闭 |
| 文件内容 | md5 与仓库一致 |
| 装完后修改仓库 | 实际配置不受影响（复制模式已解耦） |
| 词典构建 | 11 秒生成 3,402,564 条 / 327,118,848 字节，用插件自身查询代码验证可查 |
| ECDICT 下载地址 | 可访问（206 分片，PK 压缩包头，约 207 MB） |

**Windows 脚本**（开发机是 Linux，用 PowerShell Core 7.4.6 跑的逻辑测试）

| 项目 | 结果 |
| --- | --- |
| 语法解析 | 通过 |
| 空目录安装 / 重复执行 | 通过；重复执行提示 `up to date`、`already linked` |
| 已有 `cli.json`（含其它插件） | 通过，其它条目保留 |
| `-Key` | 通过；`icacls` 不存在时降级为提示 |
| `-Link` | 通过 |

**推送**

- `git push` 路线实测通过；远程 tree SHA 与本地一致（逐字节相同）
- 提交身份统一为 `liudaohui404 <liudaohui404@users.noreply.github.com>`
- `publish.sh` 重复执行是幂等的（`Everything up-to-date`）

## 还没实测

- **ECDICT 压缩包的完整下载 + 解压流程**。测试时机器温度过高被主动中止；下载地址、解压工具、
  构建步骤、查询结果都单独验证过，但没连起来跑完一次。
- **真实 Windows 机器**：`icacls` 的实际效果、`Expand-Archive` 分支。

## 平台差异

| 差异 | 处理方式 |
| --- | --- |
| Windows 没有 `unzip` | `build-db.ts` 依次尝试 `unzip` → `tar`（Win10+ 自带 bsdtar，能读 zip）→ `Expand-Archive` |
| Windows 没有 `chmod 600` | 改用 `icacls` 去掉继承权限，只留当前用户；失败只提示不中断 |
| 软链接需要开发者模式或管理员 | `-Link` 失败自动退回复制 |
| PowerShell 5.1 默认按 ANSI 读文件 | 读写 `cli.json` 都显式用 `-Encoding UTF8`，否则会损坏非 ASCII 内容 |

配置目录：Windows 用 `%USERPROFILE%\.config\opencode`（官方文档给出的路径，不是 `%APPDATA%`）。

## 数据来源

离线词典来自 [ECDICT](https://github.com/skywind3000/ECDICT)（MIT 许可），转成 SQLite 快照：
340 万词条，327 MB，单次查询约 0.013 毫秒，支持词形变化（`running` → `run`）。
