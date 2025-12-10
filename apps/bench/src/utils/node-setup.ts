// Mock для localStorage и других browser APIs в Node.js окружении

if (typeof localStorage === 'undefined') {
  class LocalStorageMock {
    private store: Map<string, string> = new Map();

    getItem(key: string): string | null {
      return this.store.get(key) ?? null;
    }

    setItem(key: string, value: string): void {
      this.store.set(key, value);
    }

    removeItem(key: string): void {
      this.store.delete(key);
    }

    clear(): void {
      this.store.clear();
    }

    get length(): number {
      return this.store.size;
    }

    key(index: number): string | null {
      return Array.from(this.store.keys())[index] ?? null;
    }
  }

  (global as any).localStorage = new LocalStorageMock();
  (global as any).sessionStorage = new LocalStorageMock();
}

// Mock для window если нужно
if (typeof window === 'undefined') {
  (global as any).window = {
    localStorage: (global as any).localStorage,
    sessionStorage: (global as any).sessionStorage,
  };
}

// Экспортируем для явного импорта если нужно
export {};

