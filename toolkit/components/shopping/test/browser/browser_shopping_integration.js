/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const PRODUCT_TEST_URL = "https://example.com/Some-Product/dp/ABCDEFG123";
const OTHER_PRODUCT_TEST_URL =
  "https://example.com/Another-Product/dp/HIJKLMN456";
const BAD_PRODUCT_TEST_URL = "https://example.com/Bad-Product/dp/0000000000";
const NEEDS_ANALYSIS_TEST_URL = "https://example.com/Bad-Product/dp/OPQRSTU789";

async function verifyProductInfo(sidebar, expectedProductInfo) {
  await SpecialPowers.spawn(
    sidebar.querySelector("browser"),
    [expectedProductInfo],
    async prodInfo => {
      let doc = content.document;
      let container = doc.querySelector("shopping-container");
      let root = container.shadowRoot;
      let reviewReliability = root.querySelector("review-reliability");
      // The async fetch could take some time.
      while (!reviewReliability) {
        info("Waiting for update.");
        await container.updateComplete;
      }
      let adjustedRating = root.querySelector("adjusted-rating");
      Assert.equal(
        reviewReliability.getAttribute("letter"),
        prodInfo.letterGrade,
        `Should have correct letter grade for product ${prodInfo.id}.`
      );
      Assert.equal(
        adjustedRating.getAttribute("rating"),
        prodInfo.adjustedRating,
        `Should have correct adjusted rating for product ${prodInfo.id}.`
      );
      Assert.equal(
        content.windowGlobalChild
          .getExistingActor("ShoppingSidebar")
          ?.getProductURI()?.spec,
        prodInfo.productURL,
        `Should have correct url in the child.`
      );
    }
  );
}

add_task(async function test_sidebar_navigation() {
  // Disable OHTTP for now to get this landed; we'll re-enable with proper
  // mocking in the near future.
  await SpecialPowers.pushPrefEnv({
    set: [
      ["toolkit.shopping.ohttpRelayURL", ""],
      ["toolkit.shopping.ohttpConfigURL", ""],
    ],
  });
  await BrowserTestUtils.withNewTab(PRODUCT_TEST_URL, async browser => {
    let sidebar = gBrowser.getPanel(browser).querySelector("shopping-sidebar");
    Assert.ok(sidebar, "Sidebar should exist");
    Assert.ok(
      BrowserTestUtils.is_visible(sidebar),
      "Sidebar should be visible."
    );
    info("Waiting for sidebar to update.");
    await promiseSidebarUpdated(sidebar, PRODUCT_TEST_URL);
    info("Verifying product info for initial product.");
    await verifyProductInfo(sidebar, {
      productURL: PRODUCT_TEST_URL,
      adjustedRating: "4.1",
      letterGrade: "B",
    });

    // Navigate the browser from the parent:
    let loadedPromise = Promise.all([
      BrowserTestUtils.browserLoaded(browser, false, OTHER_PRODUCT_TEST_URL),
      promiseSidebarUpdated(sidebar, OTHER_PRODUCT_TEST_URL),
    ]);
    BrowserTestUtils.startLoadingURIString(browser, OTHER_PRODUCT_TEST_URL);
    info("Loading another product.");
    await loadedPromise;
    Assert.ok(sidebar, "Sidebar should exist.");
    Assert.ok(
      BrowserTestUtils.is_visible(sidebar),
      "Sidebar should be visible."
    );
    info("Verifying another product.");
    await verifyProductInfo(sidebar, {
      productURL: OTHER_PRODUCT_TEST_URL,
      adjustedRating: "1",
      letterGrade: "F",
    });

    // Navigate to a non-product URL:
    loadedPromise = BrowserTestUtils.browserLoaded(
      browser,
      false,
      "https://example.com/1"
    );
    BrowserTestUtils.startLoadingURIString(browser, "https://example.com/1");
    info("Go to a non-product.");
    await loadedPromise;
    Assert.ok(BrowserTestUtils.is_hidden(sidebar));

    // Navigate using pushState:
    loadedPromise = BrowserTestUtils.waitForLocationChange(
      gBrowser,
      PRODUCT_TEST_URL
    );
    info("Navigate to the first product using pushState.");
    await SpecialPowers.spawn(browser, [PRODUCT_TEST_URL], urlToUse => {
      content.history.pushState({}, null, urlToUse);
    });
    info("Waiting to load first product again.");
    await loadedPromise;
    info("Waiting for the sidebar to have updated.");
    await promiseSidebarUpdated(sidebar, PRODUCT_TEST_URL);
    Assert.ok(sidebar, "Sidebar should exist");
    Assert.ok(
      BrowserTestUtils.is_visible(sidebar),
      "Sidebar should be visible."
    );

    info("Waiting to verify the first product a second time.");
    await verifyProductInfo(sidebar, {
      productURL: PRODUCT_TEST_URL,
      adjustedRating: "4.1",
      letterGrade: "B",
    });

    // Navigate to a product URL with query params:
    loadedPromise = BrowserTestUtils.browserLoaded(
      browser,
      false,
      PRODUCT_TEST_URL + "?th=1"
    );
    // Navigate to the same product, but with a th=1 added.
    BrowserTestUtils.startLoadingURIString(browser, PRODUCT_TEST_URL + "?th=1");
    // When just comparing URLs product info would be cleared out,
    // but when comparing the parsed product ids, we do nothing as the product
    // has not changed.
    info("Verifying product has not changed before load.");
    await verifyProductInfo(sidebar, {
      productURL: PRODUCT_TEST_URL,
      adjustedRating: "4.1",
      letterGrade: "B",
    });
    // Wait for the page to load, but don't wait for the sidebar to update so
    // we can be sure we still have the previous product info.
    await loadedPromise;
    info("Verifying product has not changed after load.");
    await verifyProductInfo(sidebar, {
      productURL: PRODUCT_TEST_URL,
      adjustedRating: "4.1",
      letterGrade: "B",
    });
  });
});

