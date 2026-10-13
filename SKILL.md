---
name: chrome-cdp-pa
description: Drive a local Chrome tab via the cdp.mjs CLI (list, nav, eval, dom-extract, click, shot). Prefer direct shell commands—no separate automation script required unless the user asks for batch/CI regression.
---

# Chrome CDP PA

Lightweight Chrome DevTools Protocol CLI. Connects directly via WebSocket — no Puppeteer, works with 100+ tabs, instant connection.

## How to work (default: no script file)

**Do not** default to “write a Node/shell script first, then run it.” The normal flow is **interactive CLI in the terminal** (or the agent runs equivalent commands directly):

1. `scripts/cdp.mjs list` → copy a **unique** `<target>` prefix (e.g. `6BE827FA`).
2. Optionally `scripts/cdp.mjs nav <target> <url>` if the tab is not already on the right page.
3. `scripts/cdp.mjs eval <target> "$(cat scripts/dom-extract.js)"` to load structured DOM (`elementTree` + `selectorMap`).
4. Next steps: `eval` one-off JS, `click`, `clickxy`, `type`, `shot`, `html`, etc., based on what you see—**iterate until the task is done**.

**When a separate script is appropriate (optional):** repeated regression suites, CI, or the user explicitly wants a checked-in runner. Otherwise keep everything as **direct `cdp.mjs` invocations**.

## Prerequisites

- Chrome (or Chromium, Brave, Edge, Vivaldi) with remote debugging enabled: open `chrome://inspect/#remote-debugging` and toggle the switch
- Node.js 22+ (uses built-in WebSocket)
- If your browser's `DevToolsActivePort` is in a non-standard location, set `CDP_PORT_FILE` to its full path

## Commands

All commands use `scripts/cdp.mjs` (path is relative to the repo or skill root that contains `scripts/cdp.mjs`). The `<target>` is a **unique** targetId prefix from `list`; copy the full prefix shown in the `list` output (for example `6BE827FA`). The CLI rejects ambiguous prefixes.

### List open pages

```bash
scripts/cdp.mjs list
```

### Take a screenshot

```bash
scripts/cdp.mjs shot <target> [file]    # default: screenshot-<target>.png in runtime dir
```

Captures the **viewport only**. Scroll first with `eval` if you need content below the fold. Output includes the page's DPR and coordinate conversion hint (see **Coordinates** below).

### Accessibility tree snapshot

```bash
scripts/cdp.mjs snap <target>
```

### Extract structured DOM info (recommended for automation)

```bash
scripts/cdp.mjs eval <target> "$(cat scripts/dom-extract.js)"
```

Returns a **standards-aligned DOM extraction envelope** for LLM-driven automation:

- `elementTree`: compact tree text of retained DOM structure, with `[index]` markers on actionable elements
- `selectorMap`: index-to-element metadata map for follow-up actions
- `pageInfo`: URL, title, viewport, scroll position
- `stats`: traversal counts and extraction timing

The extractor focuses on **visible actionable elements by default** and applies:

- visibility filtering
- interactivity heuristics (`button`, `link`, `input`, `select`, `textarea`, `checkbox`, `radio`, `clickable`)
- blocked-state detection
- sensitive-data masking
- attribute allowlists

Supports **Element Plus**, **Ant Design**, and native HTML, but the output contract is no longer tied to specific component buckets such as `inputs` or `buttons`.

Compared with `html` and `snap`, this output is usually much smaller while still preserving enough context for index-based planning. **Prefer this over `html` or `snap` when you need to understand page state for automation.**

<details>
<summary>Example output</summary>

```json
{
  "elementTree": "[noindex] <body>\n  [0] <button type=\"button\">\n  +-- \"生成二维码\"\n  [1] <input type=\"text\" placeholder=\"请输入知识点ID\" label=\"知识点\">",
  "selectorMap": {
    "0": {
      "index": 0,
      "tagName": "button",
      "elementType": "button",
      "attributes": {
        "type": "button"
      },
      "text": "生成二维码",
      "rect": {
        "x": 892,
        "y": 146,
        "width": 96,
        "height": 32,
        "centerX": 940,
        "centerY": 162
      },
      "state": {
        "isVisible": true,
        "isInteractive": true,
        "isBlocked": false,
        "isSensitive": false
      },
      "depth": 2
    },
    "1": {
      "index": 1,
      "tagName": "input",
      "elementType": "input",
      "attributes": {
        "type": "text",
        "placeholder": "请输入知识点ID",
        "label": "知识点"
      },
      "text": "",
      "rect": {
        "x": 312,
        "y": 146,
        "width": 220,
        "height": 32,
        "centerX": 422,
        "centerY": 162
      },
      "state": {
        "isVisible": true,
        "isInteractive": true,
        "isBlocked": false,
        "isSensitive": false
      },
      "depth": 2
    }
  },
  "pageInfo": {
    "url": "https://example.com/qrcode",
    "title": "CB",
    "viewport": {
      "width": 1512,
      "height": 982
    },
    "scrollPosition": {
      "x": 0,
      "y": 0
    }
  },
  "stats": {
    "totalNodes": 248,
    "visibleNodes": 96,
    "interactiveNodes": 12,
    "filteredNodes": 181,
    "extractionTime": 6.14
  }
}
```
</details>

