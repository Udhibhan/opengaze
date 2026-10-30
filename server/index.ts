// Tiny local proxy: holds ANTHROPIC_API_KEY (from .env) so the browser never sees it.
// Request bodies are used only to build the prompt; nothing is logged or stored.
import 'dotenv/config';
import express from 'express';
import { aiEnabled, complete, MODEL, suggest } from './suggest';

const app = express();
app.use(express.json({ limit: '32kb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ai: aiEnabled, model: MODEL });
});

app.post('/api/suggest', async (req, res) => {
  res.json(await suggest(req.body ?? {}));
});

app.post('/api/complete', async (req, res) => {
  res.json(await complete(req.body ?? {}));
});

const port = Number(process.env.API_PORT || 8787);
app.listen(port, '127.0.0.1', () => {
  console.log(
    `[opengaze api] http://127.0.0.1:${port}  model=${MODEL}  ai=${aiEnabled ? 'on' : 'off (no ANTHROPIC_API_KEY; using offline phrase bank)'}`,
  );
});
