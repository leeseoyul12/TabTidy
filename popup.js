"use strict";

var UNGROUPED_GROUP_ID = -1;

var elements = {
  loadingState: document.getElementById("loadingState"),
  errorState: document.getElementById("errorState"),
  emptyState: document.getElementById("emptyState"),
  summaryState: document.getElementById("summaryState"),
  errorMessage: document.getElementById("errorMessage"),
  totalTabs: document.getElementById("totalTabs"),
  groupedTabs: document.getElementById("groupedTabs"),
  ungroupedTabs: document.getElementById("ungroupedTabs"),
  tabGroups: document.getElementById("tabGroups"),
  openDashboard: document.getElementById("openDashboard")
};

document.addEventListener("DOMContentLoaded", function handleReady() {
  elements.openDashboard.addEventListener("click", openDashboard);
  renderSummary();
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

function createTab(url) {
  return new Promise(function create(resolve, reject) {
    try {
      chrome.tabs.create({ url: url }, function handleCreated(tab) {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        resolve(tab);
      });
    } catch (error) {
      reject(error);
    }
  });
}

async function renderSummary() {
  showOnly(elements.loadingState);
  elements.openDashboard.disabled = true;

  try {
    var tabs = await queryCurrentWindowTabs();

    if (!tabs.length) {
      showOnly(elements.emptyState);
      return;
    }

    var groupedCount = 0;
    var groupIds = new Set();

    tabs.forEach(function countTab(tab) {
      if (typeof tab.groupId === "number" && tab.groupId !== UNGROUPED_GROUP_ID) {
        groupedCount += 1;
        groupIds.add(tab.groupId);
      }
    });

    elements.totalTabs.textContent = String(tabs.length);
    elements.groupedTabs.textContent = String(groupedCount);
    elements.ungroupedTabs.textContent = String(tabs.length - groupedCount);
    elements.tabGroups.textContent = String(groupIds.size);
    elements.openDashboard.disabled = false;

    showOnly(elements.summaryState);
  } catch (error) {
    showError(error);
  }
}

async function openDashboard() {
  elements.openDashboard.disabled = true;

  try {
    await createTab(chrome.runtime.getURL("dashboard.html"));
  } catch (error) {
    showError(error);
  } finally {
    elements.openDashboard.disabled = false;
  }
}

function showOnly(activeElement) {
  [
    elements.loadingState,
    elements.errorState,
    elements.emptyState,
    elements.summaryState
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
