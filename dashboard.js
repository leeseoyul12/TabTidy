"use strict";

var TAB_META_KEY = "tabMeta";
var LAST_CLEANUP_KEY = "lastCleanupSnapshot";
var CLEANUP_HISTORY_KEY = "cleanupHistory";
var CLEANUP_HISTORY_LIMIT = 20;
var UNGROUPED_GROUP_ID = -1;
var ONE_DAY_MS = 24 * 60 * 60 * 1000;
var TRACKING_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "fbclid",
  "gclid"
];
var INTERNAL_PREFIXES = [
  { prefix: "chrome://", label: "Chrome 내부 페이지" },
  { prefix: "chrome-extension://", label: "확장 프로그램 페이지" },
  { prefix: "about:", label: "브라우저 내부 페이지" },
  { prefix: "edge://", label: "Edge 내부 페이지" }
];
var GROUP_COLORS = {
  grey: "#9aa4b2",
  blue: "#4d8df7",
  red: "#e35d54",
  yellow: "#f2b844",
  green: "#42a66a",
  pink: "#d85fa4",
  purple: "#8d70d6",
  cyan: "#33a6b8",
  orange: "#df7b32"
};

var elements = {
  loadingState: document.getElementById("loadingState"),
  errorState: document.getElementById("errorState"),
  emptyState: document.getElementById("emptyState"),
  contentState: document.getElementById("contentState"),
  errorMessage: document.getElementById("errorMessage"),
  refreshButton: document.getElementById("refreshButton"),
  overallScore: document.getElementById("overallScore"),
  scoreStatusBadge: document.getElementById("scoreStatusBadge"),
  scoreDescription: document.getElementById("scoreDescription"),
  totalTabs: document.getElementById("totalTabs"),
  cleanupCandidateMetric: document.getElementById("cleanupCandidateMetric"),
  groupedTabs: document.getElementById("groupedTabs"),
  ungroupedTabs: document.getElementById("ungroupedTabs"),
  groupCount: document.getElementById("groupCount"),
  duplicateTabs: document.getElementById("duplicateTabs"),
  searchTabs: document.getElementById("searchTabs"),
  protectedTabs: document.getElementById("protectedTabs"),
  groupsSummary: document.getElementById("groupsSummary"),
  ungroupedSummary: document.getElementById("ungroupedSummary"),
  ungroupedMessage: document.getElementById("ungroupedMessage"),
  duplicatesSummary: document.getElementById("duplicatesSummary"),
  searchSummary: document.getElementById("searchSummary"),
  protectedSummary: document.getElementById("protectedSummary"),
  staleSummary: document.getElementById("staleSummary"),
  groupsList: document.getElementById("groupsList"),
  ungroupedList: document.getElementById("ungroupedList"),
  duplicatesList: document.getElementById("duplicatesList"),
  searchList: document.getElementById("searchList"),
  protectedList: document.getElementById("protectedList"),
  staleList: document.getElementById("staleList"),
  cleanupSummary: document.getElementById("cleanupSummary"),
  cleanupTypeSummary: document.getElementById("cleanupTypeSummary"),
  cleanupCandidatesDetails: document.getElementById("cleanupCandidatesDetails"),
  cleanupCandidatesList: document.getElementById("cleanupCandidatesList"),
  previewCleanupButton: document.getElementById("previewCleanupButton"),
  resetManualCleanupButton: document.getElementById("resetManualCleanupButton"),
  undoCleanupButton: document.getElementById("undoCleanupButton"),
  cleanupPreviewPanel: document.getElementById("cleanupPreviewPanel"),
  previewCloseCount: document.getElementById("previewCloseCount"),
  previewKeepCount: document.getElementById("previewKeepCount"),
  previewProtectedCount: document.getElementById("previewProtectedCount"),
  previewExcludedCount: document.getElementById("previewExcludedCount"),
  previewCloseList: document.getElementById("previewCloseList"),
  executeCleanupButton: document.getElementById("executeCleanupButton"),
  cancelCleanupPreviewButton: document.getElementById("cancelCleanupPreviewButton"),
  cleanupResultPanel: document.getElementById("cleanupResultPanel"),
  cleanupResultMessage: document.getElementById("cleanupResultMessage"),
  cleanupResultSummary: document.getElementById("cleanupResultSummary"),
  cleanupFailureList: document.getElementById("cleanupFailureList"),
  undoMessage: document.getElementById("undoMessage"),
  undoStatusMessage: document.getElementById("undoStatusMessage"),
  cleanupHistorySummary: document.getElementById("cleanupHistorySummary"),
  cleanupHistoryList: document.getElementById("cleanupHistoryList"),
  clearCleanupHistoryButton: document.getElementById("clearCleanupHistoryButton"),
  groupsSection: document.getElementById("groupsSection"),
  ungroupedSection: document.getElementById("ungroupedSection"),
  staleSection: document.getElementById("staleSection"),
  duplicatesSection: document.getElementById("duplicatesSection"),
  searchSection: document.getElementById("searchSection"),
  protectedSection: document.getElementById("protectedSection"),
  historySection: document.getElementById("historySection")
};
var currentAnalysis = null;
var cleanupHistoryFilter = "all";
var staleFilterDays = 7;
var hasRenderedAnalysis = false;
var openNotePanelIds = new Set();
var manualCleanupTabIds = new Set();
var manualCleanupPreviousSelections = {};
var cleanupSelectionOverrides = {};
var cleanupState = {
  candidates: [],
  previewCandidates: [],
  isBusy: false
};

document.addEventListener("DOMContentLoaded", function handleReady() {
  elements.refreshButton.addEventListener("click", renderDashboard);
  elements.previewCleanupButton.addEventListener("click", renderCleanupPreview);
  elements.resetManualCleanupButton.addEventListener("click", resetManualCleanupSelection);
  elements.executeCleanupButton.addEventListener("click", executeCleanup);
  elements.cancelCleanupPreviewButton.addEventListener("click", cancelCleanupPreview);
  elements.undoCleanupButton.addEventListener("click", undoLastCleanup);
  elements.clearCleanupHistoryButton.addEventListener("click", clearCleanupHistory);
  Array.from(document.querySelectorAll("[data-history-filter]")).forEach(function bindHistoryFilter(button) {
    button.addEventListener("click", function handleHistoryFilterClick() {
      cleanupHistoryFilter = button.getAttribute("data-history-filter") || "all";
      renderCleanupHistory();
    });
  });
  Array.from(document.querySelectorAll("[data-stale-filter]")).forEach(function bindStaleFilter(button) {
    button.addEventListener("click", function handleStaleFilterClick() {
      staleFilterDays = Number(button.getAttribute("data-stale-filter")) || 7;
      syncStaleFilterButtons();

      if (currentAnalysis) {
        renderAnalysis(currentAnalysis);
      }
    });
  });
  renderDashboard();
});

function queryCurrentWindowTabs() {
  return new Promise(function queryTabs(resolve, reject) {
    try {
      chrome.tabs.query({ currentWindow: true }, function handleTabs(tabs) {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        resolve(Array.isArray(tabs) ? tabs : []);
      });
    } catch (error) {
      reject(error);
    }
  });
}

function getTabGroup(groupId) {
  return new Promise(function getGroup(resolve) {
    if (groupId === UNGROUPED_GROUP_ID || !chrome.tabGroups || !chrome.tabGroups.get) {
      resolve(null);
      return;
    }

    try {
      chrome.tabGroups.get(groupId, function handleGroup(group) {
        if (chrome.runtime.lastError || !group) {
          resolve(createFallbackGroup(groupId));
          return;
        }

        resolve({
          id: group.id,
          title: group.title || "이름 없는 그룹",
          color: group.color || "grey",
          collapsed: Boolean(group.collapsed),
          fallback: false
        });
      });
    } catch (error) {
      resolve(createFallbackGroup(groupId));
    }
  });
}

async function renderDashboard() {
  showOnly(elements.loadingState);
  elements.refreshButton.disabled = true;

  try {
    var tabs = await queryCurrentWindowTabs();

    if (!tabs.length) {
      showOnly(elements.emptyState);
      return;
    }

    var analysis = await analyzeTabs(tabs);
    currentAnalysis = analysis;
    renderAnalysis(analysis);
    showOnly(elements.contentState);
  } catch (error) {
    showError(error);
  } finally {
    elements.refreshButton.disabled = false;
  }
}

async function analyzeTabs(tabs) {
  var groupedTabs = tabs.filter(function isGrouped(tab) {
    return getGroupId(tab) !== UNGROUPED_GROUP_ID;
  });
  var ungroupedTabs = tabs.filter(function isUngrouped(tab) {
    return getGroupId(tab) === UNGROUPED_GROUP_ID;
  });
  var groupIds = Array.from(new Set(groupedTabs.map(getGroupId)));
  var groupInfos = await loadGroupInfo(groupIds);
  var tabMetaById = await loadCurrentTabMeta(tabs);
  var protectedTabs = tabs
    .map(function mapProtected(tab) {
      return {
        tab: tab,
        reason: getProtectedReason(tab.url)
      };
    })
    .filter(function hasReason(item) {
      return Boolean(item.reason);
    });
  var duplicateAnalysis = findDuplicateTabs(tabs);
  var searchTabs = tabs
    .map(function mapSearch(tab) {
      return {
        tab: tab,
        search: getSearchResultInfo(tab.url)
      };
    })
    .filter(function hasSearch(item) {
      return Boolean(item.search);
    });
  var groups = groupIds.map(function buildGroup(groupId) {
    var groupTabs = groupedTabs.filter(function belongsToGroup(tab) {
      return getGroupId(tab) === groupId;
    });
    var duplicateCount = countTabsInSet(groupTabs, duplicateAnalysis.duplicateTabIds);
    var searchCount = groupTabs.filter(function isSearch(tab) {
      return Boolean(getSearchResultInfo(tab.url));
    }).length;

    return {
      id: groupId,
      info: groupInfos[groupId] || createFallbackGroup(groupId),
      tabs: groupTabs,
      score: calculateHealthScore({
        tabCount: groupTabs.length,
        ungroupedCount: 0,
        duplicateCount: duplicateCount,
        searchCount: searchCount,
        isGroup: true
      })
    };
  });
  var staleAnalysis = findStaleTabs(tabs, tabMetaById);
  var ungroupedDomainGroups = groupUngroupedTabsByDomain(ungroupedTabs);
  var overallScore = calculateHealthScore({
    tabCount: tabs.length,
    ungroupedCount: ungroupedTabs.length,
    duplicateCount: duplicateAnalysis.duplicateTabIds.size,
    searchCount: searchTabs.length,
    isGroup: false
  });

  return {
    tabs: tabs,
    groupedTabs: groupedTabs,
    ungroupedTabs: ungroupedTabs,
    groups: groups,
    duplicateGroups: duplicateAnalysis.groups,
    duplicateTabIds: duplicateAnalysis.duplicateTabIds,
    searchTabs: searchTabs,
    protectedTabs: protectedTabs,
    tabMetaById: tabMetaById,
    staleAnalysis: staleAnalysis,
    ungroupedDomainGroups: ungroupedDomainGroups,
    overallScore: overallScore
  };
}

