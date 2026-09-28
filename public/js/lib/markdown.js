// markdown viewer (no deps; escape first, then format). Pure string -> string, no DOM access,
// so it can be imported straight into a Node test. lib/ imports nothing, so escapeHtml is
// duplicated here rather than shared with lib/dom.js.
const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const fmtInline = t => t
  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  .replace(/~~(.+?)~~/g, '<del>$1</del>')
  .replace(/(^|[^*\w])\*(?!\s)([^*]+?)\*(?!\w)/g, '$1<em>$2</em>')
  .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
export const inlineMd = s => escapeHtml(s)
  .split(/(`[^`]+`)/)
  .map(part => /^`[^`]+`$/.test(part) ? `<code>${part.slice(1, -1)}</code>` : fmtInline(part))
  .join('');

const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const isTableSep = l => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(l);
const cells = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());

const renderList = items => {
  const ordered = /\d/.test(items[0].marker);
  const base = items[0].indent;
  const groups = items.reduce((acc, it) => {
    if (it.indent <= base || !acc.length) acc.push({ ...it, children: [] });
    else acc[acc.length - 1].children.push(it);
    return acc;
  }, []);
  const lis = groups.map(g => {
    const task = g.text.match(/^\[([ xX])\]\s+(.*)$/);
    const body = task
      ? `<input type="checkbox" disabled${task[1] !== ' ' ? ' checked' : ''}> ${inlineMd(task[2])}`
      : inlineMd(g.text);
    return `<li${task ? ' class="task"' : ''}>${body}${g.children.length ? renderList(g.children) : ''}</li>`;
  }).join('');
  return ordered ? `<ol>${lis}</ol>` : `<ul>${lis}</ul>`;
};

