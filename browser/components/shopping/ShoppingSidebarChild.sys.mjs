/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { XPCOMUtils } from "resource://gre/modules/XPCOMUtils.sys.mjs";
import { RemotePageChild } from "resource://gre/actors/RemotePageChild.sys.mjs";

import { ShoppingProduct } from "chrome://global/content/shopping/ShoppingProduct.mjs";

let lazy = {};

let gAllActors = new Set();

XPCOMUtils.defineLazyPreferenceGetter(
  lazy,
  "optedIn",
  "browser.shopping.experience2023.optedIn",
  null,
  function optedInStateChanged() {
    for (let actor of gAllActors) {
      actor.optedInStateChanged();
    }
  }
);
XPCOMUtils.defineLazyPreferenceGetter(
  lazy,
  "adsEnabled",
  "browser.shopping.experience2023.ads.enabled",
  true
);
XPCOMUtils.defineLazyPreferenceGetter(
  lazy,
  "adsEnabledByUser",
  "browser.shopping.experience2023.ads.userEnabled",
  true,
  function adsEnabledByUserChanged() {
    for (let actor of gAllActors) {
      actor.adsEnabledByUserChanged();
    }
  }
);

export class ShoppingSidebarChild extends RemotePageChild {
  constructor() {
    super();
  }

  actorCreated() {
    super.actorCreated();
    gAllActors.add(this);
  }

  didDestroy() {
    this._destroyed = true;
    super.didDestroy?.();
    gAllActors.delete(this);
    this.#product?.uninit();
  }

  #productURI = null;
  #product = null;

