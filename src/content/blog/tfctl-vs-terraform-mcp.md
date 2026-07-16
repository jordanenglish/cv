---
title: "tfctl vs the Terraform MCP: which is more token-efficient?"
description: "Measuring how many tokens a CLI-plus-jq workflow costs an AI agent versus an MCP server, for the same Terraform Enterprise operations."
eyebrow: "AI Agents / Terraform Enterprise"
meta:
  - "Scope: TFE workspaces, runs, variable sets"
  - "Method: real byte counts (wc -c), read-only calls"
pubDate: 2026-07-14
draft: false
---

When you let an AI coding agent drive Terraform Enterprise (TFE), you have two obvious ways to give it access: an MCP server that exposes typed tools, or a CLI it already has via its shell. I wanted numbers, not vibes, so I measured both against a real TFE org: [tfctl](https://github.com/hashicorp/tfctl-cli) paired with `--jq`, versus the Terraform MCP server. Every figure below is a real `wc -c` byte count of an actual response.

## TL;DR

- **Use the CLI for TFE operations.** Zero static context cost, and the output trims to exactly the fields you want. Roughly **250x** smaller responses than raw JSON when you pair `tfctl api` with `--jq`.
- **Use the MCP for docs only.** Provider, module, and policy documentation plus version lookups. It is the right tool there, and the CLI has no equivalent. Keep it out of the TFE hot path.

## 1. The static context tax

An MCP server's tool schemas live in the agent's context whether or not you call them. The Terraform server exposes about **60 tools**. Loaded eagerly, that is an estimated **10,000 to 20,000 tokens on every turn**, paid even on turns that never touch Terraform. A CLI rides on the shell tool the agent already has, so its marginal cost is **zero**.

The mitigation, if your harness supports it: load the MCP server lazily or defer its tool schemas until first use. That mostly neutralizes the tax. If a config loads the server eagerly, you pay that 10-to-20K-token bill constantly.

## 2. Per-operation output, measured

Same operation four ways: list the workspaces in an org. The decisive difference is that the CLI lets you choose the projection; an MCP response arrives in a fixed shape you cannot trim.

![Bar chart comparing output size for listing 5 workspace names by approach, log scale. tfctl --jq: 95 bytes. tfctl default table: about 1,000 bytes. tfctl --json raw JSON:API: 23,507 bytes.](/cv/blog/tfctl-vs-mcp/output-size-comparison.svg)

(The MCP's `list_workspaces` returns a fixed shape that varies with org size and isn't projectable, so it's left off this chart; see the scenario numbers below for a direct comparison.)

The raw JSON is roughly **7.8 KB per workspace**. Filtering to just the names with `--jq` collapsed five workspaces to **95 bytes**, about a **250x** reduction. That knob simply does not exist on the MCP side: it returns a truncated summary you cannot narrow with a filter, and its `get_*_details` tools return full blobs.

## 3. Four real scenarios, measured

Everyday TFE tasks, run four ways.

![Grouped bar chart, log scale, across four tasks: list 10 workspaces, one workspace's details, last 5 runs on a workspace, and list variable sets. Compares tfctl --jq, tfctl table, tfctl --json, and Terraform MCP output sizes in bytes. tfctl --jq is smallest in every task, and the MCP returned an empty response for last 5 runs.](/cv/blog/tfctl-vs-mcp/four-scenarios.svg)

Reading across: `tfctl --jq` is smallest in every task, beating the MCP response by **3x to 60x** and raw JSON by **36x to 113x**. The pattern is consistent because `--jq` projects only the fields the task needs, while the other three return a fixed shape.

A few observations:

- **The MCP is not uniformly bloated.** Its workspace *list* summary (1,911 B) is genuinely lean, close to the CLI's table. But its *details* and *variable-set* responses drag along full relationship graphs you cannot strip.
- **Duplication you pay for.** `get_workspace_details` repeated the same relationship stub 21 times, plus a duplicate `included` block. The CLI answered the same question ("name, version, locked, failures") in **84 bytes**.
- **And it can just miss.** The MCP `list_runs` call returned an empty payload (`{"data":{"type":""}}`) for one workspace, so it was unusable there. The CLI returned five real runs.

## 4. Where each one wins

**The CLI (tfctl)**

- **Zero static cost.** No tool schemas in context; it uses the shell.
- **Tunable output.** Default table, `--json`, or `--jq` to project exact fields.
- **Full API reach.** `tfctl api` hits any TFE endpoint, including ones no tool wraps.

**The Terraform MCP**

- **Registry and docs.** `search_providers`, `get_provider_details`, module and policy lookups. The CLI has no equivalent.
- **Version lookups** when authoring Terraform (`get_latest_module_version`).
- **Typed params.** Structured schemas mean fewer malformed calls and retries.

## 5. Decision matrix

Map the task to the tool.

| Task | Reach for | Why |
| --- | --- | --- |
| Inspect state, runs, workspaces, variables | <span class="tool-badge tool-cli">tfctl</span> | Zero context tax; trim output with `--jq` |
| Bulk list where you need a few fields | <span class="tool-badge tool-cli">tfctl --jq</span> | ~250x smaller than raw JSON |
| An endpoint no tool wraps | <span class="tool-badge tool-cli">tfctl api</span> | Only option; MCP covers a curated subset |
| Provider / module / policy docs | <span class="tool-badge tool-mcp">Terraform MCP</span> | Registry knowledge; the CLI cannot do it |
| Latest provider / module version | <span class="tool-badge tool-mcp">Terraform MCP</span> | Purpose-built lookup for authoring |
| Mutations (runs, variables, deletes) | <span class="tool-badge tool-cli">tfctl</span> | Always dry-run first or confirm |

## The takeaway

MCP servers are a great fit for knowledge lookups with typed inputs. But for high-frequency read operations where you already know the endpoint, a CLI plus a projection tool like `jq` is dramatically cheaper in tokens, because you control exactly how much comes back. The general rule: reach for typed tools when you need the type safety or the registry knowledge, and reach for the shell when you need to trim the response to the bone.
