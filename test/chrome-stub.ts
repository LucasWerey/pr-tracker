type Area = Record<string, unknown>;

export interface ChromeStub {
  sync: Area;
  local: Area;
  badge: { text: string };
}

function area(data: Area) {
  return {
    async get(keys?: string | string[] | null): Promise<Area> {
      if (keys == null) return { ...data };
      const list = typeof keys === "string" ? [keys] : keys;
      const out: Area = {};
      for (const k of list) if (k in data) out[k] = data[k];
      return out;
    },
    async set(items: Area): Promise<void> {
      Object.assign(data, items);
    },
    async remove(keys: string | string[]): Promise<void> {
      for (const k of typeof keys === "string" ? [keys] : keys) delete data[k];
    },
  };
}

/** Installs a minimal in-memory `chrome` global; returns the backing stores for assertions. */
export function installChromeStub(initial: { sync?: Area; local?: Area } = {}): ChromeStub {
  const stub: ChromeStub = {
    sync: { ...initial.sync },
    local: { ...initial.local },
    badge: { text: "" },
  };
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      sync: area(stub.sync),
      local: area(stub.local),
      onChanged: { addListener() {} },
    },
    action: {
      setBadgeText: async ({ text }: { text: string }) => {
        stub.badge.text = text;
      },
      setBadgeBackgroundColor: async () => {},
    },
  };
  return stub;
}
