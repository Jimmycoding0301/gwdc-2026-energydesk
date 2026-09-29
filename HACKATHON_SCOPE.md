# Hackathon scope disclosure

## English

This repository is the GWDC 2026 Korea TRON Challenge A submission snapshot assembled on **2026-09-29 KST**. The source workspace had no usable pre-submission Git history, so exact file-level timing cannot be independently reconstructed and is not inferred from filesystem timestamps.

### Existing work and reused foundations

- The project uses React, Vite, Express, TypeScript, Vitest, TronWeb, Zod and public TRON ecosystem interfaces.
- Quote comparison, constrained optimization and procurement cost breakdowns are established techniques.
- Public provider documentation and JustLend's public MCP service description informed the adapters; their services and marks are not owned by this project.

### GWDC-specific implementation and verification

- The product was focused on a concrete 86-person Seoul event-closing scenario.
- Two provider adapters, unit normalization, inventory/minimum-order/deadline checks, split search, stale-quote invalidation and copyable evidence were integrated into one flow.
- A minimal ReceiptRegistry was deployed on Nile on 2026-09-29 and the EnergyDesk decision receipt was confirmed and independently matched.
- Automated tests, responsive UI verification, security boundaries and the standalone submission package were completed.

The public receipt commits fixture data for a repeatable demo. No Energy purchase or delivery is claimed.

### AI assistance

OpenAI Codex assisted implementation, testing, review, documentation and packaging. The participant remains responsible for the submission.

## 中文

本仓库是 2026-09-29 KST 整理的 TRON A 提交快照。原工作区没有可用的早期 Git 历史，因此不根据文件时间推断逐文件开发日期。项目复用了通用开源框架和公开 TRON 文档；GWDC 场景整合了双来源、单位归一、库存和最小单检查、拆单搜索、报价失效重算与 Nile 收据。链上收据只承诺演示采购决策，不代表已下单或交付。

