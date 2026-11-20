# EcoSimEdu 教学候选包的第三方许可记录

2026-11-21。

预构建课堂的第三方声明随产物保存在 `THIRD_PARTY/`。每个声明直接取自对应前端锁定版本的 npm 包。旧学生端与新版课堂包含各自锁定的 React、React DOM 与 Scheduler。新版课堂还使用 Apache ECharts、ZRender、tslib 和 Tailwind CSS。打包保留 ECharts 的 NOTICE 与内含的 D3 声明，并随附构建运行时代码的声明。依赖版本见两套前端的 `package-lock.json`。Python 运行依赖由安装工具独立安装，版本见 `requirements-edu.lock`。

课堂内容包含教学团队编写的课件、合成输入与可重算结果。原始论文、交易所逐笔数据与第三方原图未打入教学候选包。课程来源、底层资料缺项和历史权利核验见 [课程来源与数据资产核验](../audit/source-asset-verification.md)。研究应用的图像和独立数据目录在教学包范围之外。

仓库的项目源码和自编资产尚未登记统一的公开再分发许可。本文件记录第三方许可，项目作者的许可决定仍待落实。候选包供本机验收。
