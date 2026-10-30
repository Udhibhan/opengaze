import { aiEnabled, MODEL } from '../server/suggest';
import { json, type Req, type Res } from './_http';

export default function handler(_req: Req, res: Res) {
  json(res, 200, { ok: true, ai: aiEnabled, model: MODEL });
}
