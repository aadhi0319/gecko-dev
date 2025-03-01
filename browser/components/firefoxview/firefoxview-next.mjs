/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

let pageList = [];
const { topChromeWindow } = window.browsingContext;

function onHashChange() {
  changePage(document.location.hash.substring(1));
}

function changePage(page) {
  let navigation = document.querySelector("fxview-category-navigation");
  if (page && !pageList.includes(page)) {
    page = "recentbrowsing";
    document.location.hash = "recentbrowsing";
  }
  document.querySelector("named-deck").selectedViewName = page || pageList[0];
  navigation.currentCategory = page || pageList[0];
  if (navigation.categoryButtons.includes(document.activeElement)) {
    let currentCategoryButton = navigation.categoryButtons.find(
      categoryButton => categoryButton.name === page
    );
    (currentCategoryButton || navigation.categoryButtons[0]).focus();
  }
}

function recordNavigationTelemetry(source, eventTarget) {
  let page = "recentbrowsing";
  if (source === "category-navigation") {
    page = eventTarget.parentNode.currentCategory;
  } else if (source === "view-all") {
    page = eventTarget.shortPageName;
  }
  // Record telemetry
  Services.telemetry.recordEvent(
    "firefoxview_next",
    "change_page",
    "navigation",
    null,
    {
      page,
      source,
    }
  );
}

window.addEventListener("DOMContentLoaded", async () => {
  recordEnteredTelemetry();
  let navigation = document.querySelector("fxview-category-navigation");
  for (const item of navigation.categoryButtons) {
    pageList.push(item.getAttribute("name"));
  }
  window.addEventListener("hashchange", onHashChange);
  window.addEventListener("change-category", function (event) {
    location.hash = event.target.getAttribute("name");
    recordNavigationTelemetry("category-navigation", event.target);
  });
  window.addEventListener("card-container-view-all", function (event) {
    recordNavigationTelemetry("view-all", event.originalTarget);
  });
  if (document.location.hash) {
    changePage(document.location.hash.substring(1));
  }
  if (Cu.isInAutomation) {
    Services.obs.notifyObservers(null, "firefoxview-entered");
  }
});

document
  .querySelector("named-deck")
  .addEventListener("view-changed", async event => {
    for (const child of event.target.children) {
      if (child.getAttribute("name") == event.target.selectedViewName) {
        child.enter();
      } else {
        child.exit();
      }
    }
  });

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    recordEnteredTelemetry();
    if (Cu.isInAutomation) {
      Services.obs.notifyObservers(null, "firefoxview-entered");
    }
  }
});

function recordEnteredTelemetry() {
  Services.telemetry.recordEvent(
    "firefoxview_next",
    "entered",
    "firefoxview",
    null,
    {
      page: document.location?.hash?.substring(1) || "recentbrowsing",
    }
  );
}

window.addEventListener(
  "unload",
  () => {
    // Clear out the document so the disconnectedCallback will trigger
    // properly and all of the custom elements can cleanup.
    document.body.textContent = "";
    topChromeWindow.removeEventListener("command", onCommand);
  },
  { once: true }
);

topChromeWindow.addEventListener("command", onCommand);

function onCommand(e) {
  if (document.hidden || !e.target.closest("#contentAreaContextMenu")) {
    return;
  }
  const item =
    e.target.closest("#context-openlinkinusercontext-menu") || e.target;
  Services.telemetry.recordEvent(
    "firefoxview_next",
    "browser_context_menu",
    "tabs",
    null,
    {
      menu_action: item.id,
      page: location.hash.substring(1) || "recentbrowsing",
    }
  );
}
