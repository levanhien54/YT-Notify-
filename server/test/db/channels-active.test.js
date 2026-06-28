import { describe, it, expect } from 'vitest';
import {
  initDb, addChannel, getChannel, listChannels,
  listActiveChannels, setChannelActive, removeChannel
} from '../../src/db/index.js';

function seed(db) {
  addChannel(db, { channelId: 'UC1', handle: '@a', title: 'A', thumbnail: '', secret: 's1' });
  addChannel(db, { channelId: 'UC2', handle: '@b', title: 'B', thumbnail: '', secret: 's2' });
}

describe('channels active/remove', () => {
  it('listActiveChannels excludes deactivated channels', () => {
    const db = initDb(':memory:');
    seed(db);
    setChannelActive(db, 'UC2', false);
    const active = listActiveChannels(db);
    expect(active.map((r) => r.channel_id)).toEqual(['UC1']);
  });

  it('setChannelActive flips the flag back to 1', () => {
    const db = initDb(':memory:');
    seed(db);
    setChannelActive(db, 'UC1', false);
    expect(getChannel(db, 'UC1').active).toBe(0);
    setChannelActive(db, 'UC1', true);
    expect(getChannel(db, 'UC1').active).toBe(1);
  });

  it('removeChannel deletes the row', () => {
    const db = initDb(':memory:');
    seed(db);
    removeChannel(db, 'UC1');
    expect(getChannel(db, 'UC1')).toBeUndefined();
    expect(listChannels(db)).toHaveLength(1);
  });
});
