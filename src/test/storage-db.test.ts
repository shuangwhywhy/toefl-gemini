import { describe, expect, it, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { DBUtils } from '../services/storage/db';

describe('Storage DBUtils', () => {
  beforeEach(async () => {
    if (DBUtils.db) {
      DBUtils.db.close();
      DBUtils.db = null;
    }
  });

  it('initializes and creates object store', async () => {
    const db = await DBUtils.init();
    expect(db.name).toBe(DBUtils.dbName);
    expect(db.objectStoreNames.contains(DBUtils.storeName)).toBe(true);
  });

  it('sets and gets values', async () => {
    await DBUtils.set('test-key', { foo: 'bar' });
    const val = await DBUtils.get('test-key', null);
    expect(val).toEqual({ foo: 'bar' });
  });

  it('returns default value if key missing', async () => {
    const val = await DBUtils.get('non-existent', 'default');
    expect(val).toBe('default');
  });

  it('removes keys', async () => {
    await DBUtils.set('delete-me', 123);
    await DBUtils.remove('delete-me');
    const val = await DBUtils.get('delete-me', null);
    expect(val).toBe(null);
  });

  it('handles concurrent initializations', async () => {
    const [db1, db2] = await Promise.all([DBUtils.init(), DBUtils.init()]);
    expect(db1).toBeDefined();
    expect(db2).toBeDefined();
  });

  it('swallows errors during set/get/remove', async () => {
    vi.spyOn(DBUtils, 'init').mockRejectedValue(new Error('Init Failed'));
    
    // Should not throw
    await DBUtils.set('k', 'v');
    const val = await DBUtils.get('k', 'fallback');
    expect(val).toBe('fallback');
    await DBUtils.remove('k');
    
    vi.restoreAllMocks();
  });
});
