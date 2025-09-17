# Shopify Tracker

A lightweight JavaScript tracker for Shopify stores to monitor user events, time on page, cart actions, and send anonymized analytics data to a backend server. Includes AI-powered popup suggestions.

## Features

- Tracks page views, clicks, and time spent on each page
- Monitors cart contents and updates on cart actions
- Efficient event batching and flushing to backend (threshold-based)
- AI-powered suggestions and popups (via `/askai` endpoint)
- Resilient local storage with session management
- Compatible with modern browsers and Shopify storefronts

## How It Works

- **Event Tracking:** Listens for clicks and navigation events, saving them to browser `localStorage`.
- **Time Tracking:** Measures user time on each page using visibility events and periodic heartbeat.
- **Cart Monitoring:** Fetches `/cart.js` to sync item count after cart actions.
- **Event Flushing:** Sends events to backend when a threshold is reached or on manual/periodic triggers.
- **Popup AI:** Periodically sends session ID to backend `/askai` endpoint. If the backend responds with a popup decision, displays a modal to the user.

## Integration

1. **Add the Script:**
   Embed the bundled `tracker.js` in your Shopify theme, ideally at the end of the `<body>` tag:

   ```html
   <script src="https://your-cdn.com/path/to/tracker.js"></script>
   ```

2. **Backend Setup:**
   - The tracker requires a backend that implements the `/ingest` and `/askai` endpoints.
   - Default backend URL: `https://shopify-tracker-backend.onrender.com`
   - Change the `BACKEND_URL` constant in `tracker.js` if needed.

3. **Usage:**
   The tracker attaches itself as `window.ShopTracker` and starts automatically. No manual initialization is required.

   Example API usage (for development/debugging):
   ```js
   // Dump current tracker state to console
   window.ShopTracker.dump();

   // Manually flush events to backend
   window.ShopTracker.flushNow('manual');
   ```

## API

The following methods are available via `window.ShopTracker`:

- `createSession()` – Ensure a session ID exists and return it
- `initStorage()` – Ensure storage shape is initialized
- `countTimeTick()` – Manually count time on current page (auto-called)
- `currentPageName()` – Get current logical page name
- `recordClick(e)` – Record a click event (auto-called)
- `recordEvent(type, meta)` – Record a custom event
- `dump()` – Print tracker state to console
- `resetAll()` – Clear all tracker data
- `refreshCartCount()` – Fetch and update cart count
- `flushNow(reason)` – Immediately send events to backend

## Backend Endpoints

- `POST /ingest` – Receives full session state and event batch
- `POST /askai` – Receives session string, returns `{ decision: { show_popup, message, category } }`

## Development

- Edit `tracker.js` as needed.
- The tracker is designed to be self-contained and have minimal impact on the host Shopify store.

## Customization

- Adjust the event threshold (`150`) and heartbeat interval (`300000` ms) in `tracker.js` to fit your needs.
- To test without a backend, set `const BACKEND_URL = 'no url';` in the script for local/dev mode.

## License

MIT

---

**Author:** [Hensimkin](https://github.com/Hensimkin)
