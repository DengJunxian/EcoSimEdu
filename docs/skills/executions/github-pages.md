# GitHub Pages 发布

公开演示从 `frontend/` 构建。规则模型、笔记和复习由浏览器运行。演示使用独立的部署地址与浏览器存储，本机版继续提供原实验室、教师工作台和模型服务。

```sh
npm --prefix frontend ci
VITE_ECOSIM_PAGES=1 npm --prefix frontend run build
```

发布分支 `gh-pages` 的根目录来自这次 `frontend/dist` 构建，含 `.nojekyll`。部署分支只保存可公开提供的静态文件。[GitHub Pages 发布方式](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)

## 技能执行

- Playwright CLI 用于检查公开课堂首页与课程入口。桌面 Chrome 与 Playwright WebKit 按现有端到端脚本复测课程，模型接口保持关闭。
- PR 技能用于组织发布提交的变更摘要、验证证据和回滚影响。源码通过 GitHub PR 入主分支，静态构建使用独立部署分支。
