import { complete, type CompleteBody } from '../server/suggest';
import { body, json, type Req, type Res } from './_http';

export default async function handler(req: Req, res: Res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
  json(res, 200, await complete(body<CompleteBody>(req)));
}
