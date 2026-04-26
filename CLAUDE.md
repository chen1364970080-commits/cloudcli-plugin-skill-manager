# Skill Manager Plugin

CloudCLI UI plugin that browses Claude Code skills and rules from ~/.claude/skills/ and ~/.claude/rules/.

## Build

```bash
npm install
npm run build
```

## Files

- `src/server.ts` — HTTP backend, scans skills/rules directories and parses YAML frontmatter
- `src/index.ts` — Frontend UI, polls server every 10s
- `src/types.ts` — PluginAPI type definitions
- `dist/` — Compiled TypeScript output