### Reading the result

Use `elementTree` for fast page understanding and `selectorMap` for exact action planning.

Typical flow:

1. Read `elementTree` to identify the best candidate element.
2. Look up that element's metadata in `selectorMap[index]`.
3. Use the index as your stable mental reference while issuing the next `eval`, `clickxy`, or selector-based action.

This is especially helpful when multiple buttons or inputs are visually similar.

### Breaking change

`dom-extract.js` no longer uses the old grouped summary as its primary contract. Existing callers that expect top-level fields such as `inputs`, `selects`, `buttons`, `tables`, or `modals` should migrate to:

- `elementTree` for hierarchical context
- `selectorMap` for actionable elements and their metadata
- `pageInfo` for page-level assertions
- `stats` for extraction diagnostics

If you were previously reading `inputs[0].label` or `buttons[0].text`, now iterate over `selectorMap` and filter by `elementType`, `attributes`, or `text`.

### Default behavior notes

- Hidden and non-interactive elements are omitted by default.
- Sensitive values are masked by default, including password-like fields and common patterns such as emails or phone numbers.
- Blocked-state detection is enabled by default, so an extracted element may still be present with `state.isBlocked: true`.
- Complex component libraries may still surface a small number of helper descendants (for example select suffix wrappers or icon containers) when they behave as distinct clickable targets.
- The output is optimized for automation, not for exact DOM reconstruction.

### Evaluate JavaScript

```bash
scripts/cdp.mjs eval <target> <expr>
```

> **Watch out:** avoid index-based selection (`querySelectorAll(...)[i]`) across multiple `eval` calls when the DOM can change between them (e.g. after clicking Ignore, card indices shift). Collect all data in one `eval` or use stable selectors.

### Other commands

```bash
scripts/cdp.mjs html    <target> [selector]   # full page or element HTML
scripts/cdp.mjs nav     <target> <url>         # navigate and wait for load
scripts/cdp.mjs net     <target>               # resource timing entries
scripts/cdp.mjs click   <target> <selector>    # click element by CSS selector
scripts/cdp.mjs clickxy <target> <x> <y>       # click at CSS pixel coords
scripts/cdp.mjs type    <target> <text>         # Input.insertText at current focus; works in cross-origin iframes unlike eval
scripts/cdp.mjs loadall <target> <selector> [ms]  # click "load more" until gone (default 1500ms between clicks)
scripts/cdp.mjs evalraw <target> <method> [json]  # raw CDP command passthrough
scripts/cdp.mjs open    [url]                  # open new tab (each triggers Allow prompt)
scripts/cdp.mjs stop    [target]               # stop daemon(s)
```

## Coordinates

`shot` saves an image at native resolution: image pixels = CSS pixels × DPR. CDP Input events (`clickxy` etc.) take **CSS pixels**.

```
CSS px = screenshot image px / DPR
```

`shot` prints the DPR for the current page. Typical Retina (DPR=2): divide screenshot coords by 2.

## Tips

- **Prefer `dom-extract.js` over `html` or `snap`** for understanding page state during automation. Its primary contract is `elementTree + selectorMap + pageInfo + stats`.
- For LLM-driven actions, first inspect `elementTree`, then use `selectorMap[index]` to confirm the target element before acting.
- If a value appears as `***`, that is expected: sensitive-data masking is enabled by default.
- **Avoid inventing a wrapper script** unless the task needs repeatable batch execution; chain `cdp.mjs` commands instead.
- Legacy automation that expected grouped fields like `inputs` or `buttons` should use `selectorMap` + `elementTree` instead.
- Use `snap --compact` when you need the full accessibility tree (e.g. non-form content, text paragraphs).
- Use `html` only when you need raw DOM structure for debugging selectors.
- Use `type` (not eval) to enter text in cross-origin iframes — `click`/`clickxy` to focus first, then `type`.
- Chrome shows an "Allow debugging" modal once per tab on first access. A background daemon keeps the session alive so subsequent commands need no further approval. Daemons auto-exit after 20 minutes of inactivity.
