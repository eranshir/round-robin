const DEFAULT_MAX_TABS = 25;

const maxTabsInput = document.getElementById("maxTabs");
const protectBtn = document.getElementById("protectBtn");
const countEl = document.getElementById("count");
const rulesList = document.getElementById("rulesList");
const tagBtn = document.getElementById("tagBtn");

let currentTab = null;
let currentDomain = null;

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

async function getProtectedIds() {
  const { protectedIds } = await chrome.storage.session.get("protectedIds");
  return protectedIds ?? [];
}

async function getDomainRules() {
  const { domainRules } = await chrome.storage.sync.get("domainRules");
  return domainRules ?? {};
}

function renderProtectButton(isProtected) {
  protectBtn.textContent = isProtected
    ? "Unprotect this tab"
    : "Protect this tab";
  protectBtn.classList.toggle("protected", isProtected);
}

async function renderRules() {
  const rules = await getDomainRules();
  const domains = Object.keys(rules).sort();
  rulesList.textContent = "";

  if (domains.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No tagged domains yet.";
    rulesList.appendChild(empty);
  }

  for (const domain of domains) {
    const row = document.createElement("div");
    row.className = "rule";

    const name = document.createElement("span");
    name.className = "domain";
    name.textContent = domain;
    name.title = domain;

    const limit = document.createElement("input");
    limit.type = "number";
    limit.min = "1";
    limit.max = "50";
    limit.value = rules[domain];
    limit.addEventListener("change", async () => {
      const n = parseInt(limit.value, 10);
      if (Number.isFinite(n) && n > 0) {
        const latest = await getDomainRules();
        latest[domain] = n;
        await chrome.storage.sync.set({ domainRules: latest });
      }
    });

    const remove = document.createElement("button");
    remove.className = "remove";
    remove.textContent = "×";
    remove.title = `Remove rule for ${domain}`;
    remove.addEventListener("click", async () => {
      const latest = await getDomainRules();
      delete latest[domain];
      await chrome.storage.sync.set({ domainRules: latest });
      await renderRules();
      renderTagButton(latest);
    });

    row.append(name, limit, remove);
    rulesList.appendChild(row);
  }
}

function renderTagButton(rules) {
  if (!currentDomain) {
    tagBtn.textContent = "No taggable domain on this tab";
    tagBtn.disabled = true;
    return;
  }
  const alreadyTagged = Object.prototype.hasOwnProperty.call(
    rules,
    currentDomain
  );
  tagBtn.textContent = alreadyTagged
    ? `${currentDomain} is tagged`
    : `Tag ${currentDomain} (limit 1)`;
  tagBtn.disabled = alreadyTagged;
}

async function init() {
  const [{ maxTabs }, [tab]] = await Promise.all([
    chrome.storage.sync.get("maxTabs"),
    chrome.tabs.query({ active: true, currentWindow: true }),
  ]);
  currentTab = tab;
  currentDomain = hostnameOf(tab?.url);
  maxTabsInput.value = maxTabs ?? DEFAULT_MAX_TABS;

  const [allTabs, tabsInWindow] = await Promise.all([
    chrome.tabs.query({}),
    chrome.tabs.query({ windowId: tab.windowId }),
  ]);
  countEl.textContent = `${allTabs.length} tabs open (${tabsInWindow.length} in this window)`;

  const protectedIds = await getProtectedIds();
  renderProtectButton(protectedIds.includes(tab.id));

  await renderRules();
  renderTagButton(await getDomainRules());
}

maxTabsInput.addEventListener("change", async () => {
  const n = parseInt(maxTabsInput.value, 10);
  if (Number.isFinite(n) && n > 0) {
    await chrome.storage.sync.set({ maxTabs: n });
  }
});

protectBtn.addEventListener("click", async () => {
  if (!currentTab) return;
  let protectedIds = await getProtectedIds();
  const isProtected = protectedIds.includes(currentTab.id);
  protectedIds = isProtected
    ? protectedIds.filter((id) => id !== currentTab.id)
    : [...protectedIds, currentTab.id];
  await chrome.storage.session.set({ protectedIds });
  renderProtectButton(!isProtected);
});

tagBtn.addEventListener("click", async () => {
  if (!currentDomain) return;
  const rules = await getDomainRules();
  rules[currentDomain] = 1;
  await chrome.storage.sync.set({ domainRules: rules });
  await renderRules();
  renderTagButton(rules);
});

init();