add_task(async function test_button_visible_when_opted_out() {
  await BrowserTestUtils.withNewTab(
    {
      url: PRODUCT_TEST_URL,
      gBrowser,
    },
    async browser => {
      let shoppingBrowser = gBrowser.ownerDocument.querySelector(
        "browser.shopping-sidebar"
      );

      let shoppingButton = document.getElementById("shopping-sidebar-button");

      ok(
        BrowserTestUtils.is_visible(shoppingButton),
        "Shopping Button should be visible on a product page"
      );

      let sidebar = gBrowser
        .getPanel(browser)
        .querySelector("shopping-sidebar");
      Assert.ok(sidebar, "Sidebar should exist");
      Assert.ok(
        BrowserTestUtils.is_visible(sidebar),
        "Sidebar should be visible."
      );
      info("Waiting for sidebar to update.");
      await promiseSidebarUpdated(sidebar, PRODUCT_TEST_URL);

      await SpecialPowers.spawn(shoppingBrowser, [], async () => {
        let shoppingContainer =
          content.document.querySelector("shopping-container").wrappedJSObject;
        await shoppingContainer.updateComplete;
        let shoppingSettings = shoppingContainer.settingsEl;
        await shoppingSettings.updateComplete;

        shoppingSettings.shoppingCardEl.detailsEl.open = true;
        let optOutButton = shoppingSettings.optOutButtonEl;
        optOutButton.click();
      });

      await BrowserTestUtils.waitForMutationCondition(
        shoppingButton,
        { attributes: false, attributeFilter: ["shoppingsidebaropen"] },
        () => shoppingButton.getAttribute("shoppingsidebaropen")
      );

      ok(
        !Services.prefs.getBoolPref("browser.shopping.experience2023.active"),
        "Shopping sidebar is no longer active"
      );
      is(
        Services.prefs.getIntPref("browser.shopping.experience2023.optedIn"),
        2,
        "Opted out of shopping experience"
      );

      ok(
        BrowserTestUtils.is_visible(shoppingButton),
        "Shopping Button should be visible after opting out"
      );

      Services.prefs.setBoolPref(
        "browser.shopping.experience2023.active",
        true
      );
      Services.prefs.setIntPref("browser.shopping.experience2023.optedIn", 1);
    }
  );
});

add_task(async function test_sidebar_button_open_close() {
  // Disable OHTTP for now to get this landed; we'll re-enable with proper
  // mocking in the near future.
  await SpecialPowers.pushPrefEnv({
    set: [
      ["toolkit.shopping.ohttpRelayURL", ""],
      ["toolkit.shopping.ohttpConfigURL", ""],
    ],
  });
  await BrowserTestUtils.withNewTab(PRODUCT_TEST_URL, async browser => {
    let sidebar = gBrowser.getPanel(browser).querySelector("shopping-sidebar");
    Assert.ok(sidebar, "Sidebar should exist");
    Assert.ok(
      BrowserTestUtils.is_visible(sidebar),
      "Sidebar should be visible."
    );
    let shoppingButton = document.getElementById("shopping-sidebar-button");
    ok(
      BrowserTestUtils.is_visible(shoppingButton),
      "Shopping Button should be visible on a product page"
    );

    info("Waiting for sidebar to update.");
    await promiseSidebarUpdated(sidebar, PRODUCT_TEST_URL);

    info("Verifying product info for initial product.");
    await verifyProductInfo(sidebar, {
      productURL: PRODUCT_TEST_URL,
      adjustedRating: "4.1",
      letterGrade: "B",
    });

    // close the sidebar
    shoppingButton.click();
    ok(BrowserTestUtils.is_hidden(sidebar), "Sidebar should be hidden");

    // reopen the sidebar
    shoppingButton.click();
    Assert.ok(
      BrowserTestUtils.is_visible(sidebar),
      "Sidebar should be visible."
    );

    info("Waiting for sidebar to update.");
    await promiseSidebarUpdated(sidebar, PRODUCT_TEST_URL);

    info("Verifying product info for has not changed.");
    await verifyProductInfo(sidebar, {
      productURL: PRODUCT_TEST_URL,
      adjustedRating: "4.1",
      letterGrade: "B",
    });
  });
});

