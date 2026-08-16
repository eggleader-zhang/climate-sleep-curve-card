# AGENTS.md

本文件适用于整个 `climate-sleep-curve-card` 前端仓库。任何开发者、代码评审者或自动化编码代理在修改代码前都应阅读并遵循这些约束。

## 项目定位

这是 Climate Sleep Curve 后端集成的 Home Assistant Lovelace 卡片。它负责展示状态、编辑温度与风量曲线和控制器，以及通过已认证 WebSocket API 请求启动或停止会话。

卡片不是设备控制器。设备服务、安全检查、持久化和调度属于独立的 `climate-sleep-curve` 后端仓库。两个项目均只在 GitHub 维护，`github` remote 是唯一远程发布源。

## 不可破坏的产品边界

1. 前端不得直接调用 `hass.callService` 控制 `climate` 实体。
2. 不得新增打开、切换或修改 HVAC 模式的按钮和隐式行为；允许配置后端控制器的 `turn_off_after_completion`，但前端自身仍不得调用关机服务。
3. 所有会话操作和配置写入必须通过 `climate_sleep_curve/*` WebSocket 命令交给后端。
4. UI 文案不得暗示“启动曲线”会打开空调，或“停止曲线”会关闭空调；必须明确只有启用开关后的自然结束才会关机。
5. 空调关闭、不可用和未知状态只是展示信息；卡片不得尝试绕过后端安全跳过逻辑。
6. 活动会话展示使用后端返回的 `profile_snapshot`，不得用当前可编辑曲线覆盖它。

如果功能需求需要改变这些边界，应先修改后端安全设计并获得维护者明确确认，再配套修改前端。

## 文件职责

- `climate-sleep-curve-card.js`：由 `src/card.mjs` 打包生成的发布文件，是 HACS `filename` 指向的安装产物；不要直接编辑。
- `src/card.mjs`：卡片与编辑器的主运行时源码。
- `src/ui-helpers.mjs`：Home Assistant 风格消息、输入和确认交互，以及执行结果展示元数据。
- `src/curve-utils.mjs`：温度吸附、时长调整、风速节点继承和推荐曲线等可独立测试算法。
- `test/`：使用 Node 内置测试运行器的算法和卡片行为测试。
- `package.json`：版本与校验脚本。
- `hacs.json`：HACS Dashboard Plugin 元数据。
- `README.md`：用户安装、配置、使用和排错说明。

修改 `src/` 后必须运行 `npm run build` 更新发布文件，并用 `npm run check:bundle` 确认源码和发布文件一致。提交发布文件和源码，但不要提交 `node_modules/`。

## Home Assistant 卡片接口

主卡片必须继续实现：

- `setConfig(config)`：接受配置并应用默认值。
- `set hass(hass)`：接收 Home Assistant 状态对象。
- `getCardSize()`：向布局提供合理高度。
- `static getConfigElement()`：返回图形化编辑器。
- `static getStubConfig()`：允许卡片选择器创建初始配置。

自定义元素名称保持：

- `climate-sleep-curve-card`
- `climate-sleep-curve-card-editor`

卡片类型保持 `custom:climate-sleep-curve-card`。变更元素名或卡片类型属于破坏性变更，必须提供迁移说明。

## WebSocket 协议

当前使用的主要命令包括：

- `climate_sleep_curve/get_state`
- `climate_sleep_curve/subscribe`
- `climate_sleep_curve/profile/save`
- `climate_sleep_curve/profile/delete`
- `climate_sleep_curve/profile/duplicate`
- `climate_sleep_curve/profile/recommend`
- `climate_sleep_curve/controller/save`
- `climate_sleep_curve/controller/delete`
- `climate_sleep_curve/session/start`
- `climate_sleep_curve/session/stop`
- `climate_sleep_curve/session/restart`

协议修改规则：

- 不根据名称推导 ID；使用后端提供的不透明 `id`。
- 更新和删除继续发送 `expected_revision`，并处理 `revision_conflict`。
- 创建对象时使用 `expected_revision: null`。
- 会话进度使用后端的 `started_at` 和 `ends_at`；下一节点来自会话快照和 `next_offset_minutes`。
- 写接口权限错误、校验错误和网络错误必须给用户清晰反馈。
- 新增订阅必须保存取消函数，并在 `disconnectedCallback` 中释放。
- 不要高频轮询；优先使用后端订阅事件触发刷新。
- 前后端字段变化必须同步修改两个仓库、README、测试和版本说明。

## 状态管理和并发

- `load()` 需要避免重复并发加载，并区分后端缺失和正常空状态。
- 对话框打开时不要用后台刷新覆盖用户正在编辑的草稿。
- 编辑曲线使用独立深拷贝；取消时不得修改已加载状态。
- 有未保存修改时，关闭或缩短曲线需要明确确认。
- 保存期间禁用提交按钮，避免重复请求。
- 首次设置创建曲线后若控制器创建失败，应尽力删除刚创建的孤立曲线；清理失败不得掩盖原始错误。
- 删除控制器或曲线必须二次确认，并让后端完成引用完整性检查。
- 不要静默覆盖来自其他页面的新修订。

## 配置兼容性

支持并保留以下卡片配置：

- `controller_id`
- `name`
- `show_climate_state`，默认 `true`
- `show_next_point`，默认 `true`
- `compact`，默认 `false`

新增配置必须有稳定默认值，使旧 YAML 无需修改即可继续工作。图形化编辑器产生 `config-changed` 时应保留它不认识的已有字段。

只有一个控制器且未指定 `controller_id` 时可以自动选择；存在多个控制器时不得擅自绑定第一个控制器。

