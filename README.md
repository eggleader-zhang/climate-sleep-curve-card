# Climate Sleep Curve Card / 空调睡眠曲线卡片

Climate Sleep Curve 的 Home Assistant Dashboard Plugin，提供移动端可用的 SVG 睡眠温度曲线编辑器、控制器配置、会话启动与停止以及进度展示。

本卡片依赖独立的 **Climate Sleep Curve** 后端 Integration。检测不到后端 WebSocket API 时，卡片会显示明确的安装提示。

## 功能

- 4～12 小时曲线编辑
- 鼠标、触控和键盘调整温度节点
- 根据目标空调温度范围和步进调整编辑范围
- 创建、编辑、复制和删除曲线
- 创建、编辑和删除控制器
- 配置每天启动时间和星期
- 启动、停止和重新开始会话
- 显示空调状态、运行进度、下一节点时间和温度
- 简体中文、英文以及深浅色主题

## 安装

### HACS

将本仓库添加为 HACS 自定义仓库，类别选择 **Dashboard**，然后下载 Climate Sleep Curve Card。

### 手动安装

将 `climate-sleep-curve-card.js` 复制到 Home Assistant 的 `/config/www/`，然后在“设置 → 仪表盘 → 资源”中添加：

```text
/local/climate-sleep-curve-card.js?v=0.1.0
```

资源类型选择 JavaScript 模块。

## 卡片配置

可以通过图形化卡片编辑器选择控制器，也可以使用 YAML：

```yaml
type: custom:climate-sleep-curve-card
controller_id: 控制器_ID
name: 卧室睡眠曲线
show_climate_state: true
show_next_point: true
compact: false
```

首次没有控制器时，可以放置一张不含 `controller_id` 的卡片，然后点击“开始设置”。

## 开发与校验

```bash
npm test
npm run check
```

项目结构：

```text
climate-sleep-curve-card.js  # HACS 与手动安装使用的构建产物
src/                         # 曲线算法源码
test/                        # Node 单元测试
```

## 安全边界

卡片本身不直接调用任何空调服务，只通过 Home Assistant 已认证 WebSocket 连接管理曲线和会话。实际设备安全检查由 Climate Sleep Curve 后端执行。
