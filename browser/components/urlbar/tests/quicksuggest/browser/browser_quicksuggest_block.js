/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

// Tests quick suggest dismissals ("blocks").

"use strict";

ChromeUtils.defineESModuleGetters(this, {
  CONTEXTUAL_SERVICES_PING_TYPES:
    "resource:///modules/PartnerLinkAttribution.sys.mjs",
});

const { TELEMETRY_SCALARS } = UrlbarProviderQuickSuggest;
const { TIMESTAMP_TEMPLATE } = QuickSuggest;

// Include the timestamp template in the suggestion URLs so we can make sure
// their original URLs with the unreplaced templates are blocked and not their
// URLs with timestamps.
const REMOTE_SETTINGS_RESULTS = [
  {
    id: 1,
    url: `https://example.com/sponsored?t=${TIMESTAMP_TEMPLATE}`,
    title: "Sponsored suggestion",
    keywords: ["sponsored"],
    click_url: "https://example.com/click",
    impression_url: "https://example.com/impression",
    advertiser: "TestAdvertiser",
    iab_category: "22 - Shopping",
  },
  {
    id: 2,
    url: `https://example.com/nonsponsored?t=${TIMESTAMP_TEMPLATE}`,
    title: "Non-sponsored suggestion",
    keywords: ["nonsponsored"],
    click_url: "https://example.com/click",
    impression_url: "https://example.com/impression",
    advertiser: "TestAdvertiser",
    iab_category: "5 - Education",
  },
];

// Spy for the custom impression/click sender
let spy;

add_setup(async function () {
  ({ spy } = QuickSuggestTestUtils.createTelemetryPingSpy());

  await PlacesUtils.history.clear();
  await PlacesUtils.bookmarks.eraseEverything();
  await UrlbarTestUtils.formHistory.clear();

  await QuickSuggest.blockedSuggestions._test_readyPromise;
  await QuickSuggest.blockedSuggestions.clear();

  Services.telemetry.clearScalars();
  Services.telemetry.clearEvents();

  await QuickSuggestTestUtils.ensureQuickSuggestInit({
    remoteSettingsResults: [
      {
        type: "data",
        attachment: REMOTE_SETTINGS_RESULTS,
      },
    ],
  });
});

/**
 * Adds a test task that runs the given callback for each result in
 * `REMOTE_SETTINGS_RESULTS`.
 *
 * @param {Function} fn
 *   The callback function. It's passed: `{ suggestion }`
 */
function add_combo_task(fn) {
  let taskFn = async () => {
    for (let result of REMOTE_SETTINGS_RESULTS) {
      info(`Running ${fn.name}: ${JSON.stringify({ result })}`);
      await fn({ result });
    }
  };
  Object.defineProperty(taskFn, "name", { value: fn.name });
  add_task(taskFn);
}

// Picks the block button with the keyboard.
add_combo_task(async function basic_keyboard({ result }) {
  await doBasicBlockTest({
    result,
    block: async () => {
      if (UrlbarPrefs.get("resultMenu")) {
        await UrlbarTestUtils.openResultMenuAndPressAccesskey(window, "D", {
          resultIndex: 1,
        });
      } else {
        // TAB twice to select the block button: once to select the main
        // part of the row, once to select the block button.
        EventUtils.synthesizeKey("KEY_Tab", { repeat: 2 });
        EventUtils.synthesizeKey("KEY_Enter");
      }
    },
  });
});

// Picks the block button with the mouse.
add_combo_task(async function basic_mouse({ result }) {
  await doBasicBlockTest({
    result,
    block: async () => {
      if (UrlbarPrefs.get("resultMenu")) {
        await UrlbarTestUtils.openResultMenuAndPressAccesskey(window, "D", {
          resultIndex: 1,
          openByMouse: true,
        });
      } else {
        EventUtils.synthesizeMouseAtCenter(
          UrlbarTestUtils.getButtonForResultIndex(window, "block", 1),
          {}
        );
      }
    },
  });
});

// Uses the key shortcut to block a suggestion.
add_combo_task(async function basic_keyShortcut({ result }) {
  await doBasicBlockTest({
    result,
    block: () => {
      // Arrow down once to select the row.
      EventUtils.synthesizeKey("KEY_ArrowDown");
      EventUtils.synthesizeKey("KEY_Delete", { shiftKey: true });
    },
  });
});