## 曲线编辑规则

- 用户可选时长为 4～12 个整小时。
- 当前界面按每小时一个节点编辑，第一个节点为 0 小时。
- 缩短时长删除尾部节点前必须确认。
- 延长时长使用最后一个温度填充新增节点。
- 风速控制支持 `none`、`auto` 和 `curve`；风量曲线只提供控制器全部目标实体共同支持的 `fan_modes`。
- 延长风量曲线时使用最后一个风速填充新增节点。
- 鼠标、触摸和键盘修改应使用相同的裁剪和步进逻辑。
- 图表范围参考控制器所有目标实体的 `min_temp`、`max_temp` 和 `target_temp_step`；实际执行仍由后端对每台设备独立换算、裁剪和吸附。
- 内部和 WebSocket payload 使用摄氏温度；华氏设备属性仅用于转换编辑范围。
- 所有数值必须保持有限，避免 `NaN`、除零和无效 SVG 属性。
- 推荐曲线以服务器返回结果为准，前端不要复制一套可能漂移的业务模板。

## UI、可访问性和响应式要求

- 使用 Home Assistant CSS 变量，兼容深色与浅色主题。
- 适配窄屏和触控，交互目标应足够大，不依赖 hover。
- 曲线节点必须可聚焦，保留 `role="slider"`、`aria-valuemin`、`aria-valuemax` 和 `aria-valuenow`。
- 键盘上/下方向键应按温度步进调整节点。
- 按钮执行异步操作时防止重复提交，并呈现错误。
- 危险操作使用明确、具体的确认文案。
- 用户文本需同时提供简体中文和英文；新增文案使用现有 `t(zh, en)` 方式或经批准的统一本地化方案。
- 不要硬编码会破坏 Home Assistant 主题的背景色、文字色或字体。

## 安全与输入处理

- 所有插入 `innerHTML` 的后端数据、实体属性、配置和用户输入必须先经过 `esc()`。
- 不把错误对象、token、连接信息或完整后端状态写入 DOM、控制台或持久存储。
- 不使用 `eval`、动态脚本注入或不可信 URL。
- 用户输入先在前端提供基本约束，但最终必须依赖后端权威校验。
- 输入和确认使用卡片内的 Home Assistant 风格组件；空输入和取消操作需要显式处理，不得使用浏览器阻塞式 `alert`、`confirm` 或 `prompt`。
- 不吞掉影响用户结果的异常；仅允许对尽力清理这类次要操作做受控忽略。

## 测试与验证

每次修改至少运行：

```bash
npm test
npm run check:bundle
npm run check
git diff --check
```

算法变更应在 `test/` 增加单元测试，至少覆盖：

- 0.5 °C 和 1 °C 步进吸附。
- 最小/最大温度裁剪。
- 延长和缩短曲线。
- 推荐曲线长度、端点和确定性。
- 华氏属性换算以及缺失/无效实体属性。
- 多实体共同风速交集和延长曲线时的风速继承。

UI 或协议变更还应在真实 Home Assistant 中手动验证：

1. 后端未安装时的提示。
2. 无控制器、一个控制器和多个控制器。
3. 首次设置成功及控制器创建失败后的清理。
4. 桌面鼠标、移动触控和键盘调整节点。
5. 深色/浅色主题和窄屏布局。
6. 启动、停止、重新开始和实时状态更新。
7. 后端返回校验错误、权限错误、网络错误和修订冲突。
8. 实体为 `off`、`unavailable`、`unknown` 时界面不诱导错误操作。

## 修改工作流

1. 运行 `git status --short`，保护用户已有改动。
2. 阅读相关前端代码和后端协议实现，不根据 README 猜测字段。
3. 做最小且完整的修改，避免把功能变更与大规模格式化混在一起。
4. 同步更新发布文件、可测试算法、测试、README 和版本元数据。
5. 运行自动校验并完成与风险相称的 Home Assistant 手动验证。
6. 检查最终 diff，确认没有缓存、临时文件、令牌、内部地址之外的敏感数据或 `node_modules/`。
7. 在本仓库提交并推送到 `github` remote；不要配置或同步其他镜像 remote。如果由总仓库引用，再更新总仓库的子模块指针。

未经明确请求，不要改写历史、强制推送、删除用户分支或修改远程地址。

## 版本与发布

- `package.json` 版本、README 资源查询参数和发布标签应一致。
- `hacs.json` 的 `filename` 必须与根目录发布文件名一致。
- 发布前使用兼容后端版本进行端到端验证。
- 如果协议不向后兼容，在 README 和发布说明中明确最低后端版本。
- 发布前运行 `npm run build` 生成根目录文件，并用 `npm run check:bundle` 检查它与 `src/` 一致。

## 代码评审清单

评审按以下优先级检查：

1. 是否新增了直接设备服务调用或误导性的电源/HVAC 行为。
2. WebSocket 字段、权限、修订号和错误处理是否与后端一致。
3. 用户数据是否经过转义，是否可能发生 XSS 或敏感信息泄露。
4. 编辑草稿、实时刷新、重复点击和多页面并发是否会覆盖数据。
5. 温度换算、范围、步进、时间显示和会话快照是否正确。
6. 订阅是否释放，组件重复挂载是否产生监听器泄漏。
7. 移动端、键盘、主题、中英文和旧 YAML 是否兼容。
8. 测试、README、HACS 元数据和版本是否同步。

缺陷报告应说明复现步骤、浏览器/Home Assistant 环境、实际结果、期望结果和建议测试。
