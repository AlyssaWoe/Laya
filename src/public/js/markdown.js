/* Small, safe Markdown renderer for versioned SKILL.md and policy documents. */

export function miniMarkdown(raw) {
  const lines = String(raw || '').split(/\r?\n/);
  let html = '';
  let inCode = false;
  let inList = false;
  const closeList = () => { if (inList) { html += '</ul>'; inList = false; } };
  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      closeList();
      if (inCode) { html += '</code></pre>'; inCode = false; }
      else { html += '<pre class="json-block"><code>'; inCode = true; }
      continue;
    }
    if (inCode) { html += `${esc(line)}\n`; continue; }
    const trimmed = line.trim();
    if (!trimmed) { closeList(); continue; }
    if (/^#{1,6}\s/.test(trimmed)) {
      closeList();
      const level = Math.min(4, trimmed.match(/^#+/)[0].length);
      html += `<h${level + 1}>${inline(trimmed.replace(/^#+\s*/, ''))}</h${level + 1}>`;
      continue;
    }
    if (/^[-*]\s+/.test(trimmed)) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${inline(trimmed.replace(/^[-*]\s+/, ''))}</li>`;
      continue;
    }
    if (/^\d+\.\s+/.test(trimmed)) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${inline(trimmed.replace(/^\d+\.\s+/, ''))}</li>`;
      continue;
    }
    closeList();
    html += `<p>${inline(trimmed)}</p>`;
  }
  closeList();
  if (inCode) html += '</code></pre>';
  return html;
}

function inline(text) {
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
