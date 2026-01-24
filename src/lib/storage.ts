import { createStore, del, get, keys, set } from 'idb-keyval';

const db = createStore('fanchant-memorizer', 'kv');

export const storage = {
  get: <T>(key: IDBValidKey) => get<T>(key, db),
  set: (key: IDBValidKey, value: unknown) => set(key, value, db),
  del: (key: IDBValidKey) => del(key, db),
  keys: () => keys(db),
};
