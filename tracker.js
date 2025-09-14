(function () {

  console.log("✅ Tracker script loaded!");
  // ======= CONFIG =======
  const BACKEND_URL = "http://localhost:8080"; // change for prod
  const EVALUATE_INTERVAL_MS = 20000;          // how often to ask backend/LLM
  const BATCH_FLUSH_MS = 5000;                 // how often to send event batch
  const MAX_BATCH = 25;                        // max events per /collect
  const MODAL_COOLDOWN_DEFAULT = 180000;       // 3 min safety if backend forgets to send cooldown

  // ======= SESSION STATE =======
  const sessionId = (crypto.randomUUID?.() || (Date.now()+"-"+Math.random()));
  const startedAt = Date.now();
  let cartItems = 0;
  let lastDecisionAt = 0;
  let decisionCooldownMs = 0;
  let timeOnSiteSeconds = 0;
  let lastHeartbeat = Date.now();
  let pageVisible = true;

  // ======= UTIL =======
  function pageTypeFromLocation() {
    const url = location.pathname;
    if (/^\/$/.test(url)){
      console.log("Home page detected");
      return "Home";}
       
    if (/\/products\//.test(url)) return "Product";
    if (/\/collections\//.test(url)) return "Collection";
    if (/\/cart(?:\/|$)/.test(url)) return "Cart";
    return "Other";
  }

  console.log("📄 Current page type:", pageTypeFromLocation());

  function nowSec() { return Math.floor(Date.now()/1000); }

  // ======= EVENT BUFFER =======
  const events = [];
  function pushEvent(evt) {
    events.push({
      ...evt,
      session_id: sessionId,
      ts: nowSec(),
      url: location.href,
      page_type: pageTypeFromLocation(),
      ua: navigator.userAgent
    });
    if (events.length >= MAX_BATCH) flushBatch();
  }

  async function flushBatch() {
    if (!events.length) return;
    const batch = events.splice(0, events.length);
    try {
      await fetch(`${BACKEND_URL}/collect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify({ session_id: sessionId, events: batch })
      });
    } catch (e) {
      // swallow network errors; we don’t block UX
      console.debug("collect failed:", e);
      // push them back so we don't lose everything
      events.unshift(...batch.slice(0, MAX_BATCH));
    }
  }

  // ======= CART POLLING (Shopify /cart.js) =======
  async function refreshCartCount() {
    try {
      const res = await fetch("/cart.js", { headers: { "Accept": "application/json" }});
      if (!res.ok) return;
      const data = await res.json();
      cartItems = (data.item_count ?? 0);
    } catch {}
  }

  // ======= HEARTBEAT / TIME-ON-SITE =======
  function tickTime() {
    const now = Date.now();
    if (pageVisible) {
      timeOnSiteSeconds += Math.round((now - lastHeartbeat) / 1000);
    }
    lastHeartbeat = now;
  }
  setInterval(tickTime, 1000);

  document.addEventListener("visibilitychange", () => {
    pageVisible = !document.hidden;
    pushEvent({ type: "visibility", state: pageVisible ? "visible" : "hidden" });
  });

  // ======= URL & PAGE EVENTS =======
  function trackPageView() {
    pushEvent({ type: "page_view" });
  }

  // capture SPA-like navigations (some themes pushState when filtering, etc.)
  (function wrapHistory() {
    const _pushState = history.pushState;
    const _replaceState = history.replaceState;
    function fire() { trackPageView(); refreshCartCount(); }
    history.pushState = function () { _pushState.apply(this, arguments); setTimeout(fire, 0); };
    history.replaceState = function () { _replaceState.apply(this, arguments); setTimeout(fire, 0); };
    window.addEventListener("popstate", fire);
  })();

  // ======= CLICK TRACKING =======
  function matchesAddToCart(el) {
    // Dawn-ish selectors: product form submit buttons
    return el.closest('form[action*="/cart/add"] button[type="submit"], button[name="add"], button.add-to-cart, button#AddToCart') ||
           el.closest('button, a')?.textContent?.toLowerCase().includes("add to cart");
  }

  function matchesWishlist(el) {
    return el.closest('[data-wishlist], .wishlist, button[aria-label*="wishlist" i]') ||
           el.closest('button, a')?.textContent?.toLowerCase().includes("wishlist");
  }

  document.addEventListener("click", async (e) => {
    const el = e.target;
    if (!el) return;
    if (matchesAddToCart(el)) {
      pushEvent({ type: "click", action: "add_to_cart" });
      // cart count will change—refresh soon
      setTimeout(refreshCartCount, 800);
    } else if (matchesWishlist(el)) {
      pushEvent({ type: "click", action: "wishlist" });
    } else if (el.closest('[data-filter], .facets__item, .filter, [name*="filter"]')) {
      pushEvent({ type: "click", action: "filter" });
    }
  }, { capture: true });

  // ======= PERIODIC EVALUATION =======
  async function evaluateIfNeeded(reason = "interval") {
    // cooldown after we showed a modal
    const since = Date.now() - lastDecisionAt;
    if (since < (decisionCooldownMs || MODAL_COOLDOWN_DEFAULT)) return;

    // snapshot
    const payload = {
      session_id: sessionId,
      current_page: pageTypeFromLocation(),
      url: location.href,
      cart_items: cartItems,
      time_on_site: timeOnSiteSeconds,
      started_at: Math.floor(startedAt / 1000)
    };

    try {
      const res = await fetch(`${BACKEND_URL}/evaluate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) return;
      const data = await res.json();
      // expected: { show: boolean, message: string, cooldownMs?: number }
      if (data?.show && data?.message) {
        showModal(data.message);
        lastDecisionAt = Date.now();
        decisionCooldownMs = data.cooldownMs ?? MODAL_COOLDOWN_DEFAULT;
        pushEvent({ type: "popup_shown", reason, message_len: data.message.length });
        flushBatch();
      }
    } catch (e) {
      console.debug("evaluate failed:", e);
    }
  }

  // evaluate periodically + after meaningful events
  setInterval(() => evaluateIfNeeded("interval"), EVALUATE_INTERVAL_MS);

  // ======= BATCH FLUSH TIMER & UNLOAD =======
  setInterval(flushBatch, BATCH_FLUSH_MS);
  window.addEventListener("beforeunload", () => {
    pushEvent({ type: "unload" });
    flushBatch();
  });

  // ======= MODAL UI =======
  const styles = `
    .pe-modal-backdrop {
      position: fixed; inset: 0; background: rgba(0,0,0,0.35);
      display: none; align-items: center; justify-content: center; z-index: 999999;
    }
    .pe-modal { background: #fff; max-width: 420px; width: calc(100% - 32px);
      border-radius: 12px; padding: 18px; box-shadow: 0 10px 30px rgba(0,0,0,0.2);
      font-family: -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
    }
    .pe-modal h3 { margin: 0 0 8px; font-size: 18px; }
    .pe-modal p { margin: 0 0 14px; line-height: 1.4; }
    .pe-modal .pe-actions { display: flex; gap: 8px; justify-content: flex-end; }
    .pe-btn {
      border: 1px solid #111; background: #111; color: #fff; padding: 8px 12px;
      border-radius: 8px; cursor: pointer; font-size: 14px;
    }
    .pe-btn.secondary { background: transparent; color: #111; }
  `;
  const styleEl = document.createElement("style");
  styleEl.textContent = styles;
  document.head.appendChild(styleEl);

  const backdrop = document.createElement("div");
  backdrop.className = "pe-modal-backdrop";
  backdrop.innerHTML = `
    <div class="pe-modal" role="dialog" aria-modal="true" aria-label="Message">
      <h3>Just for you</h3>
      <p class="pe-msg"></p>
      <div class="pe-actions">
        <button class="pe-btn secondary" data-action="dismiss">Not now</button>
        <button class="pe-btn" data-action="accept">Got it</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  const msgEl = backdrop.querySelector(".pe-msg");

  function showModal(message) {
    msgEl.textContent = message;
    backdrop.style.display = "flex";
    // basic focus trap: focus first button
    backdrop.querySelector('[data-action="accept"]').focus();
  }
  function hideModal(action) {
    backdrop.style.display = "none";
    pushEvent({ type: "popup_action", action });
    flushBatch();
  }

  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) hideModal("backdrop");
  });
  backdrop.querySelector('[data-action="dismiss"]').addEventListener("click", () => hideModal("dismiss"));
  backdrop.querySelector('[data-action="accept"]').addEventListener("click", () => hideModal("accept"));

  // ======= INITIAL BOOT =======
  (async function boot() {
    pushEvent({ type: "session_start" });
    trackPageView();
    await refreshCartCount();
    // ask once on boot (useful if the user lands on cart/product with context)
    setTimeout(() => evaluateIfNeeded("boot"), 1500);
  })();
})();