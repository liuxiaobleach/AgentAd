# ZKDSP Ad Audit System

Web3 广告审核与链上验证 MVP。广告主提交素材 → Claude Vision + Tool Use 审核 → 通过后签发链上证书 → 广告位 SDK 展示"已审核"徽章。

详细规格见 `docs/ad-audit-mvp.md`。架构图见 `docs/architecture.svg`。

---

## 架构

```
┌─────────────────┐         ┌──────────────────┐        ┌──────────────┐
│  Next.js :3000  │────────▶│  Go Backend :8080│───────▶│  PostgreSQL  │
│  (Console UI)   │ rewrite │  - chi router    │  pgx   │  zkdsp_audit │
└─────────────────┘         │  - Claude Agent  │        └──────────────┘
                            │  - Policy Engine │
                            └──────────────────┘
                                    │
                                    ▼
                            Anthropic API
```

**技术栈**
- 前端：Next.js 14 + React 18 + Tailwind CSS
- 后端：Go 1.25 + chi + pgx + anthropic-sdk-go
- 数据库：PostgreSQL 18
- 审核 Agent：Claude Sonnet 4（Vision + Tool Use 多轮循环）
- 图像处理：disintegration/imaging（JPEG 压缩 + 1568px 缩放）
- QR 解码：makiuchi-d/gozxing
- 合约：Solidity（`contracts/AdAttestationRegistry.sol`，未部署）
- SDK：TypeScript（`sdk/zkdsp-ad-sdk.ts`，浏览器端验证）

---

## 目录结构

```
audit/
├── README.md                          ← 本文件
├── docs/
│   ├── ad-audit-mvp.md                规格文档
│   └── architecture.svg               架构图
│
├── backend/                           Go 后端
│   ├── cmd/server/main.go             启动入口
│   ├── internal/
│   │   ├── config/                    环境变量
│   │   ├── db/                        pgx 连接池 + Queries 层
│   │   ├── handler/                   chi HTTP handlers
│   │   ├── audit/
│   │   │   ├── triage_agent.go        Claude Vision + Tool Use 循环
│   │   │   ├── policy_engine.go       8 条规则决策
│   │   │   └── tools/                 QR / URL / Domain / Telegram / Redirect
│   │   └── attestation/service.go     证书签发 + Manifest 生成
│   ├── migrations/001_initial.sql     数据库 schema
│   ├── uploads/                       上传的广告图片
│   ├── .env                           后端配置（含 ANTHROPIC_API_KEY）
│   └── run.sh                         启动脚本
│
├── src/app/                           Next.js 前端（仅 UI）
│   ├── dashboard/                     仪表盘
│   ├── creatives/                     素材 CRUD
│   ├── audit-cases/                   审核案件列表 + 详情（含 Agent 思考过程）
│   ├── certificates/                  证书列表
│   ├── integrations/                  SDK 接入指南
│   └── _api_disabled/                 旧 Next.js API routes（已禁用，由 Go 后端接管）
│
├── contracts/
│   └── AdAttestationRegistry.sol      链上证书合约
│
├── sdk/
│   └── zkdsp-ad-sdk.ts                广告位验证 SDK
│
├── next.config.js                     前端配置（/api/* → http://localhost:8080）
└── package.json
```

---

## 本地启动

### 前置依赖

- PostgreSQL 运行在 `localhost:5432`，用户 `postgres`，密码 `YOUR_PASSWORD`
- Go 1.25+
- Node.js 20+
- `ANTHROPIC_API_KEY`（已配在 `backend/.env`）

### 1. 初始化数据库（仅首次）

```bash
PGPASSWORD=YOUR_PASSWORD psql -U postgres -c "CREATE DATABASE zkdsp_audit;"
PGPASSWORD=YOUR_PASSWORD psql -U postgres -d zkdsp_audit -f backend/migrations/001_initial.sql
```

### 2. 启动 Go 后端（终端 A）

```bash
cd backend && ./run.sh
```

`run.sh` 会自动 source `.env` 并执行 `go run ./cmd/server`，监听 `:8080`。

日志会打印到终端，若需要后台运行可：
```bash
./run.sh > /tmp/go-server.log 2>&1 &
```

### 3. 启动 Next.js 前端（终端 B）

```bash
npm install          # 仅首次
npm run dev
```

前端监听 `:3000`，`/api/*` 和 `/uploads/*` 会被代理到 Go 后端。

### 4. 打开浏览器

访问 http://localhost:3000

---

## 配置

### `backend/.env`

```bash
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/zkdsp_audit?sslmode=disable
ANTHROPIC_API_KEY=sk-ant-...
AUDIT_MODEL=claude-sonnet-4-20250514   # 可切换到 claude-opus / claude-haiku
UPLOAD_DIR=./uploads
PORT=8080
REGISTRY_ADDRESS=0x...                 # 合约地址（目前占位）
ISSUER_ADDRESS=0x...                   # 签发地址（目前占位）
ALLOWED_ORIGINS=http://localhost:3000  # CORS
```

### 代理（国内开发）

Go 的 `net/http` 默认读取 `https_proxy` / `http_proxy` 环境变量，本地有代理时 Claude API 调用会自动走代理。**不需要额外配置**。

部署到海外机器时也不需要改代码，直接跑即可。

---

