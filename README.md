# 3D-AGENT

一个面向激光切割拼装结构的实验项目，核心目标是让生成器、编辑器和 AI 基于同一套结构内核工作。

## 当前内容

- `editor-creator.html` — 创作者编辑器（主入口）
  - 自由面板拖拽 + 自动卡槽吸附
  - 已接入 `box` 组件模板
  - 支持 `组件视图 / 展开视图`
  - 发布弹窗（识别结构 → 封装为组件）
- `mvp-box-demo.html` — 盒子生成器 Demo
- `demo-v2.html` — AI + 画布协作 Demo（面编辑器、隔板、镂空）
- `polyhedra-standalone.html` — 正多面体生成器（独立版）
- `executive-demo.html` — 正多面体生成器（演示版）

## 项目思路

这个项目不是把"生成器"和"编辑器"做成两套系统，而是沉淀一套统一的结构表达：

- 生成器负责产出组件，比如 `box`
- 编辑器负责承接组件，并提供参数编辑、展开查看和局部微调
- AI 后续直接操作同一套结构模型

主链路：`generator / editor / AI → model JSON → compileModelToAssembly() → renderAssembly() → fabrication`

## 目录结构

```text
.
├── css/
│   ├── editor.css            # 编辑器样式（从 editor-creator.html 提取）
│   ├── mvp-box.css           # 盒子 Demo 样式
│   ├── demo-v2.css           # AI Demo 样式
│   ├── polyhedra.css         # 多面体样式
│   └── style.css             # 通用样式
├── js/
│   ├── core/                 # 统一结构内核
│   │   ├── schema.js         # 模型/元素/连接的数据定义
│   │   ├── model-ops.js      # 无状态操作：增删改、自动连接检测
│   │   ├── macro-models.js   # 编译层：box/polyhedron → panel+connection
│   │   ├── macro-registry.js # 组件模板注册
│   │   ├── assembly-renderer.js # Three.js 渲染
│   │   ├── joint-kernel.js   # 接合几何生成
│   │   ├── joint-policies.js # 边类型、kerf 规则
│   │   ├── joint-registry.js # 接合类型注册表
│   │   ├── publish-recognizers.js # 发布识别（面板组合 → 组件）
│   │   └── index.js          # 统一导出
│   ├── editor/
│   │   └── editor-app.js     # 编辑器主逻辑（从 editor-creator.html 提取）
│   ├── demos/
│   │   ├── mvp-box-app.js    # 盒子 Demo 逻辑
│   │   └── demo-v2-app.js    # AI Demo 逻辑
│   ├── box-generator.js      # 盒子几何生成（旧版）
│   ├── face-decorations.js   # 2D 装饰 → 3D 几何
│   ├── face-editor.js        # 面编辑器 Canvas UI
│   ├── joint-utils.js        # 接合工具函数（旧版）
│   ├── poly-*.js             # 多面体相关模块
│   ├── polygon-joint-utils.js
│   └── ui-controls.js
├── docs/
│   └── interaction-design.md # 编辑器交互设计文档
├── editor-creator.html       # 编辑器页面（薄壳）
├── mvp-box-demo.html         # 盒子 Demo 页面（薄壳）
├── demo-v2.html              # AI Demo 页面（薄壳）
├── polyhedra-standalone.html # 多面体（独立版，内联）
├── executive-demo.html       # 多面体（演示版，内联）
├── polyhedra.html            # 多面体（模块化版）
├── product-vision.md         # 产品方案文档
└── README.md
```

## 本地运行

项目使用浏览器 ES Modules，需通过本地静态服务器访问：

```bash
python3 -m http.server 8123
```

然后打开：

- http://10.50.62.229:8123/editor-creator.html （编辑器）
- http://10.50.62.229:8123/mvp-box-demo.html （盒子 Demo）
- http://10.50.62.229:8123/demo-v2.html （AI Demo）
- http://10.50.62.229:8123/polyhedra-standalone.html （多面体）

## 现阶段重点

- 统一 generator / editor / AI 的结构表达
- 编辑器交互：Figma 式双层选择（单击选组件，双击进内部）
- 吸附即成组，参数自动合并，发布时用户确认
- 先接入 `box`，后续扩展到更多组件模板
- 优先保证制造闭环和结构一致性

## 备注

这是一个快速迭代中的探索型项目，部分 Demo 侧重概念验证。详细交互设计见 [`docs/interaction-design.md`](docs/interaction-design.md)，产品方案见 [`product-vision.md`](product-vision.md)。
