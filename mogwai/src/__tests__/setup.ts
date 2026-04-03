import "@testing-library/jest-dom/vitest";

const mockStorage: Record<string, string> = {};

Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string) => mockStorage[key] ?? null,
    setItem: (key: string, value: string) => { mockStorage[key] = value; },
    removeItem: (key: string) => { delete mockStorage[key]; },
    clear: () => { Object.keys(mockStorage).forEach(k => delete mockStorage[k]); },
    get length() { return Object.keys(mockStorage).length; },
    key: (i: number) => Object.keys(mockStorage)[i] ?? null,
  },
  writable: true,
});

Object.defineProperty(globalThis, "crypto", {
  value: {
    randomUUID: () => "00000000-0000-0000-0000-000000000000",
    getRandomValues: (arr: Uint8Array) => { arr.fill(0); return arr; },
  },
});
