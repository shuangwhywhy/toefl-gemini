type MaybeIDB = IDBDatabase | null;

export const DBUtils = {
  dbName: 'ToeflAI_DB',
  storeName: 'app_state',
  db: null as MaybeIDB,
  init: async function () {
    if (this.db) return this.db;
    return await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(this.dbName, 1);
      req.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName);
        }
      };
      req.onsuccess = (e) => {
        this.db = (e.target as IDBOpenDBRequest).result;
        resolve(this.db);
      };
      req.onerror = (e) => reject((e.target as IDBOpenDBRequest).error);
    });
  },
  get: async function <T>(key: string, defaultVal: T): Promise<T> {
    try {
      await this.init();
      return await new Promise<T>((resolve) => {
        const tx = this.db!.transaction(this.storeName, 'readonly');
        const req = tx.objectStore(this.storeName).get(key);
        req.onsuccess = () =>
          resolve(req.result !== undefined ? (req.result as T) : defaultVal);
        req.onerror = () => resolve(defaultVal);
      });
    } catch {
      return defaultVal;
    }
  },
  set: async function <T>(key: string, val: T) {
    try {
      await this.init();
      await new Promise<void>((resolve) => {
        const tx = this.db!.transaction(this.storeName, 'readwrite');
        const req = tx.objectStore(this.storeName).put(val, key);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
      });
    } catch {
      // Swallow persistence errors to preserve app flow.
    }
  },
  remove: async function (key: string) {
    try {
      await this.init();
      await new Promise<void>((resolve) => {
        const tx = this.db!.transaction(this.storeName, 'readwrite');
        const req = tx.objectStore(this.storeName).delete(key);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
      });
    } catch {
      // Swallow persistence errors to preserve app flow.
    }
  }
};
