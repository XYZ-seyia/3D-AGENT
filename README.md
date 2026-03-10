# 3D-AGENT

一个面向激光切割拼装结构的实验项目，核心目标是让生成器、编辑器和 AI 基于同一套结构内核工作。

## 当前内容

- `mvp-box-demo.html`
  - 盒子生成器 Demo
  - 使用 `js/core` 中的 schema、model-ops、macro-models、assembly-renderer
- `editor-creator.html`
  - 创作者编辑器 Demo
  - 支持自由面板编辑
  - 已接入 `box` 组件模板
  - 支持 `组件视图 / 展开视图`
- `polyhedra-standalone.html`
  - 正多面体相关 Demo
- `js/core/`
  - 项目的统一结构内核
  - 包含 schema、模型操作、接合策略、组件编译和 Three.js 渲染

## 项目思路

这个项目不是把“生成器”和“编辑器”做成两套系统，而是尝试沉淀一套统一的结构表达：

- 生成器负责产出组件，比如 `box`
- 编辑器负责承接组件，并提供参数编辑、展开查看和局部微调
- AI 后续也应该直接操作同一套结构模型

当前已经形成的主链路是：

`generator / editor / AI -> model JSON -> compileModelToAssembly() -> renderAssembly() -> fabrication`

## 目录结构

```text
.
├── css/
├── js/
│   ├── core/
│   │   ├── schema.js
│   │   ├── model-ops.js
│   │   ├── macro-models.js
│   │   ├── macro-registry.js
│   │   ├── assembly-renderer.js
│   │   └── index.js
│   ├── poly-data.js
│   └── ...
├── mvp-box-demo.html
├── editor-creator.html
├── polyhedra-standalone.html
├── demo-v2.html
├── executive-demo.html
└── product-vision.md
```

## 本地运行

项目使用浏览器 ES Modules，建议通过本地静态服务器访问，不要直接双击 HTML 用 `file://` 打开。

在项目根目录执行：

```bash
python3 -m http.server 8123
```

然后在浏览器打开：

- `http://127.0.0.1:8123/mvp-box-demo.html`
- `http://127.0.0.1:8123/editor-creator.html`
- `http://127.0.0.1:8123/polyhedra-standalone.html`

## 现阶段重点

- 统一 generator / editor / AI 的结构表达
- 让编辑器从“面板编辑器”升级为“组件容器”
- 先接入 `box`，后续扩展到更多官方生成器模板
- 优先保证制造闭环和结构一致性

## 备注

这是一个快速迭代中的探索型项目，部分 Demo 侧重概念验证，代码结构会继续收敛到 `js/core`。
