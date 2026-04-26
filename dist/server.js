/**
 * Skill Manager plugin — backend HTTP server.
 *
 * Scans ~/.claude/skills/ and ~/.claude/rules/ for skill/rule definitions
 * and returns parsed metadata via HTTP API.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
// ── YAML-like frontmatter parser ─────────────────────────────────────────
function parseFrontmatter(content) {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!match)
        return { data: {}, body: content };
    const yamlStr = match[1];
    const body = match[2] ?? '';
    const data = {};
    // Simple YAML parser for our flat key-value frontmatter
    for (const line of yamlStr.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#'))
            continue;
        const colonIdx = trimmed.indexOf(':');
        if (colonIdx === -1)
            continue;
        const key = trimmed.slice(0, colonIdx).trim();
        const value = trimmed.slice(colonIdx + 1).trim();
        // Parse array values (e.g. "- Bash" or "  - Read")
        if (value === '') {
            // Might be followed by indented items on next lines — skip for simplicity
            continue;
        }
        // Remove surrounding quotes
        const cleanValue = value.replace(/^["']|["']$/g, '');
        data[key] = cleanValue;
    }
    return { data, body };
}
// Also collect array fields that appear after the key
function parseFrontmatterFull(content) {
    const { data, body } = parseFrontmatter(content);
    // Re-parse to catch array fields
    const lines = content.split('\n');
    let inArray = false;
    let currentArrayKey = '';
    const arrays = {};
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        // Start of frontmatter
        if (trimmed === '---')
            continue;
        // End of frontmatter
        if (trimmed.startsWith('---') && i > 0)
            break;
        if (trimmed.startsWith('#'))
            continue;
        if (!inArray && trimmed.includes(':')) {
            const colonIdx = trimmed.indexOf(':');
            const key = trimmed.slice(0, colonIdx).trim();
            const value = trimmed.slice(colonIdx + 1).trim();
            if (value === '' && (i + 1 < lines.length)) {
                const next = lines[i + 1].trim();
                if (next.startsWith('-') || next.startsWith('"') || next.startsWith("'")) {
                    inArray = true;
                    currentArrayKey = key;
                    arrays[key] = [];
                    // Check if current line has a value
                    const dashMatch = next.match(/^-\s*(.+)/);
                    if (dashMatch) {
                        arrays[key].push(dashMatch[1].replace(/^["']|["']$/g, ''));
                        i++;
                    }
                    continue;
                }
            }
            if (value !== '') {
                data[key] = value.replace(/^["']|["']$/g, '');
            }
        }
        else if (inArray) {
            const dashMatch = trimmed.match(/^-\s*(.+)/);
            if (dashMatch) {
                arrays[currentArrayKey].push(dashMatch[1].replace(/^["']|["']$/g, ''));
            }
            else if (trimmed && !trimmed.startsWith('-')) {
                inArray = false;
            }
        }
    }
    for (const [k, v] of Object.entries(arrays)) {
        data[k] = v;
    }
    return { data, body };
}
// ── File system helpers ─────────────────────────────────────────────────
function getMtime(p) {
    try {
        return fs.statSync(p).mtimeMs;
    }
    catch {
        return 0;
    }
}
function countFiles(dir) {
    let count = 0;
    try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.isFile())
                count++;
            else if (entry.isDirectory())
                count += countFiles(path.join(dir, entry.name));
        }
    }
    catch { /* ignore */ }
    return count;
}
function loadSkill(dirPath) {
    const skillFile = path.join(dirPath, 'SKILL.md');
    if (!fs.existsSync(skillFile))
        return null;
    let content;
    let lastModified;
    try {
        content = fs.readFileSync(skillFile, 'utf-8');
        lastModified = fs.statSync(skillFile).mtimeMs;
    }
    catch {
        return null;
    }
    const { data } = parseFrontmatterFull(content);
    const name = data['name'] ?? path.basename(dirPath);
    const description = data['description'] ?? '';
    const origin = data['origin'] ?? '';
    const version = data['version'] ?? '';
    const whenToUse = data['when_to_use'] ?? '';
    const effort = data['effort'] ?? '';
    const model = data['model'] ?? '';
    const userInvocable = data['user-invocable'] === 'true';
    const paths = data['paths'] ?? [];
    const hooks = data['hooks'] ?? {};
    return {
        type: 'skill',
        name,
        description,
        origin,
        version,
        dirPath,
        fileCount: countFiles(dirPath),
        whenToUse,
        effort,
        model,
        userInvocable,
        paths,
        hooks,
        lastModified,
    };
}
function loadRule(dirPath, langDir) {
    const files = fs.readdirSync(dirPath);
    const mdFiles = files.filter((f) => f.endsWith('.md'));
    // Get last modified from all md files
    let lastModified = 0;
    for (const f of mdFiles) {
        lastModified = Math.max(lastModified, getMtime(path.join(dirPath, f)));
    }
    if (lastModified === 0)
        lastModified = getMtime(dirPath);
    const description = (() => {
        for (const f of mdFiles) {
            if (f === 'README.md')
                continue;
            try {
                const content = fs.readFileSync(path.join(dirPath, f), 'utf-8');
                // Strip YAML frontmatter block
                const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
                // Skip blockquote lines ("This file extends...") and heading-only lines
                const nonMeta = body.split('\n').find((l) => {
                    const t = l.trim();
                    return t && !t.startsWith('>') && !t.startsWith('#');
                });
                if (nonMeta) {
                    const clean = nonMeta.replace(/^#+\s*/, '').trim();
                    if (clean)
                        return clean.slice(0, 80);
                }
                // Fallback: first heading
                const heading = body.split('\n').find((l) => l.trim().startsWith('#'));
                if (heading) {
                    const clean = heading.replace(/^#+\s*/, '').trim();
                    if (clean)
                        return clean.slice(0, 80);
                }
            }
            catch { /* ignore */ }
        }
        return '';
    })();
    return {
        type: 'rule',
        name: langDir,
        description,
        language: langDir,
        dirPath,
        fileCount: mdFiles.length,
        lastModified,
    };
}
function getSkillsData() {
    const home = os.homedir();
    const skillsDir = path.join(home, '.claude', 'skills');
    const rulesDir = path.join(home, '.claude', 'rules');
    const combined = [];
    // Load skills
    let skillsDirs = [];
    try {
        skillsDirs = fs.readdirSync(skillsDir);
    }
    catch { /* ignore */ }
    for (const dir of skillsDirs) {
        const dirPath = path.join(skillsDir, dir);
        let stat;
        try {
            stat = fs.statSync(dirPath);
        }
        catch {
            continue;
        }
        if (!stat.isDirectory())
            continue;
        const skill = loadSkill(dirPath);
        if (skill)
            combined.push(skill);
    }
    // Load rules (only language dirs — skip README.md at root)
    let rulesLangDirs = [];
    try {
        rulesLangDirs = fs.readdirSync(rulesDir);
    }
    catch { /* ignore */ }
    for (const langDir of rulesLangDirs) {
        if (langDir === 'README.md')
            continue;
        const dirPath = path.join(rulesDir, langDir);
        let stat;
        try {
            stat = fs.statSync(dirPath);
        }
        catch {
            continue;
        }
        if (!stat.isDirectory())
            continue;
        const rule = loadRule(dirPath, langDir);
        if (rule)
            combined.push(rule);
    }
    const skills = combined.filter((e) => e.type === 'skill');
    const rules = combined.filter((e) => e.type === 'rule');
    return {
        skills: combined,
        skillsCount: skills.length,
        rulesCount: rules.length,
        skillsDir,
        rulesDir,
    };
}
// ── HTTP server ────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'GET' && req.url) {
        const urlPath = req.url.split('?')[0];
        if (urlPath === '/skills' || urlPath === '/skills/') {
            try {
                const result = getSkillsData();
                res.end(JSON.stringify(result));
            }
            catch (err) {
                res.writeHead(500);
                res.end(JSON.stringify({ error: err.message }));
            }
            return;
        }
        if (urlPath === '/health') {
            res.end(JSON.stringify({ ok: true }));
            return;
        }
    }
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
});
server.listen(0, '127.0.0.1', () => {
    const addr = server.address();
    if (addr && typeof addr !== 'string') {
        console.log(JSON.stringify({ ready: true, port: addr.port }));
    }
});
//# sourceMappingURL=server.js.map