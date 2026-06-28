import crypto from 'node:crypto';

export function buildSampleAtom({
  channelId,
  videoId,
  title = 'Sample Video',
  published = new Date().toISOString(),
}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>yt:video:${videoId}</id>
    <yt:videoId>${videoId}</yt:videoId>
    <yt:channelId>${channelId}</yt:channelId>
    <title>${title}</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=${videoId}"/>
    <author><name>Mock Author</name><uri>https://www.youtube.com/channel/${channelId}</uri></author>
    <published>${published}</published>
    <updated>${published}</updated>
  </entry>
</feed>`;
}

export function signBody(body, secret) {
  return 'sha1=' + crypto.createHmac('sha1', secret).update(body).digest('hex');
}
