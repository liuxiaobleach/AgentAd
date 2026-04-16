# AgentAd — 实现文档

本文档记录 AgentAd（原 ZKDSP）在 MVP 规格之上已实际实现的功能、架构和新增特性。

## 1. 项目概述

AgentAd 是一个 AI Agent 驱动的一站式广告投放平台，覆盖从广告素材生成、安全审核、素材画像分析、智能竞价、模拟投放到效果分析的完整闭环。

**核心理念：** 用多个专职 AI Agent（而非单一 prompt）各司其职，组成一条自动化的广告生产与投放流水线。

## 2. 技术架构

### 2.1 技术栈

| 层 | 技术 | 说明 |
|---|---|---|
| 前端 | Next.js 14 + React 18 + Tailwind CSS | 赛博朋克暗色主题 UI |
| 后端 | Go (chi router) | 原生支持 https_proxy，解决 Claude API 代理问题 |
| 数据库 | PostgreSQL (pgx v5) | 本地部署 |
| AI 模型 | Claude Sonnet 4 (anthropic-sdk-go) | 审核、分析、竞价、生成 agent |
| 图像生成 | Google Imagen 3 / OpenAI DALL-E 3 | 通过 Gemini API 或 OpenAI API |
| 认证 | JWT (HMAC-SHA256) | 无外部依赖的轻量 auth |
| 前后端通信 | Next.js rewrites → Go :8080 | 前端 :3000 代理 /api/* 到后端 |

### 2.2 Agent 架构

系统包含 **5 个 AI Agent + 1 个确定性策略引擎**：

```
┌─────────────────────────────────────────────────────────────┐
│                    AgentAd Agent Pipeline                     │
├──────────────┬──────────────┬──────────────┬────────────────┤
│ Creative     │ Triage       │ Creative     │ Bidder         │
│ Generation   │ Agent        │ Analysis     │ Agent          │
│ Agent        │              │ Agent        │                │
│ (生成素材)    │ (安全审核)    │ (素材画像)    │ (智能竞价)      │
├──────────────┴──────────────┴──────────────┴────────────────┤
│                    Ad Analyst Agent (效果分析与优化建议)        │
├─────────────────────────────────────────────────────────────┤
│                    Policy Engine (确定性规则引擎)              │
└─────────────────────────────────────────────────────────────┘
```

### 2.3 项目结构

```
audit/
├── backend/                   # Go 后端
│   ├── cmd/server/main.go     # 入口 + 路由注册
│   ├── internal/
│   │   ├── config/            # 环境变量配置
│   │   ├── db/                # 数据模型 + 查询
│   │   ├── handler/           # HTTP handlers
│   │   ├── audit/             # Agent 实现 + 工具链
│   │   │   ├── triage_agent.go              # Triage Agent
│   │   │   ├── creative_analysis_agent.go   # Creative Analysis Agent
│   │   │   ├── bidder_agent.go              # Bidder Agent
│   │   │   ├── analyst_agent.go             # Analyst Agent
│   │   │   ├── creative_generation_agent.go # Creative Generation Agent
│   │   │   ├── image_provider.go            # 图像生成 (Gemini/OpenAI)
│   │   │   ├── policy_engine.go             # 确定性规则引擎
│   │   │   ├── anthropic_retry.go           # Claude API 重试封装
│   │   │   └── tools/                       # 审核工具链
│   │   └── attestation/       # 证书签发服务
│   ├── migrations/            # SQL 迁移脚本
│   ├── .env                   # 环境变量
│   └── run.sh                 # 启动脚本
├── src/                       # Next.js 前端
│   ├── app/                   # 页面路由
│   │   ├── login/             # 登录页
│   │   ├── dashboard/         # 仪表盘
│   │   ├── creatives/         # 素材管理 (含 AI 生成)
│   │   ├── audit-cases/       # 审核案件详情
│   │   ├── bidder-agents/     # Bidder Agent 策略配置
│   │   ├── auctions/          # My Bids (竞价记录)
│   │   ├── reports/           # 报表 (小时级图表)
│   │   ├── analyst/           # AI 分析师
│   │   ├── certificates/      # 证书管理
│   │   └── integrations/      # SDK 集成指南
│   ├── components/Sidebar.tsx # 侧边栏导航
│   └── lib/                   # auth + API 封装
├── public/ad-test.html        # Publisher 广告投放测试页
├── sdk/                       # 浏览器端验证 SDK
└── contracts/                 # Solidity 合约 (未部署)
```

## 3. 用户系统

### 3.1 JWT 认证

- HMAC-SHA256 签名，无外部依赖
- 预置 2 个 demo 账号：
  - `alpha@agentad.demo` / `demo123` — Alpha DeFi（Growth 策略）
  - `beta@agentad.demo` / `demo123` — Beta Gaming（Balanced 策略）
- 每个广告主绑定独立的 Bidder Agent 和素材库

### 3.2 数据隔离

所有核心接口按 JWT 中的 `advertiserID` 做 scope：
- Creatives、Audit Cases、Bidder Agents、My Bids、Reports、Analyst 均只展示当前广告主数据

## 4. Agent 详解

### 4.1 Creative Generation Agent（AI 素材生成）

**完整的三步 Agent Pipeline：**

```
广告主需求 (brief)
    ↓
[1. Brief Agent] — Claude 解析需求 → 结构化创意方向
    ↓                (headline, subheadline, CTA, visualConcept, mood, colorPalette)
[2. Visual Agent] — Claude 撰写图像 prompt → 高质量英文 prompt
    ↓
[3. Image Provider] — Gemini Imagen 3 / DALL-E 3 → 生成广告图片
    ↓
保存图片 → 创建 Creative → (可选) 自动提交审核
```

**支持的图像生成后端（按优先级）：**

| Provider | 模型 | 环境变量 |
|---|---|---|
| Google Gemini Imagen 3 (优先) | imagen-3.0-generate-002 | GEMINI_API_KEY |
| OpenAI DALL-E 3 | dall-e-3 | OPENAI_API_KEY |
| OpenAI gpt-image-1 | gpt-image-1 | OPENAI_API_KEY + IMAGE_MODEL |

**支持的画面比例：** 1:1 (Square) / 16:9 (Landscape) / 9:16 (Portrait)

**风格预设：** Cyberpunk / Minimalist / Corporate / Playful / Luxurious / Bold

**安全措施：**
- 系统提示禁止生成真人肖像、知名商标、暴力内容
- 禁止虚假收益承诺文案（"100% 收益"、"保证赚钱"）
- 生成后可自动进入审核流水线兜底

**API 端点：**
- `POST /api/creatives/generate` — 提交生成请求（异步，返回 202）
- `GET /api/creatives/{id}/generation-status` — 轮询生成进度和 Agent 思考步骤

**前端交互：**
- Creatives 页面 "✨ Generate with AI" 按钮打开生成对话框
- 实时 5 步进度时间线：Queued → Brief → Prompt → Image → Done
- Agent 思考日志实时展示
- 完成后一键跳转到 Creative 详情页

### 4.2 Triage Agent（安全审核）

**Claude Vision + Tool Use 多轮 agentic loop（最多 10 轮）：**

1. Claude Vision 读取广告图片，提取文字内容、实体、二维码信息
2. Agent 根据发现自主决定调用哪些工具
3. 工具执行后结果反馈给 Agent
4. Agent 汇总所有证据，输出 `report_findings`
5. 系统提取 `risk_signals` 传给 Policy Engine 做最终裁决

**审核工具链（5 个确定性工具）：**

| 工具 | 功能 |
|---|---|
| qr_decode | 解码图片中的二维码（gozxing） |
| canonicalize_url | 标准化 URL，拆出域名/路径/参数 |
| trace_redirects | 追踪短链完整跳转链 |
| check_domain_reputation | 检查域名年龄、证书、whois 风险 |
| check_telegram_link | 解析 t.me 链接，判断是否与项目一致 |

**Policy Engine（8 条确定性规则 R001-R008）：**
- R001: 二维码 URL 与声明落地页不一致 → REJECT
- R002: 虚假收益承诺 → REJECT
- R003: 可疑跳转链 → REJECT
- R004: 高风险域名 → REJECT
- R005: 存在二维码 → MANUAL_REVIEW
- R006: 使用短链 → MANUAL_REVIEW
- R007: Telegram 与项目不匹配 → MANUAL_REVIEW
- R008: 钱包连接/claim 诱导语言 → MANUAL_REVIEW

**当前模式：** Auto-approval（所有审核最终通过，但完整执行分析流程，保留所有 Agent 思考过程和风险信号）

**异步处理：** POST 提交 → 返回 202 → goroutine 后台执行 → 前端 2 秒轮询

### 4.3 Creative Analysis Agent（素材画像）

审核 PASS 后自动触发，生成结构化 Creative Profile：

```json
{
  "marketingSummary": "强调 DeFi 高收益，CTA 较强",
  "visualTags": ["defi", "yield", "neon-style"],
  "ctaType": "learn-more",
  "copyStyle": "direct-response",
  "targetAudiences": ["defi-trader", "yield-farmer"],
  "placementFit": {"mobile-banner": 0.8, "desktop-rectangle": 0.7},
  "predictedCtrPriors": {"mobile-banner": 0.015},
  "bidHints": {"recommendedStrategy": "growth", "suggestedMaxBidCpm": 25}
}
```

该 profile 同时服务：
- 广告主（理解素材定位）
- Bidder Agent（竞价时的输入特征）

### 4.4 Bidder Agent（智能竞价）

**输入：** Agent 配置 + BidRequest + 候选素材（含 profile + 历史表现）
**输出：** participate / selectedCreativeId / predictedCtr / bidCpm / confidence / reason

**策略预设模板（6 种）：**

| 模板 | 特点 |
|---|---|
| Growth Aggressive | 高出价、广撒网 |
| Balanced | 平衡 CTR 与成本 |
| Budget Saver | 低出价、保守 |
| CTR Optimizer | 只追求高 CTR |
| Audience Matcher | 重点匹配受众 |
| Custom | 自定义 prompt |

**可组合技能系统（6 项可开关）：**

| 技能 | 功能 |
|---|---|
| Audience Matching | 受众匹配分析 |
| Historical Learning | 历史数据学习 |
| Budget Pacing | 预算控速 |
| Floor Price Awareness | 底价感知 |
| Creative Rotation | 素材轮换 |
| Slot Specialization | 广告位专精 |

**拍卖机制：** Second-price auction，出价最高者赢，按第二高价结算

### 4.5 Ad Analyst Agent（效果分析）

输入广告主的全部表现数据（Agent stats + Creative stats + 近期拍卖记录），Claude 输出：

- **Overall Assessment** — 综合评价 + 0-100 评分
- **Key Findings** — 按 impact（high/medium/low）标注的关键发现
- **Optimization Recommendations** — 按 priority 排序的优化建议
- **Creative Insights** — 每个素材的表现评价和改进方向
- **Strategy Advice** — 策略配置调整建议

## 5. 广告投放与点击追踪

### 5.1 Publisher 测试页面

`http://localhost:8080/ad-test` — 模拟 "CryptoNews Daily" 新闻网站，内嵌广告位。

**功能：**
- 左侧控制面板：配置广告位类型、分类、用户标签、底价
- 右侧广告位：实时竞价 → 展示胜出广告
- 底部竞价日志：每次拍卖的详细过程
- Verified 徽章：点击查看竞价详情（项目、出价、Agent 理由、结算价）
- **真实点击追踪**：点击广告时通过 `navigator.sendBeacon` 上报到后端

### 5.2 点击追踪

- `POST /api/ad-slot/click/{auctionId}` — 公开端点，记录真实用户点击
- 使用 sendBeacon 确保页面跳转时不丢失请求
- 真实点击会覆盖模拟点击数据

### 5.3 公开广告端点（无需 JWT）

| 端点 | 用途 |
|---|---|
| POST /api/ad-slot/request | Publisher 请求广告填充 |
| GET /api/ad-slot/result/{id} | 轮询拍卖结果 |
| POST /api/ad-slot/click/{id} | 点击追踪 |

## 6. My Bids（竞价记录）

**Bid 维度的列表**（非 Auction 维度），每一条 bid 一行：

- 包括赢的、输的、未参与的（skipped）
- 按当前广告主 scope（只看自己 Agent 的 bid）
- 顶部 5 个汇总卡片：Total Bids / Participated / Wins / Clicks / Total Spend
- 列：Agent、Slot、Category、Floor、Bid、pCTR、Creative、Result（Won/Lost/No Bid）、Settlement、Click、Time

## 7. Reports（报表）

按小时统计的时间序列报表，展示 3 个 SVG 柱状图：

1. **Request Volume**（cyan）— 请求量
2. **Clicks**（amber）— 点击量
3. **Spend**（pink）— 广告费消耗

**特性：**
- 时间窗口切换：6H / 12H / 24H / 3D / 7D
- 6 个汇总指标卡：Requests / Wins / Clicks / Spend / Win Rate / CTR
- 连续 x 轴（无数据的小时也展示 0 值）
- 渐变柱 + hover 发光 + 精确数值 tooltip
- 使用 Postgres `generate_series` 保证 bucket 连续
- 后端 `GET /api/reports/hourly?hours=24`

## 8. 前端 UI 设计

### 8.1 赛博朋克暗色主题

- 深色背景 (#0a0e1a)
- 霓虹 cyan 主色 (#06b6d4) + purple 辅色 (#a855f7)
- 发光效果（text-shadow、box-shadow）
- 网格纹理背景
- 渐变按钮 + hover 发光
- 深色卡片覆盖所有 Tailwind 白色类

### 8.2 Logo

六边形图标 + 电路节点图案：
- 中心节点（AI Agent 核心）向四周辐射
- 4 个角节点（代表多 Agent 协作）
- cyan + purple 双色渐变
- 文字："Agent" 浅白 + "Ad" 亮 cyan 发光

### 8.3 审核详情页

- 垂直时间线展示 Agent 思考过程
- Turn 1: Agent Initial Analysis（cyan）
- Turn 2-N: Tool Verification（indigo）
- Last Turn: Final Report（green）
- 结构化表格展示分析内容（字段-内容行），深色背景适配
- 工具调用展示 input/output

### 8.4 页面导航

| 页面 | 路径 | 功能 |
|---|---|---|
| Login | /login | 登录 + Demo 账号快捷入口 |
| Dashboard | /dashboard | 广告主总览 |
| Creatives | /creatives | 素材列表 + AI 生成入口 |
| Creative Detail | /creatives/{id} | 素材详情 + 提交审核 |
| Audit Cases | /audit-cases | 审核案件列表 |
| Audit Case Detail | /audit-cases/{id} | Agent 思考过程 + 证据 + 结论 |
| Bidder Agents | /bidder-agents | Agent 列表 |
| Bidder Agent Detail | /bidder-agents/{id} | 策略模板 + 技能配置 + Prompt 预览 |
| My Bids | /auctions | Bid 维度的竞价记录 |
| Auction Detail | /auctions/{id} | 单次拍卖详情 |
| Reports | /reports | 小时级图表报表 |
| Ad Analyst | /analyst | AI 效果分析 |
| Certificates | /certificates | 证书管理 |
| Integration | /integrations | SDK 集成指南 |

## 9. API 端点一览

### 9.1 公开端点（无需认证）

```
POST /api/auth/login              — 登录
POST /api/sdk/verify              — SDK 验证
GET  /api/manifests/{id}          — 获取 manifest
POST /api/ad-slot/request         — Publisher 请求广告
GET  /api/ad-slot/result/{id}     — 轮询广告结果
POST /api/ad-slot/click/{id}      — 点击追踪
GET  /health                      — 健康检查
GET  /ad-test                     — Publisher 测试页面
```

### 9.2 受保护端点（需 JWT）

```
# Auth
GET  /api/auth/me                 — 当前用户信息

# Creatives
POST /api/creatives               — 创建素材（表单上传）
GET  /api/creatives               — 列表（按广告主 scope）
GET  /api/creatives/{id}          — 详情
DELETE /api/creatives/{id}        — 删除（级联删除关联数据）
POST /api/creatives/{id}/submit-audit   — 提交审核
POST /api/creatives/generate             — AI 生成素材
GET  /api/creatives/{id}/generation-status — 生成进度

# Audit Cases
GET  /api/audit-cases             — 列表
GET  /api/audit-cases/{id}        — 详情（含 Agent 思考过程）

# Creative Profiles
GET  /api/creative-profiles/{creativeId} — 素材画像

# Bidder Agents
GET  /api/bidder-agents           — 列表
GET  /api/bidder-agents/{id}      — 详情
PATCH /api/bidder-agents/{id}     — 更新配置

# Auctions
GET  /api/auctions                — My Bids（bid 维度，按广告主 scope）
GET  /api/auctions/{id}           — 拍卖详情
POST /api/simulation-runs         — 手动触发模拟竞价

# Reports
GET  /api/reports/hourly?hours=24 — 小时级报表

# Analyst
GET  /api/analyst/stats           — 原始表现数据
POST /api/analyst/analyze         — AI 分析（同步）

# Certificates
GET  /api/certificates            — 证书列表
```

## 10. 数据库

### 10.1 表结构

```
advertisers          — 广告主 (id, name, wallet_address, contact_email, password_hash)
creatives            — 素材 (id, advertiser_id, creative_name, project_name, image_url, ...)
audit_cases          — 审核案件 (id, creative_id, status, risk_score, decision, agent_thinking, ...)
audit_evidences      — 审核证据 (id, audit_case_id, tool_name, payload, risk_signals)
attestations         — 链上证书 (id, audit_case_id, attestation_id, chain_id, status, ...)
manifests            — 广告 manifest (id, creative_id, attestation_id, manifest_json)
creative_profiles    — 素材画像 (id, creative_id, marketing_summary, visual_tags, ...)
bidder_agents        — 竞价 Agent (id, advertiser_id, name, strategy, strategy_prompt, ...)
auction_requests     — 广告位请求 (id, slot_id, slot_type, size, floor_cpm, ...)
auction_bids         — 竞价出价 (id, auction_request_id, bidder_agent_id, bid_cpm, ...)
auction_results      — 拍卖结果 (id, auction_request_id, winner_bid_id, settlement_price, clicked)
```

### 10.2 预置数据

- 广告主 A: "Alpha DeFi" (adv_alpha) + Bidder Agent "Alpha Growth Agent"
- 广告主 B: "Beta Gaming" (adv_beta) + Bidder Agent "Beta Balanced Agent"

## 11. 环境配置

```bash
# backend/.env
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/zkdsp_audit?sslmode=disable
ANTHROPIC_API_KEY=sk-ant-xxx          # Claude API
AUDIT_MODEL=claude-sonnet-4-20250514
GEMINI_API_KEY=xxx                     # Google Imagen 3 (优先)
GEMINI_IMAGE_MODEL=imagen-3.0-generate-002
OPENAI_API_KEY=                        # OpenAI (备选)
IMAGE_MODEL=dall-e-3
UPLOAD_DIR=./uploads
PORT=8080
ALLOWED_ORIGINS=http://localhost:3000
```

## 12. 启动方式

```bash
# 后端 (Go)
cd audit/backend && ./run.sh

# 前端 (Next.js)
cd audit && npm run dev
```

- 后端: http://localhost:8080
- 前端: http://localhost:3000
- Publisher 测试页: http://localhost:8080/ad-test

## 13. 完整业务闭环

```
[广告主需求] → [Creative Generation Agent] → 素材入库
                                              ↓
                              [Submit Audit] → [Triage Agent] → [Policy Engine]
                                              ↓
                              [PASS] → [Attestation] + [Creative Analysis Agent]
                                              ↓
                              [Creative Profile 入库]
                                              ↓
[BidRequest] → [Bidder Agent A] ──→ [Auction Engine] ──→ 赢家展示
               [Bidder Agent B] ──↗        ↓
                                    [Click Tracking]
                                           ↓
                              [Reports 小时级统计]
                                           ↓
                              [Analyst Agent 效果分析 + 优化建议]
```

## 14. 与 MVP 规格的差异

### 14.1 超出规格的新增功能

| 功能 | 规格中 | 实现状态 |
|---|---|---|
| AI Creative Generation Agent | Out of Scope | ✅ 已实现（Claude + Gemini Imagen 3） |
| Ad Analyst Agent | 未提及 | ✅ 已实现（Claude 效果分析） |
| Bidder Agent 策略模板 (6 种) | 未详细设计 | ✅ 已实现 |
| Bidder Agent 可组合技能 (6 项) | 未提及 | ✅ 已实现 |
| Reports 小时级图表 | 未提及 | ✅ 已实现（SVG 柱状图） |
| 真实点击追踪 (sendBeacon) | 未提及 | ✅ 已实现 |
| Publisher 广告测试页 | 简单提及 | ✅ 完整实现（含竞价日志、验证徽章） |
| Bid 维度的 My Bids 页面 | 以 Auction 维度设计 | ✅ 改为 Bid 维度，含 Won/Lost/No Bid |
| 赛博朋克 UI 主题 | 未提及 | ✅ 已实现 |
| Auto-approval 审核模式 | 未提及 | ✅ 已实现（保留完整分析，结果默认 PASS） |

### 14.2 规格中已实现的功能

- ✅ 广告主 Console（完整 CRUD + 素材管理）
- ✅ JWT 用户认证 + 数据隔离
- ✅ Triage Agent（Claude Vision + Tool Use 多轮 loop）
- ✅ 5 个审核工具（QR decode, URL canonicalize, redirect trace, domain reputation, Telegram check）
- ✅ Policy Engine（8 条规则）
- ✅ Attestation + Manifest 签发
- ✅ Creative Analysis Agent → Creative Profile
- ✅ Bidder Agent（Claude 选材 + CTR 预测 + 出价）
- ✅ Second-price Auction Engine
- ✅ 点击模拟
- ✅ Publisher SDK 验证端点
- ✅ ad-test.html 广告位测试页

### 14.3 规格中未实现的功能

- ❌ 链上合约部署（Solidity 已写，未部署）
- ❌ SDK 浏览器包打包发布
- ❌ 审核员后台 (/ops/*)
- ❌ Onchain-direct 验证模式
- ❌ 视频广告
- ❌ 真实 RTB 接入
- ❌ 收费结算与 billing

## 15. 未来方向

- **x402 Payment** — 探索 HTTP 原生微支付（Publisher 按次付费请求广告、AI 生成按次收费）
- **多链部署** — Attestation 上链
- **Brand Kit** — 广告主上传品牌资产包，AI 生成时保持品牌一致性
- **A/B 生成** — 一次生成多版本，Bidder Agent 按预测 CTR 排序
- **反馈闭环** — Analyst Agent 的优化建议自动反馈到 Creative Generation Agent
- **视频广告** — Runway / Veo 3 API 扩展
