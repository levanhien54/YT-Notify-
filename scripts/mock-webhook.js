import { buildSampleAtom, signBody } from './lib/sampleAtom.js';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) out[a.slice(2)] = argv[++i];
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = args.url || 'http://localhost:8787/webhook/youtube';
  const channelId = args.channel || 'UC_mock_channel';
  const videoId = args.video || `MOCK_${Date.now()}`;
  const secret = args.secret;
  if (!secret) {
    console.error('Missing --secret (must match the channel secret in the DB)');
    process.exit(1);
  }

  const xml = buildSampleAtom({ channelId, videoId, title: args.title || 'Mock Notification' });
  const signature = signBody(xml, secret);

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/atom+xml', 'X-Hub-Signature': signature },
    body: xml,
  });
  console.log(`POST ${url} -> ${res.status} (videoId=${videoId})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