  receiveMessage(message) {
    switch (message.name) {
      case "ShoppingSidebar:UpdateProductURL":
        let { url, isReload } = message.data;
        let uri = url ? Services.io.newURI(url) : null;
        // If we're going from null to null, bail out:
        if (!this.#productURI && !uri) {
          return;
        }

        // If we haven't reloaded, check if the URIs represent the same product
        // as sites might change the URI after they have loaded (Bug 1852099).
        if (!isReload && this.isSameProduct(uri, this.#productURI)) {
          return;
        }

        this.#productURI = uri;
        this.updateContent({ haveUpdatedURI: true });
        break;
    }
  }

  isSameProduct(newURI, currentURI) {
    if (!newURI || !currentURI) {
      return false;
    }

    // Check if the URIs are equal:
    if (currentURI.equalsExceptRef(newURI)) {
      return true;
    }

    if (!this.#product) {
      return false;
    }

    // If the current ShoppingProduct has product info set,
    // check if the product ids are the same:
    let currentProduct = this.#product.product;
    if (currentProduct) {
      let newProduct = ShoppingProduct.fromURL(URL.fromURI(newURI));
      if (newProduct.id === currentProduct.id) {
        return true;
      }
    }

    return false;
  }

  handleEvent(event) {
    switch (event.type) {
      case "ContentReady":
        this.updateContent();
        break;
      case "PolledRequestMade":
        this.updateContent({ isPolledRequest: true });
        break;
      case "ReportProductAvailable":
        this.reportProductAvailable();
        break;
    }
  }

  get canFetchAndShowData() {
    return lazy.optedIn === 1;
  }

  get canFetchAndShowAd() {
    return lazy.adsEnabled;
  }

  get userHasAdsEnabled() {
    return lazy.adsEnabledByUser;
  }

  optedInStateChanged() {
    // Force re-fetching things if needed by clearing the last product URI:
    this.#productURI = null;
    // Then let content know.
    this.updateContent();
  }

  adsEnabledByUserChanged() {
    this.sendToContent("adsEnabledByUserChanged", {
      adsEnabledByUser: this.userHasAdsEnabled,
    });

    this.requestRecommendations(this.#productURI);
  }

  getProductURI() {
    return this.#productURI;
  }

  /**
   * This callback is invoked whenever something changes that requires
   * re-rendering content. The expected cases for this are:
   * - page navigations (both to new products and away from a product once
   *   the sidebar has been created)
   * - opt in state changes.
   *
   * @param {object?} options
   *        Optional parameter object.
   * @param {bool} options.haveUpdatedURI = false
   *        Whether we've got an up-to-date URI already. If true, we avoid
   *        fetching the URI from the parent, and assume `this.#productURI`
   *        is current. Defaults to false.
   * @param {bool} options.isPolledRequest = false
   *
   */
  async updateContent({
    haveUpdatedURI = false,
    isPolledRequest = false,
  } = {}) {
    // updateContent is an async function, and when we're off making requests or doing
    // other things asynchronously, the actor can be destroyed, the user
    // might navigate to a new page, the user might disable the feature ... -
    // all kinds of things can change. So we need to repeatedly check
    // whether we can keep going with our async processes. This helper takes
    // care of these checks.
    let canContinue = (currentURI, checkURI = true) => {
      if (this._destroyed || !this.canFetchAndShowData) {
        return false;
      }
      if (!checkURI) {
        return true;
      }
      return currentURI && currentURI == this.#productURI;
    };
    this.#product?.uninit();
    // We are called either because the URL has changed or because the opt-in
    // state has changed. In both cases, we want to clear out content
    // immediately, without waiting for potentially async operations like
    // obtaining product information.
    // Do not clear data however if an analysis was requested via a call-to-action.
    if (!isPolledRequest) {
      this.sendToContent("Update", {
        adsEnabled: this.canFetchAndShowAd,
        adsEnabledByUser: this.userHasAdsEnabled,
        showOnboarding: !this.canFetchAndShowData,
        data: null,
        recommendationData: null,
      });
    }
    if (this.canFetchAndShowData) {
      if (!this.#productURI) {
        // If we already have a URI and it's just null, bail immediately.
        if (haveUpdatedURI) {
          return;
        }
        let url = await this.sendQuery("GetProductURL");

        // Bail out if we opted out in the meantime, or don't have a URI.
        if (!canContinue(null, false)) {
          return;
        }

        this.#productURI = Services.io.newURI(url);
      }

      let uri = this.#productURI;
      this.#product = new ShoppingProduct(uri);
      let data;
      let isAnalysisInProgress;

      try {
        let analysisStatusResponse;
        if (isPolledRequest) {
          // Request a new analysis.
          analysisStatusResponse = await this.#product.requestCreateAnalysis();
        } else {
          // Check if there is an analysis in progress.
          analysisStatusResponse =
            await this.#product.requestAnalysisCreationStatus();
        }
        let analysisStatus = analysisStatusResponse?.status;

        isAnalysisInProgress =
          analysisStatus &&
          (analysisStatus == "pending" || analysisStatus == "in_progress");
        if (isAnalysisInProgress) {
          // Only clear the existing data if the update wasn't
          // triggered by a Polled Request event as re-analysis should
          // keep any stale data visible while processing.
          if (!isPolledRequest) {
            this.sendToContent("Update", {
              isAnalysisInProgress,
            });
          }
          await this.#product.pollForAnalysisCompleted({
            pollInitialWait: analysisStatus == "in_progress" ? 0 : undefined,
          });
          isAnalysisInProgress = false;
        }
        data = await this.#product.requestAnalysis();
        if (!data) {
          throw new Error("request failed");
        }
      } catch (err) {
        console.error("Failed to fetch product analysis data", err);
        data = { error: err };
      }
      // Check if we got nuked from orbit, or the product URI or opt in changed while we waited.
      if (!canContinue(uri)) {
        return;
      }

      this.sendToContent("Update", {
        adsEnabled: this.canFetchAndShowAd,
        adsEnabledByUser: this.userHasAdsEnabled,
        showOnboarding: false,
        data,
        productUrl: this.#productURI.spec,
        isAnalysisInProgress,
      });

      if (!data || data.error) {
        return;
      }

      if (!isPolledRequest && !data.grade) {
        Glean.shopping.surfaceNoReviewReliabilityAvailable.record();
      }

      this.requestRecommendations(uri);
    } else {
      // Don't bother continuing if the user has opted out.
      if (lazy.optedIn == 2) {
        return;
      }
      let url = await this.sendQuery("GetProductURL");

      // Similar to canContinue() above, check to see if things
      // have changed while we were waiting. Bail out if the user
      // opted in, or if the actor doesn't exist.
      if (this._destroyed || this.canFetchAndShowData) {
        return;
      }

      this.#productURI = Services.io.newURI(url);
      // Send the productURI to content for Onboarding's dynamic text
      this.sendToContent("Update", {
        showOnboarding: true,
        data: null,
        productUrl: this.#productURI.spec,
      });
    }
  }

  /**
   * Request recommended products for a given uri and send the recommendations
   * to the content if recommendations are enabled.
   *
   * @param {nsIURI} uri The uri of the current product page
   */
  async requestRecommendations(uri) {
    if (
      !uri.equalsExceptRef(this.#productURI) ||
      !this.canFetchAndShowData ||
      !this.canFetchAndShowAd ||
      !this.userHasAdsEnabled
    ) {
      return;
    }

    let recommendationData = await this.#product.requestRecommendations();
    // Check if the product URI or opt in changed while we waited.
    if (
      !uri.equalsExceptRef(this.#productURI) ||
      !this.canFetchAndShowData ||
      !this.canFetchAndShowAd ||
      !this.userHasAdsEnabled
    ) {
      return;
    }

    this.sendToContent("UpdateRecommendations", {
      recommendationData,
    });
  }

  sendToContent(eventName, detail) {
    if (this._destroyed) {
      return;
    }
    let win = this.contentWindow;
    let evt = new win.CustomEvent(eventName, {
      bubbles: true,
      detail: Cu.cloneInto(detail, win),
    });
    win.document.dispatchEvent(evt);
  }

  async reportProductAvailable() {
    await this.#product.sendReport();
  }
}
