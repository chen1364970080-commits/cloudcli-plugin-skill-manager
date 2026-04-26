# CloudCLI Plugin: Skill Manager

A sidebar tab plugin for [Claude Code](https://claude.ai/code) for browsing, searching, and filtering all installed Claude Code skills and rules.

## What It Does

Claude Code has a skills system (`~/.claude/skills/`) and a rules system (`~/.claude/rules/`). This plugin scans both directories, parses YAML frontmatter from each skill definition, and presents them in a searchable, filterable panel. Auto-refreshes every 10 seconds with scroll position preserved.

## Features

- **All-in-one view** — skills and rules in a single panel with type filters
- **Live search** — filter by name, description, origin, or when-to-use notes
- **Type filters** — All / Skills / Rules tabs with live counts
- **Rich skill metadata** — origin badge, effort level, version, when-to-use notes, hooks, paths
- **Rule support** — rules grouped by language with file counts and descriptions
- **Dark + light themes** — automatic theme switching based on Claude Code's theme

## Architecture

```
skill-manager/
├── manifest.json       # Plugin descriptor (name, entry, server, slot)
├── src/
│   ├── server.ts       # Backend HTTP server (Node.js)
│   │                    # Scans ~/.claude/skills/ and ~/.claude/rules/
│   │                    # Parses YAML frontmatter → JSON → HTTP API
│   ├── index.ts        # Frontend (vanilla JS, polling every 10s)
│   └── types.ts        # PluginAPI / PluginContext type definitions
├── dist/               # Compiled output (tsc)
├── icon.svg            # Plugin icon
├── package.json
└── tsconfig.json
```

## How the Backend Works

The server walks two directories:

**Skills** — `~/.claude/skills/<name>/SKILL.md`
- Each skill has a `SKILL.md` file with YAML frontmatter
- Parses: `name`, `description`, `origin`, `version`, `when_to_use`, `effort`, `model`, `paths`, `hooks`, `user-invocable`

**Rules** — `~/.claude/rules/<language>/`
- Rules are organized by language (`typescript/`, `python/`, `golang/`, etc.)
- Each rule directory contains `.md` files
- Description is extracted from the first non-heading, non-blockquote line

## YAML Frontmatter Format (Skills)

```yaml
---
name: my-skill
description: What this skill does in one sentence
origin: ecc
version: "1.0"
when_to_use: |
  Step 1: Do this
  Step 2: Then that
effort: low
model: haiku
paths: ["*.py", "*.js"]
hooks:
  PostToolUse:
    - matcher: "Bash"
      command: "pnpm prettier --write \"$FILE_PATH\""
user-invocable: true
---
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/skills` | GET | List all skills and rules |
| `/health` | GET | Server health check |

### Response: `/skills`

```json
{
  "skills": [
    {
      "type": "skill",
      "name": "example-skill",
      "description": "What this skill does",
      "origin": "ecc",
      "version": "1.0",
      "dirPath": "~/.claude/skills/example-skill",
      "fileCount": 3,
      "whenToUse": "When to invoke this skill",
      "effort": "low",
      "model": "haiku",
      "userInvocable": true,
      "paths": ["*.py", "*.js"],
      "hooks": {},
      "lastModified": 1745712000000
    },
    {
      "type": "rule",
      "name": "typescript",
      "description": "TypeScript coding standards...",
      "language": "typescript",
      "dirPath": "~/.claude/rules/typescript",
      "fileCount": 5,
      "lastModified": 1745712000000
    }
  ],
  "skillsCount": 10,
  "rulesCount": 8,
  "skillsDir": "~/.claude/skills",
  "rulesDir": "~/.claude/rules"
}
```

## Installation

```bash
# 1. Clone or copy the plugin
git clone https://github.com/chen1364970080-commits/cloudcli-plugin-skill-manager.git

# 2. Install into Claude Code plugins directory
cp -r cloudcli-plugin-skill-manager ~/.claude-code-ui/plugins/skill-manager

# 3. Build
cd ~/.claude-code-ui/plugins/skill-manager
npm install
npm run build

# 4. Restart Claude Code — the "Skills" tab appears in the sidebar
```

## Requirements

- Claude Code with plugin support (UI v2+)
- Node.js (the backend server uses native Node APIs)
- Skills/Rules installed in `~/.claude/skills/` and `~/.claude/rules/`

## Plugin API

This plugin uses the CloudCLI Plugin API:

```typescript
interface PluginContext {
  theme: 'dark' | 'light';
  project: { name: string; path: string } | null;
  session: { id: string; title: string } | null;
}

interface PluginAPI {
  readonly context: PluginContext;
  onContextChange(callback: (ctx: PluginContext) => void): () => void;
  rpc(method: string, path: string, body?: unknown): Promise<unknown>;
}

mount(container: HTMLElement, api: PluginAPI): void;
unmount(container: HTMLElement): void;
```

## Key Design Decisions

- **No framework** — vanilla JS + CSS for the frontend. No React/Vue/Svelte dependency.
- **Poll-based** — 10-second polling interval. Reasonable for skill/rule browsing which changes infrequently.
- **Custom YAML parser** — doesn't bundle `js-yaml`. A lightweight hand-rolled parser handles the flat key-value frontmatter used by Claude Code skills.
- **Scroll preservation** — saves/restores `scrollTop` across re-renders so users don't jump to the top on refresh.
- **Theme-aware** — reads `ctx.theme` from the plugin API and applies the appropriate color palette.

## License

MIT
