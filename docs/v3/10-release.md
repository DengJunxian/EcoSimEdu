# EcoSimEdu 3.0.0-rc.1 本机候选版

2026-11-21。版本号用于候选归档与验收。现有本机 API 兼容标识仍为 `1.1.0-rc.4`。归档保存两个版本、工作树源文件摘要、十二课版本与逐文件 SHA-256。

## 从候选包开始

1. 将 `EcoSimEdu_3.0.0-rc.1_Local.tar.gz` 和同名的 `.sha256` 文件放在同一目录。macOS 可用 `shasum -a 256 -c EcoSimEdu_3.0.0-rc.1_Local.tar.gz.sha256` 校验，Linux 用 `sha256sum -c`。Windows 可用 `Get-FileHash -Algorithm SHA256` 并与随附的摘要比对。
2. 解压后，在该目录运行 `uv run --no-project --python 3.12 python -m scripts.package_student_lab --verify`，校验清单中的所有文件。
3. macOS 打开 `start-student-lab.command`，Windows 打开 `start-student-lab.cmd`，Linux 可执行 `sh ./start-student-lab.command`。初次运行通过 uv 安装锁定依赖。预构建版本可以直接使用。
4. 打开 [八阶段自学](http://127.0.0.1:8776/explore/) 或 [原学生实验室](http://127.0.0.1:8776/)。学习、规则实验和复习可跳过 AI 连接。终止启动器窗口即可停止服务。

默认监听回环地址并关闭代理头解析。端口冲突时可用进程环境变量 `UVICORN_PORT` 改端口。默认 SQLite 为 `.civitas-edu/runs.sqlite3`。可用 `CIVITAS_EDU_DB` 指向备份副本。其他可选项见包内 `student-lab.env.example`。

## 纯静态演示

静态构建中的十二门课可以独立完成规则回放、政策对照、解释、迁移和本机复习。可解压 Pages 归档，在该目录运行 `python3 -m http.server 8777 --bind 127.0.0.1`，然后打开 [静态课堂](http://127.0.0.1:8777/)。

从源码生成静态产物时，先安装前端锁定依赖。将 `index.html`、`assets/` 和 `THIRD_PARTY/` 放在同一个网站根目录，可部署在 URL 子路径。

```sh
npm --prefix frontend ci
VITE_ECOSIM_PAGES=1 npm --prefix frontend run build -- --outDir ../output/v3-pages
python3 -m scripts.package_student_lab --static-notices output/v3-pages
```

## 模型连接与迁移

本机 AI 导师仅接受同源回环请求。学生在本机页面输入自己的 Key，主动确认一次供应商测试后，Key 暂存于本机服务进程内存。会话最长一小时，支持主动清除。请保留启动器的单进程回环配置。本机连接测试和讲解可能计费。原版单角色和多角色模型实验仍使用各自的服务端环境配置。静态课堂关闭模型入口。 [连接契约与用量边界](01-study-ai.md)

同一浏览器、主机名、协议和端口可读取原有本地档案。更换地址前分别备份课堂记录、作答数据及 SQLite。实验卡导入会按原种子和条件复算，并核对运行摘要和事件引用。旧数据库原地升级前先制作备份副本。 [旧档迁移](../../frontend/MIGRATION.md) · [实验室备份与恢复](../../STUDENT_LAB.md#换地址后恢复已有学习) · [V2 兼容范围](../v2/release/migration.md)

候选档案保留课程来源、既有生成资产和第三方依赖的原许可声明。项目源码及自编教学资产的公开许可须由权利人确认。 [第三方许可记录](third-party.md)

## 回归入口

`.github/workflows/teaching.yml` 配置主分支推送、PR 与手工运行的构建和验收。流程包含锁依赖安装、跨引擎帧比对、归档凭证形态扫描、解包校验、契约与机制测试、兼容测试及十二课纯静态走查。模型通路以本机测试凭证和替身供应商验证。启动器另在 Linux 与 Windows 运行独立解包验收。 [GitHub Actions 检出说明](https://github.com/actions/checkout) · [Playwright CI 指南](https://playwright.dev/python/docs/ci-intro)

## 本地候选验收

- 用新建 Python 3.12 环境和锁文件复跑。解包目录独立启动，十二课索引与旧课堂、笔记和教师路径均可访问。候选包的浏览器回归覆盖十二课八阶段、已连接与离线状态、旧进度、实验卡往返及导师作用域。
- 纯静态 HTTP 服务完成十二课八阶段及次日复习，浏览器未发出 API 请求。契约与机制测试通过 364 项，前端逻辑测试通过 68 项。三套跨引擎脚本分别核对拍卖、银行及其余课程的规则轨迹、分支或公开事件摘要。
- 课程来源登记覆盖 20 条引用和 58 项数据资产。候选包和静态构建执行凭证形态扫描，前端运行依赖的 npm 审计返回零项发现。模型验证使用测试凭证及替身供应商。历史 Git 提交不在本轮源码扫描范围内。
- 主分支托管 CI、Windows 启动器、真实供应商及原生读屏仍待实测。候选构建保存在本机。正式对外发布还需要权利人确定项目和自编资产的许可范围。
