---
title: "gcx vs the Grafana MCP server: which is more efficient for an AI agent?"
description: "Comparing Grafana's agent-oriented CLI against the Grafana MCP server on interface shape, read coverage, and the token/dollar cost of each for AI agent usage."
eyebrow: "AI Agents / Grafana"
meta:
  - "Scope: dashboards, datasources, Prometheus/Loki/Pyroscope reads"
  - "Method: live probe against a real Grafana instance"
pubDate: 2026-07-20
draft: false
---

Grafana now ships two official, actively-developed ways to hand an observability stack to an AI agent: **[`gcx`](https://grafana.com/docs/grafana/latest/as-code/observability-as-code/grafana-cli/gcx/)**, Grafana's command-line tool (formerly `grafanactl`), explicitly "optimized for agentic usage," and **[the Grafana MCP server](https://github.com/grafana/mcp-grafana)**, a Model Context Protocol server that exposes Grafana as native tool calls to clients like Claude Code, Claude Desktop, Cursor, and VS Code.

Both talk to the same Grafana REST and datasource-query APIs underneath, so the interesting question isn't "which has more features." It's how each behaves inside an agent's loop: the shape of the interface, what it can reach, and what it costs in tokens and dollars. I tested both against a real, self-hosted Grafana instance running the LGTM stack (Prometheus, Loki, Tempo, Pyroscope) in my home lab.

## TL;DR

- **Use the MCP for interactive, in-session Q&A.** Native typed tool calls, structured JSON straight into context, no shell, no parsing.
- **Use `gcx` for scripted, CI, or dashboards-as-code work.** Pipeable, diffable, and it runs from any bash-capable agent, not just an MCP client.
- **Cost is a rounding error.** The MCP pays a fixed schema tax up front; `gcx` pays nothing up front but a smaller on-demand tax to learn its commands. Prompt caching and lazy tool-loading shrink the gap enough that it shouldn't drive the decision.

## 1. Two very different shapes

The MCP server puts Grafana inside the model's tool loop. The agent calls a typed tool (`search_dashboards`, `query_prometheus`, `list_datasources`) and gets structured JSON straight back into its context. No shell, no parsing, no glue.

```json
// query_prometheus({ datasourceUid: "prometheus", expr: "up", queryType: "instant" })
{
  "resultType": "vector",
  "result": [
    {
      "metric": { "__name__": "up", "instance": "localhost:9090", "job": "prometheus" },
      "value": [1721500800, "1"]
    }
  ]
}
```

`gcx` treats Grafana as terminal output. The agent runs a command (`gcx dashboards search`, `gcx metrics query`, `gcx resources list`), reads stdout (with `-o json` for machine parsing), and composes from there. That makes it pipe-able, diff-able, and commit-able, the natural fit for dashboards-as-code and CI, but it pushes error handling onto the agent and runs through the much broader blast radius of arbitrary shell.

```bash
$ gcx metrics query --datasource prometheus --expr 'up' -o json
{
  "resultType": "vector",
  "result": [
    {
      "metric": { "__name__": "up", "instance": "localhost:9090", "job": "prometheus" },
      "value": [1721500800, "1"]
    }
  ]
}
```

| | Grafana MCP server | `gcx` CLI |
| --- | --- | --- |
| Interface | Native typed tool calls | Shell commands |
| Output to the model | Structured JSON in-context | stdout / `-o json`, agent parses |
| Where it shines | Interactive in-session Q&A | Scripting, CI, GitOps, portability |
| Client requirement | An MCP client | Anything that runs bash |
| Guidance for the model | Tool schemas | Agent Skills + `--help` |

## 2. Read coverage: what each one can reach

Both cover the reads that matter: dashboard search and inspection, datasource discovery, and querying Prometheus, Loki, Tempo, and Pyroscope. On top of that:

- The **MCP** adds read tools with no CLI equivalent: panel-image (PNG) rendering, deeplink generation, and Sift investigations, plus OnCall and Incident reads.
- **`gcx`** adds things the MCP doesn't: pulling resources to local files (GitOps), a raw `api` passthrough, cross-signal querying from a single binary, and portable Agent Skills you can drop into a coding agent.

## 3. What it costs (tokens and dollars)

I ran the same read-only calls through both tools and measured the bytes each returned to the model. Per call, they land in the same ballpark. The MCP's purpose-built tools can be very lean (a "dashboard summary" tool returned roughly a quarter of the tokens of the full dashboard JSON), while `gcx`'s defaults are richer but trimmable on the spot with a built-in `--jq` flag. `gcx` also auto-spills oversized output to a temp file and hands back a tiny pointer instead of flooding the context window, a safety net the MCP doesn't have. Call it a wash.

The cost that actually adds up is fixed overhead. An MCP server advertises its whole tool catalog to the model up front, tens of tool schemas, on the order of ten-thousand-plus tokens, that load every session whether or not you touch Grafana. `gcx` advertises nothing: it's just a binary the agent shells out to, so its fixed cost is zero, and it pays a smaller, on-demand tax to learn the commands (a `--help` here, an Agent Skill there).

Two things soften the MCP's overhead so much that it rarely decides anything:

- **[Prompt caching](https://code.claude.com/docs/en/prompt-caching).** Those tool schemas sit at the stable front of the prompt, so they're written to cache once and re-read at a tenth of the price on every later turn. Caching collapses the per-session schema tax by roughly four to five times. Across a month of daily use the difference between the two tools comes out to low tens of dollars per engineer, real, but not the number you should be optimizing.
- **[Lazy tool-loading](https://code.claude.com/docs/en/agent-sdk/tool-search).** Some agent clients (Claude Code among them) defer tool schemas and fetch only the handful actually used, instead of loading the full catalog. Where that happens, the MCP's fixed overhead mostly evaporates and the two tools converge on cost. The schema tax really only bites in clients that load every tool up front.

Bottom line on cost: it's a rounding error next to ergonomics and reliability. Pick the tool that fits the workflow; don't pick it to save pennies per session.

## 4. Decision matrix

| Task | Reach for | Why |
| --- | --- | --- |
| Interactive Q&A ("what's the error rate on service X?") | <span class="tool-badge tool-mcp">Grafana MCP</span> | Zero shell, structured results, the model drives it natively |
| Dashboards-as-code, GitOps, CI pipelines | <span class="tool-badge tool-cli">gcx</span> | Pipeable, diffable, commit-able, works from any bash-capable agent |
| Cross-agent portability (not locked to an MCP client) | <span class="tool-badge tool-cli">gcx</span> | Just a binary; no MCP client required |
| Rich in-context result without post-processing | <span class="tool-badge tool-mcp">Grafana MCP</span> | Purpose-built lean tools like `get_dashboard_summary` |

## The takeaway

They're complementary, and the choice comes down to workflow, not capability. For interactive, in-session Q&A, reach for the MCP: native typed tools, structured JSON straight into context, and trim the enabled tool set to what you actually use. For scripted, CI, GitOps, or cross-agent work, reach for `gcx`: pipeable, diffable, and it runs from any bash-capable agent. One caveat: on self-hosted OSS it needs Grafana 12 or newer, so check your version first.

Cost shouldn't be the tiebreaker either way. Prompt caching and lazy tool-loading keep the MCP's fixed schema overhead from mattering much in practice, so pick the tool that fits how you're actually going to use it.
