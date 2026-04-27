/**
 * Skill Manager plugin — frontend entry point.
 *
 * Displays Claude Code skills and rules in a searchable, filterable panel.
 * Polls the backend server every 10 seconds for updates.
 */

import type { PluginAPI, PluginContext } from './types.js';

// ── Types ──────────────────────────────────────────────────────────────

interface SkillEntry {
  type: 'skill' | 'rule';
  name: string;
  description: string;
  origin: string;
  version: string;
  dirPath: string;
  fileCount: number;
  whenToUse?: string;
  effort?: string;
  model?: string;
  userInvocable?: boolean;
  paths?: string[];
  hooks?: Record<string, unknown>;
  language?: string;
  lastModified: number;
}

interface SkillsResponse {
  skills: SkillEntry[];
  skillsCount: number;
  rulesCount: number;
  skillsDir: string;
  rulesDir: string;
}

// ── Theme ─────────────────────────────────────────────────────────────

interface ThemeColors {
  bg: string;
  surface: string;
  surface2: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  mono: string;
  tag: string;
  tagText: string;
  error: string;
}

const MONO_FONT = "'JetBrains Mono', 'Fira Code', ui-monospace, monospace";

function themeColors(dark: boolean): ThemeColors {
  return dark
    ? {
        bg: '#08080f',
        surface: '#0e0e1a',
        surface2: '#13131f',
        border: '#1a1a2c',
        text: '#e2e0f0',
        muted: '#52507a',
        accent: '#fbbf24',
        tag: 'rgba(251,191,36,0.12)',
        tagText: '#fbbf24',
        mono: MONO_FONT,
        error: '#f43f5e',
      }
    : {
        bg: '#fafaf9',
        surface: '#ffffff',
        surface2: '#f4f3ef',
        border: '#e8e6f0',
        text: '#0f0e1a',
        muted: '#9490b0',
        accent: '#d97706',
        tag: 'rgba(217,119,6,0.10)',
        tagText: '#d97706',
        mono: MONO_FONT,
        error: '#dc2626',
      };
}

const MONO = "'JetBrains Mono', 'Fira Code', ui-monospace, monospace";

// ── Helpers ────────────────────────────────────────────────────────────

function ago(ms: number): string {
  if (!ms) return 'unknown';
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 2592000) return `${Math.floor(s / 86400)}d ago`;
  return `${Math.floor(s / 2592000)}mo ago`;
}

