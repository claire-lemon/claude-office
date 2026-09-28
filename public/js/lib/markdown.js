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