async function doBasicBlockTest({ result, block }) {
  spy.resetHistory();
  let index = 2;
  let suggested_index = -1;
  let suggested_index_relative_to_group = true;
  let match_type = "firefox-suggest";

  let pingsSubmitted = 0;
  GleanPings.quickSuggest.testBeforeNextSubmit(() => {
    pingsSubmitted++;
    // First ping's an impression.
    Assert.equal(
      Glean.quickSuggest.pingType.testGetValue(),
      CONTEXTUAL_SERVICES_PING_TYPES.QS_IMPRESSION
    );
    Assert.equal(Glean.quickSuggest.matchType.testGetValue(), match_type);
    Assert.equal(Glean.quickSuggest.blockId.testGetValue(), result.id);
    Assert.equal(Glean.quickSuggest.isClicked.testGetValue(), false);
    Assert.equal(Glean.quickSuggest.position.testGetValue(), index);
    Assert.equal(
      Glean.quickSuggest.suggestedIndex.testGetValue(),
      suggested_index
    );
    Assert.equal(
      Glean.quickSuggest.suggestedIndexRelativeToGroup.testGetValue(),
      suggested_index_relative_to_group
    );
    Assert.equal(Glean.quickSuggest.position.testGetValue(), index);
    GleanPings.quickSuggest.testBeforeNextSubmit(() => {
      pingsSubmitted++;
      // Second ping's a block.
      Assert.equal(
        Glean.quickSuggest.pingType.testGetValue(),
        CONTEXTUAL_SERVICES_PING_TYPES.QS_BLOCK
      );
      Assert.equal(Glean.quickSuggest.matchType.testGetValue(), match_type);
      Assert.equal(Glean.quickSuggest.blockId.testGetValue(), result.id);
      Assert.equal(
        Glean.quickSuggest.iabCategory.testGetValue(),
        result.iab_category
      );
      Assert.equal(Glean.quickSuggest.position.testGetValue(), index);
    });
  });

  // Do a search that triggers the suggestion.
  await UrlbarTestUtils.promiseAutocompleteResultPopup({
    window,
    value: result.keywords[0],
  });
  Assert.equal(
    UrlbarTestUtils.getResultCount(window),
    2,
    "Two rows are present after searching (heuristic + suggestion)"
  );

  let isSponsored = result.keywords[0] == "sponsored";
  await QuickSuggestTestUtils.assertIsQuickSuggest({
    window,
    isSponsored,
    originalUrl: result.url,
  });

  // Block the suggestion.
  await block();

  // The row should have been removed.
  Assert.ok(
    UrlbarTestUtils.isPopupOpen(window),
    "View remains open after blocking result"
  );
  Assert.equal(
    UrlbarTestUtils.getResultCount(window),
    1,
    "Only one row after blocking suggestion"
  );
  await QuickSuggestTestUtils.assertNoQuickSuggestResults(window);

  // The URL should be blocked.
  Assert.ok(
    await QuickSuggest.blockedSuggestions.has(result.url),
    "Suggestion is blocked"
  );

  // Check Glean.
  Assert.equal(pingsSubmitted, 2, "Both Glean pings submitted.");

  // Check telemetry scalars.
  let scalars = {};
  if (isSponsored) {
    scalars[TELEMETRY_SCALARS.IMPRESSION_SPONSORED] = index;
    scalars[TELEMETRY_SCALARS.BLOCK_SPONSORED] = index;
  } else {
    scalars[TELEMETRY_SCALARS.IMPRESSION_NONSPONSORED] = index;
    scalars[TELEMETRY_SCALARS.BLOCK_NONSPONSORED] = index;
  }
  QuickSuggestTestUtils.assertScalars(scalars);

  // Check the engagement event.
  QuickSuggestTestUtils.assertEvents([
    {
      category: QuickSuggest.TELEMETRY_EVENT_CATEGORY,
      method: "engagement",
      object: "block",
      extra: {
        match_type,
        position: String(index),
        suggestion_type: isSponsored ? "sponsored" : "nonsponsored",
      },
    },
  ]);

  // Check the custom telemetry pings.
  QuickSuggestTestUtils.assertPings(spy, [
    {
      type: CONTEXTUAL_SERVICES_PING_TYPES.QS_IMPRESSION,
      payload: {
        match_type,
        suggested_index,
        suggested_index_relative_to_group,
        block_id: result.id,
        is_clicked: false,
        position: index,
      },
    },
    {
      type: CONTEXTUAL_SERVICES_PING_TYPES.QS_BLOCK,
      payload: {
        match_type,
        suggested_index,
        suggested_index_relative_to_group,
        block_id: result.id,
        iab_category: result.iab_category,
        position: index,
      },
    },
  ]);

  await UrlbarTestUtils.promisePopupClose(window);
  await QuickSuggest.blockedSuggestions.clear();
}

// Blocks multiple suggestions one after the other.
add_task(async function blockMultiple() {
  for (let i = 0; i < REMOTE_SETTINGS_RESULTS.length; i++) {
    // Do a search that triggers the i'th suggestion.
    let { keywords, url } = REMOTE_SETTINGS_RESULTS[i];
    await UrlbarTestUtils.promiseAutocompleteResultPopup({
      window,
      value: keywords[0],
    });
    await QuickSuggestTestUtils.assertIsQuickSuggest({
      window,
      originalUrl: url,
      isSponsored: keywords[0] == "sponsored",
    });

    // Block it.
    if (UrlbarPrefs.get("resultMenu")) {
      await UrlbarTestUtils.openResultMenuAndPressAccesskey(window, "D", {
        resultIndex: 1,
      });
    } else {
      EventUtils.synthesizeKey("KEY_Tab", { repeat: 2 });
      EventUtils.synthesizeKey("KEY_Enter");
    }
    Assert.ok(
      await QuickSuggest.blockedSuggestions.has(url),
      "Suggestion is blocked after picking block button"
    );

    // Make sure all previous suggestions remain blocked and no other
    // suggestions are blocked yet.
    for (let j = 0; j < REMOTE_SETTINGS_RESULTS.length; j++) {
      Assert.equal(
        await QuickSuggest.blockedSuggestions.has(
          REMOTE_SETTINGS_RESULTS[j].url
        ),
        j <= i,
        `Suggestion at index ${j} is blocked or not as expected`
      );
    }
  }

  await UrlbarTestUtils.promisePopupClose(window);
  await QuickSuggest.blockedSuggestions.clear();
});