## API 一览

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/creatives` | 创建素材（multipart form，含图片上传） |
| GET | `/api/creatives` | 列表 |
| GET | `/api/creatives/{id}` | 详情（含审核历史） |
| POST | `/api/creatives/{id}/submit-audit` | 触发审核（**异步返回 202**） |
| GET | `/api/audit-cases` | 审核案件列表 |
| GET | `/api/audit-cases/{id}` | 案件详情（含 Agent 思考过程、证据） |
| PATCH | `/api/audit-cases/{id}` | 人工复审（PASS/REJECT） |
| GET | `/api/certificates` | 证书列表 |
| GET | `/api/manifests/{id}` | 获取投放 Manifest JSON |
| POST | `/api/sdk/verify` | SDK 验证接口 |
| GET | `/uploads/{filename}` | 静态图片文件 |

---

## 审核流程

1. **前端**：`POST /api/creatives/{id}/submit-audit`
2. **Go handler**：立即创建 `audit_case`（状态 `TRIAGING`），返回 `202 + auditCaseId`
3. **后台 goroutine**（在独立 context 运行，5 分钟超时）：
   1. `QR Decode`（jsQR 先跑一次，给 Claude 参考）
   2. `Image Resize`（超过 1568px 缩放 + JPEG 85 压缩）
   3. 调用 Claude：`image + declaration + QR result` 作为输入
   4. **Agentic loop**（最多 10 轮）：
      - Claude 分析图片，调用 `check_domain_reputation` / `trace_redirects` / `check_telegram_link` / `canonicalize_url`
      - Go 执行工具，结果回传
      - 直到 Claude 调用 `report_findings` 输出结构化结论
   5. 所有 tool call + text + thinking 写入 `audit_cases.agent_thinking`
   6. `Policy Engine`（8 条规则）基于 Claude 的 `risk_signals` 做最终裁决：`PASS` / `REJECT` / `MANUAL_REVIEW`
   7. 若 `PASS`：签发 Attestation + 生成 Manifest
4. **前端**：详情页每 2 秒轮询，状态变化后自动刷新

### 关键设计

- **同步返回不可行**：Claude 循环要 30 秒～2 分钟，前端 / 代理层会超时 → 改为**异步 + 轮询**
- **Agent 不直接判定**：Claude 输出风险信号 + 评分，最终 PASS/REJECT 由规则引擎决定
- **中文审核内容**：system prompt 要求 Claude 用中文输出 text/summary，但 `risk_signals` 保留英文标签（规则引擎枚举值）

---

## 常用运维命令

```bash
# 停止所有服务
lsof -ti:8080 | xargs kill     # Go 后端
lsof -ti:3000 | xargs kill     # Next.js 前端

# 查看日志（若后台启动）
tail -f /tmp/go-server.log
tail -f /tmp/next-dev.log

# 数据库
PGPASSWORD=YOUR_PASSWORD psql -U postgres -d zkdsp_audit
# \dt                           查看所有表
# SELECT * FROM audit_cases ORDER BY submitted_at DESC LIMIT 5;
# SELECT agent_thinking FROM audit_cases WHERE id = '...';

# 重置数据库
PGPASSWORD=YOUR_PASSWORD psql -U postgres -c "DROP DATABASE IF EXISTS zkdsp_audit;"
PGPASSWORD=YOUR_PASSWORD psql -U postgres -c "CREATE DATABASE zkdsp_audit;"
PGPASSWORD=YOUR_PASSWORD psql -U postgres -d zkdsp_audit -f backend/migrations/001_initial.sql

# Go 后端重新构建
cd backend && go build -o /tmp/zkdsp-audit-server ./cmd/server
```

---

## 后续开发方向

按优先级：

1. **链上真实签发**：目前 `attestation.IssueAttestation` 只写数据库，未调合约。需要集成 `go-ethereum` / `viem` 调用 `AdAttestationRegistry.issueAttestation`
2. **Ops 审核员后台**：`_api_disabled/` 里有原始 Next.js handlers 可以参考，接入 Go 后端
3. **OCR fallback**：目前完全依赖 Claude 读图，可加入 Tesseract（`otiai10/gosseract`）做离线兜底
4. **对象存储**：`uploads/` 目前本地磁盘，生产需切 S3/R2
5. **审核任务队列**：目前用 goroutine 简单异步，扩展性差。可切 Redis + worker
6. **撤销机制**：合约有 `revokeAttestation`，后端和前端未暴露
7. **SDK 发布**：`sdk/zkdsp-ad-sdk.ts` 已写完，需要 bundle 成 `.min.js` 发 CDN
8. **生产部署**：后端走 systemd / docker，前端 `next build && next start`，Nginx 反代

---

## 已知限制

- **浏览器 UI 部分文案仍是英文**（Dashboard、表单 label）。Agent 输出已中文化，但 React 页面 label 尚未国际化
- **合约未部署**：Attestation 只存数据库，`registry_address` 和 `issuer_address` 是占位零地址
- **审核 Agent 最多 10 轮**：极端复杂的素材可能 turn 不够，需要调 `internal/audit/triage_agent.go` 里 `for turn := 0; turn < 10` 的上限
- **单条审核耗时**：Claude Sonnet 4 约 20-60 秒；若追求速度可切 `claude-haiku-4-5-20251001`（审核深度会下降）
- **并发**：goroutine 无限并发，没做速率限制。生产环境需加 semaphore 或队列