export const renderMarkdown = text => {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const out = [];
  const st = { i: 0 };
  const take = pred => {
    const got = [];
    while (st.i < lines.length && pred(lines[st.i], st.i)) got.push(lines[st.i++]);
    return got;
  };
  while (st.i < lines.length) {
    const line = lines[st.i];
    const fence = line.match(/^\s*(```|~~~)\s*([\w-]*)/);
    if (fence) {
      st.i++;
      const code = take(l => !l.trim().startsWith(fence[1]));
      st.i++;
      out.push(`<pre class="md-code"${fence[2] ? ` data-lang="${escapeHtml(fence[2])}"` : ''}><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }
    if (!line.trim()) { st.i++; continue; }
    const h = line.match(/^\s*(#{1,6})\s+(.*)$/);
    if (h) { st.i++; out.push(`<h${Math.min(h[1].length + 2, 6)}>${inlineMd(h[2])}</h${Math.min(h[1].length + 2, 6)}>`); continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { st.i++; out.push('<hr>'); continue; }
    if (line.includes('|') && isTableSep(lines[st.i + 1] || '')) {
      const head = cells(line);
      st.i += 2;
      const rows = take(l => l.includes('|') && l.trim()).map(cells);
      out.push(`<div class="md-table"><table><thead><tr>${head.map(c => `<th>${inlineMd(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${head.map((_, k) => `<td>${inlineMd(r[k] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quoted = take(l => /^\s*>/.test(l)).map(l => l.replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>${renderMarkdown(quoted.join('\n'))}</blockquote>`);
      continue;
    }
    if (LIST_RE.test(line)) {
      const items = take(l => LIST_RE.test(l) || (/^\s{2,}\S/.test(l) && !!l.trim()))
        .reduce((acc, l) => {
          const m = l.match(LIST_RE);
          if (m) acc.push({ indent: m[1].replace(/\t/g, '  ').length, marker: m[2], text: m[3] });
          else if (acc.length) acc[acc.length - 1].text += ` ${l.trim()}`;
          return acc;
        }, []);
      // "- a" followed by "1. b" at the same level are two lists, not one.
      const base = items[0].indent;
      const runs = items.reduce((acc, it) => {
        const ord = /\d/.test(it.marker);
        const last = acc[acc.length - 1];
        if (!last || (it.indent <= base && last.ord !== ord)) acc.push({ ord, items: [it] });
        else last.items.push(it);
        return acc;
      }, []);
      out.push(runs.map(r => renderList(r.items)).join(''));
      continue;
    }
    const para = take((l, i) => l.trim() && !LIST_RE.test(l) && !/^\s*(#{1,6}\s|>|```|~~~)/.test(l)
      && !isTableSep(l) && !(l.includes('|') && isTableSep(lines[i + 1] || '')));
    const shown = para.length ? para : [lines[st.i++]];
    out.push(`<p>${shown.map(l => inlineMd(l.trim())).join('<br>')}</p>`);
  }
  return out.join('');
};

// ---------- YAML frontmatter (file previews in the changes tab) ----------
// Just enough YAML for note headers: `key: value`, quoted strings, `- item` lists, `[a, b]`,
// block scalars (| >) and indented continuation lines. Anything else stays plain text.
const FM_KEY = /^([A-Za-z_][\w.-]*):(?:\s+(.*))?$/;
const unquote = v => (v.match(/^(["'])(.*)\1$/) || [null, null, v])[2];
const inlineList = v => (/^\[.*\]$/.test(v) ? v.slice(1, -1).split(',').map(x => unquote(x.trim())).filter(Boolean) : null);

// -> { meta: [{ key, value: string | string[] }] | null, body }. meta is null unless the text opens
// with a closed --- block whose top-level lines are all `key:` (so a leading --- rule isn't eaten).
export const splitFrontmatter = text => {
  const src = String(text || '').replace(/\r/g, '');
  const lines = src.split('\n');
  const none = { meta: null, body: src };
  if (lines[0].trim() !== '---') return none;
  const end = lines.findIndex((l, i) => i > 0 && /^(---|\.\.\.)\s*$/.test(l));
  if (end < 2) return none;
  const block = lines.slice(1, end);
  if (block.some(l => l.trim() && !/^\s/.test(l) && !/^-\s/.test(l) && !FM_KEY.test(l))) return none;
  const entries = block.reduce((acc, l) => {
    const key = l.trim() && !/^\s/.test(l) && l.match(FM_KEY);
    const last = acc[acc.length - 1];
    if (key) acc.push({ key: key[1], raw: (key[2] || '').trim(), items: [], text: [] });
    else if (last && l.trim()) {
      const item = l.match(/^\s*-\s+(.*)$/);
      if (item) last.items.push(unquote(item[1].trim()));
      else last.text.push(l.trim());
    }
    return acc;
  }, []);
  if (!entries.length) return none;
  const meta = entries.map(e => {
    const scalar = [/^[|>][-+]?$/.test(e.raw) ? '' : e.raw, ...e.text].filter(Boolean).join(' ');
    return { key: e.key, value: e.items.length ? e.items : inlineList(e.raw) ?? unquote(scalar) };
  });
  return { meta, body: lines.slice(end + 1).join('\n') };
};

// Obsidian-style [[path|label]] shows its label, [[path]] its path.
const wikiLabel = s => s.replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2').replace(/\[\[([^\]]*)\]\]/g, '$1');
const fmValue = v => (Array.isArray(v)
  ? (v.length ? `<ul>${v.map(x => `<li>${inlineMd(wikiLabel(x))}</li>`).join('')}</ul>` : '')
  : v ? inlineMd(wikiLabel(v)) : '<span class="md-fm-empty">-</span>');

export const renderFrontmatter = meta =>
  `<div class="md-table md-frontmatter"><table><tbody>${meta.map(m => `<tr><th>${escapeHtml(m.key)}</th><td>${fmValue(m.value)}</td></tr>`).join('')}</tbody></table></div>`;

// A whole .md file: the frontmatter as a small key/value table, then the body.
export const renderDocument = text => {
  const { meta, body } = splitFrontmatter(text);
  return (meta ? renderFrontmatter(meta) : '') + renderMarkdown(body);
};
