// A tiny fake product for the capture tests: "Larkwork", a shift planner. It counts
// every request, so a test can prove a page that writes on load was never opened and a
// link was followed by its address rather than clicked.
import { createServer } from 'node:http';

const shell = (title, body, { workspace = 'Larkwork Demo', script = '' } = {}) => `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font:16px system-ui;margin:0;display:grid;grid-template-columns:220px 1fr;min-height:100vh}
aside{background:#eee;padding:16px}main{padding:24px}</style></head>
<body><aside>${workspace === null ? '' : `<button data-workspace>${workspace}</button>`}
<nav><a href="/app/home">Home</a></nav></aside><main>${body}</main>${script ? `<script>${script}</script>` : ''}</body></html>`;

export function startFixture() {
  const hits = {};
  let clicks = 0;
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    hits[url.pathname + url.search] = (hits[url.pathname + url.search] || 0) + 1;
    const send = (html, code = 200) => { res.writeHead(code, { 'content-type': 'text/html' }); res.end(html); };
    if (req.method === 'POST' && url.pathname === '/__clicked') { clicks++; res.writeHead(204); return res.end(); }
    switch (url.pathname) {
      case '/app/home':
        return send(shell('Home', `<h1>This week</h1>
          <div role="tablist"><button role="tab">Day</button><button role="tab">Week</button></div>
          <a href="/app/reports" id="trap">Reports</a>
          <a href="/app/schedule/new">New schedule</a>
          <a href="https://example.com/docs">Docs</a>
          <a href="/app/reports?invite=abc">Team report</a>`,
          // A click handler that would count: the capture must read the href, not click.
          { script: `document.getElementById('trap').addEventListener('click', (e) => { e.preventDefault(); fetch('/__clicked', { method: 'POST' }); });` }));
      case '/app/reports':
        return send(shell('Reports', '<h1>Weekly report</h1><p>Coverage 96%</p>'));
      case '/app/schedule/new':
        return send(shell('New', '<h1>Created a schedule</h1>')); // the write-on-load page
      case '/app/other':
        return send(shell('Other', '<h1>This week</h1>', { workspace: 'Customer Co' }));
      case '/app/lookalike':
        return send(shell('Lookalike', '<h1>Larkwork Demo</h1><p>Larkwork Demo</p>', { workspace: 'Larkwork Demo Customer' }));
      case '/app/nolock':
        return send(shell('No lock', '<h1>This week</h1>', { workspace: null }));
      case '/app/drift':
        return send(shell('Drift', '<h1>This week</h1>', {
          script: `setTimeout(() => { document.querySelector('[data-workspace]').textContent = 'Customer Co'; }, 3500);`,
        }));
      case '/app/sneaky':
        return send(shell('Sneaky', '<h1>One sec</h1>', { script: `setTimeout(() => { location.href = '/app/schedule/new'; }, 300);` }));
      case '/app/bounce':
        res.writeHead(302, { location: '/app/schedule/new' }); return res.end();
      case '/app/chain':
        res.writeHead(302, { location: '/app/hop' }); return res.end();
      case '/app/hop':
        res.writeHead(302, { location: '/app/schedule/new' }); return res.end();
      case '/app/moved':
        res.writeHead(302, { location: '/app/home' }); return res.end();
      case '/app/expired':
        res.writeHead(302, { location: '/signin' }); return res.end();
      case '/signin':
        return send('<!doctype html><h1>Sign in</h1>');
      default:
        return send('<!doctype html><h1>Not found</h1>', 404);
    }
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({
    url: `http://127.0.0.1:${server.address().port}`,
    hits,
    clicks: () => clicks,
    close: () => new Promise((done) => server.close(done)),
  })));
}
