# AgentAd

AgentAd（原 ZKDSP）是一个面向 Web3 广告场景的 AI Agent 驱动投放系统。当前仓库覆盖了从广告素材生成、安全审核、素材画像分析、Bidder Agent 竞价、拍卖回放、Publisher SDK 校验，到链上 Attestation 与实验性 zk settlement 方向的完整研发资产。

这个根目录 `README` 主要负责做仓库导航；具体的运行方式、接口和页面说明，请直接看子项目文档。

## 仓库概览

- `audit/`
  主应用仓库。包含 Next.js 前端、Go 后端、数据库迁移、合约目录、Publisher SDK 测试页，以及当前主要业务代码。
- `docs/`
  根目录产品与实现文档，适合先快速理解系统目标、角色和整体架构。
- `scripts/`
  仓库级脚本。目前最实用的是 push 前的 secret 自检脚本。

## 你应该先看哪里

- 想运行项目：看 [`audit/README.md`](./audit/README.md)
- 想理解产品范围：看 [`docs/ad-audit-mvp.md`](./docs/ad-audit-mvp.md)
- 想理解当前实现状态：看 [`docs/agentad-implementation.md`](./docs/agentad-implementation.md)
- 想看演示脚本：看 [`audit/docs/demo-script.md`](./audit/docs/demo-script.md)
- 想了解实验性 zk 结算模块：看 [`audit/zk-settlement/README.md`](./audit/zk-settlement/README.md)

## 当前能力

- AI 生成广告素材，并支持生成后自动送审
- 基于 Claude Vision + Tool Use 的广告安全审核
- 审核通过后生成 Attestation、Manifest 和可校验证明
- 对审核通过的素材做结构化 creative profile 分析
- 配置 Bidder Agent 策略并在模拟拍卖里做选材、估 CTR、出价
- Publisher 侧通过 SDK 请求广告、展示胜出素材、记录点击
- 提供 Audit Replay、Auction Replay / Why I Won、Creative Lab 等演示和分析页面
- 提供实验性的 `zk-settlement/` 目录，用于探索批量结算与 zk 证明链路

## 目录结构

```text
.
├── README.md
├── docs/
│   ├── ad-audit-mvp.md
│   └── agentad-implementation.md
├── scripts/
│   └── check-secrets.sh
└── audit/
    ├── README.md
    ├── backend/          # Go backend + migrations + handlers
    ├── src/              # Next.js app router frontend
    ├── contracts/        # Solidity contracts / scripts / tests
    ├── public/           # SDK demo pages and static assets
    ├── docs/             # Demo script and diagrams
    └── zk-settlement/    # Experimental Pico zkVM settlement scaffold
```

## 快速开始

1. 进入主应用目录：

```bash
cd audit
```

2. 按 [`audit/README.md`](./audit/README.md) 准备 PostgreSQL、后端 `.env` 和前端依赖。

3. 启动后端与前端：

```bash
cd backend && ./run.sh
```

```bash
cd audit
npm install
npm run dev
```

4. 打开本地页面：

- Console: `http://localhost:3000`
- Backend API: `http://localhost:8080`

## 开发建议

- 主要业务代码都在 `audit/` 下，根目录更像 monorepo 入口和文档层。
- push 前建议先跑一次 secret 自检：

```bash
./scripts/check-secrets.sh
```

- 本地真实环境文件例如 `audit/.env`、`audit/backend/.env`、`audit/contracts/.env` 不应该提交。
- `audit/zk-settlement/target/` 这类本地构建产物也不建议进仓库。

## 备注

- 当前项目包含已实现功能和实验性方向两部分；其中 `zk-settlement/` 仍是隔离模块，还没有接入主业务结算路径。
- 如果你只是第一次进仓库，最省时间的路径是：先看根目录 `docs/`，再进 `audit/README.md`，最后按页面去读 `audit/src/app/` 和 `audit/backend/internal/`。