async function loadCurrentTabMeta(tabs) {
  var storedTabMeta = await readStoredTabMeta();
  var currentMeta = {};

  tabs.forEach(function mapCurrentTab(tab) {
    if (typeof tab.id !== "number") {
      return;
    }

    var stored = storedTabMeta[String(tab.id)];
    currentMeta[tab.id] = mergeMetaForCurrentTab(tab, stored);
  });

  return currentMeta;
}

function readStoredTabMeta() {
  return new Promise(function read(resolve) {
    if (!chrome.storage || !chrome.storage.local) {
      resolve({});
      return;
    }

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

function mergeMetaForCurrentTab(tab, stored) {
  var now = Date.now();
  var previous = stored && typeof stored === "object" ? stored : {};
  var firstSeenAt = normalizeTimestamp(previous.firstSeenAt) || now;
  var lastActivatedAt = normalizeTimestamp(previous.lastActivatedAt);
  var lastUpdatedAt = normalizeTimestamp(previous.lastUpdatedAt) || now;

  return {
    tabId: tab.id,
    windowId: typeof tab.windowId === "number" ? tab.windowId : previous.windowId || null,
    url: tab.url || previous.url || "",
    title: tab.title || previous.title || "",
    groupId: getGroupId(tab),
    firstSeenAt: firstSeenAt,
    lastActivatedAt: lastActivatedAt,
    lastUpdatedAt: lastUpdatedAt,
    isProtected: Boolean(previous.isProtected),
    note: typeof previous.note === "string" ? previous.note : "",
    hasStoredHistory: Boolean(stored)
  };
}

async function loadGroupInfo(groupIds) {
  var groups = {};
  var groupPromises = groupIds.map(function load(groupId) {
    return getTabGroup(groupId).then(function assign(groupInfo) {
      groups[groupId] = groupInfo || createFallbackGroup(groupId);
    });
  });

  await Promise.all(groupPromises);
  return groups;
}

function findDuplicateTabs(tabs) {
  var exactMap = new Map();
  var normalizedMap = new Map();
  var duplicateGroups = [];
  var duplicateTabIds = new Set();
  var eligibleTabs = tabs.filter(function isEligible(tab) {
    return !getProtectedReason(tab.url);
  });

  eligibleTabs.forEach(function collect(tab) {
    var exactKey = String(tab.url || "").trim();
    var normalizedKey = normalizeUrl(tab.url);

    if (exactKey) {
      addToMap(exactMap, exactKey, tab);
    }

    if (normalizedKey) {
      addToMap(normalizedMap, normalizedKey, tab);
    }
  });

  exactMap.forEach(function addExactGroup(groupTabs, key) {
    if (groupTabs.length <= 1) {
      return;
    }

    duplicateGroups.push({
      type: "exact",
      label: "완전히 같은 주소",
      key: key,
      tabs: groupTabs
    });
    markDuplicateTabs(groupTabs, duplicateTabIds);
  });

  normalizedMap.forEach(function addNormalizedGroup(groupTabs, key) {
    var distinctUrls = new Set(groupTabs.map(function getUrl(tab) {
      return String(tab.url || "").trim();
    }));

    if (groupTabs.length <= 1 || distinctUrls.size <= 1) {
      return;
    }

    duplicateGroups.push({
      type: "normalized",
      label: "추적 파라미터 제거 후 같은 주소",
      key: key,
      tabs: groupTabs
    });
    markDuplicateTabs(groupTabs, duplicateTabIds);
  });

  return {
    groups: duplicateGroups,
    duplicateTabIds: duplicateTabIds
  };
}

function findStaleTabs(tabs, tabMetaById) {
  var now = Date.now();
  var staleItems = [];

  tabs.forEach(function inspectTab(tab) {
    var meta = tabMetaById[tab.id] || mergeMetaForCurrentTab(tab, null);
    var lastSeenAt = normalizeTimestamp(meta.lastActivatedAt) || normalizeTimestamp(meta.firstSeenAt);

    if (!lastSeenAt) {
      return;
    }

    var ageDays = Math.floor((now - lastSeenAt) / ONE_DAY_MS);
    var item = {
      tab: tab,
      meta: meta,
      ageDays: Math.max(0, ageDays),
      lastSeenAt: lastSeenAt
    };

    if (ageDays >= 1) {
      staleItems.push(item);
    }
  });

  staleItems.sort(sortByAgeDesc);

  return {
    items: staleItems,
    total: staleItems.length
  };
}

function groupUngroupedTabsByDomain(ungroupedTabs) {
  var groupsByDomain = new Map();

  ungroupedTabs.forEach(function collect(tab) {
    var domain = extractDomain(tab.url);

    if (!groupsByDomain.has(domain)) {
      groupsByDomain.set(domain, []);
    }

    groupsByDomain.get(domain).push(tab);
  });

  return Array.from(groupsByDomain.entries())
    .map(function toGroup(entry) {
      return {
        domain: entry[0],
        tabs: entry[1]
      };
    })
    .sort(function sortGroups(a, b) {
      if (b.tabs.length !== a.tabs.length) {
        return b.tabs.length - a.tabs.length;
      }

      return a.domain.localeCompare(b.domain);
    });
}

function renderAnalysis(analysis) {
  var previousUiState = hasRenderedAnalysis ? captureUiState() : null;
  var scoreStatus = getHealthBadgeText(analysis.overallScore);
  var protectedCount = getProtectedTabCount(analysis);
  var excludedTabs = getAutomaticExcludedTabs(analysis);
  var filteredStaleItems = getFilteredStaleItems(analysis.staleAnalysis);

  elements.overallScore.textContent = String(analysis.overallScore);
  elements.scoreStatusBadge.textContent = scoreStatus;
  elements.scoreStatusBadge.className = "badge " + getScoreBadgeClass(analysis.overallScore);
  elements.scoreDescription.textContent = "정리 필요도를 보여주는 참고 점수입니다.";
  elements.totalTabs.textContent = String(analysis.tabs.length);
  elements.groupedTabs.textContent = String(analysis.groupedTabs.length);
  elements.ungroupedTabs.textContent = String(analysis.ungroupedTabs.length);
  elements.groupCount.textContent = String(analysis.groups.length);
  elements.duplicateTabs.textContent = String(analysis.duplicateTabIds.size);
  elements.searchTabs.textContent = String(analysis.searchTabs.length);
  elements.protectedTabs.textContent = String(protectedCount);

  elements.groupsSummary.textContent = analysis.groups.length + "개 그룹";
  elements.ungroupedSummary.textContent = analysis.ungroupedTabs.length + "개 탭";
  elements.duplicatesSummary.textContent = analysis.duplicateTabIds.size + "개 탭";
  elements.searchSummary.textContent = analysis.searchTabs.length + "개 탭";
  elements.protectedSummary.textContent = excludedTabs.length + "개 탭";
  elements.staleSummary.textContent = filteredStaleItems.length + "개 표시 / " + analysis.staleAnalysis.total + "개 추적";
  elements.ungroupedMessage.textContent = getUngroupedMessage(analysis.ungroupedTabs.length);

  updateAccordionDefaults(analysis, excludedTabs);
  renderGroups(analysis.groups, analysis);
  renderUngroupedDomainGroups(analysis.ungroupedDomainGroups, analysis);
  renderStaleTabs(analysis.staleAnalysis, analysis);
  renderDuplicateGroups(analysis.duplicateGroups, analysis);
  renderSearchTabs(analysis.searchTabs, analysis);
  renderProtectedTabs(excludedTabs, analysis);
  renderCleanupSection(analysis);
  renderCleanupHistory();
  refreshUndoButtonState();
  restoreUiState(previousUiState);
  hasRenderedAnalysis = true;
}

function updateAccordionDefaults(analysis, excludedTabs) {
  elements.groupsSection.open = false;
  elements.ungroupedSection.open = false;
  elements.protectedSection.open = false;
  elements.historySection.open = false;
  elements.staleSection.open = getFilteredStaleItems(analysis.staleAnalysis).length > 0;
  elements.duplicatesSection.open = analysis.duplicateTabIds.size > 0;
  elements.searchSection.open = analysis.searchTabs.length > 0;

  if (!excludedTabs.length) {
    elements.protectedSection.open = false;
  }
}

function captureUiState() {
  return {
    groupsSectionOpen: elements.groupsSection.open,
    ungroupedSectionOpen: elements.ungroupedSection.open,
    staleSectionOpen: elements.staleSection.open,
    duplicatesSectionOpen: elements.duplicatesSection.open,
    searchSectionOpen: elements.searchSection.open,
    protectedSectionOpen: elements.protectedSection.open,
    historySectionOpen: elements.historySection.open,
    cleanupCandidatesDetailsOpen: elements.cleanupCandidatesDetails.open
  };
}

function restoreUiState(state) {
  if (!state) {
    return;
  }

  elements.groupsSection.open = state.groupsSectionOpen;
  elements.ungroupedSection.open = state.ungroupedSectionOpen;
  elements.staleSection.open = state.staleSectionOpen;
  elements.duplicatesSection.open = state.duplicatesSectionOpen;
  elements.searchSection.open = state.searchSectionOpen;
  elements.protectedSection.open = state.protectedSectionOpen;
  elements.historySection.open = state.historySectionOpen;
  elements.cleanupCandidatesDetails.open = state.cleanupCandidatesDetailsOpen;
}

function renderGroups(groups, analysis) {
  clearElement(elements.groupsList);

  if (!groups.length) {
    elements.groupsList.appendChild(createEmptyNote("현재 창에 Chrome 탭 그룹이 없습니다."));
    return;
  }

  groups.forEach(function renderGroup(group) {
    var card = createElement("article", "group-card");
    var header = createElement("div", "group-card-header");
    var titleWrap = createElement("div", "group-title-wrap");
    var colorDot = createElement("span", "group-color");
    var titleBlock = createElement("div");
    var title = createElement("h3", "group-title", group.info.title);
    var meta = createElement(
      "p",
      "group-meta",
      group.tabs.length + "개 탭 · 색상 " + getGroupColorLabel(group.info.color)
    );
    var score = createElement("div", "group-score", group.score + "점");
    var tabsWrap = createElement("div", "group-tabs");

    colorDot.style.backgroundColor = GROUP_COLORS[group.info.color] || GROUP_COLORS.grey;
    colorDot.title = getGroupColorLabel(group.info.color);

    titleBlock.appendChild(title);
    titleBlock.appendChild(meta);
    titleWrap.appendChild(colorDot);
    titleWrap.appendChild(titleBlock);
    header.appendChild(titleWrap);
    header.appendChild(score);

    if (group.info.fallback) {
      var fallbackBadge = createElement("span", "badge badge-protected", "그룹 정보 조회 실패");
      titleBlock.appendChild(fallbackBadge);
    }

    group.tabs.forEach(function appendTab(tab) {
      tabsWrap.appendChild(createTabRow(tab, analysis, "", { allowManualCleanup: true }));
    });

    card.appendChild(header);
    card.appendChild(tabsWrap);
    elements.groupsList.appendChild(card);
  });
}

function renderUngroupedDomainGroups(domainGroups, analysis) {
  clearElement(elements.ungroupedList);

  if (!domainGroups.length) {
    elements.ungroupedList.appendChild(createEmptyNote("그룹 밖 탭이 없습니다."));
    return;
  }

  domainGroups.forEach(function renderDomainGroup(domainGroup) {
    var card = createElement("article", "finding-card");
    var header = createElement("div", "finding-card-header");
    var titleBlock = createElement("div");
    var title = createElement("p", "finding-title", domainGroup.domain);
    var key = createElement("p", "finding-key", "그룹 밖 탭 도메인 묶음");
    var badge = createElement("span", "badge", domainGroup.tabs.length + "개 탭");
    var list = createElement("div", "tab-list");

    titleBlock.appendChild(title);
    titleBlock.appendChild(key);
    header.appendChild(titleBlock);
    header.appendChild(badge);

    domainGroup.tabs.forEach(function appendTab(tab) {
      list.appendChild(createTabRow(tab, analysis, "", { allowManualCleanup: true }));
    });

    card.appendChild(header);
    card.appendChild(list);
    elements.ungroupedList.appendChild(card);
  });
}

function getUngroupedMessage(ungroupedCount) {
  if (ungroupedCount >= 8) {
    return "그룹 밖에 흩어진 탭이 많습니다. 도메인별 묶음을 보고 작업공간 상태를 점검해 보세요.";
  }

  if (ungroupedCount > 0) {
    return "아직 어떤 Chrome 탭 그룹에도 들어가지 않은 탭입니다. 도메인별로 묶어 표시합니다.";
  }

  return "모든 탭이 Chrome 탭 그룹 안에 들어가 있습니다.";
}

function renderStaleTabs(staleAnalysis, analysis) {
  clearElement(elements.staleList);
  syncStaleFilterButtons();

  var filteredItems = getFilteredStaleItems(staleAnalysis);

  if (!filteredItems.length) {
    elements.staleList.appendChild(createEmptyNote("선택한 기준에 해당하는 오래 안 본 현재 창 탭이 없습니다."));
    return;
  }

  appendStaleBucket(staleFilterDays + "일 이상 안 본 탭", filteredItems, analysis);
}

function appendStaleBucket(titleText, items, analysis) {
  if (!items.length) {
    return;
  }

  var card = createElement("article", "finding-card");
  var header = createElement("div", "finding-card-header");
  var titleBlock = createElement("div");
  var title = createElement("p", "finding-title", titleText);
  var key = createElement("p", "finding-key", "설치 이후 기록 기준으로 계산한 후보입니다.");
  var badge = createElement("span", "badge badge-warning", items.length + "개 탭");
  var list = createElement("div", "tab-list");

  titleBlock.appendChild(title);
  titleBlock.appendChild(key);
  header.appendChild(titleBlock);
  header.appendChild(badge);

  items.forEach(function appendItem(item) {
    var row = createTabRow(item.tab, analysis, item.ageDays + "일 전 활성");
    list.appendChild(row);
  });

  card.appendChild(header);
  card.appendChild(list);
  elements.staleList.appendChild(card);
}

function renderDuplicateGroups(duplicateGroups, analysis) {
  clearElement(elements.duplicatesList);

  if (!duplicateGroups.length) {
    elements.duplicatesList.appendChild(createEmptyNote("감지된 중복 탭이 없습니다."));
    return;
  }

  duplicateGroups.forEach(function renderGroup(group) {
    var card = createElement("article", "finding-card");
    var header = createElement("div", "finding-card-header");
    var titleBlock = createElement("div");
    var title = createElement("p", "finding-title", group.label);
    var key = createElement("p", "finding-key", group.key);
    var badge = createElement("span", "badge badge-danger", group.tabs.length + "개 탭");
    var list = createElement("div", "tab-list");

    titleBlock.appendChild(title);
    titleBlock.appendChild(key);
    header.appendChild(titleBlock);
    header.appendChild(badge);

    group.tabs.forEach(function appendTab(tab) {
      list.appendChild(createTabRow(tab, analysis, group.label));
    });

    card.appendChild(header);
    card.appendChild(list);
    elements.duplicatesList.appendChild(card);
  });
}

function renderSearchTabs(searchTabs, analysis) {
  clearElement(elements.searchList);

  if (!searchTabs.length) {
    elements.searchList.appendChild(createEmptyNote("감지된 검색 결과 탭이 없습니다."));
    return;
  }

  searchTabs.forEach(function appendItem(item) {
    elements.searchList.appendChild(createTabRow(item.tab, analysis, item.search.label));
  });
}

function renderProtectedTabs(protectedTabs, analysis) {
  clearElement(elements.protectedList);

  if (!protectedTabs.length) {
    elements.protectedList.appendChild(createEmptyNote("자동으로 건드리지 않는 탭이 없습니다."));
    return;
  }

  protectedTabs.forEach(function appendItem(item) {
    elements.protectedList.appendChild(createTabRow(item.tab, analysis, item.reason));
  });
}

function renderCleanupSection(analysis) {
  syncManualCleanupSelections(analysis);

  var cleanupPlan = buildCleanupPlan(analysis);
  var selectableCandidates = cleanupPlan.candidates.filter(function isSelectableCandidate(candidate) {
    return candidate.selectable;
  });

  cleanupState.candidates = cleanupPlan.candidates;
  cleanupState.previewCandidates = [];

  elements.cleanupSummary.textContent = cleanupPlan.selectableCount + "개 닫기 가능";
  elements.cleanupCandidateMetric.textContent = String(cleanupPlan.selectableCount);
  elements.resetManualCleanupButton.disabled = cleanupState.isBusy || cleanupPlan.manualSelectedCount === 0;
  elements.cleanupPreviewPanel.classList.add("is-hidden");
  elements.cleanupResultPanel.classList.add("is-hidden");
  clearElement(elements.cleanupCandidatesList);
  renderCleanupTypeSummary(cleanupPlan);
  elements.cleanupCandidatesDetails.open = selectableCandidates.length > 0;

  if (!selectableCandidates.length) {
    elements.cleanupCandidatesList.appendChild(createEmptyNote("정리할 탭이 거의 없습니다. 현재 창은 깔끔한 상태입니다. 중복 탭이나 오래 안 본 탭이 생기면 이곳에서 정리할 수 있습니다."));
    updateCleanupButtons();
    return;
  }

  selectableCandidates.forEach(function appendCandidate(candidate) {
    elements.cleanupCandidatesList.appendChild(createCleanupCandidateRow(candidate));
  });

  updateCleanupButtons();
}

function buildCleanupPlan(analysis) {
  var candidateMap = new Map();

  analysis.duplicateGroups.forEach(function collectDuplicateGroup(group) {
    var keepTab = chooseDuplicateKeepTab(group.tabs, analysis);

    group.tabs.forEach(function collectDuplicate(tab) {
      if (keepTab && tab.id === keepTab.id) {
        return;
      }

      addCleanupCandidate(candidateMap, tab, "중복 탭", true, analysis);
    });
  });

  getFilteredStaleItems(analysis.staleAnalysis).forEach(function collectStale(item) {
    addCleanupCandidate(candidateMap, item.tab, "오래 안 본 탭", false, analysis);
  });

  analysis.searchTabs.forEach(function collectSearch(item) {
    addCleanupCandidate(candidateMap, item.tab, item.search.label, false, analysis);
  });

  analysis.protectedTabs.forEach(function collectProtected(item) {
    addCleanupCandidate(candidateMap, item.tab, "보호 탭", false, analysis);
  });

  analysis.tabs.forEach(function collectManual(tab) {
    if (manualCleanupTabIds.has(tab.id)) {
      addManualCleanupCandidate(candidateMap, tab, analysis);
    }
  });

  var candidates = Array.from(candidateMap.values()).sort(sortCleanupCandidates);

  candidates.forEach(function applySelectionOverride(candidate) {
    if (Object.prototype.hasOwnProperty.call(cleanupSelectionOverrides, String(candidate.tabId))) {
      candidate.selected = Boolean(cleanupSelectionOverrides[String(candidate.tabId)]);
    }
  });

  var selectableCount = candidates.filter(function isSelectable(candidate) {
    return candidate.selectable;
  }).length;
  var manualSelectedCount = candidates.filter(function isManualSelected(candidate) {
    return candidate.selectable && candidate.manualSelected;
  }).length;

  return {
    candidates: candidates,
    selectableCount: selectableCount,
    manualSelectedCount: manualSelectedCount,
    selectedCount: candidates.filter(isSelectedCleanupCandidate).length,
    excludedCount: candidates.filter(function isExcluded(candidate) {
      return !candidate.selectable;
    }).length,
    protectedCount: analysis.protectedTabs.length
  };
}

function renderCleanupTypeSummary(cleanupPlan) {
  clearElement(elements.cleanupTypeSummary);

  var sourceCounts = countCleanupSources(cleanupPlan.candidates);

  if (cleanupPlan.selectableCount === 0) {
    elements.cleanupTypeSummary.appendChild(createElement(
      "p",
      "cleanup-ready-note",
      "정리할 탭이 거의 없습니다. 현재 창은 깔끔한 상태입니다. 중복 탭이나 오래 안 본 탭이 생기면 이곳에서 정리할 수 있습니다."
    ));
    return;
  }

  [
    ["중복 탭", sourceCounts.duplicate],
    ["오래 안 본 탭", sourceCounts.stale],
    ["검색 결과 탭", sourceCounts.search],
    ["직접 고른 탭", cleanupPlan.manualSelectedCount]
  ].forEach(function appendSummary(item) {
    var summary = createElement("article", "cleanup-type-card");
    summary.appendChild(createElement("span", "", item[0]));
    summary.appendChild(createElement("strong", "", item[1] + "개"));
    elements.cleanupTypeSummary.appendChild(summary);
  });
}

function countCleanupSources(candidates) {
  var counts = {
    duplicate: 0,
    stale: 0,
    search: 0
  };

  candidates.forEach(function countCandidate(candidate) {
    if (!candidate.selectable) {
      return;
    }

    if (candidate.sources.indexOf("중복 탭") !== -1) {
      counts.duplicate += 1;
    }

    if (candidate.sources.indexOf("오래 안 본 탭") !== -1) {
      counts.stale += 1;
    }

    if (candidate.sources.some(function isSearchSource(source) {
      return source.indexOf("검색 결과") !== -1;
    })) {
      counts.search += 1;
    }
  });

  return counts;
}

function getFilteredStaleItems(staleAnalysis) {
  var items = staleAnalysis && Array.isArray(staleAnalysis.items) ? staleAnalysis.items : [];

  return items.filter(function isOlderThanFilter(item) {
    return item.ageDays >= staleFilterDays;
  });
}

function syncStaleFilterButtons() {
  Array.from(document.querySelectorAll("[data-stale-filter]")).forEach(function syncButton(button) {
    button.classList.toggle("is-active", Number(button.getAttribute("data-stale-filter")) === staleFilterDays);
  });
}

function addCleanupCandidate(candidateMap, tab, sourceLabel, defaultSelected, analysis) {
  if (!tab || typeof tab.id !== "number") {
    return;
  }

  var key = String(tab.id);
  var existing = candidateMap.get(key);
  var exclusionReason = getCloseExclusionReason(tab, analysis);

  if (!existing) {
    existing = {
      tabId: tab.id,
      tab: tab,
      sources: [],
      manualSelected: false,
      selectable: !exclusionReason,
      disabledReason: exclusionReason,
      selected: !exclusionReason && Boolean(defaultSelected)
    };
    candidateMap.set(key, existing);
  }

  if (existing.sources.indexOf(sourceLabel) === -1) {
    existing.sources.push(sourceLabel);
  }

  if (!existing.disabledReason && defaultSelected) {
    existing.selected = true;
  }
}

function addManualCleanupCandidate(candidateMap, tab, analysis) {
  if (!tab || typeof tab.id !== "number") {
    return;
  }

  var key = String(tab.id);
  var existing = candidateMap.get(key);
  var exclusionReason = getManualCloseExclusionReason(tab, analysis);

  if (!existing) {
    existing = {
      tabId: tab.id,
      tab: tab,
      sources: [],
      manualSelected: true,
      selectable: !exclusionReason,
      disabledReason: exclusionReason,
      selected: !exclusionReason
    };
    candidateMap.set(key, existing);
  } else {
    existing.manualSelected = true;

    if (!exclusionReason) {
      existing.selectable = true;
      existing.disabledReason = "";
      existing.selected = true;
    }
  }

  if (existing.sources.indexOf("직접 고른 탭") === -1) {
    existing.sources.push("직접 고른 탭");
  }
}

function syncManualCleanupSelections(analysis) {
  var currentTabsById = new Map();

  analysis.tabs.forEach(function mapCurrentTab(tab) {
    currentTabsById.set(tab.id, tab);
  });

  Array.from(manualCleanupTabIds).forEach(function removeMissingTab(tabId) {
    var tab = currentTabsById.get(tabId);

    if (!tab || getManualCloseExclusionReason(tab, analysis)) {
      manualCleanupTabIds.delete(tabId);
      restorePreviousCleanupSelection(String(tabId));
    }
  });
}

function resetManualCleanupSelection() {
  Array.from(manualCleanupTabIds).forEach(function restoreManualTab(tabId) {
    restorePreviousCleanupSelection(String(tabId));
  });
  manualCleanupTabIds.clear();
  cleanupState.previewCandidates = [];
  elements.cleanupPreviewPanel.classList.add("is-hidden");

  if (currentAnalysis) {
    renderAnalysis(currentAnalysis);
  }
}

function toggleManualCleanupSelection(tab) {
  if (!currentAnalysis || !tab || typeof tab.id !== "number") {
    return;
  }

  var reason = getManualCloseExclusionReason(tab, currentAnalysis);

  if (reason) {
    return;
  }

  if (manualCleanupTabIds.has(tab.id)) {
    manualCleanupTabIds.delete(tab.id);
    restorePreviousCleanupSelection(String(tab.id));
  } else {
    rememberPreviousCleanupSelection(tab.id);
    manualCleanupTabIds.add(tab.id);
    cleanupSelectionOverrides[String(tab.id)] = true;
  }

  cleanupState.previewCandidates = [];
  elements.cleanupPreviewPanel.classList.add("is-hidden");
  renderAnalysis(currentAnalysis);
}

function rememberPreviousCleanupSelection(tabId) {
  var key = String(tabId);

  if (Object.prototype.hasOwnProperty.call(manualCleanupPreviousSelections, key)) {
    return;
  }

  var currentCandidate = cleanupState.candidates.find(function findCandidate(candidate) {
    return String(candidate.tabId) === key;
  });

  if (currentCandidate) {
    manualCleanupPreviousSelections[key] = Boolean(currentCandidate.selected);
    return;
  }

  if (Object.prototype.hasOwnProperty.call(cleanupSelectionOverrides, key)) {
    manualCleanupPreviousSelections[key] = Boolean(cleanupSelectionOverrides[key]);
    return;
  }

  manualCleanupPreviousSelections[key] = null;
}

function restorePreviousCleanupSelection(key) {
  if (!Object.prototype.hasOwnProperty.call(manualCleanupPreviousSelections, key)) {
    delete cleanupSelectionOverrides[key];
    return;
  }

  if (typeof manualCleanupPreviousSelections[key] === "boolean") {
    cleanupSelectionOverrides[key] = manualCleanupPreviousSelections[key];
  } else {
    delete cleanupSelectionOverrides[key];
  }

  delete manualCleanupPreviousSelections[key];
}

function chooseDuplicateKeepTab(tabs, analysis) {
  return tabs.slice().sort(function sortKeepTabs(a, b) {
    var priorityDiff = getDuplicateKeepPriority(a, analysis) - getDuplicateKeepPriority(b, analysis);

    if (priorityDiff !== 0) {
      return priorityDiff;
    }

    return getTabIndex(a) - getTabIndex(b);
  })[0] || null;
}

function getDuplicateKeepPriority(tab, analysis) {
  if (isTabTidyInternalUrl(tab.url) || getProtectedReason(tab.url)) {
    return 0;
  }

  if (analysis.tabMetaById[tab.id] && analysis.tabMetaById[tab.id].isProtected) {
    return 0;
  }

  if (tab.pinned) {
    return 1;
  }

  if (tab.active) {
    return 2;
  }

  return 3;
}

function createCleanupCandidateRow(candidate) {
  var row = createElement("article", "cleanup-candidate-row");
  var checkbox = document.createElement("input");
  var body = createElement("div", "tab-main");
  var title = createElement("p", "tab-title", candidate.tab.title || "제목 없는 탭");
  var url = createElement("p", "tab-url", extractDomain(candidate.tab.url));
  var meta = createElement("p", "tab-meta", candidate.sources.join(", "));
  var noteMeta = getTabMeta(candidate.tab);
  var badges = createElement("div", "tab-badges");

  checkbox.type = "checkbox";
  checkbox.className = "cleanup-checkbox";
  checkbox.checked = candidate.selected;
  checkbox.disabled = !candidate.selectable || cleanupState.isBusy;
  checkbox.setAttribute("aria-label", (candidate.tab.title || "제목 없는 탭") + " 닫을 탭 선택");

  if (candidate.selected) {
    row.classList.add("is-selected");
  }

  if (!candidate.selectable) {
    row.classList.add("is-disabled");
    badges.appendChild(createElement("span", "badge badge-protected", candidate.disabledReason || "닫지 않음"));
  } else {
    badges.appendChild(createElement("span", "badge badge-danger", "닫을 탭"));
  }

  candidate.sources.forEach(function appendSource(source) {
    badges.appendChild(createElement("span", "badge", source));
  });

  if (noteMeta.note) {
    badges.appendChild(createElement("span", "badge badge-warning", "메모 있음"));
  }

  if (noteMeta.isProtected) {
    badges.appendChild(createElement("span", "badge badge-protected", "보호됨"));
  }

  checkbox.addEventListener("change", function handleCandidateChange() {
    candidate.selected = checkbox.checked;
    cleanupSelectionOverrides[String(candidate.tabId)] = checkbox.checked;
    row.classList.toggle("is-selected", candidate.selected);
    elements.cleanupPreviewPanel.classList.add("is-hidden");
    cleanupState.previewCandidates = [];
    updateCleanupButtons();
  });

  body.appendChild(title);
  body.appendChild(url);
  body.appendChild(meta);
  body.appendChild(badges);
  body.appendChild(createTabControls(candidate.tab));
  row.appendChild(checkbox);
  row.appendChild(body);
  return row;
}

function renderCleanupPreview() {
  var selectedCandidates = getSelectedCleanupCandidates();
  var directCandidates = selectedCandidates.filter(function isDirectCandidate(candidate) {
    return candidate.manualSelected;
  });
  var automaticCandidates = selectedCandidates.filter(function isAutomaticCandidate(candidate) {
    return !candidate.manualSelected;
  });

  cleanupState.previewCandidates = selectedCandidates;
  clearElement(elements.previewCloseList);

  if (!selectedCandidates.length) {
    elements.previewCloseList.appendChild(createEmptyNote("선택된 탭이 없습니다."));
  } else {
    appendPreviewCandidateBucket("직접 고른 탭", directCandidates);
    appendPreviewCandidateBucket("자동으로 찾은 탭", automaticCandidates);
  }

  elements.previewCloseCount.textContent = selectedCandidates.length + "개 닫기";
  elements.previewKeepCount.textContent = String(Math.max(0, currentAnalysis.tabs.length - selectedCandidates.length));
  elements.previewProtectedCount.textContent = String(getProtectedTabCount(currentAnalysis));
  elements.previewExcludedCount.textContent = String(getExcludedCleanupCandidateCount());
  elements.cleanupPreviewPanel.classList.remove("is-hidden");
  elements.cleanupResultPanel.classList.add("is-hidden");
  updateCleanupButtons();
}

function appendPreviewCandidateBucket(titleText, candidates) {
  if (!candidates.length) {
    return;
  }

  var card = createElement("article", "finding-card");
  var header = createElement("div", "finding-card-header");
  var titleBlock = createElement("div");
  var title = createElement("p", "finding-title", titleText);
  var key = createElement("p", "finding-key", "미리보기와 최종 확인 후 닫습니다.");
  var badge = createElement("span", "badge badge-danger", candidates.length + "개 닫기");
  var list = createElement("div", "tab-list");

  titleBlock.appendChild(title);
  titleBlock.appendChild(key);
  header.appendChild(titleBlock);
  header.appendChild(badge);

  candidates.forEach(function appendPreview(candidate) {
    list.appendChild(createTabRow(candidate.tab, currentAnalysis, candidate.sources.join(", ")));
  });

  card.appendChild(header);
  card.appendChild(list);
  elements.previewCloseList.appendChild(card);
}

function cancelCleanupPreview() {
  cleanupState.previewCandidates = [];
  elements.cleanupPreviewPanel.classList.add("is-hidden");
  updateCleanupButtons();
}

async function executeCleanup() {
  if (cleanupState.isBusy || !cleanupState.previewCandidates.length || !currentAnalysis) {
    return;
  }

  var selectedCandidates = cleanupState.previewCandidates.slice();
  var confirmationMessage = "선택한 탭 " + selectedCandidates.length + "개를 닫으시겠습니까?";

  if (!window.confirm(confirmationMessage)) {
    return;
  }

  setCleanupBusy(true);

  try {
    var beforeAnalysis = currentAnalysis;
    var requestedClosedTabs = selectedCandidates.map(function snapshotCandidate(candidate) {
      return createClosedTabSnapshot(candidate.tab, candidate.sources);
    });
    var cleanupId = "cleanup-" + Date.now();
    var snapshot = {
      id: cleanupId,
      createdAt: new Date().toISOString(),
      beforeTabCount: beforeAnalysis.tabs.length,
      beforeScore: beforeAnalysis.overallScore,
      protectedCount: getProtectedTabCount(beforeAnalysis),
      excludedCount: getExcludedCleanupCandidateCount(),
      closedTabs: requestedClosedTabs,
      undoUsed: false
    };

    await writeStorageItems(createStoragePayload(LAST_CLEANUP_KEY, snapshot));

    var closeResult = await closeSelectedTabs(selectedCandidates);
    snapshot.closedTabs = closeResult.closedTabs;
    await writeStorageItems(createStoragePayload(LAST_CLEANUP_KEY, snapshot));

    var afterTabs = await queryCurrentWindowTabs();
    var afterAnalysis = await analyzeTabs(afterTabs);
    var historyEntry = {
      id: cleanupId,
      createdAt: snapshot.createdAt,
      beforeTabCount: beforeAnalysis.tabs.length,
      afterTabCount: afterAnalysis.tabs.length,
      beforeScore: beforeAnalysis.overallScore,
      afterScore: afterAnalysis.overallScore,
      closedCount: closeResult.closedTabs.length,
      protectedCount: getProtectedTabCount(beforeAnalysis),
      excludedCount: snapshot.excludedCount,
      closedTabs: closeResult.closedTabs
    };

    await appendCleanupHistory(historyEntry);
    currentAnalysis = afterAnalysis;
    renderAnalysis(afterAnalysis);
    renderCleanupResult(historyEntry, closeResult.failures);
    showOnly(elements.contentState);
  } catch (error) {
    renderCleanupError(error);
  } finally {
    setCleanupBusy(false);
    refreshUndoButtonState();
  }
}

async function closeSelectedTabs(candidates) {
  var closedTabs = [];
  var failures = [];
  var tabMeta = await readStoredTabMeta();

  for (var index = 0; index < candidates.length; index += 1) {
    var candidate = candidates[index];

    try {
      var liveTab = await getTabById(candidate.tabId);

      if (!liveTab) {
        failures.push(createCloseFailure(candidate.tab, "탭을 찾을 수 없습니다."));
        continue;
      }

      var exclusionReason = candidate.manualSelected
        ? getLiveManualCloseExclusionReason(liveTab, tabMeta)
        : getLiveCloseExclusionReason(liveTab);

      if (exclusionReason) {
        failures.push(createCloseFailure(liveTab, "닫기 전 제외: " + exclusionReason));
        continue;
      }

      if (tabMeta[String(liveTab.id)] && tabMeta[String(liveTab.id)].isProtected) {
        failures.push(createCloseFailure(liveTab, "닫기 전 제외: 보호한 탭"));
        continue;
      }

      await removeTabById(liveTab.id);
      closedTabs.push(createClosedTabSnapshot(liveTab, candidate.sources));
    } catch (error) {
      failures.push(createCloseFailure(candidate.tab, error && error.message ? error.message : "닫기 실패"));
    }
  }

  return {
    closedTabs: closedTabs,
    failures: failures
  };
}

async function undoLastCleanup() {
  if (cleanupState.isBusy) {
    return;
  }

  setCleanupBusy(true);

  try {
    var snapshot = await readStorageValue(LAST_CLEANUP_KEY);

    if (!snapshot || snapshot.undoUsed || !Array.isArray(snapshot.closedTabs) || !snapshot.closedTabs.length) {
      showUndoMessage("되돌릴 마지막 정리가 없습니다.");
      return;
    }

    var reopenedCount = 0;

    for (var index = 0; index < snapshot.closedTabs.length; index += 1) {
      var closedTab = snapshot.closedTabs[index];
      var reopened = await reopenClosedTab(closedTab);

      if (reopened) {
        reopenedCount += 1;
      }
    }

    snapshot.undoUsed = true;
    await writeStorageItems(createStoragePayload(LAST_CLEANUP_KEY, snapshot));
    await renderDashboard();
    showUndoMessage("닫은 탭 주소를 다시 열었습니다. 다시 연 탭 " + reopenedCount + "개");
  } catch (error) {
    showUndoMessage(error && error.message ? error.message : "되돌리기 실행 중 오류가 발생했습니다.");
  } finally {
    setCleanupBusy(false);
    refreshUndoButtonState();
  }
}

function renderCleanupResult(historyEntry, failures) {
  var failureCount = Array.isArray(failures) ? failures.length : 0;

  elements.cleanupResultPanel.classList.remove("is-hidden");
  elements.cleanupResultSummary.textContent = historyEntry.closedCount + "개 닫음";
  elements.cleanupResultMessage.textContent =
    "정리가 완료되었습니다. 닫은 탭 " + historyEntry.closedCount + "개" +
    (failureCount ? ", 닫지 못한 탭 " + failureCount + "개" : "") + ". " +
    "보호된 탭 " + historyEntry.protectedCount + "개는 유지되었습니다. " +
    "필요하면 되돌리기로 방금 닫은 탭 주소를 다시 열 수 있습니다.";
  clearElement(elements.cleanupFailureList);

  if (!failures.length) {
    elements.cleanupFailureList.appendChild(createEmptyNote("닫기 실패 탭이 없습니다."));
    return;
  }

  failures.forEach(function appendFailure(failure) {
    var row = createElement("article", "tab-row");
    var main = createElement("div", "tab-main");
    var title = createElement("p", "tab-title", failure.title || "제목 없는 탭");
    var url = createElement("p", "tab-url", failure.url || "주소 없음");
    var meta = createElement("p", "tab-meta", failure.reason);
    var badges = createElement("div", "tab-badges");

    badges.appendChild(createElement("span", "badge badge-danger", "닫기 실패"));
    main.appendChild(title);
    main.appendChild(url);
    main.appendChild(meta);
    row.appendChild(main);
    row.appendChild(badges);
    elements.cleanupFailureList.appendChild(row);
  });
}

function renderCleanupError(error) {
  elements.cleanupResultPanel.classList.remove("is-hidden");
  elements.cleanupResultSummary.textContent = "오류";
  elements.cleanupResultMessage.textContent = error && error.message
    ? error.message
    : "정리 실행 중 오류가 발생했습니다.";
  clearElement(elements.cleanupFailureList);
}

async function renderCleanupHistory() {
  var history = await readStorageValue(CLEANUP_HISTORY_KEY);

  clearElement(elements.cleanupHistoryList);
  syncHistoryFilterButtons();

  if (!Array.isArray(history) || !history.length) {
    elements.cleanupHistorySummary.textContent = "0개 기록";
    elements.clearCleanupHistoryButton.disabled = true;
    elements.cleanupHistoryList.appendChild(createEmptyNote("아직 정리 기록이 없습니다."));
    return;
  }

  var recentHistory = history.slice(0, CLEANUP_HISTORY_LIMIT);
  var filteredHistory = filterCleanupHistory(recentHistory);

  elements.clearCleanupHistoryButton.disabled = false;
  elements.cleanupHistorySummary.textContent = getCleanupHistorySummaryText(filteredHistory.length, recentHistory.length);

  if (!filteredHistory.length) {
    elements.cleanupHistoryList.appendChild(createEmptyNote("선택한 기간에 해당하는 정리 기록이 없습니다."));
    return;
  }

  filteredHistory.forEach(function appendHistory(entry) {
    elements.cleanupHistoryList.appendChild(createCleanupHistoryCard(entry));
  });
}

function createCleanupHistoryCard(entry) {
  var card = createElement("article", "finding-card history-card");
  var header = createElement("div", "finding-card-header");
  var titleBlock = createElement("div");
  var title = createElement("p", "finding-title", formatCleanupDate(entry.createdAt));
  var key = createElement("p", "finding-key", "탭 " + entry.beforeTabCount + "개 → " + entry.afterTabCount + "개");
  var headerActions = createElement("div", "history-card-actions");
  var badge = createElement("span", "badge badge-good", "닫은 탭 " + entry.closedCount + "개");
  var deleteButton = createElement("button", "tool-button danger-text-button", "기록 지우기");
  var grid = createElement("div", "history-grid");
  var closedTabsDetails = createClosedTabsDetails(entry.closedTabs);

  deleteButton.type = "button";
  deleteButton.addEventListener("click", function handleDeleteHistoryClick() {
    deleteCleanupHistoryEntry(entry);
  });

  titleBlock.appendChild(title);
  titleBlock.appendChild(key);
  headerActions.appendChild(badge);
  headerActions.appendChild(deleteButton);
  header.appendChild(titleBlock);
  header.appendChild(headerActions);

  [
    ["닫은 탭", entry.closedCount],
    ["보호 탭", entry.protectedCount],
    ["점수 변화", entry.beforeScore + " → " + entry.afterScore],
    ["건드리지 않은 탭", entry.excludedCount]
  ].forEach(function appendMetric(item) {
    var metric = createElement("article", "history-metric");
    metric.appendChild(createElement("span", "", item[0]));
    metric.appendChild(createElement("strong", "", String(item[1])));
    grid.appendChild(metric);
  });

  card.appendChild(header);
  card.appendChild(grid);
  card.appendChild(closedTabsDetails);
  return card;
}

async function deleteCleanupHistoryEntry(entry) {
  if (!window.confirm("이 정리 기록을 삭제하시겠습니까?")) {
    return;
  }

  var history = await readStorageValue(CLEANUP_HISTORY_KEY);

  if (!Array.isArray(history)) {
    await renderCleanupHistory();
    return;
  }

  var targetKey = getCleanupHistoryEntryKey(entry);
  var nextHistory = history.filter(function keepHistoryItem(item) {
    return getCleanupHistoryEntryKey(item) !== targetKey;
  });

  await writeStorageItems(createStoragePayload(CLEANUP_HISTORY_KEY, nextHistory.slice(0, CLEANUP_HISTORY_LIMIT)));
  await renderCleanupHistory();
}

async function clearCleanupHistory() {
  if (!window.confirm("전체 정리 기록을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.")) {
    return;
  }

  await writeStorageItems(createStoragePayload(CLEANUP_HISTORY_KEY, []));
  await renderCleanupHistory();
}

function getCleanupHistoryEntryKey(entry) {
  if (entry && entry.id) {
    return "id:" + entry.id;
  }

  return "createdAt:" + (entry && entry.createdAt ? entry.createdAt : "");
}

function createClosedTabsDetails(closedTabs) {
  var details = createElement("details", "closed-tabs-details");
  var summary = createElement(
    "summary",
    "",
    "닫힌 탭 주소 보기"
  );
  var list = createElement("div", "tab-list");

  details.appendChild(summary);

  if (!Array.isArray(closedTabs) || !closedTabs.length) {
    list.appendChild(createEmptyNote("기록된 닫힌 탭 주소가 없습니다."));
  } else {
    closedTabs.forEach(function appendClosedTab(closedTab) {
      var row = createElement("article", "tab-row");
      var main = createElement("div", "tab-main");
      main.appendChild(createElement("p", "tab-title", closedTab.title || "제목 없는 탭"));
      main.appendChild(createElement("p", "tab-url", extractDomain(closedTab.url)));
      row.appendChild(main);
      list.appendChild(row);
    });
  }

  details.appendChild(list);
  return details;
}

function filterCleanupHistory(history) {
  if (cleanupHistoryFilter === "all") {
    return history;
  }

  var now = Date.now();
  var rangeMs = cleanupHistoryFilter === "today"
    ? getTodayRangeMs()
    : Number(cleanupHistoryFilter) * ONE_DAY_MS;

  return history.filter(function isInRange(entry) {
    var createdAt = Date.parse(entry.createdAt);

    if (!Number.isFinite(createdAt)) {
      return false;
    }

    if (cleanupHistoryFilter === "today") {
      return createdAt >= rangeMs.start && createdAt <= rangeMs.end;
    }

    return now - createdAt <= rangeMs;
  });
}

function getTodayRangeMs() {
  var start = new Date();
  start.setHours(0, 0, 0, 0);

  var end = new Date(start.getTime());
  end.setHours(23, 59, 59, 999);

  return {
    start: start.getTime(),
    end: end.getTime()
  };
}

function getCleanupHistorySummaryText(filteredCount, totalCount) {
  if (cleanupHistoryFilter === "all") {
    return totalCount + "개 기록";
  }

  return filteredCount + "개 표시 / " + totalCount + "개 기록";
}

function syncHistoryFilterButtons() {
  Array.from(document.querySelectorAll("[data-history-filter]")).forEach(function syncButton(button) {
    button.classList.toggle("is-active", button.getAttribute("data-history-filter") === cleanupHistoryFilter);
  });
}

async function appendCleanupHistory(historyEntry) {
  var history = await readStorageValue(CLEANUP_HISTORY_KEY);

  if (!Array.isArray(history)) {
    history = [];
  }

  history.unshift(historyEntry);
  await writeStorageItems(createStoragePayload(CLEANUP_HISTORY_KEY, history.slice(0, CLEANUP_HISTORY_LIMIT)));
}

async function refreshUndoButtonState() {
  var snapshot = await readStorageValue(LAST_CLEANUP_KEY);
  var statusMessage = "되돌릴 마지막 정리가 없습니다.";
  var canUndo = Boolean(
    snapshot &&
    !snapshot.undoUsed &&
    Array.isArray(snapshot.closedTabs) &&
    snapshot.closedTabs.length
  );

  elements.undoCleanupButton.disabled = cleanupState.isBusy || !canUndo;

  if (snapshot && snapshot.undoUsed) {
    statusMessage = "이미 되돌린 정리입니다.";
  } else if (canUndo) {
    statusMessage = "마지막 정리에서 닫은 탭 " + snapshot.closedTabs.length + "개를 주소로 다시 열 수 있습니다.";
  }

  elements.undoStatusMessage.textContent = statusMessage + " 되돌리기는 방금 닫은 탭의 주소를 다시 여는 기능입니다. 페이지 안에 입력한 내용이나 스크롤 위치까지 복구되지는 않습니다.";
}

function updateCleanupButtons() {
  var selectedCount = getSelectedCleanupCandidates().length;
  var hasPreview = cleanupState.previewCandidates.length > 0;

  elements.previewCleanupButton.disabled = cleanupState.isBusy || selectedCount === 0;
  elements.resetManualCleanupButton.disabled = cleanupState.isBusy || manualCleanupTabIds.size === 0;
  elements.executeCleanupButton.disabled = cleanupState.isBusy || !hasPreview;
  elements.cancelCleanupPreviewButton.disabled = cleanupState.isBusy;
  elements.refreshButton.disabled = cleanupState.isBusy;
  refreshUndoButtonState();
}

function setCleanupBusy(isBusy) {
  cleanupState.isBusy = Boolean(isBusy);
  Array.from(elements.cleanupCandidatesList.querySelectorAll(".cleanup-checkbox")).forEach(function toggleCheckbox(checkbox) {
    checkbox.disabled = isBusy || checkbox.closest(".cleanup-candidate-row").classList.contains("is-disabled");
  });
  Array.from(document.querySelectorAll(".tool-button")).forEach(function toggleToolButton(button) {
    button.disabled = isBusy;
  });
  updateCleanupButtons();
}

function getSelectedCleanupCandidates() {
  return cleanupState.candidates.filter(isSelectedCleanupCandidate);
}

function isSelectedCleanupCandidate(candidate) {
  return candidate.selectable && candidate.selected;
}

function getExcludedCleanupCandidateCount() {
  return cleanupState.candidates.filter(function isExcluded(candidate) {
    return !candidate.selectable;
  }).length;
}

function getProtectedTabCount(analysis) {
  var protectedIds = new Set();

  analysis.protectedTabs.forEach(function addProtected(item) {
    if (item.tab && typeof item.tab.id === "number") {
      protectedIds.add(item.tab.id);
    }
  });

  Object.keys(analysis.tabMetaById || {}).forEach(function addUserProtected(tabId) {
    if (analysis.tabMetaById[tabId] && analysis.tabMetaById[tabId].isProtected) {
      protectedIds.add(Number(tabId));
    }
  });

  return protectedIds.size;
}

function getCloseExclusionReason(tab, analysis) {
  if (!tab || typeof tab.id !== "number") {
    return "탭 정보 없음";
  }

  if (isTabTidyInternalUrl(tab.url)) {
    return "TabTidy 화면";
  }

  if (tab.pinned) {
    return "고정된 탭";
  }

  if (tab.active) {
    return "현재 보고 있는 탭";
  }

  if (analysis.tabMetaById[tab.id] && analysis.tabMetaById[tab.id].isProtected) {
    return "보호한 탭";
  }

  return getProtectedReason(tab.url) || "";
}

function getManualCloseExclusionReason(tab, analysis) {
  if (!tab || typeof tab.id !== "number") {
    return "탭 정보 없음";
  }

  if (analysis.tabMetaById[tab.id] && analysis.tabMetaById[tab.id].isProtected) {
    return "보호한 탭";
  }

  if (isCurrentDashboardTab(tab)) {
    return "현재 TabTidy 화면";
  }

  return "";
}

function getLiveCloseExclusionReason(tab) {
  if (isTabTidyInternalUrl(tab.url)) {
    return "현재 TabTidy 화면";
  }

  if (tab.pinned) {
    return "고정된 탭";
  }

  if (tab.active) {
    return "현재 보고 있는 탭";
  }

  return getProtectedReason(tab.url) || "";
}

function getLiveManualCloseExclusionReason(tab, tabMeta) {
  if (!tab || typeof tab.id !== "number") {
    return "탭 정보 없음";
  }

  if (tabMeta[String(tab.id)] && tabMeta[String(tab.id)].isProtected) {
    return "보호한 탭";
  }

  if (isCurrentDashboardTab(tab)) {
    return "현재 TabTidy 화면";
  }

  return "";
}

function isTabTidyInternalUrl(rawUrl) {
  try {
    var baseUrl = chrome.runtime.getURL("").toLowerCase();
    var urlText = String(rawUrl || "").trim().toLowerCase();

    return Boolean(baseUrl) && urlText.indexOf(baseUrl) === 0;
  } catch (error) {
    return false;
  }
}

function isCurrentDashboardTab(tab) {
  if (!tab || !tab.active) {
    return false;
  }

  try {
    var tabUrl = new URL(String(tab.url || ""));
    var dashboardUrl = new URL(chrome.runtime.getURL("dashboard.html"));

    return tabUrl.origin === dashboardUrl.origin && tabUrl.pathname === dashboardUrl.pathname;
  } catch (error) {
    return false;
  }
}

function createClosedTabSnapshot(tab, sources) {
  return {
    tabId: tab.id,
    title: tab.title || "",
    url: tab.url || "",
    windowId: typeof tab.windowId === "number" ? tab.windowId : null,
    groupId: getGroupId(tab),
    index: typeof tab.index === "number" ? tab.index : null,
    sources: Array.isArray(sources) ? sources.slice() : []
  };
}

function createCloseFailure(tab, reason) {
  return {
    tabId: tab && typeof tab.id === "number" ? tab.id : null,
    title: tab && tab.title ? tab.title : "제목 없는 탭",
    url: tab && tab.url ? tab.url : "",
    reason: reason
  };
}

function getTabById(tabId) {
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

function removeTabById(tabId) {
  return new Promise(function remove(resolve, reject) {
    try {
      chrome.tabs.remove(tabId, function handleRemove() {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        resolve();
      });
    } catch (error) {
      reject(error);
    }
  });
}

function reopenClosedTab(closedTab) {
  return new Promise(function create(resolve) {
    var url = closedTab && closedTab.url ? closedTab.url : "";

    if (!url) {
      resolve(false);
      return;
    }

    var createProperties = {
      url: url,
      active: false
    };

    if (closedTab && typeof closedTab.windowId === "number") {
      createProperties.windowId = closedTab.windowId;
    }

    try {
      chrome.tabs.create(createProperties, function handleCreated(tab) {
        if (!chrome.runtime.lastError && tab) {
          resolve(true);
          return;
        }

        try {
          chrome.tabs.create({ url: url, active: false }, function handleFallbackCreated(fallbackTab) {
            resolve(!chrome.runtime.lastError && Boolean(fallbackTab));
          });
        } catch (error) {
          resolve(false);
        }
      });
    } catch (error) {
      resolve(false);
    }
  });
}

function readStorageValue(key) {
  return new Promise(function read(resolve) {
    try {
      chrome.storage.local.get(key, function handleItems(items) {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }

        resolve(items ? items[key] : null);
      });
    } catch (error) {
      resolve(null);
    }
  });
}

function writeStorageItems(items) {
  return new Promise(function write(resolve) {
    try {
      chrome.storage.local.set(items, function handleSet() {
        resolve(!chrome.runtime.lastError);
      });
    } catch (error) {
      resolve(false);
    }
  });
}

function createStoragePayload(key, value) {
  var payload = {};
  payload[key] = value;
  return payload;
}

function getTabMeta(tab) {
  if (!currentAnalysis || !currentAnalysis.tabMetaById || !tab || typeof tab.id !== "number") {
    return {
      isProtected: false,
      note: ""
    };
  }

  return currentAnalysis.tabMetaById[tab.id] || {
    isProtected: false,
    note: ""
  };
}

function getTabKey(tab) {
  return tab && typeof tab.id === "number" ? String(tab.id) : "";
}

function createTabControls(tab) {
  var meta = getTabMeta(tab);
  var tabKey = getTabKey(tab);
  var controls = createElement("div", "tab-tools");
  var protectButton = createElement("button", "tool-button", meta.isProtected ? "보호 해제" : "보호");
  var noteButton = createElement("button", "tool-button", meta.note ? "메모 수정" : "메모");
  var notePanel = createNotePanel(tab, meta.note || "");

  notePanel.classList.toggle("is-hidden", !openNotePanelIds.has(tabKey));
  protectButton.type = "button";
  protectButton.classList.toggle("is-active", Boolean(meta.isProtected));
  protectButton.addEventListener("click", function handleProtectClick() {
    toggleTabProtection(tab);
  });

  noteButton.type = "button";
  noteButton.classList.toggle("is-active", Boolean(meta.note));
  noteButton.addEventListener("click", function handleNoteClick() {
    var isHidden = notePanel.classList.toggle("is-hidden");

    if (isHidden) {
      openNotePanelIds.delete(tabKey);
    } else {
      openNotePanelIds.add(tabKey);
    }
  });

  controls.appendChild(protectButton);
  controls.appendChild(noteButton);

  var wrap = createElement("div");
  wrap.appendChild(controls);
  wrap.appendChild(notePanel);
  return wrap;
}

function createNotePanel(tab, note) {
  var panel = createElement("div", "note-panel is-hidden");
  var textarea = document.createElement("textarea");
  var actions = createElement("div", "note-actions");
  var saveButton = createElement("button", "tool-button", "메모 저장");
  var clearButton = createElement("button", "tool-button", "메모 지우기");
  var helper = createElement("p", "tab-meta", "메모는 판단을 돕는 표시이며 자동으로 닫기 제외하지 않습니다.");

  textarea.value = note;
  textarea.maxLength = 240;
  textarea.placeholder = "짧은 메모를 입력하세요.";
  saveButton.type = "button";
  clearButton.type = "button";

  saveButton.addEventListener("click", function handleSave() {
    saveTabNote(tab, textarea.value.trim());
  });

  clearButton.addEventListener("click", function handleClear() {
    textarea.value = "";
    saveTabNote(tab, "");
  });

  actions.appendChild(saveButton);
  actions.appendChild(clearButton);
  panel.appendChild(textarea);
  panel.appendChild(actions);
  panel.appendChild(helper);
  return panel;
}

async function toggleTabProtection(tab) {
  if (!tab || typeof tab.id !== "number") {
    return;
  }

  var meta = getTabMeta(tab);
  await updateTabMeta(tab, {
    isProtected: !meta.isProtected
  });
  await rerenderAfterMetaChange();
}

async function saveTabNote(tab, note) {
  if (!tab || typeof tab.id !== "number") {
    return;
  }

  openNotePanelIds.add(getTabKey(tab));
  await updateTabMeta(tab, {
    note: String(note || "").slice(0, 240)
  });
  await rerenderAfterMetaChange();
}

async function updateTabMeta(tab, changes) {
  var tabMeta = await readStoredTabMeta();
  var key = String(tab.id);
  var previous = tabMeta[key] || {};
  var now = Date.now();

  tabMeta[key] = Object.assign({}, previous, {
    tabId: tab.id,
    windowId: typeof tab.windowId === "number" ? tab.windowId : previous.windowId || null,
    url: tab.url || previous.url || "",
    title: tab.title || previous.title || "",
    groupId: getGroupId(tab),
    firstSeenAt: previous.firstSeenAt || now,
    lastActivatedAt: previous.lastActivatedAt || null,
    lastUpdatedAt: now,
    isProtected: typeof previous.isProtected === "boolean" ? previous.isProtected : false,
    note: typeof previous.note === "string" ? previous.note : ""
  }, changes);

  await writeStorageItems(createStoragePayload(TAB_META_KEY, tabMeta));
}

async function rerenderAfterMetaChange() {
  if (!currentAnalysis) {
    await renderDashboard();
    return;
  }

  var tabs = await queryCurrentWindowTabs();
  currentAnalysis = await analyzeTabs(tabs);
  cleanupState.previewCandidates = [];
  renderAnalysis(currentAnalysis);
}

function getTabStatusLabel(tab, metaInfo) {
  if (metaInfo.isProtected) {
    return "사용자 보호";
  }

  if (tab.pinned || tab.active || getProtectedReason(tab.url) || isTabTidyInternalUrl(tab.url)) {
    return "건드리지 않음";
  }

  return "";
}

function getAutomaticExcludedTabs(analysis) {
  return analysis.tabs
    .map(function mapExcluded(tab) {
      return {
        tab: tab,
        reason: getCloseExclusionReason(tab, analysis)
      };
    })
    .filter(function hasReason(item) {
      return Boolean(item.reason);
    });
}

function getHealthBadgeText(score) {
  if (score >= 80) {
    return "양호";
  }

  if (score >= 55) {
    return "보통";
  }

  return "정리 필요";
}

function getScoreBadgeClass(score) {
  if (score >= 80) {
    return "badge-good";
  }

  if (score >= 55) {
    return "badge-warning";
  }

  return "badge-danger";
}

function formatCleanupDate(value) {
  try {
    return new Date(value).toLocaleString("ko-KR");
  } catch (error) {
    return "날짜 알 수 없음";
  }
}

function showUndoMessage(message) {
  elements.cleanupResultPanel.classList.remove("is-hidden");
  elements.cleanupResultSummary.textContent = "되돌리기";
  elements.cleanupResultMessage.textContent = message;
  elements.undoMessage.textContent = message;
  clearElement(elements.cleanupFailureList);
}

function sortCleanupCandidates(a, b) {
  if (a.selectable !== b.selectable) {
    return a.selectable ? -1 : 1;
  }

  if (a.selected !== b.selected) {
    return a.selected ? -1 : 1;
  }

  return getTabIndex(a.tab) - getTabIndex(b.tab);
}

function getTabIndex(tab) {
  return typeof tab.index === "number" ? tab.index : Number.MAX_SAFE_INTEGER;
}

function createTabRow(tab, analysis, extraBadgeText, options) {
  var settings = options || {};
  var row = createElement("article", "tab-row");
  var main = createElement("div", "tab-main");
  var title = createElement("p", "tab-title", tab.title || "제목 없는 탭");
  var url = createElement("p", "tab-url", extractDomain(tab.url));
  var metaInfo = getTabMeta(tab);
  var meta = createElement("p", "tab-meta", getTabStatusLabel(tab, metaInfo));
  var badges = createElement("div", "tab-badges");
  var side = createElement("div", "tab-side");
  var protectedReason = getProtectedReason(tab.url);
  var searchInfo = getSearchResultInfo(tab.url);

  main.appendChild(title);
  main.appendChild(url);

  if (meta.textContent) {
    main.appendChild(meta);
  }

  if (extraBadgeText) {
    badges.appendChild(createElement("span", "badge", extraBadgeText));
  }

  if (protectedReason) {
    badges.appendChild(createElement("span", "badge badge-protected", "제외됨"));
  }

  if (isTabTidyInternalUrl(tab.url)) {
    badges.appendChild(createElement("span", "badge badge-protected", "TabTidy 화면"));
  }

  if (tab.pinned) {
    badges.appendChild(createElement("span", "badge badge-protected", "고정된 탭"));
  }

  if (tab.active) {
    badges.appendChild(createElement("span", "badge badge-protected", "현재 보고 있는 탭"));
  }

  if (metaInfo.isProtected) {
    badges.appendChild(createElement("span", "badge badge-protected", "보호됨"));
  }

  if (metaInfo.note) {
    badges.appendChild(createElement("span", "badge badge-warning", "메모 있음"));
  }

  if (manualCleanupTabIds.has(tab.id)) {
    badges.appendChild(createElement("span", "badge badge-danger", "직접 고름"));
  }

  if (!protectedReason && analysis.duplicateTabIds.has(tab.id)) {
    badges.appendChild(createElement("span", "badge badge-danger", "중복"));
  }

  if (searchInfo) {
    badges.appendChild(createElement("span", "badge badge-warning", searchInfo.label));
  }

  if (badges.childNodes.length === 0) {
    badges.appendChild(createElement("span", "badge badge-good", getHealthBadgeText(analysis.overallScore)));
  }

  side.appendChild(badges);
  if (settings.allowManualCleanup) {
    side.appendChild(createManualCleanupControl(tab, analysis));
  }
  side.appendChild(createTabControls(tab));
  row.appendChild(main);
  row.appendChild(side);
  return row;
}

function createManualCleanupControl(tab, analysis) {
  var reason = getManualCloseExclusionReason(tab, analysis);
  var isSelected = manualCleanupTabIds.has(tab.id);
  var button = createElement(
    "button",
    isSelected ? "tool-button is-active" : "tool-button",
    isSelected ? "닫을 탭에서 빼기" : "닫을 탭으로 선택"
  );

  button.type = "button";

  if (reason) {
    button.disabled = true;
    button.textContent = reason === "보호한 탭" ? "보호됨" : "선택할 수 없음";
    button.title = reason;
  } else {
    button.addEventListener("click", function handleManualCleanupClick() {
      toggleManualCleanupSelection(tab);
    });
  }

  return button;
}

function normalizeUrl(rawUrl) {
  try {
    var urlText = String(rawUrl || "").trim();

    if (!urlText || getProtectedReason(urlText)) {
      return urlText;
    }

    var parsed = new URL(urlText);
    var trackingKeys = [];

    parsed.searchParams.forEach(function collectTrackingParam(value, key) {
      if (TRACKING_PARAMS.indexOf(key.toLowerCase()) !== -1) {
        trackingKeys.push(key);
      }
    });

    trackingKeys.forEach(function removeParam(param) {
      parsed.searchParams.delete(param);
    });

    var sortedParams = Array.from(parsed.searchParams.entries()).sort(function sortParams(a, b) {
      var keyCompare = a[0].localeCompare(b[0]);
      return keyCompare !== 0 ? keyCompare : a[1].localeCompare(b[1]);
    });
    var nextParams = new URLSearchParams();

    sortedParams.forEach(function appendParam(entry) {
      nextParams.append(entry[0], entry[1]);
    });

    parsed.search = nextParams.toString();
    return parsed.toString();
  } catch (error) {
    return String(rawUrl || "").trim();
  }
}

function extractDomain(rawUrl) {
  try {
    var protectedReason = getProtectedReason(rawUrl);

    if (protectedReason) {
      return protectedReason;
    }

    var parsed = new URL(String(rawUrl || ""));
    return parsed.hostname.replace(/^www\./, "") || "도메인 없음";
  } catch (error) {
    return "주소 확인 불가";
  }
}

function getSearchResultInfo(rawUrl) {
  try {
    if (getProtectedReason(rawUrl)) {
      return null;
    }

    var parsed = new URL(String(rawUrl || ""));
    var host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    var path = parsed.pathname.toLowerCase();

    if ((host === "google.com" || host.endsWith(".google.com")) && path === "/search") {
      return { label: "Google 검색 결과" };
    }

    if (host === "search.naver.com" && path === "/search.naver") {
      return { label: "Naver 검색 결과" };
    }

    if ((host === "bing.com" || host.endsWith(".bing.com")) && path === "/search") {
      return { label: "Bing 검색 결과" };
    }

    if ((host === "youtube.com" || host.endsWith(".youtube.com")) && path === "/results") {
      return { label: "YouTube 검색 결과" };
    }

    if ((host === "github.com" || host.endsWith(".github.com")) && path === "/search") {
      return { label: "GitHub 검색 결과" };
    }

    return null;
  } catch (error) {
    return null;
  }
}

function getProtectedReason(rawUrl) {
  try {
    var urlText = String(rawUrl || "").trim().toLowerCase();

    if (!urlText) {
      return null;
    }

    for (var index = 0; index < INTERNAL_PREFIXES.length; index += 1) {
      if (urlText.indexOf(INTERNAL_PREFIXES[index].prefix) === 0) {
        return INTERNAL_PREFIXES[index].label;
      }
    }

    return null;
  } catch (error) {
    return "주소 확인 불가";
  }
}

function normalizeTimestamp(value) {
  var timestamp = Number(value);

  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return null;
  }

  return timestamp;
}

function sortByAgeDesc(a, b) {
  return b.ageDays - a.ageDays;
}

function calculateHealthScore(input) {
  var base = 100;
  var tabLimit = input.isGroup ? 6 : 10;
  var tabPenalty = Math.max(0, input.tabCount - tabLimit) * (input.isGroup ? 3 : 1.5);
  var ungroupedPenalty = input.ungroupedCount * 3;
  var duplicatePenalty = input.duplicateCount * 7;
  var searchPenalty = input.searchCount * 4;
  var score = base - tabPenalty - ungroupedPenalty - duplicatePenalty - searchPenalty;

  return clamp(Math.round(score), 0, 100);
}

function getGroupId(tab) {
  return typeof tab.groupId === "number" ? tab.groupId : UNGROUPED_GROUP_ID;
}

function createFallbackGroup(groupId) {
  return {
    id: groupId,
    title: "그룹 " + groupId,
    color: "grey",
    collapsed: false,
    fallback: true
  };
}

function getGroupColorLabel(color) {
  var labels = {
    grey: "회색",
    blue: "파랑",
    red: "빨강",
    yellow: "노랑",
    green: "초록",
    pink: "분홍",
    purple: "보라",
    cyan: "청록",
    orange: "주황"
  };

  return labels[color] || "회색";
}

function addToMap(map, key, tab) {
  if (!map.has(key)) {
    map.set(key, []);
  }

  map.get(key).push(tab);
}

function markDuplicateTabs(groupTabs, duplicateTabIds) {
  groupTabs.forEach(function mark(tab) {
    duplicateTabIds.add(tab.id);
  });
}

function countTabsInSet(tabs, idSet) {
  return tabs.filter(function hasId(tab) {
    return idSet.has(tab.id);
  }).length;
}

function createElement(tagName, className, textContent) {
  var element = document.createElement(tagName);

  if (className) {
    element.className = className;
  }

  if (typeof textContent === "string") {
    element.textContent = textContent;
  }

  return element;
}

function createEmptyNote(message) {
  return createElement("p", "empty-note", message);
}

function clearElement(element) {
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
}

function showOnly(activeElement) {
  [
    elements.loadingState,
    elements.errorState,
    elements.emptyState,
    elements.contentState
  ].forEach(function hide(element) {
    element.classList.add("is-hidden");
  });

  activeElement.classList.remove("is-hidden");
}

function showError(error) {
  elements.errorMessage.textContent = error && error.message
    ? error.message
    : "알 수 없는 오류가 발생했습니다.";
  showOnly(elements.errorState);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
