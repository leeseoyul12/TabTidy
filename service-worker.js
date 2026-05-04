"use strict";

var TAB_META_KEY = "tabMeta";
var UNGROUPED_GROUP_ID = -1;
var INTERNAL_PREFIXES = [
  "chrome://",
  "chrome-extension://",
  "about:",
  "edge://"
];

initializeTabMeta();

chrome.runtime.onInstalled.addListener(function handleInstalled(details) {
  initializeTabMeta();
});

chrome.runtime.onStartup.addListener(function handleStartup() {
  initializeTabMeta();
});

chrome.tabs.onCreated.addListener(function handleTabCreated(tab) {
  upsertTabMeta(tab, { activated: Boolean(tab && tab.active) });
});

chrome.tabs.onUpdated.addListener(function handleTabUpdated(tabId, changeInfo, tab) {
  if (!tab) {
    return;
  }

  upsertTabMeta(tab, { activated: false });
});

chrome.tabs.onActivated.addListener(function handleTabActivated(activeInfo) {
  safeGetTab(activeInfo.tabId).then(function handleTab(tab) {
    if (!tab) {
      return;
    }

    upsertTabMeta(tab, { activated: true, windowId: activeInfo.windowId });
  });
});

chrome.tabs.onRemoved.addListener(function handleTabRemoved(tabId) {
  removeTabMeta(tabId);
});

chrome.runtime.onMessage.addListener(function handleMessage(message, sender, sendResponse) {
  if (!message || message.type !== "TABTIDY_PING") {
    return false;
  }

  sendResponse({
    ok: true,
    extension: "TabTidy",
    senderTabId: sender && sender.tab ? sender.tab.id : null
  });

  return false;
});

async function initializeTabMeta() {
  try {
    var tabs = await queryAllTabs();
    var tabMeta = await readTabMeta();
    var now = Date.now();
    var openTabIds = {};

    tabs.forEach(function rememberOpenTab(tab) {
      if (typeof tab.id === "number") {
        openTabIds[String(tab.id)] = true;
      }
    });

    Object.keys(tabMeta).forEach(function removeClosedTab(tabId) {
      if (!openTabIds[tabId]) {
        delete tabMeta[tabId];
      }
    });

    tabs.forEach(function mergeOpenTab(tab) {
      if (typeof tab.id !== "number") {
        return;
      }

      var tabKey = String(tab.id);
      tabMeta[tabKey] = buildTabMeta(tab, tabMeta[tabKey], now, {
        activated: Boolean(tab.active)
      });
    });

    await writeTabMeta(tabMeta);
  } catch (error) {
  }
}

async function upsertTabMeta(tab, options) {
  if (!tab || typeof tab.id !== "number") {
    return;
  }

  try {
    var tabMeta = await readTabMeta();
    var tabKey = String(tab.id);
    var nextTab = Object.assign({}, tab);

    if (options && typeof options.windowId === "number") {
      nextTab.windowId = options.windowId;
    }

    tabMeta[tabKey] = buildTabMeta(nextTab, tabMeta[tabKey], Date.now(), options || {});
    await writeTabMeta(tabMeta);
  } catch (error) {
  }
}

async function removeTabMeta(tabId) {
  try {
    var tabMeta = await readTabMeta();
    delete tabMeta[String(tabId)];
    await writeTabMeta(tabMeta);
  } catch (error) {
  }
}

function buildTabMeta(tab, existing, now, options) {
  var previous = existing || {};
  var url = tab.url || tab.pendingUrl || previous.url || "";
  var isActivated = Boolean(options && options.activated);
  var firstSeenAt = previous.firstSeenAt || now;
  var lastActivatedAt = previous.lastActivatedAt || null;

  if (isActivated || (!lastActivatedAt && tab.active)) {
    lastActivatedAt = now;
  }

  return {
    tabId: tab.id,
    windowId: typeof tab.windowId === "number" ? tab.windowId : previous.windowId || null,
    url: url,
    title: tab.title || previous.title || "",
    groupId: typeof tab.groupId === "number" ? tab.groupId : UNGROUPED_GROUP_ID,
    firstSeenAt: firstSeenAt,
    lastActivatedAt: lastActivatedAt,
    lastUpdatedAt: now,
    isProtected: typeof previous.isProtected === "boolean" ? previous.isProtected : false,
    note: typeof previous.note === "string" ? previous.note : ""
  };
}

function queryAllTabs() {
  return new Promise(function queryTabs(resolve) {
    try {
      chrome.tabs.query({}, function handleTabs(tabs) {
        if (chrome.runtime.lastError) {
          resolve([]);
          return;
        }

        resolve(Array.isArray(tabs) ? tabs : []);
      });
    } catch (error) {
      resolve([]);
    }
  });
}

function safeGetTab(tabId) {
  return new Promise(function getTab(resolve) {
    try {
      chrome.tabs.get(tabId, function handleTab(tab) {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }

        resolve(tab || null);
      });
    } catch (error) {
      resolve(null);
    }
  });
}

function readTabMeta() {
  return new Promise(function read(resolve) {
    try {
      chrome.storage.local.get(TAB_META_KEY, function handleItems(items) {
        if (chrome.runtime.lastError) {
          resolve({});
          return;
        }

        resolve(items && items[TAB_META_KEY] && typeof items[TAB_META_KEY] === "object"
          ? items[TAB_META_KEY]
          : {});
      });
    } catch (error) {
      resolve({});
    }
  });
}

function writeTabMeta(tabMeta) {
  return new Promise(function write(resolve) {
    var payload = {};
    payload[TAB_META_KEY] = tabMeta || {};

    try {
      chrome.storage.local.set(payload, function handleSet() {
        resolve();
      });
    } catch (error) {
      resolve();
    }
  });
}

function isProtectedUrl(rawUrl) {
  try {
    var urlText = String(rawUrl || "").trim().toLowerCase();

    return INTERNAL_PREFIXES.some(function hasPrefix(prefix) {
      return urlText.indexOf(prefix) === 0;
    });
  } catch (error) {
    return false;
  }
}
