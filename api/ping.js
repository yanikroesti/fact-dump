/* Daily keep-alive (see "crons" in vercel.json). Supabase pauses free projects
   after a week without traffic, and a paused project would break every printed
   QR code — one tiny query a day keeps it awake. */

const SB_URL = 'https://ljkdibnkifzwydhqkzxt.supabase.co';
const SB_KEY = 'sb_publishable_1vEjb3RhVFo54KZM948PCA_A_9SpAgQ';

export async function GET() {
  try {
    const res = await fetch(`${SB_URL}/rest/v1/rpc/qr_ping`, {
      method: 'POST',
      headers: { apikey: SB_KEY, 'Content-Type': 'application/json' },
      body: '{}'
    });
    const db = await res.json().catch(() => null);
    return new Response(JSON.stringify({ ok: res.ok, db }), {
      status: res.ok ? 200 : 502,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
  }
}