function truncate(str: string, max = 80): string {
  if (!str) return '';
  const s = str.trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

const ORIGIN_COLORS: Record<string, string> = {
  ecc: '#a78bfa',
  common: '#60a5fa',
  '': '#9ca3af',
};

function originBadge(origin: string, c: ThemeColors): string {
  const color = ORIGIN_COLORS[origin.toLowerCase()] ?? c.muted;
  const label = origin || 'unknown';
  return `<span style="
    display:inline-block;font-size:0.58rem;font-weight:600;
    padding:2px 7px;border-radius:3px;
    background:${color}22;color:${color};
    border:1px solid ${color}44;
    letter-spacing:0.06em;text-transform:uppercase;
  ">${label}</span>`;
}

function effortColor(effort: string): string {
  const map: Record<string, string> = {
    low: '#34d399',
    medium: '#60a5fa',
    high: '#fbbf24',
    max: '#f43f5e',
  };
  return map[effort.toLowerCase()] ?? '#9ca3af';
}

type FilterTab = 'all' | 'skills' | 'rules';

function filterBadge(filter: FilterTab, active: FilterTab, count: number, c: ThemeColors): string {
  const isActive = filter === active;
  return `<button
    data-filter="${filter}"
    style="
      padding:4px 14px;font-size:0.7rem;font-weight:${isActive ? 600 : 400};
      font-family:${MONO};cursor:pointer;border-radius:4px;
      border:1px solid ${isActive ? c.accent : c.border};
      background:${isActive ? c.accent + '18' : 'transparent'};
      color:${isActive ? c.accent : c.muted};
      transition:all 0.15s;letter-spacing:0.03em;
    "
  >${filter === 'all' ? 'All' : filter === 'skills' ? 'Skills' : 'Rules'} <span style="opacity:0.6">${count}</span></button>`;
}

function skillCard(s: SkillEntry, c: ThemeColors): string {
  const isSkill = s.type === 'skill';
  const icon = isSkill ? '⚡' : '📐';
  const shortPath = s.dirPath.replace(/\\/g, '/').replace(/\//g, ' / ').split(' / ').slice(-3).join(' / ');

  let detailHtml = '';
  if (isSkill && (s.whenToUse || s.paths?.length || s.model || s.hooks)) {
    const details: string[] = [];
    if (s.whenToUse) details.push(`<div style="margin-bottom:6px"><span style="font-size:0.62rem;color:${c.muted}">when</span><div style="font-size:0.68rem;line-height:1.4;opacity:0.8">${truncate(s.whenToUse, 160)}</div></div>`);
    if (s.model) details.push(`<div style="font-size:0.65rem;color:${c.muted}">model: <span style="color:${c.text};opacity:0.7">${s.model}</span></div>`);
    if (s.paths?.length) details.push(`<div style="font-size:0.65rem;color:${c.muted}">paths: <span style="color:${c.text};opacity:0.7">${s.paths.slice(0, 3).join(', ')}${s.paths.length > 3 ? '…' : ''}</span></div>`);
    if (s.hooks && Object.keys(s.hooks).length > 0) details.push(`<div style="font-size:0.65rem;color:${c.muted}">hooks: <span style="color:${c.text};opacity:0.7">${Object.keys(s.hooks).join(', ')}</span></div>`);

    if (details.length) {
      detailHtml = `<div style="margin-top:10px;padding-top:10px;border-top:1px solid ${c.border};display:flex;flex-direction:column;gap:4px">${details.join('')}</div>`;
    }
  } else if (!isSkill && s.language) {
    detailHtml = `<div style="margin-top:8px;font-size:0.65rem;color:${c.muted}">${s.fileCount} rule${s.fileCount !== 1 ? 's' : ''}</div>`;
  }

  return `
    <div class="sm-card" data-type="${s.type}" data-name="${s.name}" style="
      background:${c.surface};border:1px solid ${c.border};
      border-radius:6px;padding:14px 16px;
      margin-bottom:8px;
      cursor:default;
      transition:border-color 0.15s;
    "
    onmouseover="this.style.borderColor='${c.accent}44'"
    onmouseout="this.style.borderColor='${c.border}'"
    >
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:6px">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span style="font-size:0.75rem">${icon}</span>
          <span style="font-size:0.8rem;font-weight:600;letter-spacing:-0.01em">${s.name}</span>
          ${s.origin ? originBadge(s.origin, c) : ''}
          ${isSkill && s.effort ? `<span style="font-size:0.6rem;color:${effortColor(s.effort)};font-weight:500">${s.effort}</span>` : ''}
          ${isSkill && s.version ? `<span style="font-size:0.58rem;color:${c.muted}">v${s.version}</span>` : ''}
          ${!isSkill ? `<span style="font-size:0.6rem;color:${c.muted};font-family:${MONO}">${s.language}</span>` : ''}
        </div>
        <div style="font-size:0.6rem;color:${c.muted};white-space:nowrap;flex-shrink:0;margin-top:2px">${ago(s.lastModified)}</div>
      </div>
      <div style="font-size:0.7rem;line-height:1.5;color:${c.muted}">${truncate(s.description, 120) || '<em style="opacity:0.4">no description</em>'}</div>
      <div style="font-size:0.58rem;color:${c.muted};margin-top:8px;font-family:${MONO};opacity:0.5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${s.dirPath}">${shortPath}</div>
      ${detailHtml}
    </div>
  `;
}

// ── Styles ─────────────────────────────────────────────────────────────

function ensureStyles(): void {
  if (document.getElementById('skm-styles')) return;
  const s = document.createElement('style');
  s.id = 'skm-styles';
  s.textContent = `
    @keyframes skm-fadeup {
      from { opacity:0; transform:translateY(6px) }
      to   { opacity:1; transform:translateY(0) }
    }
    @keyframes skm-pulse {
      0%,100% { opacity:0.3 }
      50%      { opacity:0.6 }
    }
    @keyframes skm-spin {
      to { transform:rotate(360deg) }
    }
    .skm-up { animation: skm-fadeup 0.3s ease both }
  `;
  document.head.appendChild(s);
}

// ── Render ─────────────────────────────────────────────────────────────

let currentFilter: FilterTab = 'all';
let searchQuery = '';

function render(
  root: HTMLElement,
  data: SkillsResponse | null,
  loading: boolean,
  error: string | null,
  ctx: PluginContext
): void {
  const c = themeColors(ctx.theme === 'dark');
  root.style.background = c.bg;
  root.style.color = c.text;
  root.style.fontFamily = MONO;

  // Filter skills
  let filtered: SkillEntry[] = [];
  if (data) {
    filtered = data.skills.filter((s) => {
      if (currentFilter === 'skills' && s.type !== 'skill') return false;
      if (currentFilter === 'rules' && s.type !== 'rule') return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          s.name.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.origin.toLowerCase().includes(q) ||
          (s.whenToUse ?? '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }

  const skillsCount = data?.skillsCount ?? 0;
  const rulesCount = data?.rulesCount ?? 0;
  const totalCount = skillsCount + rulesCount;

  // Preserve scroll position across re-renders
  const contentEl = root.querySelector('#skm-content');
  const savedScrollTop = contentEl ? contentEl.scrollTop : root.scrollTop;

  root.innerHTML = `
    <div style="height:100%;display:flex;flex-direction:column;overflow:hidden">

      <!-- Header -->
      <div style="
        display:flex;align-items:center;justify-content:space-between;
        padding:16px 20px 12px;
        border-bottom:1px solid ${c.border};flex-shrink:0;
      ">
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:1rem;font-weight:700;letter-spacing:-0.02em">Skills</span>
          ${loading ? `<span style="
            display:inline-block;width:11px;height:11px;
            border:1.5px solid ${c.muted};border-top-color:${c.accent};
            border-radius:50%;animation:skm-spin 0.7s linear infinite;
          "></span>` : ''}
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:0.65rem;color:${c.muted};letter-spacing:0.04em">
            ${totalCount} total · ${skillsCount} skills · ${rulesCount} rules
          </span>
          <button id="skm-refresh-btn" style="
            background:none;border:1px solid ${c.border};cursor:pointer;
            color:${c.muted};padding:4px 8px;border-radius:4px;
            font-family:${MONO};font-size:0.65rem;display:flex;align-items:center;gap:4px;
            transition:all 0.15s;
          " title="Refresh">
            ↻
          </button>
        </div>
      </div>

      <!-- Search + Filters -->
      <div style="
        display:flex;align-items:center;gap:10px;
        padding:10px 20px;
        border-bottom:1px solid ${c.border};flex-shrink:0;
      ">
        <div style="position:relative;flex:1">
          <input
            id="skm-search"
            type="text"
            placeholder="search skills & rules…"
            value="${escHtml(searchQuery)}"
            style="
              width:100%;box-sizing:border-box;
              padding:6px 12px 6px 30px;
              background:${c.surface2};border:1px solid ${c.border};
              border-radius:4px;color:${c.text};
              font-family:${MONO};font-size:0.72rem;
              outline:none;transition:border-color 0.15s;
            "
            onfocus="this.style.borderColor='${c.accent}'"
            onblur="this.style.borderColor='${c.border}'"
          />
          <span style="
            position:absolute;left:10px;top:50%;transform:translateY(-50%);
            font-size:0.7rem;opacity:0.4;
          ">⌕</span>
        </div>
        <div style="display:flex;gap:6px">
          ${filterBadge('all', currentFilter, totalCount, c)}
          ${filterBadge('skills', currentFilter, skillsCount, c)}
          ${filterBadge('rules', currentFilter, rulesCount, c)}
        </div>
      </div>

      <!-- Content -->
      <div id="skm-content" style="flex:1;overflow-y:auto;padding:12px 20px">
        ${error ? `
          <div style="padding:20px;font-size:0.75rem;color:${c.error};opacity:0.85">
            ✗ ${escHtml(error)}
          </div>
        ` : loading && !data ? `
          ${[65, 40, 55, 35, 50].map((w, i) => `
            <div style="
              background:${c.surface};border:1px solid ${c.border};
              border-radius:6px;padding:14px 16px;margin-bottom:8px;
            ">
              <div style="
                height:10px;background:${c.muted};border-radius:2px;opacity:0.2;
                width:${w}%;margin-bottom:8px;
                animation:skm-pulse 1.6s ease infinite;animation-delay:${i * 0.1}s
              "></div>
              <div style="
                height:8px;background:${c.muted};border-radius:2px;opacity:0.12;
                width:${Math.max(20, w - 25)}%;
                animation:skm-pulse 1.6s ease infinite;animation-delay:${i * 0.1 + 0.08}s
              "></div>
            </div>
          `).join('')}
        ` : !data || filtered.length === 0 ? `
          <div style="
            display:flex;flex-direction:column;align-items:center;justify-content:center;
            height:50%;gap:10px;color:${c.muted};text-align:center;
          ">
            <div style="font-size:0.72rem;opacity:0.4">
              ${searchQuery ? 'no results for "' + escHtml(searchQuery) + '"' : 'no skills found'}
            </div>
          </div>
        ` : filtered.map((s, i) => `
          <div class="skm-up" style="animation-delay:${Math.min(i * 0.025, 0.5)}s">
            ${skillCard(s, c)}
          </div>
        `).join('')}
      </div>
    </div>
  `;

  // Wire search input
  const searchInput = root.querySelector<HTMLInputElement>('#skm-search');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      searchQuery = searchInput.value;
      render(root, data, false, error, ctx);
    });
  }

  // Wire filter buttons
  for (const btn of Array.from(root.querySelectorAll<HTMLButtonElement>('[data-filter]'))) {
    btn.addEventListener('click', () => {
      currentFilter = btn.dataset.filter as FilterTab;
      render(root, data, false, error, ctx);
    });
  }

  // Restore scroll position after re-render
  const newContent = root.querySelector('#skm-content');
  if (newContent) {
    newContent.scrollTop = savedScrollTop;
  } else {
    root.scrollTop = savedScrollTop;
  }
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Mount / Unmount ────────────────────────────────────────────────────


export function mount(container: HTMLElement, api: PluginAPI): void {
  ensureStyles();

  const root = document.createElement('div');
  Object.assign(root.style, {
    height: '100%',
    boxSizing: 'border-box',
    overflow: 'hidden',
  });
  container.appendChild(root);

  let cached: SkillsResponse | null = null;
  let loading = false;
  let lastError: string | null = null;
  let firstLoad = true;
  let currentProjectPath: string | null = null;

  async function loadData(): Promise<void> {
    // Only show skeleton on first load — keep old content visible during refresh
    if (firstLoad) {
      loading = true;
      firstLoad = false;
    }
    render(root, cached, loading, lastError, api.context);

    try {
      const data = (await api.rpc('GET', 'skills')) as SkillsResponse;
      cached = data;
      lastError = null;
      loading = false;
      render(root, data, false, null, api.context);
    } catch (err) {
      lastError = (err as Error).message;
      render(root, cached, false, lastError, api.context);
    } finally {
      loading = false;
    }
  }

  currentProjectPath = api.context.project?.path ?? null;
  loadData();

  // Wire refresh button
  root.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('#skm-refresh-btn');
    if (btn) {
      firstLoad = true;
      loadData();
    }
  });

  const unsubscribe = api.onContextChange(() => {
    const newProjectPath = api.context.project?.path ?? null;
    if (newProjectPath !== currentProjectPath) {
      currentProjectPath = newProjectPath;
      firstLoad = true;
      loadData();
    }
  });

  (container as any)._skmUnsubscribe = unsubscribe;
}

export function unmount(container: HTMLElement): void {
  if (typeof (container as any)._skmUnsubscribe === 'function') {
    (container as any)._skmUnsubscribe();
    delete (container as any)._skmUnsubscribe;
  }
  container.innerHTML = '';
}
