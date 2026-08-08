const DEFAULT_MAX_TABS = 10;

// --- last-used tracking -----------------------------------------------------
// Tab IDs and usage times live in storage.session so they survive service
// worker suspension but reset with the browser (tab IDs are not stable
// across restarts anyway).

async function getSession(key, fallback) {
  const data = await chrome.storage.session.get(key);
  return data[key] ?? fallback;
}

async function touchTab(tabId) {
  const lastUsed = await getSession("lastUsed", {});
  lastUsed[tabId] = Date.now();
  await chrome.storage.session.set({ lastUsed });
}

async function forgetTab(tabId) {
  const [lastUsed, protectedIds, tabHosts] = await Promise.all([
    getSession("lastUsed", {}),
    getSession("protectedIds", []),
    getSession("tabHosts", {}),
  ]);
  delete lastUsed[tabId];
  delete tabHosts[tabId];
  await chrome.storage.session.set({
    lastUsed,
    tabHosts,
    protectedIds: protectedIds.filter((id) => id !== tabId),
  });
}

// --- domain rules -----------------------------------------------------------
// domainRules (sync storage) maps a domain to its max tab count, e.g.
// { "x.com": 1 }. When a tab newly lands on a tagged domain and the domain
// is over its cap, the least-recently-used tab of that domain is closed —
// independent of the per-window limit.

function hostnameOf(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.hostname.replace(/^www\./, "");
  } catch (e) {
    return null;
  }
}

function matchRule(hostname, domainRules) {
  if (!hostname) return null;
  for (const domain of Object.keys(domainRules)) {
    if (hostname === domain || hostname.endsWith("." + domain)) return domain;
  }
  return null;
}

async function enforceDomainLimit(domain, newTabId) {
  const { domainRules = {} } = await chrome.storage.sync.get("domainRules");
  const limit = parseInt(domainRules[domain], 10);
  if (!Number.isFinite(limit) || limit < 1) return;

  const [lastUsed, protectedIds, tabs] = await Promise.all([
    getSession("lastUsed", {}),
    getSession("protectedIds", []),
    chrome.tabs.query({}),
  ]);

  const domainTabs = tabs.filter(
    (t) => matchRule(hostnameOf(t.url || t.pendingUrl), { [domain]: limit }) === domain
  );
  let excess = domainTabs.length - limit;
  if (excess <= 0) return;

  const candidates = domainTabs
    .filter(
      (t) =>
        !t.pinned &&
        !t.active &&
        !t.audible &&
        t.id !== newTabId &&
        !protectedIds.includes(t.id)
    )
    .sort(
      (a, b) =>
        (lastUsed[a.id] ?? a.lastAccessed ?? a.index) -
        (lastUsed[b.id] ?? b.lastAccessed ?? b.index)
    );

  for (const tab of candidates) {
    if (excess <= 0) break;
    try {
      await chrome.tabs.remove(tab.id);
      excess--;
    } catch (e) {
      // Tab may already be gone; skip it.
    }
  }
}

// --- enforcement ------------------------------------------------------------

async function getLimitSettings() {
  const { maxTabs, scope } = await chrome.storage.sync.get([
    "maxTabs",
    "scope",
  ]);
  const n = parseInt(maxTabs, 10);
  return {
    maxTabs: Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_TABS,
    // "global" counts tabs across all windows; "window" counts per window.
    scope: scope === "window" ? "window" : "global",
  };
}

async function enforceLimit(windowId, newTabId) {
  const [{ maxTabs, scope }, lastUsed, protectedIds] = await Promise.all([
    getLimitSettings(),
    getSession("lastUsed", {}),
    getSession("protectedIds", []),
  ]);

  const tabs = await chrome.tabs.query(
    scope === "window" ? { windowId } : {}
  );
  let excess = tabs.length - maxTabs;
  if (excess <= 0) return;

  const candidates = tabs
    .filter(
      (t) =>
        !t.pinned &&
        !t.active &&
        !t.audible &&
        t.id !== newTabId &&
        !protectedIds.includes(t.id)
    )
    // Least recently used first. Prefer our own tracking; fall back to
    // Chrome's lastAccessed, then to tab index (leftmost = oldest).
    .sort(
      (a, b) =>
        (lastUsed[a.id] ?? a.lastAccessed ?? a.index) -
        (lastUsed[b.id] ?? b.lastAccessed ?? b.index)
    );

  for (const tab of candidates) {
    if (excess <= 0) break;
    try {
      await chrome.tabs.remove(tab.id);
      excess--;
    } catch (e) {
      // Tab may already be gone; skip it.
    }
  }
}

// --- badge: mark protected tabs so their state is visible -------------------

async function updateBadge(tabId) {
  const protectedIds = await getSession("protectedIds", []);
  const isProtected = protectedIds.includes(tabId);
  await chrome.action.setBadgeText({
    tabId,
    text: isProtected ? "✓" : "",
  });
  if (isProtected) {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: "#1a7f37" });
  }
}

// --- event wiring -----------------------------------------------------------

chrome.tabs.onCreated.addListener(async (tab) => {
  if (tab.id === undefined) return;
  await touchTab(tab.id);
  await enforceLimit(tab.windowId, tab.id);
});

// Domain rules trigger when a tab's URL commits onto a tagged domain it
// wasn't on before (covers new tabs, link-opens, and navigations alike).
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (!changeInfo.url) return;
  const newHost = hostnameOf(changeInfo.url);
  const tabHosts = await getSession("tabHosts", {});
  const prevHost = tabHosts[tabId];
  tabHosts[tabId] = newHost;
  await chrome.storage.session.set({ tabHosts });

  const { domainRules = {} } = await chrome.storage.sync.get("domainRules");
  const newMatch = matchRule(newHost, domainRules);
  if (newMatch && newMatch !== matchRule(prevHost, domainRules)) {
    await enforceDomainLimit(newMatch, tabId);
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  await touchTab(tabId);
  await updateBadge(tabId);
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  const [tab] = await chrome.tabs.query({ active: true, windowId });
  if (tab?.id !== undefined) await touchTab(tab.id);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await forgetTab(tabId);
});

// Re-enforce in every window when the limit is lowered from the popup.
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === "sync" && (changes.maxTabs || changes.scope)) {
    const { scope } = await getLimitSettings();
    if (scope === "window") {
      const windows = await chrome.windows.getAll({ windowTypes: ["normal"] });
      for (const win of windows) {
        await enforceLimit(win.id, undefined);
      }
    } else {
      await enforceLimit(undefined, undefined);
    }
  }
  if (area === "sync" && changes.domainRules) {
    const rules = changes.domainRules.newValue ?? {};
    for (const domain of Object.keys(rules)) {
      await enforceDomainLimit(domain, undefined);
    }
  }
  if (area === "session" && changes.protectedIds) {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tab?.id !== undefined) await updateBadge(tab.id);
  }
});

// Seed usage times for tabs that are already open when the extension loads.
async function seedExistingTabs() {
  const tabs = await chrome.tabs.query({});
  const lastUsed = await getSession("lastUsed", {});
  const now = Date.now();
  for (const tab of tabs) {
    if (tab.id !== undefined && !(tab.id in lastUsed)) {
      lastUsed[tab.id] = tab.lastAccessed ?? now;
    }
  }
  await chrome.storage.session.set({ lastUsed });
}

chrome.runtime.onInstalled.addListener(seedExistingTabs);
chrome.runtime.onStartup.addListener(seedExistingTabs);
