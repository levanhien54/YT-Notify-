import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
});

function asArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function text(v) {
  if (v == null) return null;
  if (typeof v === 'object') return v['#text'] != null ? String(v['#text']) : null;
  return String(v);
}

function videoIdFromRef(ref) {
  if (!ref) return null;
  const m = String(ref).match(/yt:video:(.+)$/);
  return m ? m[1] : null;
}

export function parseAtom(xml) {
  if (!xml || !xml.trim()) return { entries: [], deleted: [] };
  let doc;
  try {
    doc = parser.parse(xml);
  } catch {
    return { entries: [], deleted: [] };
  }
  const feed = doc && doc.feed ? doc.feed : {};

  const entries = asArray(feed.entry).map((e) => ({
    videoId: text(e.videoId),
    channelId: text(e.channelId),
    title: text(e.title),
    author: e.author ? text(e.author.name) : null,
    published: text(e.published),
    updated: text(e.updated),
  }));

  const deleted = asArray(feed['deleted-entry']).map((d) => ({
    videoId: videoIdFromRef(d['@_ref']),
    channelId: null,
  }));

  return { entries, deleted };
}
