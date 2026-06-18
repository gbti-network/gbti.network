// A tiny self-contained HTML test page, served (unauthenticated) at GET /. It carries no data itself —
// it calls the API from the browser with the key you paste in (kept in localStorage), so it works
// same-origin both locally (`npm run dev` -> http://localhost:8787) and in production. Edit freely.

export const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>GBTI News — test console</title>
<style>
  :root { color-scheme: light dark; --b:#888; }
  body { font: 15px/1.5 system-ui, sans-serif; max-width: 880px; margin: 0 auto; padding: 1rem; }
  h1 { font-size: 1.3rem; }
  header.bar { display:flex; gap:.5rem; flex-wrap:wrap; align-items:center; margin-bottom:1rem; }
  input, select, button { font: inherit; padding:.4rem .5rem; border:1px solid var(--b); border-radius:6px; background:transparent; color:inherit; }
  input#key { flex:1; min-width:220px; }
  button { cursor:pointer; }
  .row { display:flex; gap:.5rem; flex-wrap:wrap; align-items:center; margin-bottom:.75rem; }
  .meta { color:#888; font-size:.85rem; }
  article { border-top:1px solid #8884; padding:.6rem 0; }
  article a { font-weight:600; text-decoration:none; color:inherit; }
  article a:hover { text-decoration:underline; }
  .tags { font-size:.8rem; color:#888; margin-top:.2rem; }
  .cat { display:inline-block; padding:0 .4rem; border:1px solid #8884; border-radius:10px; }
  #status { color:#c0392b; }
</style>
</head>
<body>
<h1>GBTI News — test console</h1>
<header class="bar">
  <input id="key" type="password" placeholder="API key (Bearer NEWS_API_KEY)" />
  <button id="save">Save key</button>
  <span id="status"></span>
</header>
<div class="row">
  <select id="category"><option value="">All categories</option></select>
  <select id="source"><option value="">All sources</option></select>
  <input id="limit" type="number" value="25" min="1" max="100" style="width:5rem" />
  <button id="load">Load feed</button>
  <span class="meta" id="summary"></span>
</div>
<div id="items"></div>

<script>
const $ = (s) => document.querySelector(s);
const base = location.origin; // same-origin: works locally and in prod
let key = localStorage.getItem('gbti_news_key') || '';
$('#key').value = key;
$('#save').onclick = () => { key = $('#key').value.trim(); localStorage.setItem('gbti_news_key', key); status('Key saved.'); init(); };
function status(m, err=false){ const s=$('#status'); s.textContent=m||''; s.style.color = err ? '#c0392b' : '#27ae60'; }

async function api(path) {
  const res = await fetch(base + path, { headers: { Authorization: 'Bearer ' + key } });
  if (!res.ok) throw new Error(res.status + ' ' + res.statusText);
  return res.json();
}

async function init() {
  if (!key) { status('Enter your API key to begin.', true); return; }
  try {
    const [cats, srcs] = await Promise.all([api('/categories'), api('/sources')]);
    fill('#category', cats.categories.map(c => [c.name, \`\${c.name} (\${c.count})\`]));
    fill('#source', srcs.sources.filter(s => s.count > 0).map(s => [s.id, \`\${s.name} (\${s.count})\`]));
    status('Connected.');
    load();
  } catch (e) { status('Auth/connection failed: ' + e.message, true); }
}
function fill(sel, pairs) {
  const el = $(sel); const first = el.options[0];
  el.innerHTML = ''; el.appendChild(first);
  for (const [v, label] of pairs) { const o=document.createElement('option'); o.value=v; o.textContent=label; el.appendChild(o); }
}

async function load() {
  if (!key) { status('Enter your API key to begin.', true); return; }
  const q = new URLSearchParams();
  if ($('#category').value) q.set('category', $('#category').value);
  if ($('#source').value) q.set('source', $('#source').value);
  q.set('limit', $('#limit').value || '25');
  try {
    const data = await api('/feed?' + q.toString());
    $('#summary').textContent = \`\${data.count} items · updated \${data.updatedAt ? new Date(data.updatedAt*1000).toLocaleString() : 'never'}\`;
    $('#items').innerHTML = data.items.map(it => \`
      <article>
        <a href="\${it.link}" target="_blank" rel="noopener">\${esc(it.title)}</a>
        <div class="tags"><span class="cat">\${esc(it.category)}</span> · \${esc(it.source)} · \${it.publishedAt ? new Date(it.publishedAt*1000).toLocaleString() : ''}</div>
      </article>\`).join('') || '<p class="meta">No items yet — run an ingest (POST /refresh) or wait for the hourly cron.</p>';
  } catch (e) { status('Load failed: ' + e.message, true); }
}
function esc(s){ return String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

$('#load').onclick = load;
init();
</script>
</body>
</html>`;
