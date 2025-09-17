(function () {
        'use strict';

        // ===== Backend config =====
        const BACKEND_URL = 'https://shopify-tracker-backend.onrender.com'; // <-- change when backend exists
        const CLEAR_AFTER_SEND = true; // clear events after sending

        // ===== LocalStorage key =====
        const LS_KEY = 'shopify_tracker_state';

        // ===== State shape =====
        // {
        //   session: "uuid",
        //   events: { [pageName]: Event[] },
        //   timeonpage: { [pageName]: number }, // ms
        //   itemsInCart: number
        // }

        // ===== Utilities =====
        const now = () => Date.now();
        const seconds = (ms) => Math.round(ms / 1000);
        const pretty = (obj) => JSON.stringify(obj, null, 2);

        function uuid() {
          try {
            return crypto.randomUUID();
          } catch {
            return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
          }
        }

        function loadState() {
          try {
            return JSON.parse(localStorage.getItem(LS_KEY) || '{}');
          } catch {
            return {};
          }
        }

        function saveState(s) {
          localStorage.setItem(LS_KEY, JSON.stringify(s));
        }

        function ensureShape() {
          const s = loadState();
          if (!s.session) s.session = uuid();
          if (!s.events || typeof s.events !== 'object') s.events = {};
          if (!s.timeonpage || typeof s.timeonpage !== 'object') s.timeonpage = {};
          if (typeof s.itemsInCart !== 'number') s.itemsInCart = 0;
          saveState(s);
          return s;
        }

        // ===== Page naming =====
        function pageNameFromLocation(loc = window.location) {
          const p = loc.pathname.replace(/\/+$/, '') || '/';
          if (p === '/') return 'Home:/';
          if (/\/products\//.test(p)) return `Product:${p}`;
          if (/\/collections\//.test(p)) return `Collection:${p}`;
          if (/\/cart(?:\/|$)/.test(p)) return `Cart:${p}`;
          return `Other:${p}`;
        }

        // ===== Runtime (not stored) =====
        const runtime = {
          currentPage: pageNameFromLocation(),
          visibleSince: document.visibilityState === 'visible' ? now() : null,
        };


        

        // ===== Event counting + sending =====
        function totalEventCount(s) {
          return Object.values(s.events).reduce((acc, arr) => acc + (Array.isArray(arr) ? arr.length : 0), 0);
        }

        async function sendState(s, reason = 'manual') {
          const payload = {
            reason,
            ts: Math.floor(Date.now() / 1000),
            session: s.session,
            state: s,
          };

          if (BACKEND_URL === 'no url') {
            console.log('[ShopTracker] SEND (mock, no backend):', reason, payload);
            return { ok: true, skipped: true };
          }

          try {
            const res = await fetch(`${BACKEND_URL}/ingest`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),

            });
            console.log('[ShopTracker] SEND ->', res.status);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return { ok: true };
          } catch (err) {
            console.warn('[ShopTracker] SEND failed:', err);
            return { ok: false, error: String(err) };
          }
        }

        async function flushIfThreshold() {
          const s = ensureShape();
          const count = totalEventCount(s);
          if (count >= 150) {
            console.log('[ShopTracker] Threshold reached:', count, 'events. Flushing...');
            const res = await sendState(s, 'threshold_150');
            if (res.ok && CLEAR_AFTER_SEND) {
              // Clear only the events; keep timeonpage/session/cart
              Object.keys(s.events).forEach((k) => (s.events[k] = []));

              Object.keys(s.timeonpage).forEach((k) => (s.timeonpage[k] = 0));

              saveState(s);
              console.log('[ShopTracker] Events cleared after flush.');
            }
          }
        }

        // === CART ===
        async function refreshCartCount() {
          try {
            const res = await fetch('/cart.js', { credentials: 'same-origin' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            const s = ensureShape();
            s.itemsInCart = Number(data.item_count) || 0;
            saveState(s);
            console.log('[ShopTracker] CART: itemsInCart =', s.itemsInCart);
            return s.itemsInCart;
          } catch (err) {
            console.warn('[ShopTracker] CART: failed to fetch /cart.js', err);
            return null;
          }
        }

        async function sendSessionToAskAI() {
          const s = ensureShape(); // guarantees we have a session
          const sessionStr = String(s.session || '');

          

          if (BACKEND_URL === 'no url') {
            console.log('[ShopTracker] ASKAI (mock, no backend):', sessionStr);
            return { ok: true, skipped: true };
          }

          try {
            const res = await fetch(`${BACKEND_URL}/askai`, {
              method: 'POST',
              headers: { 'Content-Type': 'text/plain' },
              body: sessionStr, // <-- only the session as raw string

            });
            const data = await res.json();

            console.log('[ShopTracker] ASKAI decision:', data);


            if (data.decision?.show_popup) {
              console.log('Popup message:', data.decision.message);
              showAskAIPopup(data.decision.message, data.decision.category);
            }

            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return { ok: true };
          } catch (err) {
            console.warn('[ShopTracker] ASKAI failed:', err);
            return { ok: false, error: String(err) };
          }
        }

        // ===== Public API =====
        const API = {
          createSession() {
            const s = ensureShape();
            if (!s.session) {
              s.session = uuid();
              saveState(s);
            }
            return s.session;
          },

          initStorage() {
            return ensureShape();
          },

          countTimeTick() {
            const s = ensureShape();
            const pg = runtime.currentPage;
            if (!pg) return;
            if (!s.timeonpage[pg]) s.timeonpage[pg] = 0;

            if (runtime.visibleSince != null) {
              const dt = now() - runtime.visibleSince;
              s.timeonpage[pg] += dt;
              runtime.visibleSince = now();
              saveState(s);
            }
          },

          currentPageName() {
            return runtime.currentPage;
          },

          recordClick(e) {
            const target = e.target.closest ? e.target.closest("a,button,[role='button'],[data-action]") : e.target;

            const meta = {
              tag: target?.tagName?.toLowerCase() || e.target.tagName?.toLowerCase(),
              id: target?.id || '',
              classes: target?.className && typeof target.className === 'string' ? target.className : '',
              text: (target?.innerText || '').trim().slice(0, 140),
              href: target?.getAttribute?.('href') || '',
            };

            API.recordEvent('click', meta);
            console.log('[ShopTracker] CLICK:', meta, 'page:', runtime.currentPage);

            // CART heuristic
            const addToCartSelector = [
              'form[action*="/cart/add"]',
              'button[name="add"]',
              'button.add-to-cart',
              '[data-add-to-cart]',
              'form[action*="/cart/add"] [type="submit"]',
            ].join(',');

            if (target && (target.matches?.(addToCartSelector) || target.closest?.(addToCartSelector))) {
              setTimeout(refreshCartCount, 800);
            }
          },

          recordEvent(type, meta = {}) {
            const s = ensureShape();
            const pg = runtime.currentPage || pageNameFromLocation();
            if (!s.events[pg]) s.events[pg] = [];
            const evt = { type, ts: Math.floor(now() / 1000), url: location.href, ...meta };
            s.events[pg].push(evt);
            saveState(s);

            // NEW: check after every event
            flushIfThreshold();

            return evt;
          },

          dump() {
            const s = ensureShape();
            console.log('session:', s.session);
            console.log('currentPage:', runtime.currentPage);
            console.log('itemsInCart:', s.itemsInCart);
            console.log('events:', s.events);
            console.log('timeonpage (ms):', s.timeonpage);
            console.table(
              Object.entries(s.timeonpage).map(([k, v]) => ({
                page: k,
                'time (s)': seconds(v),
                events: (s.events[k] || []).length,
              }))
            );
            return s;
          },

          resetAll() {
            localStorage.removeItem(LS_KEY);
            runtime.visibleSince = document.visibilityState === 'visible' ? now() : null;
            runtime.currentPage = pageNameFromLocation();
            return ensureShape();
          },

          refreshCartCount,
          // optional manual flush
          flushNow: async (reason = 'manual_button') => {
            const s = ensureShape();
            const res = await sendState(s, reason);
            if (res.ok && CLEAR_AFTER_SEND) {
              Object.keys(s.events).forEach((k) => (s.events[k] = []));
              saveState(s);
              console.log('[ShopTracker] Events cleared after manual flush.');
            }
            return res;
          },
        };

        // expose API
        window.ShopTracker = API;

        // ===== Boot =====
        API.initStorage();
        const sessionId = API.createSession();
        console.log('[ShopTracker] initialized. session:', sessionId);

        if (document.visibilityState === 'visible') {
          runtime.visibleSince = now();
        }

        API.recordEvent('page_view', { page: runtime.currentPage });
        console.log('[ShopTracker] NAVIGATE: page_view ->', runtime.currentPage, location.href);

        refreshCartCount();

        // ===== Visibility handling =====
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'hidden') {
            API.countTimeTick();
            runtime.visibleSince = null;
          } else {
            runtime.visibleSince = now();
            refreshCartCount();
          }
        });

        // ===== Periodic time counting =====
        const HEARTBEAT_MS = 300000;
        setInterval(() => {
          if (document.visibilityState === 'visible') API.countTimeTick();
        }, HEARTBEAT_MS);

        // ===== Print localStorage JSON every 10s =====
        // const PRINT_MS = 30000;
        // setInterval(() => {
        //   const state = loadState();
        //   console.log('[ShopTracker] STATE (every 10s):\n', pretty(state));
        //   // Optional: also check threshold on the timer (safety net)
        //   flushIfThreshold();
        // }, PRINT_MS);

        const ASKAI_MS = 5000;   //where you can adjust the interval time (in milliseconds) for asking ai
        setInterval(() => {
          // Always send the current session string only
          sendSessionToAskAI();
        }, ASKAI_MS);

        // ===== Click tracking =====
        document.addEventListener('click', API.recordClick, { capture: true });


        function showAskAIPopup(message, category = "info") {
          // Prevent duplicate popup
          if (document.getElementById("askai-popup")) return;

          // Backdrop
          const backdrop = document.createElement("div");
          backdrop.id = "askai-popup";
          backdrop.style.position = "fixed";
          backdrop.style.inset = "0";
          backdrop.style.background = "rgba(0,0,0,.4)";
          backdrop.style.display = "flex";
          backdrop.style.alignItems = "center";
          backdrop.style.justifyContent = "center";
          backdrop.style.zIndex = "9999";

          // Modal
          const modal = document.createElement("div");
          modal.style.background = "#fff";
          modal.style.borderRadius = "10px";
          modal.style.boxShadow = "0 5px 25px rgba(0,0,0,.3)";
          modal.style.padding = "20px";
          modal.style.maxWidth = "400px";
          modal.style.width = "90%";
          modal.style.textAlign = "center";
          modal.style.fontFamily = "sans-serif";

          // Title by category
          const title = document.createElement("h3");
          title.textContent =
            category === "warn"
              ? "Reminder"
              : category === "error"
              ? "Attention"
              : "Notice";
          title.style.marginTop = "0";

          // Body message
          const body = document.createElement("p");
          body.textContent = message;

          // Close button
          const btn = document.createElement("button");
          btn.textContent = "OK";
          btn.style.marginTop = "15px";
          btn.style.padding = "8px 16px";
          btn.style.border = "none";
          btn.style.borderRadius = "6px";
          btn.style.cursor = "pointer";
          btn.style.background = "#111";
          btn.style.color = "#fff";

          btn.addEventListener("click", () => backdrop.remove());
          backdrop.addEventListener("click", (e) => {
            if (e.target === backdrop) backdrop.remove();
          });

          modal.appendChild(title);
          modal.appendChild(body);
          modal.appendChild(btn);
          backdrop.appendChild(modal);
          document.body.appendChild(backdrop);
        }

        // ===== Navigation tracking =====
        function handleNavigation() {
          if (document.visibilityState === 'visible') API.countTimeTick();

          runtime.currentPage = pageNameFromLocation();
          runtime.visibleSince = document.visibilityState === 'visible' ? now() : null;

          API.recordEvent('page_view', { page: runtime.currentPage });
          console.log('[ShopTracker] NAVIGATE: page_view ->', runtime.currentPage, location.href);

          refreshCartCount();
          // Optional: check after navigation too
          flushIfThreshold();
        }

        window.addEventListener('popstate', handleNavigation, true);
        window.addEventListener('hashchange', handleNavigation, true);

        ['pushState', 'replaceState'].forEach((fn) => {
          const orig = history[fn];
          history[fn] = function () {
            const ret = orig.apply(this, arguments);
            handleNavigation();
            return ret;
          };
        });
      })();