add_task(async function test_sidebar_error() {
  // Disable OHTTP for now to get this landed; we'll re-enable with proper
  // mocking in the near future.
  await SpecialPowers.pushPrefEnv({
    set: [
      ["toolkit.shopping.ohttpRelayURL", ""],
      ["toolkit.shopping.ohttpConfigURL", ""],
    ],
  });
  await BrowserTestUtils.withNewTab(BAD_PRODUCT_TEST_URL, async browser => {
    let sidebar = gBrowser.getPanel(browser).querySelector("shopping-sidebar");

    Assert.ok(sidebar, "Sidebar should exist");

    Assert.ok(
      BrowserTestUtils.is_visible(sidebar),
      "Sidebar should be visible."
    );
    info("Waiting for sidebar to update.");
    await promiseSidebarUpdated(sidebar, BAD_PRODUCT_TEST_URL);

    info("Verifying a generic error is shown.");
    await SpecialPowers.spawn(
      sidebar.querySelector("browser"),
      [],
      async prodInfo => {
        let doc = content.document;
        let shoppingContainer =
          doc.querySelector("shopping-container").wrappedJSObject;

        ok(
          shoppingContainer.shoppingMessageBarEl,
          "Got shopping-message-bar element"
        );
        is(
          shoppingContainer.shoppingMessageBarEl.getAttribute("type"),
          "generic-error",
          "generic-error type should be correct"
        );
      }
    );
  });
});

add_task(async function test_ads_requested_after_enabled() {
  await SpecialPowers.pushPrefEnv({
    set: [["browser.shopping.experience2023.ads.enabled", true]],
  });
  await BrowserTestUtils.withNewTab(
    {
      url: PRODUCT_TEST_URL,
      gBrowser,
    },
    async browser => {
      let sidebar = gBrowser
        .getPanel(browser)
        .querySelector("shopping-sidebar");
      Assert.ok(sidebar, "Sidebar should exist");
      Assert.ok(
        BrowserTestUtils.is_visible(sidebar),
        "Sidebar should be visible."
      );
      info("Waiting for sidebar to update.");
      await promiseSidebarUpdated(sidebar, PRODUCT_TEST_URL);

      await SpecialPowers.spawn(
        sidebar.querySelector("browser"),
        [],
        async () => {
          let shoppingContainer =
            content.document.querySelector(
              "shopping-container"
            ).wrappedJSObject;
          await shoppingContainer.updateComplete;

          Assert.ok(
            !shoppingContainer.recommendedAdEl,
            "Recommended card should not exist"
          );

          let shoppingSettings = shoppingContainer.settingsEl;
          await shoppingSettings.updateComplete;
          shoppingSettings.shoppingCardEl.detailsEl.open = true;

          let recommendationsToggle = shoppingSettings.recommendationsToggleEl;
          recommendationsToggle.click();

          await ContentTaskUtils.waitForCondition(() => {
            return shoppingContainer.recommendedAdEl;
          });

          await shoppingContainer.updateComplete;

          let recommendedCard = shoppingContainer.recommendedAdEl;
          await recommendedCard.updateComplete;
          Assert.ok(recommendedCard, "Recommended card should exist");
          Assert.ok(
            ContentTaskUtils.is_visible(recommendedCard),
            "Recommended card is visible"
          );
        }
      );
    }
  );
});

add_task(async function test_no_reliability_available() {
  Services.fog.testResetFOG();
  await Services.fog.testFlushAllChildren();
  // Disable OHTTP for now to get this landed; we'll re-enable with proper
  // mocking in the near future.
  await SpecialPowers.pushPrefEnv({
    set: [
      ["toolkit.shopping.ohttpRelayURL", ""],
      ["toolkit.shopping.ohttpConfigURL", ""],
    ],
  });
  await BrowserTestUtils.withNewTab(NEEDS_ANALYSIS_TEST_URL, async browser => {
    let sidebar = gBrowser.getPanel(browser).querySelector("shopping-sidebar");

    Assert.ok(sidebar, "Sidebar should exist");

    Assert.ok(
      BrowserTestUtils.is_visible(sidebar),
      "Sidebar should be visible."
    );
    info("Waiting for sidebar to update.");
    await promiseSidebarUpdated(sidebar, NEEDS_ANALYSIS_TEST_URL);
  });

  await Services.fog.testFlushAllChildren();
  var sawPageEvents =
    Glean.shopping.surfaceNoReviewReliabilityAvailable.testGetValue();

  Assert.equal(sawPageEvents.length, 1);
  Assert.equal(sawPageEvents[0].category, "shopping");
  Assert.equal(
    sawPageEvents[0].name,
    "surface_no_review_reliability_available"
  );
});
