/* Daily keep-alive (see "crons" in vercel.json). Supabase pauses free projects
   after a week without traffic. A paused school project would break every printed
   QR code, a paused easel project would break Easel sync and share links — one tiny
   query a day each keeps them awake. */

const TARGETS = [
  { name: 'qr-studio', url: 'https://ljkdibnkifzwydhqkzxt.supabase.co', key: 'sb_publishable_1vEjb3RhVFo54KZM948PCA_A_9SpAgQ', rpc: 'qr_ping' },
  { name: 'easel', url: 'https://vcglqoqtcsiqfjutizib.supabase.co', key: 'sb_publishable_fbTatnQ1Dpu9uhTWI0hMEA_1FizA6MU', rpc: 'easel_ping' },
];

async function ping(t) {
  try {
    const res = await fetch(`${t.url}/rest/v1/rpc/${t.rpc}`, {
      method: 'POST',
      headers: { apikey: t.key, 'Content-Type': 'application/json' },
      body: '{}'
    });
    return { name: t.name, ok: res.ok, db: await res.json().catch(() => null) };
  } catch (e) {
    return { name: t.name, ok: false };
  }
}

export async function GET() {
  const results = await Promise.all(TARGETS.map(ping));
  const ok = results.every(r => r.ok);
  return new Response(JSON.stringify({ ok, results }), {
    status: ok ? 200 : 502,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}
