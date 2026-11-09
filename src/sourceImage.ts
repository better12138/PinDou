// 把最近一次导入的原图存在本地，刷新页面后改拼豆板尺寸仍能沿用同一套生成算法，
// 而不是退回到「缩放已量化的格子」。
const DATABASE_NAME = 'perler-beads-generator';
const STORE_NAME = 'source-image';
const RECORD_KEY = 'current';

export type StoredSourceImage = {
  blob: Blob;
  name: string;
  layerId: string;
};

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveSourceImage(blob: Blob, name: string, layerId: string): Promise<void> {
  try {
    const database = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put({ blob, name, layerId }, RECORD_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  } catch {
    // 隐私模式或存储被禁用时忽略：只影响刷新后能否重新生成。
  }
}

export async function loadSourceImage(): Promise<StoredSourceImage | null> {
  try {
    const database = await openDatabase();
    const record = await new Promise<StoredSourceImage | null>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).get(RECORD_KEY);
      request.onsuccess = () => resolve((request.result as StoredSourceImage | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return record && record.blob ? record : null;
  } catch {
    return null;
  }
}

export async function clearSourceImage(): Promise<void> {
  try {
    const database = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).delete(RECORD_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  } catch {
    // 忽略：清理失败不影响当前编辑。
  }
}

