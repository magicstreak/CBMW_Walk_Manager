    import {initializeApp} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
    import {
      getDatabase,
      ref,
      set,
      onValue,
      remove,
      get,
      query,
      orderByChild,
      equalTo,
    } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
    import {getAuth, signInAnonymously} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {ensureSignedIn, isStaff, showStaffNotice, STAFF_APP_NAME, accountRoles, allowedView, redirectToView} from "./cbmw-auth.js";
      /* ========================================================= FIREBASE CONFIG ========================================================= */
// Programme planning database (cbmw-portal): bookings, leaders, walks and requests
import { firebaseConfig as firebaseConfigWalks } from "./firebase-config.js";

let db = null;
let dbWalks = null;
let isFirebaseActive = false;
let isWalksFirebaseActive = false;

// Anonymous sign-in for both projects. Data is read only after this finishes.
const authSignIns = [];
let staffUser = null;
let staffIsAdmin = false;

// One database now holds everything (bookings, leaders, walks), so both names point at the same connection.
try {
  const plannerApp = initializeApp(firebaseConfigWalks, STAFF_APP_NAME);
  db = getDatabase(plannerApp);
  dbWalks = db;
  isFirebaseActive = true;
  isWalksFirebaseActive = true;
  authSignIns.push(ensureSignedIn(getAuth(plannerApp)).then(async (user) => {
  staffUser = user;
  const roles = await accountRoles(db, user);
  staffIsAdmin = roles.isAdmin;
  const requested = VIEW_FROM_HOST || "walker";
  const wanted = allowedView(requested, roles);
  if (wanted !== requested) { redirectToView(wanted); return new Promise(() => {}); }
}));
  console.log("Programme planning Firebase connected.");
} catch (err) {
  console.error("Programme planning Firebase startup failed.", err);
}

// Resolves when both sign-ins have finished (failures are logged, so the app still loads)
const authReady = Promise.allSettled(authSignIns).then((results) => {
  results.forEach((r) => { if (r.status === "rejected") console.error("Sign-in failed:", r.reason); });
  if (currentView !== "walker") showStaffNotice(staffUser);
  if (currentView === "leader" && isStaff(staffUser)) identifyFromAccount(staffUser);
});
      /* ========================================================= GLOBAL VARIABLES ========================================================= */ const grades =
      ["E", "M", "MS", "S", "VS"];
    let currentDate = new Date();
    let globalBookings = {};
    let bookingRequests = {};   // booking_requests/{id}: leader requests for live walks
    let bookingRequestMode = null; // null | "change" | "cancel" while a leader fills in a request
    let globalSocial = {};
    let editingSocialKey = null;
    let masterWalks = {};
    let monthlyChart = null;
    const monthNames = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];
    const daysGrid = document.getElementById("days-grid");
    const calendarTitle = document.getElementById("calendar-title");
    const modal = document.getElementById("booking-modal");
    const bookingForm = document.getElementById("kv-booking-form");
    const adminTableBody = document.getElementById("admin-table-body");

    // Walker View map: pins at each walk's meeting point, for the walks the list shows
    let walkMap = null;
    let walkMapLayer = null;
    let walkMapFrame = 0;
    let walkMapShown = false;
    function renderWalkMap() {
      if (walkerMode !== "map" || currentView !== "walker") return;
      const note = document.getElementById("walker-map-note");
      if (typeof L === "undefined") {
        note.textContent = "The map needs an internet connection to load.";
        return;
      }
      // Build a fresh map each time Map mode is entered, so it is sized while its panel is visible
      if (walkMap && !walkMapShown) {
        walkMap.remove();
        walkMap = null;
        walkMapLayer = null;
      }
      walkMapShown = true;
      if (!walkMap) {
        walkMap = L.map("walker-map-canvas").setView([38.8, 0.05], 10);
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 18,
          attribution: "&copy; OpenStreetMap contributors",
        }).addTo(walkMap);
        walkMapLayer = L.layerGroup().addTo(walkMap);
      }
      walkMapLayer.clearLayers();
      const points = [];
      let missing = 0;
      // Walks that share a meeting point become one pin with a count, so they do not hide each other
      const spots = new Map();
      document.querySelectorAll("#admin-table-body tr[data-walk-key]").forEach((tr) => {
        const key = tr.dataset.walkKey;
        const record = globalBookings[key];
        if (!record) return;
        const route = bookingRoute(record) || {};
        const coords = getMasterCoordinates(route);
        if (!coords) { missing += 1; return; }
        const lat = Number(coords.latitude);
        const lon = Number(coords.longitude);
        const name = route.Route_Name || route.Walk_Name || record.walk_name || `Walk ${record.walk_number || ""}`;
        const spotKey = `${lat.toFixed(5)},${lon.toFixed(5)}`;
        if (!spots.has(spotKey)) spots.set(spotKey, { lat, lon, items: [] });
        spots.get(spotKey).items.push({ key, name, date: record.date, start_time: record.start_time, grade: record.walk_grade || "" });
      });
      let shownWalks = 0;
      spots.forEach((spot) => {
        const count = spot.items.length;
        shownWalks += count;
        const line = (i) => `<strong>${escapeHtml(i.name)}</strong><br>${escapeHtml(tableDate(i.date))} ${escapeHtml(formatStartTime(i.start_time) || "")} · ${escapeHtml(i.grade)}`;
        const marker = count > 1
          ? L.marker([spot.lat, spot.lon], { icon: L.divIcon({ className: "walk-pin-count", html: `<span>${count}</span>`, iconSize: [30, 30], iconAnchor: [15, 15] }) })
          : L.marker([spot.lat, spot.lon]);
        marker.bindTooltip(
          count > 1 ? `<strong>${count} walks at this meeting point</strong><br>${spot.items.map(line).join("<br>")}` : line(spot.items[0]),
          { direction: "top" }
        );
        if (count > 1) {
          marker.bindPopup(`<div class="map-pop"><strong>${count} walks at this meeting point</strong>${spot.items.map((i) => `<button type="button" class="map-pop-walk" data-open-walk="${escapeHtml(i.key)}">${escapeHtml(i.name)} · ${escapeHtml(tableDate(i.date))}</button>`).join("")}</div>`);
          marker.on("popupopen", (e) => {
            e.popup.getElement().querySelectorAll("[data-open-walk]").forEach((b) => b.addEventListener("click", () => {
              walkMap.closePopup();
              openDetailCard(b.dataset.openWalk);
            }, { once: true }));
          });
        } else {
          marker.on("click", () => openDetailCard(spot.items[0].key));
        }
        marker.addTo(walkMapLayer);
        points.push([spot.lat, spot.lon]);
      });
      // Measure and centre once the panel is visible; the map may have been created while hidden
      const fit = () => {
        walkMap.invalidateSize();
        if (points.length) walkMap.fitBounds(points, { padding: [30, 30], maxZoom: 12 });
      };
      fit();
      setTimeout(fit, 150);
      const shown = `${shownWalks} walk${shownWalks === 1 ? "" : "s"} on the map`;
      note.textContent = missing ? `${shown}. ${missing} without a meeting point are not shown.` : `${shown}. Tap a pin for the walk.`;
    }
    // Keep the map sized correctly when the window or orientation changes
    window.addEventListener("resize", () => { if (walkMap && walkerMode === "map") walkMap.invalidateSize(); });
    // Rebuilding the list (filters, dates, mode) also refreshes the map
    new MutationObserver(() => {
      if (walkerMode !== "map") { walkMapShown = false; return; }
      cancelAnimationFrame(walkMapFrame);
      walkMapFrame = requestAnimationFrame(renderWalkMap);
    }).observe(adminTableBody, { childList: true });
    const modalHeading = document.getElementById("modal-heading");
    const puebloFilter = document.getElementById("pueblo-filter");
      /* ========================================================= GRADE COLOURS FOR CHART ========================================================= */ const gradeColours =
    {
      E: "#16a34a",
      M: "#3773f5",
      MS: "#dc2626",
      S: "#7c3aed",
      VS: "#111827",
    };
      /* ========================================================= DATA SYNC ========================================================= */
    // Booking requests: staff read them all; a leader reads only the requests they made (the rules allow nothing else)
    let stopBookingRequests = null;
    function subscribeBookingRequests() {
      if (!db) return;
      if (stopBookingRequests) { stopBookingRequests(); stopBookingRequests = null; }
      if (currentView !== "admin" && !myLeaderId) { bookingRequests = {}; renderBookingRequestsPanel(); return; }
      const base = ref(db, "booking_requests");
      const source = currentView === "admin" ? base : query(base, orderByChild("requested_by"), equalTo(String(myLeaderId)));
      stopBookingRequests = onValue(source, (snapshot) => {
        bookingRequests = snapshot.val() || {};
        renderBookingRequestsPanel();
        refreshOpenDetailCard();
      }, (error) => console.error("Unable to load booking requests:", error));
    }

    function initDataSync() {
      // Leaders: read from the "leaders" path and kept as a list sorted by leader_id.
      if (isFirebaseActive) {
        onValue(ref(db, "leaders"), (snapshot) => {
          const data = snapshot.val() || {};
          LEADER_LOOKUP = Object.values(data).sort((a, b) => Number(a.leader_id) - Number(b.leader_id));
          LEADER_FULL_LIST = true;
          // Refresh the open booking modal's dropdown, keeping the current choice
          refreshLeaderOptions();
          // Leader identity comes from sign-in (see identifyFromAccount)
          // Do not re-render the table while someone is editing a row inline
          if (!editingOfferKey) renderAdminTable();
        }, () => { /* leaders cannot read the full list: they use leader_names below */ });

        // Names only (no contact details): everyone signed in can read this list
        onValue(ref(db, "leader_names"), (snapshot) => {
          if (LEADER_FULL_LIST) return; // admins already have the full list
          LEADER_LOOKUP = Object.values(snapshot.val() || {}).filter(Boolean)
            .sort((a, b) => Number(a.leader_id) - Number(b.leader_id));
          refreshLeaderOptions();
          renderCalendar();
          refreshOpenDetailCard();
          renderAdminTable();
          renderBookingRequestsPanel();
        }, (error) => console.error("Unable to load leader names:", error));
      }

      // Social events: own database path, shown in every view, changed from Admin View only.
      if (isFirebaseActive) {
        onValue(ref(db, "social_events"), (snapshot) => {
          globalSocial = snapshot.val() || {};
          renderCalendar();
          renderAdminTable();
          refreshOpenDetailCard();
        }, (error) => {
          console.error("Unable to load social events:", error);
        });
      } else {
        globalSocial = JSON.parse(localStorage.getItem("global_social_events") || "{}");
      }

      // Booking database remains the source of scheduled dates and booking fields.
      if (isFirebaseActive) {
        subscribeBookingRequests();

        onValue(ref(db, "walk_messages"), (snapshot) => {
          walkMessages = snapshot.val() || {};
          renderMessagesPane();
        }, (error) => console.error("Unable to load requests:", error));

        onValue(ref(db, "walk_bookings"), (snapshot) => {
          globalBookings = snapshot.val() || {};
          renderCalendar();
          refreshOpenDetailCard();
          renderAdminTable();
          renderBookingRequestsPanel(); // requests may have arrived before the bookings
          updateStatistics();
        }, (error) => {
          console.error("Unable to load walk bookings:", error);
          alert("Could not load the booking database. Check Firebase permissions and connection.");
        });
      } else {
        const localData = localStorage.getItem("global_walk_bookings");
        globalBookings = localData ? JSON.parse(localData) : {};
        renderCalendar();
        renderAdminTable();
        updateStatistics();
      }

      // Master routes are read-only here; bookings link to them through walk_number / walk ID.
      if (isWalksFirebaseActive) {
        onValue(ref(dbWalks, "walks"), (snapshot) => {
          masterWalks = snapshot.val() || {};
          refreshWalkPicker();
          refreshWalkDetailsPanel();
          renderAdminTable();
          updateStatistics();
        }, (error) => {
          console.error("Unable to load master walks:", error);
          setWalkDetailsMessage("Master walk details could not be loaded. Check the walks database connection.");
        });
      } else {
        masterWalks = {};
        refreshWalkPicker();
        refreshWalkDetailsPanel();
      }
    }

    // Walk photo thumbnails (walker view): photo from walk_photos/{walk id}, else the walk's Image_URL, else a placeholder
    const walkPhotoCache = new Map();
    const walkPhotoPending = new Set();
    let thumbHydrateQueued = false;
    function masterWalkKey(walkId) {
      const key = String(walkId ?? "").trim();
      if (!key) return "";
      if (Object.prototype.hasOwnProperty.call(masterWalks, key)) return key;
      const hit = Object.entries(masterWalks).find(([id, walk]) =>
        String(id).trim() === key ||
        String(walk?.Walk_ID ?? walk?.walkid ?? walk?.Walk_Number ?? "").trim() === key);
      return hit ? hit[0] : "";
    }
    // Shown when a walk has no photo: a simple mountain illustration instead of text
    const WALK_PHOTO_PLACEHOLDER = '<svg viewBox="0 0 120 80" aria-hidden="true" focusable="false"><circle cx="92" cy="22" r="7" fill="#f4d58d"/><path d="M0 80 L34 30 L52 52 L70 26 L120 80 Z" fill="#9dbaa5"/><path d="M20 80 L50 40 L66 60 L84 38 L108 80 Z" fill="#5f8a6e"/><path d="M50 40 L56 48 L50 46 L44 50 Z" fill="#ffffff" opacity="0.85"/><path d="M70 26 L76 34 L70 32 L64 35 Z" fill="#ffffff" opacity="0.85"/></svg>';
    function walkThumbHtml(record) {
      const masterKey = masterWalkKey(record?.walk_number || record?.walk_id || "");
      if (!masterKey) return `<div class="walk-thumb walk-thumb-empty">${WALK_PHOTO_PLACEHOLDER}</div>`;
      return `<div class="walk-thumb walk-thumb-empty" data-photo-key="${escapeHtml(masterKey)}">${WALK_PHOTO_PLACEHOLDER}</div>`;
    }
    function applyWalkThumb(el, src) {
      if (!src) return;
      const img = document.createElement("img");
      img.alt = "";
      img.loading = "lazy";
      // A photo link that cannot be loaded falls back to the placeholder instead of a broken-image icon
      img.onerror = () => { el.classList.add("walk-thumb-empty"); el.innerHTML = WALK_PHOTO_PLACEHOLDER; };
      img.src = src;
      el.replaceChildren(img);
    }
    function hydrateWalkThumbs() {
      thumbHydrateQueued = false;
      if (!isWalksFirebaseActive) return;
      document.querySelectorAll(".walk-thumb[data-photo-key], .walk-card-photo[data-photo-key]").forEach((el) => {
        if (el.classList.contains("walk-thumb") && currentView !== "walker") return;
        const k = el.dataset.photoKey;
        if (walkPhotoCache.has(k)) { applyWalkThumb(el, walkPhotoCache.get(k)); return; }
        if (walkPhotoPending.has(k)) return;
        walkPhotoPending.add(k);
        // Uploaded photo first; the walk's Image URL is only a fallback (some image hosts have certificate problems)
        const linked = masterWalks[k]?.Image_URL ? String(masterWalks[k].Image_URL) : "";
        const finish = (src) => {
          walkPhotoCache.set(k, src);
          document.querySelectorAll(".walk-thumb[data-photo-key], .walk-card-photo[data-photo-key]").forEach((node) => {
            if (node.dataset.photoKey === k) applyWalkThumb(node, src);
          });
        };
        get(ref(dbWalks, "walk_photos/" + k)).then((snap) => {
          const v = snap.val();
          finish(v && v.data ? String(v.data) : linked);
        }).catch(() => finish(linked)).finally(() => walkPhotoPending.delete(k));
      });
    }
    function queueWalkThumbHydrate() {
      if (thumbHydrateQueued) return;
      thumbHydrateQueued = true;
      setTimeout(hydrateWalkThumbs, 0);
    }
    function getMasterWalk(walkId) {
      if (walkId === undefined || walkId === null) return null;
      const key = String(walkId).trim();
      if (!key) return null;
      if (Object.prototype.hasOwnProperty.call(masterWalks, key)) return masterWalks[key];
      // Be tolerant of numeric/string IDs and a walk record whose Walk_ID field differs from its key.
      return Object.entries(masterWalks).find(([id, walk]) =>
        String(id).trim() === key ||
        String(walk?.Walk_ID ?? walk?.walkid ?? walk?.Walk_Number ?? "").trim() === key
      )?.[1] || null;
    }

    function refreshWalkPicker() {
      const input = document.getElementById("input-walk-no");
      const list = document.getElementById("master-walk-options");
      if (!input || !list) return;
      list.innerHTML = "";
      // Only walks of the grade chosen in the form are offered; each option shows its grade
      const selectedGrade = document.getElementById("input-grade")?.value || "";
      Object.entries(masterWalks || {}).sort(([a], [b]) => a.localeCompare(b, undefined, {numeric:true})).forEach(([id, walk]) => {
        const walkGrade = getMasterRouteGrade(walk);
        if (selectedGrade && walkGrade !== selectedGrade) return;
        if (!leaderCanPickWalk(id)) return;
        const option = document.createElement("option");
        option.value = id;
        option.label = `${walkGrade || "?"} · ${walk?.Route_Name || `Walk ${id}`}`;
        list.appendChild(option);
      });
    }

    function setWalkDetailsMessage(message) {
      const panel = document.getElementById("walk-master-details");
      if (panel) panel.innerHTML = `<p class="walk-details-empty">${escapeHtml(message)}</p>`;
    }

    function getMasterCoordinates(walk) {
      const latitude = walk?.Latitude ?? walk?.latitude ?? walk?.Lat ?? walk?.lat ?? walk?.GPS_Latitude ?? walk?.GPS_Lat ?? walk?.Meeting_Point_Latitude ?? walk?.Meeting_Point_Lat ?? walk?.MeetingPointLatitude;
      const longitude = walk?.Longitude ?? walk?.longitude ?? walk?.Lon ?? walk?.lon ?? walk?.Lng ?? walk?.lng ?? walk?.GPS_Longitude ?? walk?.GPS_Lon ?? walk?.Meeting_Point_Longitude ?? walk?.Meeting_Point_Lon ?? walk?.MeetingPointLongitude;
      const lat = latitude === undefined || latitude === null ? "" : String(latitude).trim();
      const lon = longitude === undefined || longitude === null ? "" : String(longitude).trim();
      if (lat === "" || lon === "" || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))) return null;
      return { latitude: lat, longitude: lon, url: `https://www.google.com/maps?q=${encodeURIComponent(lat)},${encodeURIComponent(lon)}` };
    }

    function getMasterWisUrl(walk) {
      const raw = String(walk?.WiS_URL ?? walk?.WIS_URL ?? walk?.Wis_Url ?? walk?.WisUrl ?? walk?.wis_url ?? "").trim();
      if (!raw) return "";
      try {
        const url = new URL(raw, window.location.href);
        return ["http:", "https:"].includes(url.protocol) ? url.href : "";
      } catch (_) { return ""; }
    }

    // Downloadable GPX route: the file text is kept in Firebase at walk_gpx/{walk key} and fetched only when clicked
    document.addEventListener("click", async (e) => {
      const link = e.target.closest("[data-gpx-download]");
      if (!link) return;
      e.preventDefault();
      try {
        const snap = await get(ref(dbWalks, "walk_gpx/" + link.dataset.gpxDownload));
        const file = snap.val();
        if (!file || !file.text) return alert("The GPX file could not be found.");
        const url = URL.createObjectURL(new Blob([file.text], { type: "application/gpx+xml" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = file.name || link.dataset.gpxName || "route.gpx";
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (err) {
        console.error("GPX download failed:", err);
        alert("Could not download the GPX file. Check the database connection.");
      }
    });

    function renderMasterRouteValue(label, value) {
      if (label === "Meeting point" && value && value.url) {
        return `<a href="${escapeHtml(value.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(value.latitude)}, ${escapeHtml(value.longitude)} · Open in Google Maps ↗</a>`;
      }
      if (label === "WIS_URL" && value) {
        return `<a href="${escapeHtml(value)}" target="_blank" rel="noopener noreferrer">Walks In Spain ↗</a>`;
      }
      return escapeHtml(value || "Not recorded");
    }

    function refreshWalkDetailsPanel() {
      const walkId = document.getElementById("input-walk-no")?.value;
      const walk = getMasterWalk(walkId);
      const panel = document.getElementById("walk-master-details");
      if (!panel) return;
      if (!walkId) {
        setWalkDetailsMessage("Enter or select a Walk Number to load the master route details.");
        return;
      }
      if (!walk) {
        setWalkDetailsMessage(`No master route found for Walk ID ${walkId}. Booking details can still be recorded; check the Walk Number.`);
        return;
      }
      // Walk name and pueblo are mastered by the linked walks record.
      // Use common field-name variants so the lookup tolerates existing dataset conventions.
      const routeName = getMasterRouteName(walk);
      const routePueblo = getMasterRoutePueblo(walk);
      const nameInput = document.getElementById("input-walk-name");
      const puebloInput = document.getElementById("input-pueblo");
      if (nameInput && routeName) {
        nameInput.value = routeName;
        nameInput.dataset.autofilled = "true";
      }
      if (puebloInput && routePueblo) {
        puebloInput.value = routePueblo;
        puebloInput.dataset.autofilled = "true";
      }

      const gradeCheck = validateBookingWalkGrade(false);
      const fields = [
        ["Route name", getMasterRouteName(walk)],
        ["Grade", getMasterRouteGrade(walk)],
        ["Distance", walk.Distance],
        ["Ascent", walk.Ascent],
        ["Terrain", walk.Terrain],
        ["SCR", walk.Scr],
        ["X", xFlag(walk)],
        ["Total time", walk.Total_Time],
        ["Dogs", walk.Dogs],
        ["Route description", walk.Route_Description],
        ["Directions", walk.Directions],
        ["Meeting point", getMasterCoordinates(walk)],
        ["WIS_URL", getMasterWisUrl(walk)]
      ];
      panel.innerHTML = `
        <div class="walk-details-title">Walk details from the master database <span class="walk-id-pill">Walk ID: ${escapeHtml(walkId)}</span></div>
        ${readOnlyNoteHtml()}
        ${gradeCheck.mismatch ? `<p role="alert" style="color:#b91c1c;font-weight:700;margin:8px 0;">Grade mismatch: this master walk is grade ${escapeHtml(gradeCheck.masterGrade)}, but the booking is grade ${escapeHtml(gradeCheck.bookingGrade)}. Choose a walk with a matching grade.</p>` : ""}
        <div class="walk-details-grid">
          ${fields.map(([label, value]) => {
            const compact = ["Grade", "Distance", "Ascent", "Terrain", "SCR", "Total time", "Dogs"].includes(label);
            const wide = ["Route name", "Route description", "Directions"].includes(label);
            return `<div class="walk-detail-field${compact ? " compact" : ""}${wide ? " wide" : ""}"><span>${escapeHtml(label)}</span><div>${renderMasterRouteValue(label, value)}</div></div>`;
          }).join("")}
        </div>`;
    }

    function getMasterRouteGrade(walk) {
      return String(walk?.Grade ?? walk?.Walk_Grade ?? walk?.WalkGrade ?? walk?.grade ?? walk?.walk_grade ?? "").trim().toUpperCase();
    }

    function validateBookingWalkGrade(showMessage = false) {
      const walkInput = document.getElementById("input-walk-no");
      const gradeInput = document.getElementById("input-grade");
      if (!walkInput || !gradeInput) return { mismatch: false, masterGrade: "", bookingGrade: "" };
      const walk = getMasterWalk(walkInput.value);
      const masterGrade = getMasterRouteGrade(walk);
      const bookingGrade = String(gradeInput.value || "").trim().toUpperCase();
      const mismatch = !!(walk && masterGrade && bookingGrade && masterGrade !== bookingGrade);
      const message = mismatch
        ? `Grade mismatch: Walk ${walkInput.value.trim()} is grade ${masterGrade}, but this booking is grade ${bookingGrade}. Enter a walk number with grade ${bookingGrade}.`
        : "";
      walkInput.setCustomValidity(message);
      walkInput.setAttribute("aria-invalid", mismatch ? "true" : "false");
      if (showMessage && mismatch) walkInput.reportValidity();
      return { mismatch, masterGrade, bookingGrade };
    }

    /* ========================================================= LEADER LOOKUP =========================================================
       Loaded live from the "leaders" database path (see initDataSync). Keyed by leader_id.
       linked_leader holds another leader's leader_id (e.g. a co-leader). */
    let LEADER_LOOKUP = [];
    let LEADER_FULL_LIST = false; // true once the full leaders list (admins only) has loaded

    function leaderFullName(leader) {
      return leader ? `${leader.first_name || ""} ${leader.surname || ""}`.trim() : "";
    }

    // Name shown to walkers: the directory's display name when set, otherwise the full name
    function leaderDisplayName(leader) {
      return leader ? (String(leader.display_name || "").trim() || leaderFullName(leader)) : "";
    }

    // Walker-facing names for a booking's leaders, looked up from their IDs
    function bookingLeaderDisplayNames(record) {
      return bookingLeaderIds(record).map((id) => leaderDisplayName(findLeader(id))).filter(Boolean);
    }

    // Contact details for a booking's leaders, read by their random key. Cached; re-renders the open card when they arrive.
    const contactCache = new Map();
    const contactPending = new Set();
    function requestContact(key) {
      if (!key || contactCache.has(key) || contactPending.has(key)) return;
      contactPending.add(key);
      get(ref(db, "leader_contacts/" + key)).then((snap) => {
        contactCache.set(key, snap.exists() ? snap.val() : {});
        contactPending.delete(key);
        if (openCardKey) renderDetailCard();
      }).catch(() => { contactPending.delete(key); });
    }

    function findLeader(leaderId) {
      return LEADER_LOOKUP.find((l) => String(l.leader_id) === String(leaderId)) || null;
    }

    // The booking's main leader ID
    function selectedLeaderId(record) {
      return record?.leader_id || "";
    }

    /* Leader ids allowed to lead a walk: its owner plus the permitted leaders in the walk library.
       Returns null (no restriction) when the walk is unknown or has no owner/permitted list. */
    function permittedLeaderIds(walkNo) {
      const walk = getMasterWalk(walkNo);
      if (!walk) return null;
      // Owner plus permitted leaders, as leader IDs
      const raw = [walk.owner_leader_id, ...(Array.isArray(walk.permitted_leader_ids) ? walk.permitted_leader_ids : String(walk.permitted_leader_ids || "").split(","))];
      // The full list is only available to admins, so filter by it only when it has been loaded
      const known = new Set(LEADER_LOOKUP.map((l) => String(l.leader_id)));
      const ids = [...new Set(raw.map((id) => String(id ?? "").trim()).filter((id) => id && id !== "0" && id !== "undefined" && (!LEADER_LOOKUP.length || known.has(id))))];
      return ids.length ? ids : null;
    }

    function leaderOptionsHtml(selectedId, allowedIds = null) {
      const placeholder = `<option value="" disabled ${selectedId ? "" : "selected"}>Choose a leader</option>`;
      const options = LEADER_LOOKUP.filter((l) => !allowedIds || allowedIds.includes(l.leader_id)).map((l) =>
        `<option value="${escapeHtml(l.leader_id)}" ${l.leader_id === selectedId ? "selected" : ""}>${escapeHtml(leaderFullName(l))}</option>`
      ).join("");
      return placeholder + options;
    }

    /* Leader ids on a booking: up to two (leader_ids), or the single leader_id. */
    function bookingLeaderIds(record) {
      if (!record) return [];
      if (Array.isArray(record.leader_ids) && record.leader_ids.length) return record.leader_ids;
      const id = selectedLeaderId(record);
      return id ? [id] : [];
    }

    /* Names of the owner and permitted leaders for the walk typed in the booking modal (no restriction if the walk has none) */
    function allowedLeaderNames() {
      const walkNo = document.getElementById("input-walk-no")?.value.trim() || "";
      const allowed = permittedLeaderIds(walkNo);
      return LEADER_LOOKUP
        .filter((l) => !allowed || allowed.includes(String(l.leader_id)))
        .map((l) => leaderFullName(l));
    }

    // Suggestions in the Leader(s) field, and a hint showing who may lead the walk
    function refreshLeaderOptions() {
      const names = allowedLeaderNames();
      const list = document.getElementById("leader-options");
      if (list) list.innerHTML = names.map((n) => `<option value="${escapeHtml(n)}"></option>`).join("");
    }

    // Optional leader choice (inline edit, Leader 2): first option is "none"
    function leaderOptionsOptionalHtml(selectedId, allowedIds = null) {
      const options = LEADER_LOOKUP.filter((l) => !allowedIds || allowedIds.includes(l.leader_id)).map((l) =>
        `<option value="${escapeHtml(l.leader_id)}" ${l.leader_id === selectedId ? "selected" : ""}>${escapeHtml(leaderFullName(l))}</option>`
      ).join("");
      return `<option value="" ${selectedId ? "" : "selected"}>No second leader</option>` + options;
    }

    function populateLeaderSelect(record) {
      const first = document.getElementById("input-leader");
      const second = document.getElementById("input-leader-2");
      if (!first || !second) return;
      const names = bookingLeaderIds(record).map((id) => leaderFullName(findLeader(id))).filter(Boolean);
      first.value = names[0] || "";
      second.value = names[1] || "";
      refreshLeaderOptions();
    }

    // Validate the two Leader fields: leader 1 required, leader 2 optional; each the owner or a permitted leader of the walk
    function validateLeaderInput(walkNo) {
      const first = document.getElementById("input-leader").value.trim();
      if (!first) return { error: "Please enter a leader.", field: "input-leader" };
      const typed = [
        { el: "input-leader", value: first },
        { el: "input-leader-2", value: document.getElementById("input-leader-2").value.trim() },
      ].filter((f) => f.value);
      const allowed = permittedLeaderIds(walkNo);
      const ids = [];
      for (const f of typed) {
        const name = f.value.replace(/\s+/g, " ");
        const match = LEADER_LOOKUP.find((l) => leaderFullName(l).toLowerCase() === name.toLowerCase());
        if (!match) return { error: `"${name}" is not a known leader. Choose from the suggestions.`, field: f.el };
        if (allowed && !allowed.includes(match.leader_id)) {
          return { error: `${leaderFullName(match)} is not permitted to lead walk ${walkNo}. Only the owner or a permitted leader can be listed.`, field: f.el };
        }
        if (ids.includes(match.leader_id)) return { error: `${leaderFullName(match)} is listed twice.`, field: f.el };
        ids.push(match.leader_id);
      }
      return { ids };
    }

    function getMasterRouteName(walk) {
      return String(walk?.Route_Name ?? walk?.Walk_Name ?? walk?.Name ?? walk?.name ?? "").trim();
    }

    function getMasterRoutePueblo(walk) {
      return String(walk?.Pueblo ?? walk?.pueblo ?? walk?.Town ?? walk?.town ?? walk?.Village ?? walk?.village ?? "").trim();
    }

    function getBookingMasterValues(record) {
      const walk = getMasterWalk(record?.walk_number || record?.walk_id || "");
      return {
        walk,
        name: getMasterRouteName(walk) || record?.walk_name || "",
        pueblo: getMasterRoutePueblo(walk) || record?.pueblo || ""
      };
    }

      /* ========================================================= SAVE BOOKING ========================================================= */ function saveBookingRecord(
      key,
      data,
    ) {
      if (data === null) {
        delete globalBookings[key];
      } else {
        globalBookings[key] = data;
      }
      if (isFirebaseActive) {

        // Drop undefined values (Firebase refuses them), and tell the user if the write is refused
        set(ref(db, "walk_bookings/" + key), data === null ? null : JSON.parse(JSON.stringify(data))).catch((err) => {
          console.error("Booking not saved:", err);
          alert("This booking could not be saved: " + (err?.message || err));
        });
      } else {
        localStorage.setItem(
          "global_walk_bookings",
          JSON.stringify(globalBookings),
        );
        renderCalendar();
        renderAdminTable();
        updateStatistics();
      }
    }
      /* ========================================================= CLEAR ALL ========================================================= */ function downloadBookingsBackup() {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const blob = new Blob([JSON.stringify(globalBookings, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `cbmw-bookings-backup-${stamp}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    function clearAllRecords() {
      const count = Object.keys(globalBookings || {}).length;
      if (count === 0) { alert("There are no walk bookings to clear."); return; }
      if (!confirm(`This will permanently delete all ${count} walk bookings. Social events are kept.\n\nA backup file is downloaded first.`)) return;
      const typed = prompt(`To confirm, type CLEAR (in capitals) to delete all ${count} bookings.`);
      if (typed !== "CLEAR") { alert("Nothing was deleted."); return; }
      try {
        downloadBookingsBackup();
      } catch (err) {
        alert("The backup could not be downloaded, so nothing was deleted: " + (err?.message || err));
        return;
      }
      if (isFirebaseActive) {
        remove(ref(db, "walk_bookings")).catch((err) => {
          console.error("Clear all bookings failed:", err);
          alert("The bookings could not be cleared: " + (err?.message || err));
        });
      } else {
        globalBookings = {};
        localStorage.removeItem("global_walk_bookings");
        renderCalendar();
        renderAdminTable();
        updateStatistics();
      }
    }
    /* ========================================================= CALENDAR ========================================================= */
      // Picker mode: a stacked 12-month picker; days with a walk are marked. Clicking a day filters the list to it.
      let pickerDay = "";
      function pickerHasWalkOn(dateISO) {
        if (socialKeysForDate(dateISO).length) return true;
        return Object.entries(globalBookings || {}).some(([k, b]) => k.startsWith(dateISO + "_") && isVisibleInView(b));
      }
      function renderPicker() {
        const host = document.getElementById("picker-months");
        if (!host) return;
        updatePickerOpenLabel();
        host.innerHTML = "";
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const startY = today.getFullYear();
        const startM = today.getMonth();
        for (let m = 0; m < 12; m++) {
          const first = new Date(startY, startM + m, 1);
          const y = first.getFullYear();
          const mo = first.getMonth();
          const block = document.createElement("div");
          block.className = "picker-month";
          const title = document.createElement("div");
          title.className = "picker-month-title";
          title.textContent = `${monthNames[mo]} ${y}`;
          const wd = document.createElement("div");
          wd.className = "picker-weekdays picker-weekdays-inline";
          wd.setAttribute("aria-hidden", "true");
          wd.innerHTML = "<span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span>";
          const grid = document.createElement("div");
          grid.className = "picker-grid";
          for (let i = 0; i < first.getDay(); i++) {
            const e = document.createElement("span");
            e.className = "picker-empty";
            grid.appendChild(e);
          }
          const total = new Date(y, mo + 1, 0).getDate();
          for (let d = 1; d <= total; d++) {
            const dateObj = new Date(y, mo, d);
            const iso = modeIso(dateObj);
            const dmy = `${String(d).padStart(2, "0")}-${String(mo + 1).padStart(2, "0")}-${y}`;
            const has = pickerHasWalkOn(dmy);
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "picker-day";
            btn.textContent = d;
            if (has) btn.classList.add("has-walk");
            if (dateObj < today) btn.classList.add("past");
            if (dateObj.getTime() === today.getTime()) btn.classList.add("today");
            if (pickerDay === iso) btn.classList.add("selected");
            btn.setAttribute("aria-label", `${d} ${monthNames[mo]} ${y}${has ? ", walks" : ""}`);
            btn.setAttribute("aria-pressed", String(pickerDay === iso));
            btn.addEventListener("click", () => {
              pickerDay = pickerDay === iso ? "" : iso;
              applyPickerRange();
              updateWalkOffersTitle();
              renderPicker();
              renderAdminTable();
              if (isPickerPopupView()) setPickerPopup(false);
            });
            grid.appendChild(btn);
          }
          block.appendChild(title);
          block.appendChild(wd);
          block.appendChild(grid);
          host.appendChild(block);
        }
      }
      function applyPickerRange() {
        if (pickerDay) {
          setWalkerRange(pickerDay, pickerDay);
        } else {
          const t = new Date();
          t.setHours(0, 0, 0, 0);
          setWalkerRange(modeIso(t), "");
        }
      }
      // Leader View: "Calendar" = calendar stacked above the list; "Picker" = picker and list side by side
      function setLeaderLayout(layout) {
        document.body.dataset.leaderLayout = layout;
        document.querySelectorAll("[data-leader-layout]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.leaderLayout === layout)));
        if (layout === "picker") {
          applyPickerRange();
          renderPicker();
        } else {
          pickerDay = "";
          setWalkerRange("", "");
        }
        updateWalkOffersTitle();
        renderAdminTable();
      }
      document.querySelectorAll("[data-leader-layout]").forEach((btn) => {
        btn.addEventListener("click", () => setLeaderLayout(btn.dataset.leaderLayout));
      });
      // Leader View: side bars for previous / next month; they drive the month buttons in the title row
      document.querySelector(".month-side-prev")?.addEventListener("click", () => document.getElementById("prev-month")?.click());
      document.querySelector(".month-side-next")?.addEventListener("click", () => document.getElementById("next-month")?.click());
      // Phones and tablets: the date picker is a popup opened from the date button
      const isPickerPopupView = () => currentView === "walker" && document.body.dataset.walkerMode === "picker" && window.matchMedia("(max-width: 700px)").matches;
      function setPickerPopup(open) {
        document.body.classList.toggle("picker-open", open && isPickerPopupView());
        document.getElementById("picker-open-btn")?.setAttribute("aria-expanded", String(document.body.classList.contains("picker-open")));
        if (document.body.classList.contains("picker-open")) renderPicker();
      }
      function updatePickerOpenLabel() {
        const el = document.getElementById("picker-open-label");
        if (el) el.textContent = pickerDay ? msgDateText(pickerDay) : "All upcoming";
      }
      document.getElementById("picker-open-btn")?.addEventListener("click", () => {
        setPickerPopup(!document.body.classList.contains("picker-open"));
      });
      document.getElementById("picker-close")?.addEventListener("click", () => setPickerPopup(false));
      document.addEventListener("click", (e) => {
        if (!document.body.classList.contains("picker-open")) return;
        if (e.target.closest("#picker-column") || e.target.closest("#picker-open-btn")) return;
        setPickerPopup(false);
      });
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && document.body.classList.contains("picker-open")) setPickerPopup(false);
      });
      document.getElementById("picker-clear")?.addEventListener("click", () => {
        pickerDay = "";
        applyPickerRange();
        updateWalkOffersTitle();
        renderPicker();
        renderAdminTable();
      });

      function renderCalendar() {
        hideHoverCard();
        renderPicker();
        daysGrid.innerHTML = "";

        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();
        const gotoMonth = document.getElementById("walker-goto-month");
        if (gotoMonth) gotoMonth.value = `${year}-${String(month + 1).padStart(2, "0")}`;

        calendarTitle.innerText = `${monthNames[month]} ${year}`;

        const firstDayIndex = new Date(year, month, 1).getDay();
        const totalDays = new Date(year, month + 1, 0).getDate();

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Empty cells before the first day of the month
        for (let i = 0; i < firstDayIndex; i++) {
          const emptyCell = document.createElement("div");
          emptyCell.classList.add("day-cell", "empty");
          daysGrid.appendChild(emptyCell);
        }

        // Render each day
        for (let day = 1; day <= totalDays; day++) {

          const dayCell = document.createElement("div");
          dayCell.classList.add("day-cell");

          // Day number
          const dayNoDiv = document.createElement("div");
          dayNoDiv.classList.add("day-number");
          dayNoDiv.innerText = day;
          dayCell.appendChild(dayNoDiv);

          const specificDate = new Date(year, month, day);
          specificDate.setHours(0, 0, 0, 0);

          const dayOfWeek = specificDate.getDay();
          dayNoDiv.dataset.dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dayOfWeek];

          // Firebase date format: DD-MM-YYYY
          const dateISO =
            `${String(day).padStart(2, "0")}-` +
            `${String(month + 1).padStart(2, "0")}-` +
            `${year}`;

          const isPast = specificDate < today;

          const slotsContainer = document.createElement("div");
          slotsContainer.classList.add("slots-container");

          // Social events: listed first on the day, in every view
          socialKeysForDate(dateISO).forEach((key) => {
            const record = globalSocial[key];
            const socialEl = document.createElement("div");
            const isSummer = record.type === "summer";
            socialEl.classList.add("slot", "social");
            if (isSummer) socialEl.classList.add("summer");
            const eventLabel = isSummer ? `Walk · ${record.title || "Summer walk"}` : `★ ${record.title || "Social event"}`;
            setSlotLabel(socialEl, eventLabel, isSummer ? "Walk" : "★", record.start_time);
            socialEl.title = `${record.title || (isSummer ? "Summer walk" : "Social event")} • ${formatStartTime(record.start_time)}`;
            if (isPast) socialEl.classList.add("past");
            socialEl.addEventListener("click", () => {
              if (isAdminView()) {
                openSocialModal(dateISO, key);
              } else {
                openSocialCard(key);
              }
            });
            slotsContainer.appendChild(socialEl);
          });

          // ============================================================
          // STANDARD WEDNESDAY / SATURDAY
          // ============================================================

          if (dayOfWeek === 3 || dayOfWeek === 6) {

            grades.forEach((grade) => {
              // Walker view: a chosen grade filter shows only that grade on the calendar
              const gradeFilter = currentView === "walker" ? (document.getElementById("admin-filter-grade")?.value || "ALL") : "ALL";
              if (gradeFilter !== "ALL" && grade !== gradeFilter) return;

              /*
              * Find ALL booking keys matching:
              *
              * DD-MM-YYYY_GRADE_unique
              *
              * Example:
              * 29-09-2026_E_34444
              * 29-09-2026_E_565656
              */

              const keyPrefix = `${dateISO}_${grade}_`;

              const matchingBookings = Object.entries(globalBookings || {})
                .filter(([key, b]) => key.startsWith(keyPrefix) && (previewReturnView || isVisibleInView(b)));


              // --------------------------------------------------------
              // There are bookings for this date/grade
              // --------------------------------------------------------

              if (matchingBookings.length > 0) {

                matchingBookings.forEach(([key, bookedData]) => {

                  const slotEl = document.createElement("div");

                  slotEl.classList.add(
                    "slot",
                    `grade-${grade}`,
                    "booked"
                  );
                  if (isDraft(bookedData)) slotEl.classList.add("draft");
                  if (isCancelled(bookedData)) slotEl.classList.add("cancelled");
                  else if (bookedData.modified === true) slotEl.classList.add("modified");

                  /*
                  * Get the Walk ID from:
                  *
                  * DD-MM-YYYY_GRADE_WALKID
                  */
                  const walkID = bookedData.walk_number;

                  setSlotLabel(slotEl, bookedSlotLabel(bookedData, walkID), grade, bookedData.start_time);

                  

                  if (isPast) {
                    slotEl.classList.add("past");
                  } else {
                    attachBookedSlot(slotEl, key, () => openBookingModal(dateISO, grade, bookedData, walkID));
                  }

                  slotsContainer.appendChild(slotEl);
                });

              }

              // --------------------------------------------------------
              // No bookings - show available slot
              // --------------------------------------------------------

              else {

                // Walker View shows only booked slots
                if (currentView === "walker") return;

                const slotEl = document.createElement("div");

                slotEl.classList.add(
                  "slot",
                  `grade-${grade}`
                );

                if (isPast) {

                  slotEl.classList.add("past");
                  slotEl.innerText = grade;

                } else {

                  slotEl.classList.add("available");
                  slotEl.innerHTML = `<span class="slot-grade">${grade}</span><span class="slot-label">Available</span><span class="slot-add" aria-hidden="true">+ Add</span>`;

                  slotEl.addEventListener("click", () =>
                    handleAvailableClick(dateISO, grade)
                  );
                }

                slotsContainer.appendChild(slotEl);
              }

            });
          }


          // ============================================================
          // AD HOC WALKS
          // ============================================================

          else {

            grades.forEach((grade) => {
              // Walker view: a chosen grade filter applies to ad hoc days too
              const gradeFilter = currentView === "walker" ? (document.getElementById("admin-filter-grade")?.value || "ALL") : "ALL";
              if (gradeFilter !== "ALL" && grade !== gradeFilter) return;

              const keyPrefix = `${dateISO}_${grade}_`;

              const matchingBookings = Object.entries(globalBookings || {})
                .filter(([key, b]) => key.startsWith(keyPrefix) && (previewReturnView || isVisibleInView(b)));


              /*
              * Ad hoc days only display slots that actually exist
              * in Firebase.
              */

              matchingBookings.forEach(([key, bookedData]) => {

                const walkID = key.substring(keyPrefix.length);

                const slotEl = document.createElement("div");

                slotEl.classList.add(
                  "slot",
                  `grade-${grade}`,
                  "booked"
                );
                  if (isDraft(bookedData)) slotEl.classList.add("draft");
                  if (isCancelled(bookedData)) slotEl.classList.add("cancelled");
                  else if (bookedData.modified === true) slotEl.classList.add("modified");

                setSlotLabel(slotEl, bookedSlotLabel(bookedData, walkID), grade, bookedData.start_time);

                

                if (isPast) {
                  slotEl.classList.add("past");
                } else {
                  attachBookedSlot(slotEl, key, () => openBookingModal(dateISO, grade, bookedData, walkID));
                }

                slotsContainer.appendChild(slotEl);
              });

            });
          }


          // Add slots to day
          dayCell.appendChild(slotsContainer);

          const dayIso = `${dateISO.slice(6, 10)}-${dateISO.slice(3, 5)}-${dateISO.slice(0, 2)}`;


          // Add day to calendar
          // Walker View: clicking a day (not a walk) filters the walk list to that day, and clicking it again clears the filter
          if (currentView === "walker") {
            const dayIso = modeIso(specificDate);
            const fromNow = document.getElementById("admin-filter-from")?.value || "";
            const toNow = document.getElementById("admin-filter-to")?.value || "";
            dayCell.classList.add("selectable-day");
            if (fromNow === dayIso && toNow === dayIso) dayCell.classList.add("selected-day");
            dayCell.addEventListener("click", (e) => {
              if (e.target.closest(".slot")) return; // walk clicks open the walk card instead
              if (fromNow === dayIso && toNow === dayIso) syncWalkerRange();
              else setWalkerRange(dayIso, dayIso);
              renderCalendar();
              renderAdminTable();
            });
          }
          // Leader and Admin on phones and tablets: tapping an empty part of a busy day opens that day as a large list
          if (currentView !== "walker" && slotsContainer.children.length) {
            dayCell.addEventListener("click", (e) => {
              if (e.target.closest(".slot")) return; // slot taps are handled by the slot itself
              if (!window.matchMedia("(max-width: 1100px)").matches) return;
              openDaySheet(dayCell, specificDate);
            });
          }
          // Days with no walks, slots or social events: narrower on phones and tablets (Leader and Admin)
          if (!slotsContainer.children.length) dayCell.classList.add("quiet-day");
          daysGrid.appendChild(dayCell);
        }
        // Group the days into week rows so the empty days can be narrowed on phones and tablets
        const allCells = Array.from(daysGrid.children);
        daysGrid.innerHTML = "";
        for (let i = 0; i < allCells.length; i += 7) {
          const row = document.createElement("div");
          row.className = "week-row";
          allCells.slice(i, i + 7).forEach((c) => row.appendChild(c));
          daysGrid.appendChild(row);
        }
      }
      /* ========================================================= ADMIN TABLE ========================================================= */ 
    /* ===== Walk Offers table: sort + filter state and helpers ===== */
    const adminGradeOrder = { E: 1, M: 2, MS: 3, S: 4, VS: 5 };
    let adminSortColumn = "date";
    let adminSortDirection = "asc";

    function getAdminSortValue(record, column) {
      switch (column) {
        case "date": {
          const d = convertDate(record.date);
          return d ? d.getTime() : 0;
        }
        case "start_time":
          return record.start_time || "";
        case "walk_grade":
          return adminGradeOrder[record.walk_grade] || 99;
        case "walk_number":
          return Number(record.walk_number) || 0;
        case "walk_name":
          return (record.walk_name || "").toLowerCase();
        case "leader_name":
          return bookingLeaderLabel(record).toLowerCase();
        case "status":
          return bookingStatus(record) === "live" ? 1 : 0;
        case "notes":
          return (record.notes || "").toLowerCase();
        case "pueblo":
          return (record.pueblo || "").toLowerCase();
        case "comments":
          return (record.comments || "").toLowerCase();
        default:
          return "";
      }
    }

    // Full names of a booking's leaders, looked up from their IDs
    function leaderNamesOnBooking(record) {
      return bookingLeaderIds(record).map((id) => leaderFullName(findLeader(id))).filter(Boolean);
    }
    // Display label for a booking's leaders, e.g. "Ann Smith, Bob Jones"
    function bookingLeaderLabel(record) {
      return leaderNamesOnBooking(record).join(", ");
    }

    // Rebuild the Leader / Pueblo dropdowns from the data, keeping the current selection
    function populateAdminFilters() {
      const records = Object.values(globalBookings).filter(Boolean);
      [
        ["admin-filter-leader", null, "All leaders"],
        ["admin-filter-pueblo", "pueblo", "All pueblos"],
      ].forEach(([id, field, allLabel]) => {
        const select = document.getElementById(id);
        if (!select) return;
        const current = select.value;
        // Leader filter: values are leader IDs, labels are names
        const label = (v) => (field ? v : (leaderFullName(findLeader(v)) || v));
        const values = [...new Set(field
          ? records.map((r) => r[field]).filter(Boolean)
          : records.flatMap((r) => bookingLeaderIds(r).map(String)).filter(Boolean))]
          .sort((a, b) => label(a).localeCompare(label(b)));
        select.innerHTML = "";
        select.appendChild(new Option(allLabel, "ALL"));
        values.forEach((v) => select.appendChild(new Option(label(v), v)));
        select.value = values.includes(current) ? current : "ALL";
      });
    }

    // Apply the filters, then sort; returns the booking keys to display
    function getAdminVisibleKeys() {
      const val = (id) => (document.getElementById(id) ? document.getElementById(id).value : "ALL");
      const search = (document.getElementById("admin-filter-search")?.value || "").trim().toLowerCase();
      const grade = val("admin-filter-grade");
      // Preview shows the walker look but keeps the Leader and Pueblo filters the admin or leader chose
      const walkerLook = currentView === "walker" && !previewReturnView;
      const leader = walkerLook ? "ALL" : val("admin-filter-leader");
      const pueblo = walkerLook ? "ALL" : val("admin-filter-pueblo");
      const status = val("admin-filter-status");
      // Date range (YYYY-MM-DD from the date inputs); booking dates are DD-MM-YYYY
      const rangeFrom = document.getElementById("admin-filter-from")?.value || "";
      const rangeTo = document.getElementById("admin-filter-to")?.value || "";

      const keys = Object.keys(globalBookings).filter((key) => {
        const r = globalBookings[key];
        if (!r) return false;
        if (rangeFrom || rangeTo) {
          const p = String(r.date || "").split("-");
          const iso = p.length === 3 ? `${p[2]}-${p[1]}-${p[0]}` : "";
          if (!iso) return false;
          if (rangeFrom && iso < rangeFrom) return false;
          if (rangeTo && iso > rangeTo) return false;
        }
        if (grade !== "ALL" && r.walk_grade !== grade) return false;
        if (leader !== "ALL" && !bookingLeaderIds(r).map(String).includes(String(leader))) return false;
        if (pueblo !== "ALL" && r.pueblo !== pueblo) return false;
        if (status !== "ALL" && bookingStatus(r) !== status) return false;
        if (!previewReturnView && !isVisibleInView(r)) return false;
        if ((currentView !== "walker" || previewReturnView) && !showPastWalks && isPastDate(r.date)) return false;
        if (search) {
          const haystack = [r.date, r.start_time, r.walk_grade, r.walk_number, r.walk_name,
            leaderNamesOnBooking(r).join(" "), r.notes, r.pueblo, r.comments].join(" ").toLowerCase();
          if (!haystack.includes(search)) return false;
        }
        return true;
      });

      keys.sort((a, b) => {
        const va = getAdminSortValue(globalBookings[a], adminSortColumn);
        const vb = getAdminSortValue(globalBookings[b], adminSortColumn);
        let result =
          typeof va === "number" && typeof vb === "number"
            ? va - vb
            : String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: "base" });
        if (result === 0) result = a.localeCompare(b); // stable tie-break
        return adminSortDirection === "asc" ? result : -result;
      });
      return keys;
    }

    function updateAdminSortIndicators() {
      document.querySelectorAll(".admin-sortable-header").forEach((header) => {
        const indicator = header.querySelector(".sort-indicator");
        const active = header.dataset.adminSort === adminSortColumn;
        indicator.textContent = active ? (adminSortDirection === "asc" ? "↑" : "↓") : "↕";
        indicator.classList.toggle("active", active);
        header.setAttribute("aria-sort", active ? (adminSortDirection === "asc" ? "ascending" : "descending") : "none");
      });
    }

    // Header clicks (mouse + keyboard)
    document.querySelectorAll(".admin-sortable-header").forEach((header) => {
      const toggleSort = () => {
        const column = header.dataset.adminSort;
        if (adminSortColumn === column) {
          adminSortDirection = adminSortDirection === "asc" ? "desc" : "asc";
        } else {
          adminSortColumn = column;
          adminSortDirection = "asc";
        }
        renderAdminTable();
      };
      header.addEventListener("click", toggleSort);
      header.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggleSort();
        }
      });
    });

    // Filter controls
    ["admin-filter-search", "admin-filter-grade", "admin-filter-leader",
      "admin-filter-pueblo", "admin-filter-status", "admin-filter-from", "admin-filter-to"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener(id === "admin-filter-search" ? "input" : "change", () => {
        renderAdminTable();
        if (["admin-filter-grade", "admin-filter-from", "admin-filter-to"].includes(id) && currentView === "walker") renderCalendar();
      });
    });
    document.getElementById("admin-filter-clear").addEventListener("click", () => {
      document.getElementById("admin-filter-search").value = "";
      ["admin-filter-grade", "admin-filter-leader", "admin-filter-pueblo", "admin-filter-status"]
        .forEach((id) => { document.getElementById(id).value = "ALL"; });
      ["admin-filter-from", "admin-filter-to"]
        .forEach((id) => { document.getElementById(id).value = ""; });
      renderAdminTable();
      if (currentView === "walker") { syncWalkerRange(); updateWalkOffersTitle(); renderCalendar(); }
    });

    // Status toggle in the Walk Offers table: Draft <-> Live in one click
    adminTableBody?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-status-key]");
      if (!btn || !isAdminView()) return;
      const key = btn.dataset.statusKey;
      const record = globalBookings[key];
      if (!record) return;
      const next = bookingStatus(record) === "live" ? "draft" : "live";
      saveBookingRecord(key, { ...record, status: next });
    });

    // Escape free text before it is placed into innerHTML
    /* ========================================================= LEADER INLINE EDIT =========================================================
       In Leader View an expanded walk offer can change the same fields the leader may change in the modal:
       start time, walk number, leader, programme comments and notes. Date, grade and name stay as they are. */
    let editingOfferKey = null;

    /* Master database details cannot be changed from a booking; Leader View says so plainly */
    function readOnlyPillHtml() {
      return currentView === "walker" ? "" : '<span class="read-only-pill">🔒 Read only</span>';
    }
    function readOnlyNoteHtml() {
      if (currentView === "leader") {
        return '<p class="read-only-note">🔒 These walk details come from the master walks database. They can\'t be changed from a booking.</p>';
      }
      if (currentView === "admin") {
        return '<p class="read-only-note">🔒 These walk details come from the master walks database.</p>';
      }
      return "";
    }

    // Temporary leader identity: the leader enters their email. Leaders act only on walks they own
    // (the master walk's Leader). This is a convenience until proper sign-in, not a security control.
    let myLeaderId = "";
    function myLeader() {
      return myLeaderId ? findLeader(myLeaderId) : null;
    }
    // Compare names loosely: ignore case and extra spaces
    function normaliseName(value) {
      return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
    }
    function leaderOwnsWalk(walkNo) {
      const me = myLeader();
      const walk = getMasterWalk(walkNo);
      if (!me || !walk) return false;
      return String(walk.owner_leader_id || "") !== "" && String(walk.owner_leader_id) === String(me.leader_id);
    }
    // Leaders may book only walks they own or are a permitted leader on
    function leaderMayLeadWalk(walkNo) {
      const me = myLeader();
      const walk = getMasterWalk(walkNo);
      if (!me || !walk) return false;
      return (permittedLeaderIds(walkNo) || []).includes(String(me.leader_id));
    }
    // In Leader View the walk lists only show walks this leader may lead
    function leaderCanPickWalk(walkId) {
      return currentView !== "leader" || leaderMayLeadWalk(walkId);
    }
    // A booking is theirs when they are listed as one of its leaders (walk ownership does not count)
    function leaderOwnsRecord(record) {
      if (!record || !myLeaderId) return false;
      return bookingLeaderIds(record).map(String).includes(String(myLeaderId));
    }
    // Leader View: drafts they own can be changed or deleted
    function leaderCanEditDraft(record) {
      return currentView === "leader" && !!record && isDraft(record) && leaderOwnsRecord(record);
    }
    // Leader View: published walks they own can be asked about
    function leaderCanRequest(record) {
      return currentView === "leader" && !!record && !isDraft(record) && leaderOwnsRecord(record);
    }

    // Leaders can only change drafts they own; admins can change any booking
    function canEditRecordInline(record) {
      return canEditBookingInline() && (currentView !== "leader" || leaderCanEditDraft(record));
    }

    function canEditBookingInline() {
      return currentView === "leader" || currentView === "admin";
    }

    function readOnlyFieldHtml(label, value) {
      return `<div class="offer-card-field"><span class="field-label">${escapeHtml(label)}</span><span class="field-value">${escapeHtml(value || "-")}</span></div>`;
    }

    function inlineEditFormHtml(key, record, pueblo, walkName) {
      const sameGradeWalks = Object.entries(masterWalks || {})
        .filter(([id, w]) => getMasterRouteGrade(w) === record.walk_grade && leaderCanPickWalk(id))
        .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
        .map(([id, w]) => `<option value="${escapeHtml(id)}" label="${escapeHtml(`${record.walk_grade} · ${w?.Route_Name || `Walk ${id}`}`)}"></option>`)
        .join("");
      return `
        <form class="inline-edit-form" data-key="${escapeHtml(key)}">
          <div class="offer-card-grid">
            ${readOnlyFieldHtml("Date", record.date)}
            ${readOnlyFieldHtml("Booking grade", record.walk_grade)}
            ${readOnlyFieldHtml("Walk name", walkName)}
            ${readOnlyFieldHtml("Pueblo", pueblo)}
          </div>
          <div class="inline-edit-grid">
            <label>Start time <span class="required-mark" aria-hidden="true">*</span>
              <input type="time" name="start_time" required value="${escapeHtml(record.start_time || "")}" /></label>
            <label>Walk number / ID <span class="required-mark" aria-hidden="true">*</span>
              <input type="text" name="walk_number" required list="inline-walk-options" autocomplete="off" value="${escapeHtml(record.walk_number || "")}" /></label>
            <label>Leader 1 <span class="required-mark" aria-hidden="true">*</span>
              <select name="leader_id" required>${leaderOptionsHtml(bookingLeaderIds(record)[0] || "", permittedLeaderIds(record.walk_number))}</select></label>
            <label>Leader 2
              <select name="leader_id_2">${leaderOptionsOptionalHtml(bookingLeaderIds(record)[1] || "", permittedLeaderIds(record.walk_number))}</select></label>
            <label class="wide">Programme comments
              <textarea name="comments" rows="2">${escapeHtml(record.comments || "")}</textarea></label>
            <label class="wide">Notes for programme team
              <textarea name="notes" rows="2">${escapeHtml(record.notes || "")}</textarea></label>
          </div>
          <datalist id="inline-walk-options">${sameGradeWalks}</datalist>
          <p class="inline-edit-error" hidden></p>
          <div class="inline-edit-actions">
            <button type="button" class="btn btn-secondary" data-inline="cancel">Cancel</button>
            <button type="submit" class="btn btn-primary">Save changes</button>
          </div>
        </form>`;
    }

    function saveInlineOffer(form) {
      const key = form.dataset.key;
      const record = globalBookings[key];
      const errorEl = form.querySelector(".inline-edit-error");
      const fail = (message) => {
        errorEl.textContent = message;
        errorEl.hidden = false;
      };
      if (!record) return fail("This booking no longer exists.");
      if (currentView === "leader" && !leaderCanEditDraft(record)) return fail("You can only change draft walks for walks you own.");

      const walkNo = form.elements.walk_number.value.trim();
      const walk = walkNo && masterWalks ? masterWalks[walkNo] : null;
      if (!walk) {
        return fail(walkNo
          ? `Walk Number "${walkNo}" is not in the master walks list. Choose one from the list.`
          : "Please choose a Walk Number.");
      }
      const walkGrade = getMasterRouteGrade(walk);
      if (walkGrade !== record.walk_grade) {
        return fail(`Walk ${walkNo} is grade ${walkGrade || "?"}, but this booking is grade ${record.walk_grade}.`);
      }
      const startTime = form.elements.start_time.value;
      if (!startTime) return fail("Please enter a start time.");
      const leaderRecord = findLeader(form.elements.leader_id.value);
      if (!leaderRecord) return fail("Please choose a leader.");
      const secondId = form.elements.leader_id_2.value;
      const secondRecord = secondId ? findLeader(secondId) : null;
      if (secondId && !secondRecord) return fail("Please choose a valid second leader.");
      if (secondRecord && secondRecord.leader_id === leaderRecord.leader_id) return fail("Leader 2 must be different from Leader 1.");
      const allowedLeaders = permittedLeaderIds(walkNo);
      const chosen = [leaderRecord, secondRecord].filter(Boolean);
      const notAllowed = allowedLeaders && chosen.find((l) => !allowedLeaders.includes(l.leader_id));
      if (notAllowed) {
        return fail(`${leaderFullName(notAllowed)} is not permitted to lead walk ${walkNo}. Only the owner or a permitted leader can be listed.`);
      }

      const walkChanged = walkNo !== String(record.walk_number || "").trim();
      saveBookingRecord(key, {
        ...record,
        walk_number: walkNo,
        walk_id: walkNo,
        walk_name: walkChanged ? (getMasterRouteName(walk) || record.walk_name || "") : record.walk_name,
        start_time: startTime,
        leader_id: leaderRecord.leader_id,
        leader_ids: chosen.map((l) => l.leader_id),
        leader_keys: chosen.map((l) => l.public_key).filter(Boolean),
        comments: form.elements.comments.value.trim(),
        notes: form.elements.notes.value.trim(),
        updated_at: new Date().toISOString(),
      });
      editingOfferKey = null;
      renderAdminTable();
    }

    // When the walk number changes in an offer being edited, narrow the leader list to that walk's permitted leaders
    document.addEventListener("change", (e) => {
      if (e.target?.name !== "walk_number") return;
      const form = e.target.closest(".inline-edit-form");
      if (!form) return;
      const allowed = permittedLeaderIds(e.target.value);
      const first = form.elements.leader_id;
      const second = form.elements.leader_id_2;
      const keep = (v) => (v && (!allowed || allowed.includes(v)) ? v : "");
      first.innerHTML = leaderOptionsHtml(keep(first.value), allowed);
      second.innerHTML = leaderOptionsOptionalHtml(keep(second.value), allowed);
    });

    /* Booked slots keep the full name for desktop; phones show the grade and start time (see CSS) */
    function setSlotLabel(el, longText, grade, startTime) {
      const time = String(startTime || "");
      el.innerHTML = `<span class="slot-long">${escapeHtml(longText)}</span><span class="slot-short"><span class="slot-grade-txt">${escapeHtml(grade || "")}</span><br><span class="slot-time-txt">${escapeHtml(time)}</span></span>`;
      el.title = longText;
    }

    function escapeHtml(value) {
      return String(value ?? "").replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
      }[c]));
    }

    // Single source of truth for admin state: read it from the toggle itself
    // The hosting page can fix the view, e.g. ?view=leader in the iframe address or window.SCHEDULER_VIEW = "admin".
    // When it does, the view switch is hidden. This only changes what is shown; protecting the data is a separate job (Firebase rules, logins).
    const VIEW_FROM_HOST = (() => {
      let requested = "";
      try {
        requested = new URLSearchParams(window.location.search).get("view") || window.SCHEDULER_VIEW || "";
      } catch (e) {}
      requested = String(requested).trim().toLowerCase();
      return ["walker", "leader", "admin"].includes(requested) ? requested : null;
    })();
    let currentView = VIEW_FROM_HOST || "walker"; // "walker" | "leader" | "admin"
    function isAdminView() {
      return currentView === "admin";
    }

    // Leader View: find the leader by email. The email is never shown back.
    // Leader view: the signed-in account's leader ID (leader_accounts/{uid}) says who is leading
    async function identifyFromAccount(user) {
      try {
        const snap = await get(ref(db, "leader_accounts/" + user.uid));
        myLeaderId = snap.exists() ? String(snap.val()) : "";
      } catch (err) {
        console.error("Could not read leader account:", err);
        myLeaderId = "";
      }
      refreshLeaderActions();
      renderAdminTable();
      subscribeBookingRequests();
    }

    function identifyLeaderByEmail() {
      const typed = String(document.getElementById("leader-email").value || "").trim().toLowerCase();
      const msg = document.getElementById("leader-identify-msg");
      const input = document.getElementById("leader-email");
      if (!typed) { myLeaderId = ""; msg.hidden = true; input.disabled = false; document.getElementById("leader-identify").classList.remove("locked"); refreshLeaderActions(); return; }
      const match = LEADER_LOOKUP.find((l) => String(l.email_add || "").trim().toLowerCase() === typed);
      myLeaderId = match ? match.leader_id : "";
      if (match) rememberLeaderEmail(typed);
      msg.hidden = false;
      // Once identified, the email box is locked
      input.disabled = !!match;
      msg.textContent = match ? `I am logged in as ${leaderFullName(match)}` : "No leader found with that email address.";
      document.getElementById("leader-identify").classList.toggle("locked", !!match);
      refreshLeaderActions();
    }
    function refreshLeaderActions() {
      renderAdminTable();
      renderCalendar();
      renderBookingRequestsPanel();
    }
    document.getElementById("leader-email").addEventListener("change", identifyLeaderByEmail);
    document.getElementById("leader-email").addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); identifyLeaderByEmail(); }
    });

    // Leader email: passed from the Leaders Hub (?email=), or remembered on this device.
    // Used to identify the leader once the leader list has loaded.
    const LEADER_EMAIL_KEY = "cbmw-leader-email";
    let hubEmail = "";
    try {
      const hubUrl = new URL(window.location.href);
      hubEmail = hubUrl.searchParams.get("email") || "";
      if (hubEmail) {
        hubUrl.searchParams.delete("email");
        history.replaceState(null, "", hubUrl.pathname + hubUrl.search + hubUrl.hash);
      }
    } catch (e) {}
    function rememberLeaderEmail(email) {
      try { localStorage.setItem(LEADER_EMAIL_KEY, email); } catch (e) {}
    }
    let leaderEmailApplied = false;
    function applySavedLeaderEmail() {
      if (leaderEmailApplied) return;
      leaderEmailApplied = true;
      let email = hubEmail;
      if (!email) { try { email = localStorage.getItem(LEADER_EMAIL_KEY) || ""; } catch (e) {} }
      const input = document.getElementById("leader-email");
      if (!input || !email) return;
      input.value = email;
      identifyLeaderByEmail();
    }


    adminTableBody.addEventListener("click", (e) => {
      const deleteDraftBtn = e.target.closest('[data-action="delete-draft"]');
      if (deleteDraftBtn && currentView === "leader") {
        const key = deleteDraftBtn.dataset.key;
        const record = globalBookings[key];
        if (!leaderCanEditDraft(record)) return;
        if (confirm(`Delete this draft walk ${record.walk_number || record.walk_id || ""}? This removes it completely.`)) {
          expandedOfferRows.delete(key);
          editingOfferKey = null;
          saveBookingRecord(key, null);
        }
        return;
      }
      const editBtn = e.target.closest('[data-action="edit-offer"]');
      if (editBtn && canEditRecordInline(globalBookings[editBtn.dataset.key])) {
        editingOfferKey = editBtn.dataset.key;
        expandedOfferRows.add(editingOfferKey);
        renderAdminTable();
        return;
      }
      if (e.target.closest('[data-inline="cancel"]')) {
        editingOfferKey = null;
        renderAdminTable();
      }
    });
    adminTableBody.addEventListener("submit", (e) => {
      if (!e.target.classList || !e.target.classList.contains("inline-edit-form")) return;
      e.preventDefault();
      if (canEditBookingInline()) saveInlineOffer(e.target);
    });

    // Keep track of which booking cards are expanded as the table re-renders.
    const expandedOfferRows = new Set();

    // If no argument is passed (data sync, save, clear, etc.), fall back to the toggle state
    // Walker View: a summer programme walk as a row in the Upcoming Walks list
    function summerWalkerRow(skey) {
      const rec = globalSocial[skey];
      const tr = document.createElement("tr");
      tr.className = "summer-row walk-row-clickable";
      const headCells = [...document.querySelectorAll(".offers-table thead th")];
      const details = [
        rec.leader ? `Leader: ${rec.leader}` : "",
        rec.duration,
        rec.distance,
        rec.ascent ? `Ascent: ${rec.ascent}` : "",
        rec.meeting_point ? `Meeting point: ${rec.meeting_point}` : "",
        rec.contact ? `Booking: ${rec.contact}` : "",
      ].map((v) => String(v ?? "").trim()).filter(Boolean);
      const detailHtml = `${details.length ? `<div class="summer-details">${escapeHtml(details.join(" · "))}</div>` : ""}${rec.description ? `<div>${escapeHtml(rec.description)}</div>` : ""}`;
      const actionHtml = isAdminView() ? '<button type="button" class="btn btn-secondary summer-edit-btn">Edit</button>' : "";
      // Each cell is chosen by the column's own class, so the summer row lines up with the header in every view
      const isWalkerView = currentView === "walker";
      const cellFor = (th) => {
        const c = th.classList;
        if (c.contains("expand-column")) return "";
        if (th.dataset.adminSort === "date") return `${escapeHtml(tableDate(rec.date))}<br><span class="summer-time">${escapeHtml(formatStartTime(rec.start_time))}</span>`;
        if (th.dataset.adminSort === "walk_grade") return '<span class="badge summer-badge">Summer</span>';
        if (th.dataset.adminSort === "walk_number") return "";
        if (th.dataset.adminSort === "walk_name") return `<strong>${escapeHtml(rec.title || "Summer walk")}</strong>${isWalkerView ? `<div class="walker-desc-inline">${detailHtml}</div>` : ""}`;
        if (c.contains("walker-only-col")) return isWalkerView ? detailHtml : "";
        if (c.contains("walker-image-col")) return "";
        if (th.dataset.adminSort === "leader_name") return escapeHtml(rec.leader || "");
        if (th.dataset.adminSort === "pueblo" || th.dataset.adminSort === "comments") return "";
        if (c.contains("notes-col")) return isWalkerView ? "" : detailHtml;
        if (c.contains("action-cancel-head")) return actionHtml;
        return "";
      };
      // Cells carry the same layout classes as their header, so the CSS that hides or places columns applies to them too
      const layoutClasses = ["expand-column", "walkid-col", "walker-only-col", "walker-image-col", "notes-col", "hide-in-walker", "status-col"];
      const cellClassFor = (th) => {
        const list = layoutClasses.filter((cls) => th.classList.contains(cls));
        if (th.classList.contains("action-cancel-head")) list.push("action-cancel");
        return list.join(" ");
      };
      tr.innerHTML = headCells.map((th) => `<td class="${cellClassFor(th)}"${th.hidden ? " hidden" : ""} data-label="${escapeHtml(th.textContent.trim())}">${cellFor(th)}</td>`).join("");
      tr.addEventListener("click", () => openSocialCard(skey));
      tr.querySelector(".summer-edit-btn")?.addEventListener("click", (e) => {
        e.stopPropagation();
        openSocialModal(rec.date, skey);
      });
      return tr;
    }

    function renderAdminTable(admin = isAdminView()) {
      updateWalkOffersTitle();
      if (!adminTableBody) return;
      adminTableBody.innerHTML = "";

      const currentMode = admin === true ? "adminView" : "view";
      // The actions column is shown to admins, and to leaders (drafts: Edit; live walks: request buttons)
      const showActions = currentMode === "adminView" || currentView === "leader";
      document.querySelectorAll(".action-cancel-head").forEach((th) => {
        th.hidden = !showActions;
      });

      const walkerMode = currentView === "walker";
      document.querySelectorAll(".notes-col, .walkid-col, .hide-in-walker").forEach((el) => {
        el.hidden = walkerMode;
      });
      document.querySelectorAll(".status-col").forEach((el) => {
        el.hidden = walkerMode && !previewReturnView;
      });
      // Leader and Pueblo filters stay visible in Preview, so the applied filter can be seen
      document.querySelectorAll(".table-filters .hide-in-walker").forEach((el) => {
        el.hidden = walkerMode && !previewReturnView;
      });
      document.querySelectorAll(".walker-only-col").forEach((el) => {
        el.hidden = !walkerMode;
      });
      const dateField = document.getElementById("admin-filter-date-field");
      const dateValue = document.getElementById("admin-filter-date");
      const dateClear = document.getElementById("admin-filter-date-clear");
      dateField.hidden = true;   // day selection now lives in the From and To filters
      dateValue.textContent = walkerMode && selectedWalkerDate ? `Showing ${selectedWalkerDate}` : "All dates";
      dateValue.classList.toggle("date-filtered", walkerMode && !!selectedWalkerDate);
      dateClear.hidden = !(walkerMode && selectedWalkerDate);

      const statusFilter = document.getElementById("admin-filter-status");
      if (statusFilter) statusFilter.closest(".filter-field").hidden = walkerMode;

      populateAdminFilters();
      let sortedKeys = getAdminVisibleKeys();
      // Summer programme walks join the list in every view. Date sort places them by date; other sorts add them at the end.
      {
        const searchNow = (document.getElementById("admin-filter-search")?.value || "").trim().toLowerCase();
        const gradeNow = document.getElementById("admin-filter-grade")?.value || "ALL";
        const fromNow = document.getElementById("admin-filter-from")?.value || "";
        const toNow = document.getElementById("admin-filter-to")?.value || "";
        const isoOfDmy = (d) => { const p = String(d || "").split("-"); return p.length === 3 ? `${p[2]}-${p[1]}-${p[0]}` : ""; };
        // Summer walks are listed only with All grades or Summer walks selected, and no Leader or Pueblo filter is set
        const leaderNow = document.getElementById("admin-filter-leader")?.value || "ALL";
        const puebloNow = document.getElementById("admin-filter-pueblo")?.value || "ALL";
        const summerAllowed = (gradeNow === "ALL" || gradeNow === "SUMMER") && leaderNow === "ALL" && puebloNow === "ALL";
        const summerKeys = !summerAllowed ? [] : Object.keys(globalSocial || {})
          .filter((k) => globalSocial[k]?.type === "summer")
          .filter((k) => (currentView === "walker" && !previewReturnView) || showPastWalks || !isPastDate(globalSocial[k].date))
          .filter((k) => {
            const iso = isoOfDmy(globalSocial[k].date);
            return iso && (!fromNow || iso >= fromNow) && (!toNow || iso <= toNow);
          })
          .filter((k) => {
            if (!searchNow) return true;
            const rec = globalSocial[k];
            return [rec.title, rec.leader, rec.description, rec.meeting_point, rec.contact]
              .some((v) => String(v ?? "").toLowerCase().includes(searchNow));
          })
          .map((k) => `SUMMER:${k}`);
        if (summerKeys.length && adminSortColumn === "date") {
          const isoOfKey = (k) => isoOfDmy(k.startsWith("SUMMER:") ? globalSocial[k.slice(7)]?.date : globalBookings[k]?.date);
          sortedKeys = [...sortedKeys, ...summerKeys].sort((a, b) => {
            const c = isoOfKey(a).localeCompare(isoOfKey(b));
            return adminSortDirection === "desc" ? -c : c;
          });
        } else if (summerKeys.length) {
          sortedKeys = [...sortedKeys, ...summerKeys];
        }
      }
      updateAdminSortIndicators();

      // Build a consistent card field, escaping every value before inserting HTML.
      const cardField = (rawLabel, value, wide = false) => {
        const adjusted = String(rawLabel).endsWith(ADJ_MARK);
        const label = adjusted ? String(rawLabel).slice(0, -ADJ_MARK.length) : rawLabel;
        let renderedValue;
        if (label === "Meeting point" && value && value.url) {
          renderedValue = `<a href="${escapeHtml(value.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(value.latitude)}, ${escapeHtml(value.longitude)} · Google Maps ↗</a>`;
        } else if (label === "WIS_URL" && value) {
          const safeUrl = getMasterWisUrl({WIS_URL: value});
          renderedValue = safeUrl ? `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">Walks In Spain ↗</a>` : "Not recorded";
        } else {
          renderedValue = escapeHtml(value === undefined || value === null || String(value).trim() === "" ? "Not recorded" : value);
        }
        const compact = ["Route grade", "Grade", "Distance", "Ascent", "Terrain", "SCR", "Total time", "Dogs"].includes(label);
        return `<div class="offer-card-field${wide ? " wide" : ""}${compact ? " compact" : ""}">
          <span class="field-label">${escapeHtml(label)}${adjusted ? ' <span class="adjusted-tag">adjusted</span>' : ""}</span>
          <span class="field-value">${renderedValue}</span>
        </div>`;
      };

      let lastGroupDate = null;
      const dateOfKey = (k) => (k.startsWith("SUMMER:") ? globalSocial[k.slice(7)]?.date : globalBookings[k]?.date) || "";
      const addGroupHeader = (dateStr) => {
        if (!walkerMode || adminSortColumn !== "date" || dateStr === lastGroupDate) return;
        lastGroupDate = dateStr;
        const groupRow = document.createElement("tr");
        groupRow.className = "walker-date-group";
        const groupCount = sortedKeys.filter((k) => dateOfKey(k) === dateStr).length;
        groupRow.innerHTML = `<th colspan="${[...document.querySelectorAll(".offers-table thead th")].filter((th) => !th.hidden && getComputedStyle(th).display !== "none").length}" scope="rowgroup">${escapeHtml(tableDate(dateStr))}<span class="walker-date-count">${groupCount} ${groupCount === 1 ? "walk" : "walks"}</span></th>`;
        adminTableBody.appendChild(groupRow);
      };
      sortedKeys.forEach((key) => {
        if (key.startsWith("SUMMER:")) {
          const skey = key.slice(7);
          if (!globalSocial[skey]) return;
          addGroupHeader(globalSocial[skey].date);
          adminTableBody.appendChild(summerWalkerRow(skey));
          return;
        }
        const record = globalBookings[key];
        if (!record) return;
        addGroupHeader(record.date);

        const expanded = expandedOfferRows.has(key);
        const masterValues = getBookingMasterValues(record);
        const displayWalkName = masterValues.name;
        const displayPueblo = masterValues.pueblo;
        // Distance and ascent under the walk name, as unlabelled badges in every view
        const walkerStats = (() => {
          const rt = bookingRoute(record) || {};
          const icons = {
            distance: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
            ascent: '<path d="M3 20l6-10 4 6 3-4 5 8z"/>',
            duration: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
          };
          const badges = [["distance", rt.Distance], ["ascent", rt.Ascent], ["duration", rt.Total_Time]]
            .map(([kind, v]) => [kind, String(v ?? "").trim()])
            .filter(([, v]) => v)
            .map(([kind, v]) => `<span class="badge stat-badge"><svg class="stat-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[kind]}</svg>${escapeHtml(v)}</span>`);
          return badges.length ? `<div class="stat-badges">${badges.join(" ")}</div>` : "";
        })();
        const tr = document.createElement("tr");
        tr.dataset.walkKey = key;
        tr.classList.toggle("cancelled-row", isCancelled(record));
        tr.classList.toggle("expanded-parent", expanded);
        tr.classList.toggle("draft-row", isDraft(record));
        tr.innerHTML = `
          <td class="expand-column">
            <button type="button" class="expand-toggle" aria-expanded="${expanded}" aria-label="${expanded ? "Hide" : "Show"} details for walk ${escapeHtml(record.walk_number || "")}" title="${expanded ? "Hide details" : "Show all details"}"><svg class="chev-down" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg><svg class="chev-up" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 15 12 9 18 15"/></svg></button>
          </td>
          <td data-label="Date" class="date-time-cell">
            ${currentView === "walker" ? (() => { const bd = walkerBadgeDate(record.date); return `<div class="dt-line"><strong>${escapeHtml(bd.wd)}</strong></div><div class="dt-line"><strong>${escapeHtml(bd.day)}</strong></div><div class="dt-line"><span>${escapeHtml(formatTime12(record.start_time) || "-")}</span></div>`; })() : `<div class="dt-line"><strong>${escapeHtml(tableDate(record.date))}</strong></div><div class="dt-line"><span>${escapeHtml(formatStartTime(record.start_time) || "-")}</span></div>`}
            ${currentView === "walker" && !previewReturnView ? "" : `<div class="dt-line dt-status status-col"><button type="button" class="status-toggle status-${bookingStatus(record)}" data-status-key="${escapeHtml(key)}" ${isAdminView() ? 'title="Click to switch between Draft and Live"' : 'title="Status is set by the admin" disabled'}>${bookingStatus(record) === "live" ? "Published" : "Draft"}</button></div>`}
          </td>
          <td data-label="Grade"><span class="badge ${currentView === "walker" ? "badge-mono" : ""} grade-${escapeHtml(record.walk_grade || "")}">${escapeHtml(record.walk_grade || "-")}</span></td>
          <td class="walkid-col" data-label="Walk No">${escapeHtml(record.walk_number || record.walk_id || "-")}</td>
          <td data-label="Walk name">${pendingRequestBadge(key)}${cancelledBadge(record)}${modifiedBadge(record)}<strong>${escapeHtml(displayWalkName || "-")}</strong>${walkerStats}${currentView === "walker" ? `<div class="walker-desc-inline">${walkerDescriptionCell(record)}</div>` : ""}</td>
          <td class="walker-only-col" data-label="Description">${walkerDescriptionCell(record)}</td>
          <td class="walker-image-col" data-label="Photo">${walkThumbHtml(record)}</td>
          <td class="hide-in-walker" data-label="Leader">${escapeHtml(bookingLeaderLabel(record) || "-")}</td>
          <td class="hide-in-walker" data-label="Pueblo">${escapeHtml(displayPueblo || "-")}</td>
          <td class="hide-in-walker" data-label="Comments">${escapeHtml(record.comments || "-")}</td>
          <td class="notes-col${bookingStatus(record) === "draft" && String(record.notes || "").trim() ? " notes-flag" : ""}" data-label="Notes">${escapeHtml(record.notes || "-")}</td>
          <td class="action-cancel">
            <button class="btn btn-success edit-walk-btn" type="button">Edit</button>
            <button class="btn cancel-walk-btn ${isCancelled(record) ? "reinstate" : "cancel"}" type="button">${isCancelled(record) ? "Reinstate walk" : "Cancel walk"}</button>
            <button class="btn btn-danger" type="button">Delete</button>
            <button class="btn btn-small list-request-btn" type="button" data-list-request="change">Request change</button>
            <button class="btn btn-small btn-danger list-request-btn" type="button" data-list-request="cancel">Request cancellation</button>
            <span class="list-request-pending muted">Change pending</span>
          </td>
        `;

        tr.querySelector(".edit-walk-btn").hidden = (currentMode === "view") || (currentView === "leader" && !leaderCanEditDraft(record));
        // Leaders never cancel or delete directly. Live walks get request buttons instead.
        const leaderLive = leaderCanRequest(record);
        const pendingHere = !!pendingRequestFor(key);
        tr.querySelector(".cancel-walk-btn").hidden = currentView === "leader";
        tr.querySelector(".btn-danger:not(.list-request-btn)").hidden = currentView === "leader";
        tr.querySelectorAll(".list-request-btn").forEach((btn) => {
          btn.hidden = !leaderLive || pendingHere || (isCancelled(record) && btn.dataset.listRequest === "cancel") || isCancelled(record);
        });
        tr.querySelector(".list-request-pending").hidden = !(leaderLive && pendingHere);
        tr.querySelectorAll(".notes-col, .walkid-col, .hide-in-walker").forEach((el) => {
          el.hidden = walkerMode;
        });
        tr.querySelectorAll(".status-col").forEach((el) => {
          el.hidden = walkerMode && !previewReturnView;
        });
        tr.querySelectorAll(".walker-only-col").forEach((el) => {
          el.hidden = !walkerMode;
        });
        tr.querySelector(".action-cancel").hidden = !showActions;

        const toggleExpanded = () => {
          // Walker View (and Preview, which shows the same view) opens the same card as a calendar click
          if (walkerMode) {
            openDetailCard(key);
            return;
          }
          if (expandedOfferRows.has(key)) expandedOfferRows.delete(key);
          else expandedOfferRows.add(key);
          renderAdminTable();
        };
        tr.querySelector(".expand-toggle")?.addEventListener("click", toggleExpanded);
        // Clicking anywhere on the row (outside its buttons, links and fields) also expands it
        tr.classList.add("walk-row-clickable");
        tr.addEventListener("click", (e) => {
          if (e.target.closest("button, a, input, select, textarea, label")) return;
          toggleExpanded();
        });

        tr.querySelector(".edit-walk-btn")?.addEventListener("click", () =>
          openBookingModal(record.date, record.walk_grade, record, record.walk_number || record.walk_id)
        );
        tr.querySelectorAll(".list-request-btn").forEach((btn) => btn.addEventListener("click", (e) => {
          e.stopPropagation();
          openDetailCard(key);
          bookingRequestMode = btn.dataset.listRequest;
          renderDetailCard();
        }));
        tr.querySelector(".cancel-walk-btn")?.addEventListener("click", () => {
          const reinstating = isCancelled(record);
          const msg = reinstating
            ? `Reinstate walk ${record.walk_number || record.walk_id || ""}?`
            : `Cancel walk ${record.walk_number || record.walk_id || ""}? It will stay visible but marked as cancelled.`;
          if (confirm(msg)) {
            saveBookingRecord(key, { ...record, cancelled: !reinstating });
          }
        });
        tr.querySelector(".btn-danger")?.addEventListener("click", () => {
          if (confirm(`Delete booking for walk ${record.walk_number || record.walk_id || ""}? This removes it completely.`)) {
            expandedOfferRows.delete(key);
            saveBookingRecord(key, null);
          }
        });

        adminTableBody.appendChild(tr);
        queueWalkThumbHydrate();

        if (expanded) {
          const detailsRow = document.createElement("tr");
          detailsRow.className = "offer-details-row";
          const walkId = record.walk_number || record.walk_id || "";
          const route = bookingRoute(record);

          const bookingFields = [
            ["Date", record.date],
            ["Start time", record.start_time],
            ["Booking grade", record.walk_grade],
            ["Walk number / ID", walkId],
            ["Walk name", masterValues.name],
            ["Leader(s)", bookingLeaderLabel(record)],
            ["Pueblo", masterValues.pueblo],
            ["Programme comments", record.comments, true],
            ["Notes for programme team", record.notes, true]
          ];

          const routeFields = route ? [
            ["Route name", route.Route_Name],
            ["Route grade", route.Grade],
            ["Permitted leaders", (Array.isArray(route.permitted_leader_ids) ? route.permitted_leader_ids : String(route.permitted_leader_ids || "").split(",")).map((id) => leaderFullName(findLeader(String(id).trim()))).filter(Boolean).join(", ")],
            [adjLabel(record, ["Distance"], "Distance"), route.Distance],
            [adjLabel(record, ["Ascent"], "Ascent"), route.Ascent],
            [adjLabel(record, ["Terrain"], "Terrain"), route.Terrain],
            [adjLabel(record, ["Scr"], "SCR"), route.Scr],
            [adjLabel(record, ["X"], "X"), xFlag(route)],
            [adjLabel(record, ["Total_Time"], "Total time"), route.Total_Time],
            [adjLabel(record, ["Dogs"], "Dogs"), route.Dogs],
            [adjLabel(record, ["Route_Description"], "Route description"), route.Route_Description, true],
            [adjLabel(record, ["Directions"], "Directions"), route.Directions, true],
            [adjLabel(record, ["Latitude", "Longitude"], "Meeting point"), getMasterCoordinates(route)],
            ["WIS_URL", getMasterWisUrl(route), true]
          ] : [];

          if (walkerMode) {
            const visibleColumns = [...document.querySelectorAll(".offers-table thead th")].filter((th) => !th.hidden && getComputedStyle(th).display !== "none").length;
            detailsRow.innerHTML = `<td colspan="${visibleColumns}"><div class="walk-card-inline">${walkCardBodyHtml(key)}</div></td>`;
            adminTableBody.appendChild(detailsRow);
            return;
          }
          detailsRow.innerHTML = `
            <td colspan="13">
              <div class="offer-detail-cards">
                <section class="offer-detail-card">
                  <h4><span class="card-icon" aria-hidden="true">🗓️</span> Booked Walking Slot Details
                    ${canEditRecordInline(record) && editingOfferKey !== key ? `<button type="button" class="btn btn-secondary inline-edit-btn" data-action="edit-offer" data-key="${escapeHtml(key)}">Edit</button>` : ""}
                    ${leaderCanEditDraft(record) && editingOfferKey !== key ? `<button type="button" class="btn btn-danger inline-edit-btn" style="margin-left:0" data-action="delete-draft" data-key="${escapeHtml(key)}">Delete draft</button>` : ""}
                  </h4>
                  ${canEditRecordInline(record) && editingOfferKey === key
                    ? inlineEditFormHtml(key, record, masterValues.pueblo, masterValues.name)
                    : `<div class="offer-card-grid">
                    ${bookingFields.map(([label, value, wide]) => cardField(label, value, wide)).join("")}
                  </div>`}
                </section>
                <section class="offer-detail-card${currentView === "walker" ? "" : " read-only-card"}">
                  <h4><span class="card-icon" aria-hidden="true">🥾</span> Walk details from Master Database
                    <span class="offer-route-id">Walk ID: ${escapeHtml(walkId || "Not set")}</span>
                    ${readOnlyPillHtml()}
                  </h4>
                  ${readOnlyNoteHtml()}
                  ${route ? `<div class="offer-card-grid route-compact-grid">
                    ${routeFields.map(([label, value, wide]) => cardField(label, value, wide)).join("")}
                  </div>` : `<p class="offer-route-missing">${walkId
                    ? `No matching master route was found for Walk ID ${escapeHtml(walkId)}. The booking is still shown; check the Walk Number or master walks database.`
                    : "This booking has no Walk Number / ID linked to the master walks database."}</p>`}
                </section>
              </div>
            </td>`;
          adminTableBody.appendChild(detailsRow);
        }
      });

      if (!sortedKeys.length) {
        const empty = document.createElement("tr");
        empty.innerHTML = `<td colspan="13" style="text-align:center; color: var(--text-muted)">No walks match the current filters.</td>`;
        adminTableBody.appendChild(empty);
      }

      // Total = every row the table could show with no filters: bookings and summer walks,
      // using the same view and past-walk rules as the rows above.
      const bookingTotal = Object.keys(globalBookings).filter((k) => {
        const r = globalBookings[k];
        if (!r) return false;
        if (!previewReturnView && !isVisibleInView(r)) return false;
        if ((currentView !== "walker" || previewReturnView) && !showPastWalks && isPastDate(r.date)) return false;
        return true;
      }).length;
      const summerTotal = Object.keys(globalSocial || {})
        .filter((k) => globalSocial[k]?.type === "summer")
        .filter((k) => (currentView === "walker" && !previewReturnView) || showPastWalks || !isPastDate(globalSocial[k].date))
        .length;
      const total = bookingTotal + summerTotal;
      // Badge: how many bookings are still drafts, so the admin sees what is waiting
      const draftEl = document.getElementById("draft-count");
      if (draftEl) {
        const drafts = Object.values(globalBookings).filter((r) => r && isDraft(r)).length;
        draftEl.hidden = currentView !== "admin" || drafts === 0;
        draftEl.textContent = `${drafts} draft${drafts === 1 ? "" : "s"} waiting`;
      }
      const countEl = document.getElementById("admin-filter-count");
      if (countEl) {
        countEl.textContent = `Showing ${sortedKeys.length} of ${total}`;
      }
      updateFilterState();
    }

    // How many filters are applied, shown on the Filters toggle
    function activeFilterCount() {
      const val = (id, def) => document.getElementById(id)?.value ?? def;
      let n = 0;
      if (String(val("admin-filter-search", "")).trim()) n++;
      if (val("admin-filter-grade", "ALL") !== "ALL") n++;
      if (val("admin-filter-leader", "ALL") !== "ALL") n++;
      if (val("admin-filter-pueblo", "ALL") !== "ALL") n++;
      if (val("admin-filter-status", "ALL") !== "ALL") n++;
      if (val("admin-filter-from", "")) n++;
      if (val("admin-filter-to", "")) n++;
      return n;
    }
    function updateFilterState() {
      const badge = document.getElementById("header-filter-badge");
      if (!badge) return;
      const n = activeFilterCount();
      badge.hidden = n === 0;
      badge.textContent = `${n} filter${n === 1 ? "" : "s"} applied`;
    }
    document.getElementById("filters-state")?.addEventListener("click", (e) => {
      const bar = e.currentTarget.closest(".filters-bar");
      const collapsed = bar.classList.toggle("filters-collapsed");
      e.currentTarget.setAttribute("aria-expanded", String(!collapsed));
    });

    // Wait for the window to load, then attach the listener
    /* ========================================================= WALKER CARDS (hover + click) ========================================================= */
    const hoverCard = document.getElementById("hover-card");
    const detailOverlay = document.getElementById("detail-overlay");
    const detailCard = document.getElementById("detail-card");
    let openCardKey = null;

    function getBookingCardData(key) {
      const record = globalBookings[key];
      if (!record) return null;
      const walkId = record.walk_number || record.walk_id || "";
      const masterValues = getBookingMasterValues(record);
      return {
        record,
        walkId,
        route: bookingRoute(record),
        name: masterValues.name,
        pueblo: masterValues.pueblo,
      };
    }

    function isPastDate(dateString) {
      const d = convertDate(dateString);
      if (!d) return false;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return d < today;
    }

    function detailField(label, value, wide = false) {
      let rendered;
      if (label === "Meeting point" && value && value.url) {
        rendered = `<a href="${escapeHtml(value.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(value.latitude)}, ${escapeHtml(value.longitude)} · Open in Google Maps ↗</a>`;
      } else if (label === "WIS_URL" && value) {
        rendered = `<a href="${escapeHtml(value)}" target="_blank" rel="noopener noreferrer">Walks In Spain ↗</a>`;
      } else {
        const empty = value === undefined || value === null || String(value).trim() === "";
        rendered = empty ? "Not recorded" : escapeHtml(value);
      }
      return `<div class="dfield${wide ? " wide" : ""}">
        <span class="dfield-label">${escapeHtml(label)}</span>
        <div class="dfield-value">${rendered}</div>
      </div>`;
    }

    /* ---------- Hover card: quick summary ---------- */
    // Experienced-walkers attribute: shown as a bare "X" after the grade, terrain and SCR when set
    function xFlag(r) { return String(r?.X ?? "").trim() ? "X" : ""; }
    function hoverCardHtml(d) {
      const r = d.route || {};
      const grade = getMasterRouteGrade(d.route) || d.record.walk_grade || "";
      const or = (v) => (v === undefined || v === null || String(v).trim() === "" ? "Not recorded" : escapeHtml(v));
      const dash = (v) => (v === undefined || v === null || String(v).trim() === "" ? "–" : escapeHtml(v));
      const description = String(r.Route_Description ?? "").trim();
      const stats = [r.Distance, r.Ascent, grade, r.Terrain, ...[r.Scr, xFlag(r)].filter((v) => String(v ?? "").trim())].map(dash).join(" / ");
      return `
        <div class="hover-card-head">
          <span class="grade-chip grade-${escapeHtml(grade)}">${escapeHtml(grade || "-")}</span>
          ${currentView === "walker" ? "" : statusChip(d.record)}${cancelledChip(d.record)}${modifiedChipHtml(d.record)}
          <span>${escapeHtml(d.record.date || "")}</span>
        </div>
        <div class="hover-card-title">${escapeHtml(d.name || "Untitled walk")}</div>
        ${modifiedHoverNote(d.record)}
        <div class="hover-card-stats">
          <div class="hover-card-stats-label">Walk stats</div>
          <div class="hover-card-stats-labels">Distance / Ascent / Grade</div>
          <div class="hover-card-stats-value">${stats}</div>
        </div>
        <div class="hover-card-row"><span>Start</span>${or(d.record.start_time)}</div>
        <div class="hover-card-row"><span>Total time</span>${or(r.Total_Time)}</div>
        ${description ? `<div class="hover-card-desc">${escapeHtml(description)}</div>` : ""}
        <div class="hover-card-meta">Walk ${escapeHtml(d.walkId || "-")} · Leader ${escapeHtml(bookingLeaderDisplayNames(d.record).join(", ") || "-")}</div>
        <div class="hover-card-hint">${currentView === "leader" && isDraft(d.record) ? "Click to edit" : "Click for full details"}</div>`;
    }

    function positionHoverCard(e) {
      const pad = 12;
      const w = hoverCard.offsetWidth;
      const h = hoverCard.offsetHeight;
      let x = e.clientX + pad;
      let y = e.clientY + pad;
      if (x + w > window.innerWidth - 8) x = e.clientX - w - pad;
      if (y + h > window.innerHeight - 8) y = e.clientY - h - pad;
      hoverCard.style.left = Math.max(8, x) + "px";
      hoverCard.style.top = Math.max(8, y) + "px";
    }

    // Booked slot label: the walk name, falling back to the walk number if no name is known
    function bookedSlotLabel(record, walkID) {
      if (isCancelled(record)) return "CANCELLED · " + (getBookingMasterValues(record).name || record.walk_name || record.walk_number || walkID || "Booked");
      const name = getBookingMasterValues(record).name || record.walk_name || "";
      return name || record.walk_number || walkID || "Booked";
    }

    /* ========================================================= BOOKING OVERRIDES ========================================================= */
    // Fields an admin can adjust for one booking. Grade is excluded: the booking grade must match the route grade.
    const OVERRIDE_FIELDS = ["Distance", "Ascent", "Total_Time", "Terrain", "Scr", "Dogs", "Latitude", "Longitude", "Route_Description", "Directions"];

    // The route a booking should display: master walk values, with any booking overrides applied
    function bookingRoute(record) {
      const master = getMasterWalk(record?.walk_number || record?.walk_id || "");
      const ov = record?.overrides || {};
      const keys = OVERRIDE_FIELDS.filter((k) => ov[k] !== undefined && ov[k] !== null && String(ov[k]).trim() !== "");
      if (!master && !keys.length) return null;
      const merged = { ...(master || {}) };
      keys.forEach((k) => { merged[k] = ov[k]; });
      return merged;
    }

    const ADJ_MARK = "\u0001adjusted";

    // Admin View marks adjusted values; Leader and Walker views show them without a mark
    function adjLabel(record, keys, label) {
      if (!isAdminView()) return label;
      const ov = record?.overrides || {};
      const adjusted = keys.some((k) => ov[k] !== undefined && ov[k] !== null && String(ov[k]).trim() !== "");
      return adjusted ? label + ADJ_MARK : label;
    }

    // Fill the override panel: stored overrides in the inputs, master values as placeholders
    function populateOverrideFields(record, walkNum, show) {
      const panel = document.getElementById("override-panel");
      panel.hidden = !show;
      if (!show) return;
      const ov = record?.overrides || {};
      const master = getMasterWalk(walkNum || record?.walk_number || record?.walk_id || "") || {};
      const masterCoords = getMasterCoordinates(master);
      OVERRIDE_FIELDS.forEach((k) => {
        const input = document.getElementById("ov-" + k);
        input.value = ov[k] ?? "";
        let masterValue = master[k];
        if (k === "Latitude") masterValue = masterCoords?.latitude;
        if (k === "Longitude") masterValue = masterCoords?.longitude;
        input.placeholder = masterValue ? `Master: ${masterValue}` : "Master: –";
      });
    }

    function clearOverrideFields() {
      OVERRIDE_FIELDS.forEach((k) => { document.getElementById("ov-" + k).value = ""; });
    }

    // Returns the overrides to store, or null when nothing is overridden. Throws on invalid input.
    function collectOverrides() {
      const out = {};
      OVERRIDE_FIELDS.forEach((k) => {
        const v = document.getElementById("ov-" + k).value.trim();
        if (v) out[k] = v;
      });
      const hasLat = "Latitude" in out;
      const hasLon = "Longitude" in out;
      if (hasLat !== hasLon) throw new Error("Enter both latitude and longitude for the meeting point override, or leave both empty.");
      if (hasLat && (!Number.isFinite(Number(out.Latitude)) || !Number.isFinite(Number(out.Longitude)))) {
        throw new Error("Meeting point latitude and longitude must be numbers.");
      }
      return Object.keys(out).length ? out : null;
    }

    // Walker View table: route description with the programme comments appended
    function walkerDescriptionCell(record) {
      const description = String(bookingRoute(record)?.Route_Description ?? "").trim();
      const comments = String(record.comments ?? "").trim();
      if (!description && !comments) return "-";
      const descHtml = description ? `<span class="walker-desc-text" title="${escapeHtml(description)}">${escapeHtml(description)}</span>` : "";
      const commentsHtml = comments ? `<span class="walker-desc-comments">${escapeHtml(comments)}</span>` : "";
      return `<div class="walker-desc">${descHtml}${commentsHtml}</div>`;
    }

    // The booking date is stored as DD-MM-YYYY (the calendar's key format).
    // The Add Walk picker gives YYYY-MM-DD, so convert it here. Returns "" if no valid date.
    function bookingDateFromForm() {
      const el = document.getElementById("input-date");
      const raw = String(el.value || "").trim();
      if (el.type === "date") {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
        return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
      }
      return /^\d{2}-\d{2}-\d{4}$/.test(raw) ? raw : "";
    }

    // Cancelled walks stay on the calendar and in Walker View, clearly marked
    function isCancelled(record) {
      return record?.cancelled === true;
    }

    function cancelledChip(record) {
      return isCancelled(record) ? '<span class="cancelled-chip">Cancelled</span>' : "";
    }

    function cancelledBadge(record) {
      return isCancelled(record) ? '<span class="cancelled-badge">Cancelled</span> ' : "";
    }

    function modifiedBadge(record) {
      return record?.modified === true && !isCancelled(record) ? '<span class="modified-badge">Changed</span> ' : "";
    }
    function modifiedChipHtml(record) {
      return record?.modified === true && !isCancelled(record) ? '<span class="modified-chip">Changed</span>' : "";
    }
    function modifiedHoverNote(record) {
      if (record?.modified !== true || isCancelled(record)) return "";
      const note = String(record.modified_note ?? "").trim();
      return `<div class="hover-card-modified">Changed since publishing${note ? ": " + escapeHtml(note) : ""}</div>`;
    }
    function modifiedBanner(record) {
      if (record?.modified !== true || isCancelled(record)) return "";
      const note = String(record.modified_note ?? "").trim();
      return `<div class="modified-banner"><strong>This walk has changed since it was published.</strong>${note ? " " + escapeHtml(note) : ""}</div>`;
    }
    function cancelBanner(record) {
      return isCancelled(record) ? '<div class="cancel-banner">This walk has been cancelled</div>' : "";
    }

    // Booking status: "draft" or "live". Bookings saved before statuses existed count as draft.
    function bookingStatus(record) {
      return record && record.status === "live" ? "live" : "draft";
    }

    function isDraft(record) {
      return bookingStatus(record) === "draft";
    }

    // Walker View shows only live bookings; Leader and Admin View show both
    function isVisibleInView(record) {
      return currentView !== "walker" || bookingStatus(record) === "live";
    }

    function statusChip(record) {
      const status = bookingStatus(record);
      return `<span class="status-chip status-${status}">${status === "live" ? "Published" : "Draft"}</span>`;
    }

    // Walker View: the day clicked on the calendar (DD-MM-YYYY), or null for all days
    let selectedWalkerDate = null;

    let hoverKey = null;
    let hoverHideTimer = null;

    let hoverAction = null;

    function showHoverCard(key, e, onOpen) {
      if (openCardKey) return;
      const d = getBookingCardData(key);
      if (!d) return;
      clearTimeout(hoverHideTimer);
      hoverKey = key;
      hoverAction = onOpen;
      hoverCard.innerHTML = hoverCardHtml(d);
      hoverCard.hidden = false;
      positionHoverCard(e);
    }

    function hideHoverCard() {
      clearTimeout(hoverHideTimer);
      hoverKey = null;
      hoverAction = null;
      if (hoverCard) hoverCard.hidden = true;
    }

    // Short grace period so the pointer can travel from the slot onto the card
    function scheduleHideHoverCard() {
      clearTimeout(hoverHideTimer);
      hoverHideTimer = setTimeout(hideHoverCard, 150);
    }

    hoverCard.addEventListener("mouseenter", () => clearTimeout(hoverHideTimer));
    hoverCard.addEventListener("mouseleave", hideHoverCard);
    hoverCard.addEventListener("click", () => {
      if (hoverAction) hoverAction();
    });

    /* ---------- Walk levels dialog and legend toggle ---------- */
    // Any [data-open-levels] button opens the full definitions dialog
    document.addEventListener("click", (e) => {
      if (e.target.closest("[data-open-levels]")) {
        const dialog = document.getElementById("walk-levels-dialog");
        if (dialog && !dialog.open) dialog.showModal();
        document.querySelector(".legend-wrap")?.classList.remove("open");
      }
    });
    document.getElementById("walk-levels-dialog").addEventListener("click", (e) => {
      // Close button, or a click on the backdrop (outside the content)
      if (e.target.closest("[data-close-levels]") || e.target.id === "walk-levels-dialog") {
        e.currentTarget.close();
      }
    });
    // Legend: tap to open on touch screens, tap outside to close
    document.querySelectorAll(".legend-wrap").forEach((legendWrap) => {
      legendWrap.querySelector(".legend-link").addEventListener("click", () => legendWrap.classList.toggle("open"));
      document.addEventListener("click", (e) => {
        if (!legendWrap.contains(e.target)) legendWrap.classList.remove("open");
      });
    });
    if (false) {
    }

    /* ---------- Click card: full booking + walk details (read-only) ---------- */
    // "14-10-2026" -> "Wed " (empty if the date cannot be read)
    function weekdayShort(dateString) {
      const d = convertDate(dateString);
      if (!d) return "";
      return d.toLocaleDateString("en-GB", { weekday: "short" }) + " ";
    }

    // Walk offers and upcoming walks: "Wed 14 Oct 26"
    function tableDate(dateString) {
      const d = convertDate(dateString);
      if (!d) return dateString || "-";
      const wd = d.toLocaleDateString("en-GB", { weekday: "short" });
      const rest = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" });
      return `${wd} ${rest}`;
    }

    // "14-10-2026" -> "Wednesday 14 Oct 2026"
    function formatWalkDate(dateString) {
      const d = convertDate(dateString);
      if (!d) return dateString || "";
      return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short", year: "numeric" });
    }

    // "9:05" -> "09:05", "14:30" -> "14:30"
    /* Walker list badge: 12-hour time with am/pm, e.g. "10:00 am" */
    function formatTime12(t) {
      const m = /^(\d{1,2}):(\d{2})/.exec(String(t || "").trim());
      if (!m) return String(t || "");
      const h = Number(m[1]);
      const h12 = h % 12 === 0 ? 12 : h % 12;
      return `${h12}:${m[2]} ${h < 12 ? "am" : "pm"}`;
    }

    /* Walker list badge: "Wed" / "28 Oct" */
    function walkerBadgeDate(dateString) {
      const d = convertDate(dateString);
      if (!d) return { wd: "", day: dateString || "-" };
      return {
        wd: d.toLocaleDateString("en-GB", { weekday: "short" }),
        day: d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
      };
    }

    function formatStartTime(t) {
      const m = /^(\d{1,2}):(\d{2})/.exec(String(t || "").trim());
      if (!m) return String(t || "");
      return `${String(Number(m[1])).padStart(2, "0")}:${m[2]}`;
    }

    function walkInfoRow(label, valueHtml) {
      return `<div class="walk-info-row"><span class="walk-info-label">${escapeHtml(label)}</span><span class="walk-info-value">${valueHtml}</span></div>`;
    }

    /* ---------- Click card: full walk details (read-only, walker view) ---------- */
    // Programme notes for the team are deliberately not shown here.
    /* Body of the walker card (no header). Reused by the table's expanded row. */
    function walkCardBodyHtml(key) {
      const d = getBookingCardData(key);
      if (!d) return "";
      const r = d.route || {};
      const grade = getMasterRouteGrade(d.route) || d.record.walk_grade || "";
      const dash = (v) => (v === undefined || v === null || String(v).trim() === "" ? "–" : escapeHtml(v));
      const description = String(r.Route_Description ?? "").trim();
      const comments = String(d.record.comments ?? "").trim();
      const directions = String(r.Directions ?? "").trim();
      const dogs = String(r.Dogs ?? "").trim();
      const wisUrl = getMasterWisUrl(d.route);
      const meeting = getMasterCoordinates(d.route);
      const gpxName = String(d.route?.GPX_Name ?? "").trim();
      // Map of the meeting point under the location details (only for valid coordinates)
      const meetingMapOk = meeting && meeting.url && Number.isFinite(Number(meeting.latitude)) && Number.isFinite(Number(meeting.longitude));
      const meetingMap = meetingMapOk
        ? `<iframe class="walk-meeting-map" title="Meeting point map" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="https://www.google.com/maps?q=${encodeURIComponent(Number(meeting.latitude))},${encodeURIComponent(Number(meeting.longitude))}&amp;z=14&amp;output=embed"></iframe>`
        : "";

      const stat = (label, value) => `
        <div class="walk-stat">
          <div class="walk-stat-label">${escapeHtml(label)}</div>
          <div class="walk-stat-value">${value}</div>
        </div>`;

      // Leader contact details come from the leaders lookup (database)
      const phoneLink = (p) => {
        const digits = String(p).replace(/[^\d+]/g, "");
        return `<a href="tel:${escapeHtml(digits)}">${escapeHtml(p)}</a>`;
      };
      // Leader(s): one line per leader, stacked: name, phone 1, phone 2, WhatsApp badge.
      // Contact details are read by the booking's leader keys, so the full leaders list is not needed here.
      const leaderKeys = Array.isArray(d.record.leader_keys) ? d.record.leader_keys : [];
      const contactLine = (c) => {
        const name = String(c.display_name || "").trim() || `${c.first_name || ""} ${c.surname || ""}`.trim();
        const phones = [c.phone_1, c.phone_2].filter((p) => String(p || "").trim()).map(phoneLink);
        return [
          `<span class="leader-line-name">${escapeHtml(name)}</span>`,
          ...phones,
          c.whats_app === "y" ? `<span class="whatsapp-pref">WhatsApp</span>` : "",
        ].filter(Boolean).join(" · ");
      };
      const leaderLines = leaderKeys.length
        ? leaderKeys.map((key) => { requestContact(key); const c = contactCache.get(key); return c && Object.keys(c).length ? contactLine(c) : ""; }).filter(Boolean)
        : bookingLeaderIds(d.record).map((id) => { const leader = findLeader(id); return leader ? contactLine(leader) : ""; }).filter(Boolean);
      const leaderRows = walkInfoRow(
        leaderLines.length > 1 ? "Leaders:" : "Leader:",
        leaderLines.length
          ? leaderLines.map((line) => `<span class="leader-line">${line}</span>`).join("")
          : escapeHtml(bookingLeaderLabel(d.record) || "–")
      );

      const organiser = [
        leaderRows,
        d.pueblo && currentView !== "walker" ? walkInfoRow("Pueblo:", escapeHtml(d.pueblo)) : "",
        wisUrl
          ? walkInfoRow("WiS link:", `<a href="${escapeHtml(wisUrl)}" target="_blank" rel="noopener noreferrer">Walks In Spain ↗</a>`)
          : "",
        gpxName && d.walkId
          ? walkInfoRow("GPX route:", `<a href="#" data-gpx-download="${escapeHtml(d.walkId)}" data-gpx-name="${escapeHtml(gpxName)}">Download GPX ↓</a>`)
          : "",
        meeting && meeting.url
          ? walkInfoRow("Meeting point:", `<a href="${escapeHtml(meeting.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(meeting.latitude)}, ${escapeHtml(meeting.longitude)} ↗</a>`)
          : "",
      ].join("");

      // Description and programme comments appear together in one quote block
      const quoteParts = [description, comments].filter(Boolean).map((t) => escapeHtml(t));
      const quoteBlock = quoteParts.length
        ? `<blockquote class="walk-quote">${quoteParts.join('<span class="walk-quote-break"></span>')}</blockquote>`
        : "";

      const body = d.route
        ? `<div class="walk-stats">
            ${stat("Distance", dash(r.Distance))}
            ${stat("Ascent", dash(r.Ascent))}
            ${stat("Total time", dash(r.Total_Time))}
            ${stat("Grade", [grade, r.Terrain, ...[r.Scr, xFlag(r)].filter((v) => String(v ?? "").trim())].map(dash).join(" / "))}
          </div>
          ${quoteBlock}
          <button type="button" class="walk-levels-link" data-open-levels>What do the walk levels mean?</button>
          <div class="walk-section-title">Leader and location</div>
          <div class="walk-info">${organiser}</div>
          ${meetingMap}
          ${directions ? `<div class="walk-section-title">Driving directions</div><div class="walk-directions">${escapeHtml(directions)}</div>` : ""}
          ${dogs ? `<div class="walk-dogs">🐾 ${escapeHtml(dogs)}</div>` : ""}`
        : `<p class="detail-missing">${d.walkId
            ? `No master route found for Walk ID ${escapeHtml(d.walkId)}. Check the Walk Number.`
            : "This booking has no Walk Number linked to the master walks database."}</p>
          ${quoteBlock}`;

      const photoKey = masterWalkKey(d.walkId || d.record?.walk_number || d.record?.walk_id || "");
      const photoHtml = photoKey ? `<div class="walk-card-photo walk-thumb-empty" data-photo-key="${escapeHtml(photoKey)}">${WALK_PHOTO_PLACEHOLDER}</div>` : "";
      queueWalkThumbHydrate();
      return cancelBanner(d.record) + modifiedBanner(d.record) + photoHtml + body;
    }

    function detailCardHtml(key) {
      const d = getBookingCardData(key);
      if (!d) return "";
      return `
        <div class="walk-card-header">
          <div>
            <h3 id="detail-title">${escapeHtml(d.name || "Untitled walk")}</h3>
            <div class="walk-card-date">📅 ${escapeHtml(formatWalkDate(d.record.date))} • ${escapeHtml(formatStartTime(d.record.start_time))}</div>
          </div>
          <div class="walk-card-head-actions">
            <button class="walk-card-expand" type="button" data-action="expand" aria-pressed="${detailCard.classList.contains("expanded")}" aria-label="${detailCard.classList.contains("expanded") ? "Shrink card" : "Expand card"}" title="${detailCard.classList.contains("expanded") ? "Shrink card" : "Expand card"}">${detailCard.classList.contains("expanded") ? "⤡" : "⤢"}</button>
            <button class="walk-card-close" type="button" data-action="close" aria-label="Close">×</button>
          </div>
        </div>
        ${bookingRequestActionsHtml(key)}
        <div class="walk-card-body">
          ${walkCardBodyHtml(key)}
        </div>`;
    }

    function renderDetailCard() {
      if (!openCardKey) return;
      if (!globalBookings[openCardKey]) {
        closeDetailCard();
        return;
      }
      detailCard.classList.add("walk-card-wrap");
      detailCard.innerHTML = bookingRequestMode ? bookingRequestFormHtml(openCardKey, bookingRequestMode) : detailCardHtml(openCardKey);
    }

    /* ---------- Click card for an open (unbooked) slot in walker view ---------- */
    function availableCardHtml(dateISO, grade) {
      return `
        <div class="detail-head">
          <div>
            <div class="detail-kicker">Open slot</div>
            <h3 id="detail-title">${escapeHtml(grade)} slot available</h3>
          </div>
          <button class="detail-close" type="button" data-action="close" aria-label="Close">×</button>
        </div>
        <div class="detail-meta">
          <span class="grade-chip grade-${escapeHtml(grade)}">${escapeHtml(grade)}</span>
          <span>${escapeHtml(dateISO)}</span>
        </div>
        <p class="detail-missing" style="color:var(--text-muted);background:var(--bg-muted)">
          This slot has not been booked yet. Switch to Leader View to book it.
        </p>
        <div class="detail-actions">
          <button class="btn btn-secondary" type="button" data-action="close">Close</button>
        </div>`;
    }

    function openDetailCard(key) {
      if (!globalBookings[key]) return;
      hideHoverCard();
      openCardKey = key;
      bookingRequestMode = null;
      renderDetailCard();
      detailOverlay.classList.add("active");
    }

    function openAvailableCard(dateISO, grade) {
      hideHoverCard();
      openCardKey = null;
      detailCard.classList.remove("walk-card-wrap");
      detailCard.innerHTML = availableCardHtml(dateISO, grade);
      detailOverlay.classList.add("active");
    }

    function closeDetailCard() {
      openCardKey = null;
      bookingRequestMode = null;
      detailCard.classList.remove("expanded");
      detailOverlay.classList.remove("active");
    }

    /* ========================================================= BOOKING CHANGE REQUESTS =========================================================
       Leaders ask for changes or cancellations to live walks. An admin approves or rejects each one.
       Stored in booking_requests/{request_id}. The walk itself only changes on approval. */
    const BR_LABELS = { start_time: "Start time", comments: "Programme comments", notes: "Notes for the team", leader_ids: "Leaders" };
    const brLeaderName = (l) => `${l?.first_name || ""} ${l?.surname || ""}`.trim();
    const pendingRequestFor = (key) => Object.values(bookingRequests).find((r) => r && r.status === "pending" && r.booking_key === key) || null;
    function lastRejectedRequestFor(key) {
      return Object.values(bookingRequests)
        .filter((r) => r && r.status === "rejected" && r.booking_key === key)
        .sort((a, b) => String(b.reviewed_at || "").localeCompare(String(a.reviewed_at || "")))[0] || null;
    }
    function saveBookingRequest(id, data) {
      bookingRequests[id] = data;
      if (isFirebaseActive) set(ref(db, "booking_requests/" + id), data);
    }
    // Leader view, live walks only: buttons to ask for a change or cancellation
    function bookingRequestActionsHtml(key) {
      const record = globalBookings[key];
      if (!leaderCanRequest(record)) return "";
      if (pendingRequestFor(key)) {
        return `<div class="booking-request-bar booking-request-pending">Change pending: an admin will review your request.</div>`;
      }
      const rejected = lastRejectedRequestFor(key);
      const note = rejected
        ? `<div class="booking-request-bar muted">Your last request was not approved${rejected.reject_reason ? ": " + escapeHtml(rejected.reject_reason) : "."}</div>`
        : "";
      if (isCancelled(record)) return note;
      return `${note}<div class="booking-request-bar">
          <button type="button" class="btn btn-small" data-booking-request="change">Request change</button>
          <button type="button" class="btn btn-small btn-danger" data-booking-request="cancel">Request cancellation</button>
        </div>`;
    }
    // Small label on the walk's row in the admin list, so pending changes stand out (not shown to walkers)
    function pendingRequestBadge(key) {
      if (currentView === "walker") return "";
      const r = pendingRequestFor(key);
      if (!r) return "";
      return `<span class="pending-request-badge">${r.type === "cancel" ? "Cancellation pending" : "Change pending"}</span>`;
    }
    // Leader View: the request is made by the logged-in leader, so the name is filled in and locked
    function requesterFieldHtml(leaderOptions) {
      if (currentView !== "leader") {
        return `<label>Your name<select id="br-leader" required><option value="">Choose your name</option>${leaderOptions}</select></label>`;
      }
      const me = myLeader();
      if (!me) {
        return `<p class="muted">Enter your email at the top of the page first, so we know who is asking.</p>`;
      }
      return `<label>Your name<select id="br-leader" disabled><option value="${escapeHtml(me.leader_id)}" selected>${escapeHtml(brLeaderName(me))}</option></select></label>`;
    }
    function bookingRequestFormHtml(key, type) {
      const d = getBookingCardData(key);
      const record = globalBookings[key] || {};
      const leaderOptions = LEADER_LOOKUP.map((l) => `<option value="${escapeHtml(l.leader_id)}">${escapeHtml(brLeaderName(l))}</option>`).join("");
      const title = type === "cancel" ? "Request cancellation" : "Request a change";
      // Leaders on the booking can be changed only to the walk's owner or permitted leaders (same rule as the booking form)
      const allowedLeaders = permittedLeaderIds(record.walk_number) || [];
      const currentLeaders = bookingLeaderIds(record);
      const leaderFields = `
          <label>Leader 1<select id="br-lead-1" required>${leaderOptionsHtml(currentLeaders[0] || "", allowedLeaders)}</select></label>
          <label>Leader 2<select id="br-lead-2">${leaderOptionsOptionalHtml(currentLeaders[1] || "", allowedLeaders)}</select></label>`;
      const fields = type === "change" ? `${leaderFields}
          <label>Start time<input type="text" id="br-start" value="${escapeHtml(record.start_time || "")}" /></label>
          <label>Programme comments<textarea id="br-comments" rows="2">${escapeHtml(record.comments || "")}</textarea></label>
          <label>Notes for the team<textarea id="br-notes" rows="2">${escapeHtml(record.notes || "")}</textarea></label>` : "";
      return `
        <div class="walk-card-header">
          <div>
            <h3 id="detail-title">${escapeHtml(title)}</h3>
            <div class="walk-card-date">${escapeHtml(d?.name || "Walk")}</div>
          </div>
          <button class="walk-card-close" type="button" data-action="close" aria-label="Close">×</button>
        </div>
        <form class="walk-card-body booking-request-form" id="booking-request-form" data-type="${type}">
          ${requesterFieldHtml(leaderOptions)}
          ${fields}
          <label>Description of required changes <textarea id="br-reason" rows="3" required placeholder="Say what should change and why, e.g. Meet at the car park by the church instead."></textarea></label>
          <div class="detail-actions">
            <button type="button" class="btn btn-secondary" data-booking-request="back">Back</button>
            <button type="submit" class="btn btn-primary">Send request</button>
          </div>
        </form>`;
    }
    function submitBookingRequest(form) {
      const key = openCardKey;
      const record = globalBookings[key];
      if (!record) return;
      const type = form.dataset.type;
      const leader = LEADER_LOOKUP.find((l) => l.leader_id === document.getElementById("br-leader").value);
      const reason = document.getElementById("br-reason").value.trim();
      if (!leader) return alert(currentView === "leader" ? "Enter your email at the top of the page first." : "Choose your name first.");
      // Leader View: the requester must be listed on the booking. Other views keep the name check.
      if (currentView === "leader") {
        if (!leaderOwnsRecord(record)) return alert("You can only ask for changes to bookings you lead.");
      } else if (bookingLeaderIds(record).length && !bookingLeaderIds(record).map(String).includes(String(leader.leader_id))) {
        return alert("You can only ask for changes to walks you lead.");
      }
      if (!reason) return alert("Please give a description of the required changes.");
      const changes = {};
      if (type === "change") {
        const next = {
          start_time: document.getElementById("br-start").value.trim(),
          comments: document.getElementById("br-comments").value.trim(),
          notes: document.getElementById("br-notes").value.trim(),
        };
        for (const k of Object.keys(next)) {
          if (next[k] !== String(record[k] ?? "").trim()) changes[k] = next[k];
        }
        // Leaders: only owner or permitted leaders, no one twice
        const firstId = document.getElementById("br-lead-1").value;
        const secondId = document.getElementById("br-lead-2").value;
        const ids = [firstId, secondId].filter(Boolean);
        const allowedForWalk = permittedLeaderIds(record.walk_number) || [];
        if (!firstId) return alert("Choose Leader 1.");
        if (ids.length === 2 && ids[0] === ids[1]) return alert("Leader 2 must be different from Leader 1.");
        if (ids.some((id) => !allowedForWalk.includes(id))) return alert("Leaders must be the walk's owner or a permitted leader.");
        if (ids.join(",") !== bookingLeaderIds(record).map(String).join(",")) {
          changes.leader_ids = ids;
        }
        // The instructions box is enough on its own: the other fields may stay as they are
      }
      const before = {};
      Object.keys(changes).forEach((k) => { before[k] = record[k] ?? ""; });
      if (changes.leader_ids) before.leader_ids = bookingLeaderIds(record);
      const id = `${key}_${Date.now()}`;
      saveBookingRequest(id, {
        request_id: id,
        booking_key: key,
        type,
        status: "pending",
        requested_by: leader.leader_id,
        requested_by_name: brLeaderName(leader),
        requested_at: new Date().toISOString(),
        reason,
        changes,
        before,
      });
      bookingRequestMode = null;
      renderDetailCard();
    }
    // Admin: pending requests above the walk offers table
    function renderBookingRequestsPanel() {
      const panel = document.getElementById("booking-requests-panel");
      if (!panel) return;
      const pending = Object.values(bookingRequests)
        .filter((r) => r && r.status === "pending")
        .sort((a, b) => String(a.requested_at).localeCompare(String(b.requested_at)));
      panel.hidden = currentView !== "admin" || pending.length === 0;
      document.getElementById("booking-requests-count").textContent = pending.length ? `(${pending.length})` : "";
      document.getElementById("booking-requests-list").innerHTML = pending.map((r) => {
        const rec = globalBookings[r.booking_key];
        const name = getBookingCardData(r.booking_key)?.name || rec?.walk_name || `Walk ${rec?.walk_number || ""}`;
        const slot = rec ? [rec.walk_grade, rec.pueblo].filter(Boolean).join(" · ") : "";
        const when = rec ? `${formatWalkDate(rec.date)} • ${formatStartTime(rec.start_time)}` : "Booking no longer exists";
        const what = r.type === "cancel"
          ? "<p><strong>Asks to cancel this walk.</strong></p>"
          : !Object.keys(r.changes || {}).length ? `<p class="muted">Description only. No fields are changed.</p>`
          : `<ul class="change-list">${Object.entries(r.changes || {}).map(([k, v]) => {
              if (k === "leader_ids") {
                const names = (ids) => (ids || []).map((id) => leaderFullName(findLeader(id))).filter(Boolean).join(", ");
                return `<li><strong>Leaders:</strong> ${escapeHtml(names(r.before?.leader_ids) || "(blank)")} → ${escapeHtml(names(v) || "(blank)")}</li>`;
              }
              return `<li><strong>${escapeHtml(BR_LABELS[k] || k)}:</strong> ${escapeHtml(r.before?.[k] || "(blank)")} → ${escapeHtml(v || "(blank)")}</li>`;
            }).join("")}</ul>`;
        return `<div class="booking-request-item">
          <div><strong>${escapeHtml(name)}</strong> <span class="muted">${escapeHtml(when)}${slot ? " · " + escapeHtml(slot) : ""}</span></div>
          <div class="muted">${r.type === "cancel" ? "Cancellation" : "Change"} requested by ${escapeHtml(r.requested_by_name || r.requested_by || "a leader")}</div>
          ${what}
          <div class="muted">Reason: ${escapeHtml(r.reason || "")}</div>
          <div class="booking-request-actions">
            ${rec
              ? `${r.type === "cancel"
                  ? `<button type="button" class="btn btn-small btn-primary" data-br-approve="${escapeHtml(r.request_id)}">Approve cancellation</button>`
                  : `<button type="button" class="btn btn-small btn-primary" data-br-review="${escapeHtml(r.request_id)}">Review</button>`}
            <button type="button" class="btn btn-small btn-danger" data-br-reject="${escapeHtml(r.request_id)}">Reject</button>`
              : `<button type="button" class="btn btn-small" data-br-dismiss="${escapeHtml(r.request_id)}">Dismiss (walk was removed)</button>`}
          </div>
        </div>`;
      }).join("");
    }
    function approveBookingRequest(id) {
      const r = bookingRequests[id];
      if (!r || r.status !== "pending") return;
      const rec = globalBookings[r.booking_key];
      if (!rec) return alert("This booking no longer exists.");
      if (r.type === "cancel") {
        saveBookingRecord(r.booking_key, { ...rec, cancelled: true });
      } else {
        saveBookingRecord(r.booking_key, { ...rec, ...r.changes, modified: true, modified_note: r.reason });
      }
      saveBookingRequest(id, { ...r, status: "approved", reviewed_at: new Date().toISOString() });
    }
    /* Review: the admin edit form opens with the leader's requested values filled in. Saving it approves the request,
       and any value the admin changed from what the leader asked for is recorded as an override. Cancellations still use Approve. */
    let brReviewId = null;
    function openBookingReview(id) {
      const r = bookingRequests[id];
      if (!r || r.status !== "pending") return;
      const rec = globalBookings[r.booking_key];
      if (!rec) return alert("This booking no longer exists.");
      brReviewId = id;
      openBookingModal(rec.date, rec.walk_grade, { ...rec, ...(r.changes || {}) }, rec.walk_number);
      document.getElementById("modal-heading").textContent = `Review change request: ${r.requested_by_name || r.requested_by || "leader"}`;
      // Amber border on each field the leader changed
      const fieldIds = { start_time: "input-start-time", comments: "input-comments", notes: "input-notes" };
      Object.keys(r.changes || {}).forEach((k) => {
        const el = fieldIds[k] && document.getElementById(fieldIds[k]);
        if (el) { el.style.border = "2px solid #f59e0b"; el.style.background = "#fffbeb"; el.title = `Leader asked for this. Was: ${r.before?.[k] || "(blank)"}`; }
      });
    }
    // Called from the admin booking form on save: records the approval and any overrides
    function finishBookingReview(payload) {
      const r = bookingRequests[brReviewId];
      brReviewId = null;
      if (!r || r.status !== "pending") return;
      // Leaders are recorded by leader_ids and are not counted as overrides
      const keys = Object.keys(r.changes || {}).filter((k) => k !== "leader_ids");
      const reviewed = {};
      keys.forEach((k) => { reviewed[k] = payload[k] ?? ""; });
      const overrides = keys.filter((k) => String(reviewed[k] ?? "").trim() !== String(r.changes[k] ?? "").trim());
      saveBookingRequest(r.request_id, { ...r, status: "approved", reviewed_changes: reviewed, admin_overrides: overrides, reviewed_at: new Date().toISOString() });
    }

    function dismissBookingRequest(id) {
      const r = bookingRequests[id];
      if (!r || r.status !== "pending") return;
      saveBookingRequest(id, { ...r, status: "dismissed", reviewed_at: new Date().toISOString() });
    }
    function rejectBookingRequest(id) {
      const r = bookingRequests[id];
      if (!r || r.status !== "pending") return;
      const why = prompt("Reason for not approving (the leader will see this):", "");
      if (why === null) return;
      saveBookingRequest(id, { ...r, status: "rejected", reject_reason: why.trim(), reviewed_at: new Date().toISOString() });
    }

    function refreshOpenDetailCard() {
      if (openCardKey) renderDetailCard();
    }

    /* ========================================================= SOCIAL EVENTS =========================================================
       Kept apart from walk bookings (own database path), so they never enter walk stats or the Walk Offers table.
       Shown on the calendar in every view. Only Admin View can add, edit or delete them. */
    function socialKeysForDate(dateISO) {
      const prefix = `${dateISO}_SOC_`;
      return Object.keys(globalSocial || {}).filter((key) => key.startsWith(prefix));
    }

    function saveSocialRecord(key, data) {
      if (data === null) {
        delete globalSocial[key];
      } else {
        globalSocial[key] = data;
      }
      if (isFirebaseActive) {
        set(ref(db, "social_events/" + key), data);
      } else {
        localStorage.setItem("global_social_events", JSON.stringify(globalSocial));
        renderCalendar();
      }
    }

    function isoFromDisplayDate(dateISO) {
      const [dd, mm, yyyy] = dateISO.split("-");
      return `${yyyy}-${mm}-${dd}`;
    }

    function displayDateFromIso(value) {
      const [yyyy, mm, dd] = value.split("-");
      return `${dd}-${mm}-${yyyy}`;
    }

    function socialCardHtml(record) {
      const isSummer = record.type === "summer";
      const line = (label, value) => (String(value ?? "").trim() ? `<p class="social-card-line"><strong>${label}:</strong> ${escapeHtml(value)}</p>` : "");
      return `
        <div class="social-card-head">
          <div>
            <div class="social-kicker${isSummer ? " summer-kicker" : ""}">${isSummer ? "Summer programme walk" : "Social event"}</div>
            <h3 id="detail-title">${escapeHtml(record.title || (isSummer ? "Summer walk" : "Social event"))}</h3>
          </div>
          <button class="detail-close" type="button" data-action="close" aria-label="Close">×</button>
        </div>
        <div class="social-card-meta">
          <span>📅 ${escapeHtml(formatWalkDate(record.date))}</span>
          <span>🕒 ${escapeHtml(formatStartTime(record.start_time))}</span>
          ${isSummer && String(record.duration ?? "").trim() ? `<span>⏱ ${escapeHtml(record.duration)}</span>` : ""}
        </div>
        ${isSummer ? `
          ${line("Leader(s)", record.leader)}
          ${line("Distance", record.distance)}
          ${line("Ascent", record.ascent)}
          ${line("Meeting point", record.meeting_point)}
          ${line("Booking / contact", record.contact)}
        ` : (record.location ? `<p class="social-card-line"><strong>Where:</strong> ${escapeHtml(record.location)}</p>` : "")}
        ${record.description ? `<div class="social-card-desc${isSummer ? " summer-desc" : ""}">${escapeHtml(record.description)}</div>` : ""}
        <div class="detail-actions">
          <button class="btn btn-secondary" type="button" data-action="close">Close</button>
        </div>`;
    }

    function openSocialCard(key) {
      const record = globalSocial[key];
      if (!record) return;
      hideHoverCard();
      openCardKey = null;
      detailCard.classList.remove("walk-card-wrap");
      detailCard.innerHTML = socialCardHtml(record);
      detailOverlay.classList.add("active");
    }

    function openSocialModal(dateISO, key = null) {
      if (!isAdminView()) return;
      hideHoverCard();
      editingSocialKey = key;
      const record = key ? globalSocial[key] : null;
      document.getElementById("social-heading").textContent = key ? "Edit Event" : "Add Event";
      document.getElementById("social-type").value = record && record.type === "summer" ? "summer" : "social";
      document.getElementById("social-date").value = dateISO ? isoFromDisplayDate(dateISO) : "";
      document.getElementById("social-start-time").value = record ? record.start_time || "" : "18:00";
      document.getElementById("social-title").value = record ? record.title || "" : "";
      document.getElementById("social-location").value = record ? record.location || "" : "";
      document.getElementById("social-leader").value = record ? record.leader || "" : "";
      document.getElementById("social-duration").value = record ? record.duration || "" : "";
      document.getElementById("social-distance").value = record ? record.distance || "" : "";
      document.getElementById("social-ascent").value = record ? record.ascent || "" : "";
      document.getElementById("social-meeting").value = record ? record.meeting_point || "" : "";
      document.getElementById("social-contact").value = record ? record.contact || "" : "";
      document.getElementById("social-description").value = record ? record.description || "" : "";
      applySocialTypeFields();
      document.getElementById("social-delete").hidden = !key;
      document.getElementById("social-modal").classList.add("active");
    }

    // Summer programme walks show the walk fields; social events show the location
    function applySocialTypeFields() {
      const summer = document.getElementById("social-type").value === "summer";
      document.querySelectorAll("#social-modal .summer-only").forEach((el) => { el.hidden = !summer; });
      document.querySelectorAll("#social-modal .social-only").forEach((el) => { el.hidden = summer; });
    }

    function closeSocialModal() {
      editingSocialKey = null;
      document.getElementById("social-modal").classList.remove("active");
    }

    // Booked slot: walker view shows hover + card; other views keep the original modal
    function attachBookedSlot(el, key, openModal) {
      // Walker View opens the read-only card; Leader and Admin View open the booking modal
      const open = () => {
        hideHoverCard();
        if (currentView === "walker" || (currentView === "leader" && !leaderCanEditDraft(globalBookings[key]))) openDetailCard(key);
        else openModal();
      };
      el.addEventListener("mouseenter", (e) => showHoverCard(key, e, open));
      el.addEventListener("mousemove", positionHoverCard);
      el.addEventListener("mouseleave", scheduleHideHoverCard);
      el.addEventListener("click", open);
    }

    // Open slot: walker view shows an info card, other views keep the booking modal
    function handleAvailableClick(dateISO, grade) {
      if (currentView === "walker") openAvailableCard(dateISO, grade);
      else openBookingModal(dateISO, grade);
    }

    detailOverlay.addEventListener("click", (e) => {
      if (e.target === detailOverlay) return closeDetailCard();
      const requestBtn = e.target.closest("[data-booking-request]");
      if (requestBtn && openCardKey !== null) {
        const action = requestBtn.dataset.bookingRequest;
        bookingRequestMode = action === "back" ? null : action;
        renderDetailCard();
        return;
      }
      const expandBtn = e.target.closest("[data-action='expand']");
      if (expandBtn) {
        detailCard.classList.toggle("expanded");
        renderDetailCard();
        return;
      }
      const btn = e.target.closest("[data-action='close']");
      if (btn) closeDetailCard();
    });

    detailOverlay.addEventListener("submit", (e) => {
      if (e.target.id !== "booking-request-form") return;
      e.preventDefault();
      submitBookingRequest(e.target);
    });

    /* ========================================================= REQUESTS AND MESSAGES =========================================================
       Admins and leaders post requests to change a walk (date, time, leader, walk or other).
       Stored in walk_messages/{id}. Anyone in Leader or Admin View can mark one done or reopen it; only admins can delete. */
    let walkMessages = {};
    let msgStatusFilter = "open";
    let msgTypeFilter = "";
    const MSG_TYPES = { date: "Change date", time: "Change time", leader: "Change leader", walk: "Change walk", other: "Other" };
    function msgAuthorName() {
      if (currentView === "admin") return "Admin";
      const me = findLeader(myLeaderId);
      return brLeaderName(me) || "A leader";
    }
    function msgWalkOptions() {
      return Object.entries(globalBookings)
        .filter(([, b]) => b && b.status === "live" && b.cancelled !== true && !isPastDate(b.date))
        .sort(([, a], [, b]) => (convertDate(a.date)?.getTime() || 0) - (convertDate(b.date)?.getTime() || 0) || String(a.start_time || "").localeCompare(String(b.start_time || "")))
        .map(([key, b]) => {
          const name = getBookingCardData(key)?.name || b.walk_name || `Walk ${b.walk_number || ""}`;
          return { key, label: `${formatWalkDate(b.date)} · ${name}${b.walk_grade ? " · " + b.walk_grade : ""}` };
        });
    }
    function msgDateText(iso) {
      if (!iso) return "";
      const d = new Date(`${iso}T00:00`);
      return isNaN(d) ? iso : d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
    }
    function msgTimeText(iso) {
      const d = new Date(iso);
      return isNaN(d) ? "" : d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    }
    function msgItemHtml(m) {
      const done = m.status === "done";
      const proposal = [m.proposed_date ? `Proposed date: ${msgDateText(m.proposed_date)}` : "", m.proposed_time ? `Proposed time: ${m.proposed_time}` : ""].filter(Boolean).join(" · ");
      const id = escapeHtml(m.id);
      return `<article class="msg-item${done ? " is-done" : ""}">
        <div class="msg-item-head">
          <span class="msg-type">${escapeHtml(MSG_TYPES[m.type] || "Other")}</span>
          <strong class="msg-walk">${escapeHtml(m.walk_label || "Walk")}</strong>
          <span class="msg-status ${done ? "done" : "open"}">${done ? "Done" : "Open"}</span>
        </div>
        <p class="msg-text">${escapeHtml(m.text || "")}</p>
        ${proposal ? `<div class="msg-meta"><strong>${escapeHtml(proposal)}</strong></div>` : ""}
        <div class="muted msg-meta">${escapeHtml(m.from_name || "Someone")} · ${escapeHtml(msgTimeText(m.created_at))}${done && m.done_by ? " · Done by " + escapeHtml(m.done_by) : ""}</div>
        <div class="msg-actions">
          ${done
            ? `<button type="button" class="btn btn-small" data-msg-reopen="${id}">Reopen</button>`
            : `<button type="button" class="btn btn-small btn-primary" data-msg-done="${id}">Mark done</button>`}
          ${currentView === "admin" ? `<button type="button" class="btn btn-small btn-danger" data-msg-delete="${id}">Delete</button>` : ""}
        </div>
      </article>`;
    }
    function renderMessagesPane() {
      const countEl = document.getElementById("msg-pane-count");
      if (!countEl) return;
      const all = Object.values(walkMessages).filter((m) => m && m.id)
        .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
      const openCount = all.filter((m) => m.status !== "done").length;
      countEl.textContent = openCount ? `${openCount} open` : "";
      document.querySelectorAll("[data-msg-status]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.msgStatus === msgStatusFilter)));
      const list = all.filter((m) =>
        (msgStatusFilter === "all" || (msgStatusFilter === "done" ? m.status === "done" : m.status !== "done")) &&
        (!msgTypeFilter || m.type === msgTypeFilter));
      document.getElementById("msg-list").innerHTML = list.length
        ? list.map(msgItemHtml).join("")
        : `<p class="muted msg-empty">No ${msgStatusFilter === "all" ? "" : msgStatusFilter + " "}requests${msgTypeFilter ? " of this type" : ""}.</p>`;
    }
    function setMsgStatus(id, status) {
      const m = walkMessages[id];
      if (!m) return;
      const next = { ...m, status, updated_at: new Date().toISOString(), done_by: status === "done" ? msgAuthorName() : null };
      walkMessages[id] = next;
      renderMessagesPane();
      if (isFirebaseActive) set(ref(db, "walk_messages/" + id), next);
    }
    function deleteMessage(id) {
      if (currentView !== "admin" || !walkMessages[id]) return;
      if (!confirm("Delete this request? This cannot be undone.")) return;
      delete walkMessages[id];
      renderMessagesPane();
      if (isFirebaseActive) remove(ref(db, "walk_messages/" + id));
    }
    function openMsgForm(show) {
      const form = document.getElementById("msg-form");
      form.hidden = !show;
      if (!show) return;
      const walkSel = document.getElementById("msg-walk");
      const opts = msgWalkOptions();
      walkSel.innerHTML = opts.length
        ? `<option value="">Choose a walk</option>` + opts.map((o) => `<option value="${escapeHtml(o.key)}">${escapeHtml(o.label)}</option>`).join("")
        : `<option value="">No upcoming walks</option>`;
      document.getElementById("msg-text").focus();
    }

    /* ========================================================= DAY SHEET (Leader and Admin, phones and tablets) =========================================================
       Tapping a busy day opens it as a large list of its slots. Each row passes the tap on to the calendar slot. */
    function openDaySheet(dayCell, date) {
      let sheet = document.getElementById("day-sheet");
      if (!sheet) {
        sheet = document.createElement("div");
        sheet.id = "day-sheet";
        sheet.className = "day-sheet";
        sheet.hidden = true;
        sheet.innerHTML = `<div class="day-sheet-card" role="dialog" aria-modal="true" aria-labelledby="day-sheet-title">
          <div class="day-sheet-head"><h3 id="day-sheet-title"></h3><button type="button" class="day-sheet-close" aria-label="Close">&times;</button></div>
          <p class="day-sheet-hint">Tap a slot to book it, or to open a walk.</p>
          <div class="day-sheet-list" id="day-sheet-list"></div>
        </div>`;
        document.body.appendChild(sheet);
        sheet.addEventListener("click", (e) => {
          if (e.target === sheet || e.target.closest(".day-sheet-close")) closeDaySheet();
        });
      }
      sheet.querySelector("#day-sheet-title").textContent = date.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
      const list = sheet.querySelector("#day-sheet-list");
      list.innerHTML = "";
      dayCell.querySelectorAll(".slot").forEach((orig) => {
        const grade = ([...orig.classList].find((c) => c.startsWith("grade-")) || "").slice(6);
        const row = document.createElement("button");
        row.type = "button";
        row.className = "day-sheet-slot" + (orig.classList.contains("past") ? " past" : "");
        if (grade) row.style.setProperty("--slot-c", `var(--color-${grade})`);
        let main, sub;
        if (orig.classList.contains("available")) {
          main = "Available";
          sub = `Grade ${grade} · tap to book`;
        } else if (orig.classList.contains("social")) {
          main = orig.textContent.replace(/\s+/g, " ").trim();
          sub = "Social event";
        } else {
          main = orig.querySelector(".slot-long")?.textContent.trim() || orig.title || "Walk";
          const timeLine = (orig.querySelector(".slot-short")?.innerText || "").split("\n").slice(1).join(" ").trim();
          sub = [grade && `Grade ${grade}`, timeLine].filter(Boolean).join(" · ");
        }
        row.innerHTML = `<span><span class="day-sheet-slot-main">${escapeHtml(main)}</span><span class="day-sheet-slot-sub">${escapeHtml(sub)}</span></span>`;
        row.addEventListener("click", () => {
          closeDaySheet();
          orig.click();
        });
        list.appendChild(row);
      });
      sheet.hidden = false;
      document.body.classList.add("day-sheet-open");
      sheet.querySelector(".day-sheet-close").focus();
    }
    function closeDaySheet() {
      document.getElementById("day-sheet")?.setAttribute("hidden", "");
      document.body.classList.remove("day-sheet-open");
    }
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && document.body.classList.contains("day-sheet-open")) closeDaySheet();
    });

    // Leader and Admin on phones and tablets: the grade legend sits beside the Calendar / List switch
    const calendarLegendEl = document.querySelector(".legend-wrap:not(.picker-legend-wrap)");
    const calendarToolsEl = document.querySelector(".calendar-tools-group");
    function placeLegendForPhones() {
      const header = document.getElementById("leader-layout-header");
      if (!calendarLegendEl || !header || !calendarToolsEl) return;
      const small = window.matchMedia("(max-width: 1100px)").matches && currentView !== "walker";
      if (small && calendarLegendEl.parentElement !== header) header.appendChild(calendarLegendEl);
      else if (!small && calendarLegendEl.parentElement === header) calendarToolsEl.appendChild(calendarLegendEl);
    }
    window.matchMedia("(max-width: 1100px)").addEventListener("change", placeLegendForPhones);

    document.getElementById("msg-pane-toggle").addEventListener("click", (e) => {
      const btn = e.currentTarget;
      const body = document.getElementById("msg-pane-body");
      body.hidden = !body.hidden;
      btn.setAttribute("aria-expanded", String(!body.hidden));
    });
    document.querySelectorAll("[data-msg-status]").forEach((b) => b.addEventListener("click", () => {
      msgStatusFilter = b.dataset.msgStatus;
      renderMessagesPane();
    }));
    document.getElementById("msg-type-filter").addEventListener("change", (e) => {
      msgTypeFilter = e.target.value;
      renderMessagesPane();
    });
    document.getElementById("msg-new-btn").addEventListener("click", () => {
      openMsgForm(document.getElementById("msg-form").hidden);
    });
    document.getElementById("msg-cancel").addEventListener("click", () => openMsgForm(false));
    document.getElementById("msg-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const walkKey = document.getElementById("msg-walk").value;
      const text = document.getElementById("msg-text").value.trim();
      if (!walkKey) return alert("Please choose a walk.");
      if (!text) return alert("Please describe the request.");
      const opt = msgWalkOptions().find((o) => o.key === walkKey);
      const id = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const data = {
        id,
        type: document.getElementById("msg-type").value,
        booking_key: walkKey,
        walk_label: opt ? opt.label : walkKey,
        proposed_date: document.getElementById("msg-date").value || null,
        proposed_time: document.getElementById("msg-time").value || null,
        text,
        status: "open",
        from_name: msgAuthorName(),
        from_role: currentView,
        created_at: new Date().toISOString(),
      };
      walkMessages[id] = data;
      if (isFirebaseActive) set(ref(db, "walk_messages/" + id), data);
      e.target.reset();
      openMsgForm(false);
      msgStatusFilter = "open";
      renderMessagesPane();
    });
    document.getElementById("msg-list").addEventListener("click", (e) => {
      const done = e.target.closest("[data-msg-done]");
      const reopen = e.target.closest("[data-msg-reopen]");
      const del = e.target.closest("[data-msg-delete]");
      if (done) setMsgStatus(done.dataset.msgDone, "done");
      if (reopen) setMsgStatus(reopen.dataset.msgReopen, "open");
      if (del) deleteMessage(del.dataset.msgDelete);
    });

    document.getElementById("booking-requests-panel").addEventListener("click", (e) => {
      const ok = e.target.closest("[data-br-approve]");
      const rv = e.target.closest("[data-br-review]");
      const no = e.target.closest("[data-br-reject]");
      if (rv) openBookingReview(rv.dataset.brReview);
      if (ok) approveBookingRequest(ok.dataset.brApprove);
      if (no) rejectBookingRequest(no.dataset.brReject);
      const gone = e.target.closest("[data-br-dismiss]");
      if (gone) dismissBookingRequest(gone.dataset.brDismiss);
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && openCardKey !== null) closeDetailCard();
      else if (e.key === "Escape" && detailOverlay.classList.contains("active")) closeDetailCard();
    });

    /* ========================================================= MODAL ========================================================= */
    function openBookingModal(dateString, grade, existingData = null, walkNum) {
      hideHoverCard();
      setTimeout(refreshLeaderOptions, 0); // rebuild the Leader suggestions for every open, not only when a walk is typed
      let uniqueValue = null;
      const admin = dateString === "" && grade === "" && !existingData;

      if (!existingData) {
        bookingForm.reset();
        const timestamp = Date.now().toString(36);
        const randomStr = Math.random().toString(36).substring(2, 10);
        uniqueValue = `${timestamp}-${randomStr}`;
        document.getElementById("modalHiddenValue").value = uniqueValue;
      } else {
        document.getElementById("modalHiddenValue").value = existingData.unique_id || "";
      }

      document.getElementById("input-walk-name").setCustomValidity("");
      document.getElementById("input-walk-name").dataset.autofilled = "false";
      const adminView = isAdminView();
      const dateInput = document.getElementById("input-date");
      const gradeInput = document.getElementById("input-grade");
      const commentsInput = document.getElementById("input-comments");
      const notesInput = document.getElementById("input-notes");

      dateInput.value = dateString || "";
      if (admin) {
        dateInput.type = "date";
        dateInput.value = "";
        dateInput.removeAttribute("readonly");
        dateInput.disabled = false;
        gradeInput.disabled = false;
        gradeInput.value = "M";
      } else {
        dateInput.type = "text";
        dateInput.setAttribute("readonly", "true");
        dateInput.disabled = true;
        gradeInput.value = grade;
        gradeInput.disabled = true;
      }

      populateOverrideFields(existingData, walkNum, adminView && !admin);
      document.getElementById("modified-panel").hidden = !(adminView && !admin);
      document.getElementById("input-modified").checked = existingData?.modified === true;
      document.getElementById("input-modified-note").value = existingData?.modified_note || "";

      if (existingData) {
        modalHeading.innerText = "Edit Walk Offer";
        document.getElementById("input-walk-no").value = existingData.walk_number || walkNum || "";
        document.getElementById("input-walk-name").value = existingData.walk_name || "";
        populateLeaderSelect(existingData);
        document.getElementById("input-pueblo").value = existingData.pueblo || "";
        document.getElementById("input-start-time").value = existingData.start_time || "";
        commentsInput.value = (existingData.comments || "").trim();
        notesInput.value = (existingData.notes || "").trim();
      } else {
        modalHeading.innerText = "Book Walk Slot";
        document.getElementById("input-walk-no").value = walkNum || "";
        document.getElementById("input-walk-name").value = "";
        populateLeaderSelect(null);
        document.getElementById("input-pueblo").value = "";
        document.getElementById("input-start-time").value = "10:00";
        commentsInput.value = "";
        notesInput.value = "";
      }

      // In Leaders View, only these four booking fields may be changed.
      // Admin View keeps the booking fields editable for maintenance.
      const editableInLeadersView = new Set([
        "input-start-time",
        "input-walk-no", // Leaders may change the linked walk number / ID.
        "input-leader",
        "input-leader-2",
        "input-comments",
        "input-notes",
      ]);
      const bookingFieldIds = [
        "input-date",
        "input-start-time",
        "input-grade",
        "input-walk-no",
        "input-walk-name",
        "input-leader",
        "input-leader-2",
        "input-pueblo",
        "input-comments",
        "input-notes",
      ];
      bookingFieldIds.forEach((id) => {
        const field = document.getElementById(id);
        if (!field) return;
        const lockedForLeader = !adminView && !editableInLeadersView.has(id);
        field.classList.toggle("field-locked", lockedForLeader);
        if (id === "input-date") {
          // Date is chosen only when adding a walk; otherwise it comes from the slot or booking
          if (lockedForLeader || !admin) field.setAttribute("readonly", "true");
          else field.removeAttribute("readonly");
        } else if (id === "input-grade") {
          // Grade is chosen only when adding a walk; otherwise it comes from the slot or booking
          field.disabled = lockedForLeader || !admin;
        } else if (id === "input-walk-name" || id === "input-pueblo") {
          // Greyed out when editing an existing booking; enabled when adding a walk
          field.disabled = !!existingData;
          if (lockedForLeader) field.setAttribute("readonly", "true");
          else field.removeAttribute("readonly");
        } else if (field.tagName === "INPUT" || field.tagName === "TEXTAREA") {
          if (lockedForLeader) field.setAttribute("readonly", "true");
          else field.removeAttribute("readonly");
        }
      });

      const button = document.getElementById("submit-booking");
      refreshLeaderOptions();
      syncLeaderInputsEnabled();
      refreshWalkDetailsPanel();
      modal.classList.add("active");
    }
    // Leaders can be entered only once the Walk Number matches a walk in the master list
    function syncLeaderInputsEnabled() {
      const key = (document.getElementById("input-walk-no")?.value || "").trim();
      const valid = !!key && !!masterWalks && Object.prototype.hasOwnProperty.call(masterWalks, key);
      ["input-leader", "input-leader-2"].forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.disabled = !valid;
        el.title = valid ? "" : "Choose a valid Walk Number first";
      });
    }

    function closeModal() {
      brReviewId = null;
      modal.classList.remove("active");
    
    }
      document.getElementById("input-walk-name").addEventListener("input", (e) => {
        e.target.setCustomValidity("");
        e.target.dataset.autofilled = "false";
      });
      document.getElementById("input-walk-no").addEventListener("input", () => {
        const nameInput = document.getElementById("input-walk-name");
        refreshLeaderOptions();
        syncLeaderInputsEnabled();
        nameInput.dataset.autofilled = "true";
        validateBookingWalkGrade(false);
        refreshWalkDetailsPanel();
      });
      document.getElementById("input-grade").addEventListener("change", () => {
        validateBookingWalkGrade(false);
        refreshWalkPicker();
        refreshWalkDetailsPanel();
      });

      // Refresh the walk list on focus so it always matches the grade currently chosen
      document.getElementById("input-walk-no").addEventListener("focus", refreshWalkPicker);
      /* ========================================================= BOOKING FORM ========================================================= */ bookingForm.addEventListener(
      "submit",
      (e) => {
        e.preventDefault();
        const dateStr = bookingDateFromForm();
        if (!dateStr) {
          const dateEl = document.getElementById("input-date");
          alert("Please choose a date for this walk.");
          if (dateEl.type === "date") dateEl.focus();
          return;
        }
        const gradeStr = document.getElementById("input-grade").value;
        const walkNum = document.getElementById("input-walk-no").value;
        // Only a Walk Number that exists in the master database can be saved
        const walkNumKey = walkNum.trim();
        if (currentView === "leader" && walkNumKey && !leaderMayLeadWalk(walkNumKey)) {
          alert(myLeaderId ? `You can only book walks you own or are a permitted leader on. Walk ${walkNumKey} is not one of yours.` : "Enter your email address first, so we know which walks you can lead.");
          return;
        }
        if (!walkNumKey || !masterWalks || !Object.prototype.hasOwnProperty.call(masterWalks, walkNumKey)) {
          const walkNumEl = document.getElementById("input-walk-no");
          alert(
            walkNumKey
              ? `Walk Number "${walkNumKey}" is not in the master walks list. Choose one from the list.`
              : "Please choose a Walk Number from the list."
          );
          walkNumEl.focus();
          return;
        }
        const gradeValidation = validateBookingWalkGrade(true);
        if (gradeValidation.mismatch) {
          document.getElementById("input-walk-no").focus();
          return;
        }
        const leaderCheck = validateLeaderInput(walkNumKey);
        if (leaderCheck.error) {
          alert(leaderCheck.error);
          document.getElementById(leaderCheck.field).focus();
          return;
        }
        const walkNameInput = document.getElementById("input-walk-name");
        const walkName = walkNameInput.value.trim();
        if (!walkName) {
          // "required" lets whitespace-only through, so check the trimmed value too
          walkNameInput.value = "";
          walkNameInput.setCustomValidity("Please enter the name of the walk.");
          walkNameInput.reportValidity();
          walkNameInput.focus();
          return;
        }
        const uniqueID = document.getElementById("modalHiddenValue").value;
        console.log("key: ", uniqueID);
        const compositeKey = `${dateStr}_${gradeStr}_${uniqueID}`;

        const payload = {
          date: dateStr,
          walk_grade: gradeStr,
          walk_number: walkNum.trim(),
          walk_id: walkNum.trim(),
          walk_name: walkName,
          leader_ids: leaderCheck.ids,
          leader_keys: leaderCheck.ids.map((id) => findLeader(id)?.public_key).filter(Boolean),
          leader_id: leaderCheck.ids[0],
          pueblo: document.getElementById("input-pueblo").value.trim(),
          comments: document.getElementById("input-comments").value.trim(),
          notes: document.getElementById("input-notes").value.trim(),
          status: bookingStatus(globalBookings[compositeKey]),
          unique_id: uniqueID,
          start_time: document
            .getElementById("input-start-time")
            .value.trim(),
        };
        const existingRecord = globalBookings[compositeKey];
        if (existingRecord?.cancelled === true) payload.cancelled = true;
        if (isAdminView()) {
          payload.modified = document.getElementById("input-modified").checked;
          payload.modified_note = document.getElementById("input-modified-note").value.trim();
        } else {
          payload.modified = existingRecord?.modified === true;
          payload.modified_note = existingRecord?.modified_note ?? "";
        }
        if (isAdminView()) {
          let overrides;
          try {
            overrides = collectOverrides();
          } catch (err) {
            alert(err.message);
            return;
          }
          payload.overrides = overrides;
        } else {
          payload.overrides = existingRecord?.overrides ?? null;
        }
        if (existingRecord && existingRecord.owner) {
          payload.owner = existingRecord.owner;
        }
        saveBookingRecord(compositeKey, payload);
        if (brReviewId) finishBookingReview(payload);
        closeModal();
      },
    );
      /* ========================================================= DATE CONVERSION ========================================================= */ function convertDate(
      dateString,
    ) {
      if (!dateString) {
        return null;
      }
        /* * Converts: * * DD-MM-YYYY * * into a JavaScript Date. */ const parts =
        dateString.split("-");
      if (parts.length !== 3) {
        return null;
      }
      return new Date(
        Number(parts[2]),
        Number(parts[1]) - 1,
        Number(parts[0]),
      );
    }
      /* ========================================================= GET FILTERED STATISTICS DATA ========================================================= */ function getStatisticsData() {
      const selectedPueblo = puebloFilter.value;
      let data = Object.values(globalBookings);
      if (selectedPueblo !== "ALL") {
        data = data.filter((item) => item.pueblo === selectedPueblo);
      }
      return data;
    }
      /* ========================================================= POPULATE PUEBLO FILTER ========================================================= */ function populatePuebloFilter() {
      const currentValue = puebloFilter.value;
      const pueblos = [
        ...new Set(
          Object.values(globalBookings)
            .map((item) => item.pueblo)
            .filter(Boolean),
        ),
      ].sort();
      puebloFilter.innerHTML = ` <option value="ALL"> All Pueblos </option> `;
      pueblos.forEach((pueblo) => {
        const option = document.createElement("option");
        option.value = pueblo;
        option.textContent = pueblo;
        puebloFilter.appendChild(option);
      });
      if (pueblos.includes(currentValue)) {
        puebloFilter.value = currentValue;
      } else {
        puebloFilter.value = "ALL";
      }
    }
      /* ========================================================= STATISTICS TOTALS ========================================================= */ function updateStatisticsTotals(
      data,
    ) {
      document.getElementById("stat-total").textContent = data.length;
      grades.forEach((grade) => {
        document.getElementById(`stat-${grade}`).textContent = data.filter(
          (item) => item.walk_grade === grade,
        ).length;
      });
    }
      /* ========================================================= MONTHLY CHART ========================================================= */ function updateMonthlyChart(
      data,
    ) {
      const monthKeys = [
        ...new Set(
          data
            .map((item) => {
              const d = convertDate(item.date);
              if (!d) {
                return null;
              }
              return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
            })
            .filter(Boolean),
        ),
      ].sort();
      const labels = monthKeys.map((key) => {
        const parts = key.split("-");
        const d = new Date(Number(parts[0]), Number(parts[1]) - 1, 1);
        return d.toLocaleDateString("en-GB", {
          month: "short",
          year: "numeric",
        });
      });
      const datasets = grades.map((grade) => ({
        label: grade,
        data: monthKeys.map(
          (monthKey) =>
            data.filter((item) => {
              const d = convertDate(item.date);
              if (!d) {
                return false;
              }
              const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
              return key === monthKey && item.walk_grade === grade;
            }).length,
        ),
        backgroundColor: gradeColours[grade],
        borderWidth: 0,
      }));
      if (monthlyChart) {
        monthlyChart.destroy();
      }
      monthlyChart = new Chart(document.getElementById("monthlyChart"), {
        type: "bar",
        data: {labels: labels, datasets: datasets},
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: {stacked: true, grid: {display: false}},
            y: {stacked: true, beginAtZero: true, ticks: {precision: 0}},
          },
          plugins: {
            legend: {
              position: "bottom",
              labels: {usePointStyle: true, padding: 18},
            },
          },
        },
      });
    }
      /* ========================================================= LEADER TABLE ========================================================= */ function updateLeaderTable(
      data,
    ) {
      const body = document.getElementById("leader-stats-body");
      body.innerHTML = "";
      const leaders = [
        ...new Set(data.map((item) => bookingLeaderLabel(item)).filter(Boolean)),
      ].sort();
      const grandTotals = {E: 0, M: 0, MS: 0, S: 0, VS: 0};
      leaders.forEach((leader) => {
        const leaderData = data.filter((item) => bookingLeaderLabel(item) === leader);
        const counts = {};
        grades.forEach((grade) => {
          counts[grade] = leaderData.filter(
            (item) => item.walk_grade === grade,
          ).length;
          grandTotals[grade] += counts[grade];
        });
        const tr = document.createElement("tr");
        tr.innerHTML = ` <td> <strong> ${leader} </strong> </td> ${grades.map((grade) => ` <td class="grade-cell"> <span class="grade-count" style=" background: ${gradeColours[grade]} "> ${counts[grade]} </span> </td> `).join("")} <td style=" text-align:center; font-weight:700 "> ${leaderData.length} </td> `;
        body.appendChild(tr);
      });
      const total = Object.values(grandTotals).reduce((a, b) => a + b, 0);
      const totalRow = document.createElement("tr");
      totalRow.classList.add("total-row");
      totalRow.innerHTML = ` <td> TOTAL </td> ${grades.map((grade) => ` <td class="grade-cell"> <span class="grade-count" style=" background: ${gradeColours[grade]} "> ${grandTotals[grade]} </span> </td> `).join("")} <td style=" text-align:center "> ${total} </td> `;
      body.appendChild(totalRow);
    }
    /* ========================================================= RAW STATISTICS TABLE ========================================================= */

    function updateStatisticsTable(data) {
      const body = document.getElementById("stats-data-body");

      body.innerHTML = "";

      const sorted = sortWalkData(data);

      sorted.forEach((item) => {
        const tr = document.createElement("tr");

        tr.innerHTML = `

            <td>
                ${item.walk_number || "-"}
            </td>

            <td>
                ${item.date || "-"}
            </td>

            <td>
                ${item.start_time || "-"}
            </td>

            <td>

                <span
                    class="badge"
                    style="
                        background:
                        ${gradeColours[item.walk_grade] || "#64748b"}
                    ">

                    ${item.walk_grade || "-"}

                </span>

            </td>

            <td>
                ${bookingLeaderLabel(item) || "-"}
            </td>

            <td>
                ${item.pueblo || "-"}
            </td>

        `;

        body.appendChild(tr);
      });

      document.getElementById("stats-count").textContent = data.length;

      updateSortIndicators();
    }
      /* ========================================================= MASTER STATISTICS UPDATE ========================================================= */ function updateStatistics() {
      populatePuebloFilter();
      const data = getStatisticsData();
      updateStatisticsTotals(data);
      updateMonthlyChart(data);
      updateLeaderTable(data);
      updateStatisticsTable(data);
    }
      /* ========================================================= PUEBLO FILTER ========================================================= */ puebloFilter.addEventListener(
      "change",
      updateStatistics,
    );
      /* ========================================================= EXPORT PDF (admin) ========================================================= */
      const pdfModal = document.getElementById("pdf-modal");
      const pdfIso = (d) => {
        const p = (n) => String(n).padStart(2, "0");
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
      };
      // Booking date (DD-MM-YYYY) as YYYY-MM-DD, so ranges compare as text
      const bookingIsoDate = (dateString) => {
        const d = convertDate(dateString);
        return d ? pdfIso(d) : "";
      };
      const pdfRange = () => ({
        from: document.getElementById("pdf-from").value,
        to: document.getElementById("pdf-to").value,
      });

      function bookingsInRange(from, to) {
        const walkerView = currentView === "walker";
        return Object.entries(globalBookings)
          .filter(([, r]) => r)
          .map(([key, r]) => ({ key, r, iso: bookingIsoDate(r.date) }))
          .filter((x) => x.iso && x.iso >= from && x.iso <= to)
          // Walker view: live bookings only. Leader and admin views also get drafts and cancelled walks.
          .filter((x) => !walkerView || (bookingStatus(x.r) === "live" && x.r.cancelled !== true))
          .sort((a, b) => (a.iso + (a.r.start_time || "")).localeCompare(b.iso + (b.r.start_time || "")))
          .map((x) => x.key);
      }

      function updatePdfCount() {
        const { from, to } = pdfRange();
        const countEl = document.getElementById("pdf-count");
        const submit = document.getElementById("pdf-submit");
        let n = 0;
        let message = "";
        if (!from || !to) {
          message = "Choose a start and end date.";
        } else if (from > to) {
          message = "The start date must be on or before the end date.";
        } else {
          n = bookingsInRange(from, to).length;
          message = `${n} walk booking(s) in this range.`;
        }
        countEl.textContent = message;
        submit.disabled = false;
      }

      document.getElementById("export-pdf").addEventListener("click", () => {
        const today = new Date();
        const end = new Date(today);
        end.setDate(end.getDate() + 30);
        document.getElementById("pdf-from").value = pdfIso(today);
        document.getElementById("pdf-to").value = pdfIso(end);
        updatePdfCount();
        pdfModal.classList.add("active");
      });
      document.getElementById("pdf-from").addEventListener("change", updatePdfCount);
      document.getElementById("pdf-to").addEventListener("change", updatePdfCount);
      document.getElementById("pdf-cancel").addEventListener("click", () => pdfModal.classList.remove("active"));

      // Status badge colours: [background, text]
      const PDF_BADGE = {
        Published: [[220, 252, 231], [22, 101, 52]],
        Draft: [[241, 245, 249], [71, 85, 105]],
        Cancelled: [[254, 226, 226], [185, 28, 28]],
      };
      const pdfState = (r) => (r.cancelled === true ? "Cancelled" : bookingStatus(r) === "live" ? "Published" : "Draft");

      // One table row per booked walk. Five columns:
      // 1 date, time and duration (status badge below) | 2 walk name, description, comments
      // 3 grade, distance, ascent, dogs | 4 leader, phones, WhatsApp badge, meeting point, directions, WIS
      // The PDF's built-in font only draws Latin-1 characters. Map common
      // punctuation to plain equivalents, keep accented letters, and replace
      // anything else with "?" so it is visible rather than garbled.
      const PDF_CHAR_MAP = {
        "‘": "'", "’": "'", "‚": "'", "′": "'",
        "“": '"', "”": '"', "„": '"', "″": '"',
        "–": "-", "—": "-", "−": "-",
        "…": "...", " ": " ", " ": " ", " ": " ",
        "•": "-", "·": "-", "™": "TM",
      };
      function pdfText(value) {
        const s = String(value ?? "").normalize("NFC").replace(/\r/g, "");
        let out = "";
        for (const ch of s) {
          if (ch === "\n" || ch === "\t") { out += ch === "\t" ? " " : ch; continue; }
          if (PDF_CHAR_MAP[ch]) { out += PDF_CHAR_MAP[ch]; continue; }
          const code = ch.codePointAt(0);
          const latin1 = (code >= 0x20 && code <= 0x7E) || (code >= 0xA0 && code <= 0xFF);
          out += latin1 ? ch : "?";
        }
        return out;
      }
      // Single-line values (names, titles): line breaks become spaces
      const pdfLine = (value) => pdfText(value).replace(/\s*\n\s*/g, " ").trim();

      function pdfRow(key) {
        const d = getBookingCardData(key);
        const r = d.record;
        const route = d.route || {};
        const leader = findLeader(selectedLeaderId(r));
        const dash = (v) => pdfText(v).trim() || "–";
        const txt = (v) => pdfText(v).trim();
        const grade = getMasterRouteGrade(route) || r.walk_grade || "";
        const meeting = getMasterCoordinates(route);
        const wis = getMasterWisUrl(route);

        const col1 = dateTimeLines(r, route);

        // First line is a blank placeholder; the bold walk name is drawn on it
        const walkCell = [
          " ",
          txt(route.Route_Description),
          txt(r.comments),
          `WIS: ${wis || "–"}`,
        ].filter(Boolean).join("\n");

        const gradeCell = [
          `Grade: ${[grade, route.Terrain, route.Scr, xFlag(route)].map(dash).join(" / ")}`,
          `Dist: ${dash(route.Distance)}`,
          `Asc: ${dash(route.Ascent)}`,
          `Dogs: ${dash(route.Dogs)}`,
        ].join("\n");

        const leaderParts = [`Leader: ${pdfLine(dash(leader ? leaderFullName(leader) : bookingLeaderLabel(r)))}`];
        if (leader) {
          [leader.phone_1, leader.phone_2].map(txt).filter(Boolean).forEach((p) => leaderParts.push(p));
        }
        let waLine = -1;
        if (leader && leader.whats_app === "y") {
          waLine = leaderParts.length;   // blank line; the badge is drawn on it
          leaderParts.push("");
        }
        leaderParts.push("");
        leaderParts.push(`Meeting Point: ${meeting ? `${meeting.latitude}, ${meeting.longitude}` : "–"}`);
        if (meeting) leaderParts.push(`Map: ${meeting.url}`);
        leaderParts.push("");
        leaderParts.push(`Directions: ${dash(route.Directions)}`);

        const cells = [col1, walkCell, gradeCell, leaderParts.join("\n")];
        cells.waLine = waLine;
        // Status badge only in leader and admin PDFs; walker PDFs are live walks only
        cells.state = currentView === "walker" ? "" : pdfState(r);
        cells.name = pdfLine(d.name) || "–";
        return cells;
      }

      // Date, time and duration, one per line, no labels
      function dateTimeLines(r, route) {
        return [
          formatWalkDate(r.date),
          formatStartTime(r.start_time),
          String(route.Total_Time ?? "").trim() || "–",
        ].join("\n");
      }

      function buildWalksPdf(from, to) {
        if (!window.jspdf || typeof window.jspdf.jsPDF !== "function") {
          alert("The PDF library did not load. Check your connection and try again.");
          return;
        }
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
        if (typeof doc.autoTable !== "function") {
          alert("The table plugin did not load. Check your connection and try again.");
          return;
        }
        const keys = bookingsInRange(from, to);
        const rows = keys.map(pdfRow);
        const dmy = (iso) => iso.split("-").reverse().join("/");

        doc.setFontSize(14);
        doc.text(`Scheduled Walks: ${dmy(from)} to ${dmy(to)}`, 10, 12);
        doc.setFontSize(9);
        doc.setTextColor(100);
        doc.text(`${keys.length} walk(s) · Generated ${new Date().toLocaleString("en-GB")}`, 10, 18);
        doc.setTextColor(0);

        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const drawBadge = (x, y, label, [fill, text]) => {
          doc.setFontSize(6.5);
          doc.setFont(undefined, "bold");
          const width = doc.getTextWidth(label) + 4;
          doc.setFillColor(...fill);
          doc.roundedRect(x, y, width, 4, 1, 1, "F");
          doc.setTextColor(...text);
          doc.text(label, x + 2, y + 2.9);
          doc.setTextColor(0);
          doc.setFont(undefined, "normal");
        };

        doc.autoTable({
          startY: 22,
          head: [["Schedule", "Details", "Stats", "Leader & Location"]],
          body: rows,
          theme: "grid",
          styles: { fontSize: 7.5, cellPadding: 2, valign: "top", overflow: "linebreak", lineColor: [200, 200, 200], lineWidth: 0.1 },
          headStyles: { fillColor: [45, 91, 62], textColor: 255, fontStyle: "bold" },
          columnStyles: {
            0: { cellWidth: 34 },
            1: { cellWidth: 72 },
            2: { cellWidth: 50 },
            3: { cellWidth: "auto" },
          },
          margin: { left: 10, right: 10, bottom: 12 },
          // Keep each walk on one page, so the drawn name and badges line up with their cell
          rowPageBreak: "avoid",
          didDrawCell: (data) => {
            if (data.section !== "body") return;
            const x = data.cell.x + data.cell.padding("left");
            // Status badge under the date, time and duration
            const raw = data.row.raw || [];
            if (data.column.index === 1 && raw.name) {
              doc.setFontSize(7.5);
              doc.setFont(undefined, "bold");
              const line = doc.splitTextToSize(raw.name, data.cell.contentWidth)[0] || "";
              doc.text(line, x, data.cell.y + data.cell.padding("top") + 2.1);
              doc.setFont(undefined, "normal");
            }
            if (data.column.index === 0) {
              const state = raw.state;
              if (!state) return;
              doc.setFontSize(7.5);
              const textHeight = doc.getTextDimensions(data.cell.text).h;
              drawBadge(x, data.cell.y + data.cell.padding("top") + textHeight + 1.5, state.toUpperCase(), PDF_BADGE[state]);
            }
            // (walk name is drawn below, in column 2)
            // WhatsApp badge on the line after the phone numbers
            if (data.column.index === 3) {
              const idx = raw.waLine ?? -1;
              if (idx < 0) return;
              const prefix = String(raw[3] ?? "").split("\n").slice(0, idx).join("\n");
              doc.setFontSize(7.5);
              const prefixHeight = prefix
                ? doc.getTextDimensions(doc.splitTextToSize(prefix, data.cell.contentWidth)).h
                : 0;
              drawBadge(x, data.cell.y + data.cell.padding("top") + prefixHeight + 0.5, "WHATSAPP", [[220, 252, 231], [22, 101, 52]]);
            }
          },
          didDrawPage: (data) => {
            doc.setFontSize(8);
            doc.setTextColor(120);
            doc.text(`Page ${data.pageNumber}`, pageWidth - 10, pageHeight - 6, { align: "right" });
            doc.setTextColor(0);
          },
        });
        doc.save(currentView === "walker"
          ? `CBMW Walk Programme ${from} to ${to}.pdf`
          : `walk-bookings-${from}-to-${to}.pdf`);
      }

      document.getElementById("pdf-submit").addEventListener("click", () => {
        const { from, to } = pdfRange();
        if (!from || !to || from > to) return;
        if (bookingsInRange(from, to).length === 0) {
          document.getElementById("pdf-count").textContent = "No walk bookings in this range. Choose different dates.";
          return;
        }
        // Close the dialog first, so it closes even if the PDF step fails
        pdfModal.classList.remove("active");
        try {
          buildWalksPdf(from, to);
        } catch (err) {
          console.error("PDF export failed:", err);
          alert(`Could not create the PDF: ${err.message || err}`);
        }
      });

      /* ========================================================= EXPORT CSV ========================================================= */ document
      .getElementById("export-csv")
      .addEventListener("click", () => {
        const records = Object.values(globalBookings);
        if (!records.length) {
          alert("No active data entries to export.");
          return;
        }
        let csv =
          "Date,Start Time,Grade,Walk Number,Name of Walk,Leader,Pueblo,Comments,Notes,Status,Cancelled\n";
        records.forEach((r) => {
          const row = [
            r.date,
            r.start_time || "",
            r.walk_grade,
            r.walk_number || "",
            r.walk_name || "",
            bookingLeaderLabel(r),
            r.pueblo || "",
            r.comments || "",
            r.notes || "",
            bookingStatus(r) === "live" ? "Published" : "Draft",
            r.cancelled === true ? "Yes" : "No",
          ]
            .map((value) => `"${String(value).replace(/"/g, '""')}"`)
            .join(",");
          csv += row + "\n";
        });
        const blob = new Blob([csv], {type: "text/csv;charset=utf-8;"});
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "walk_bookings_export.csv";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      });
        /* ========================================================= ADD A WALK TO THE SCHEDULER ========================================================= */ document
      .getElementById("add-walk-to-schedule")
      .addEventListener("click", () => {
        openBookingModal("", "", "", "", "", true);
      });

      /* ========================================================= SOCIAL EVENT BUTTONS ========================================================= */
      document.getElementById("add-social-event").addEventListener("click", () => {
        openSocialModal("");
      });
      document.getElementById("social-cancel").addEventListener("click", closeSocialModal);
      document.getElementById("social-type").addEventListener("change", applySocialTypeFields);

      document.getElementById("social-delete").addEventListener("click", () => {
        if (!editingSocialKey || !isAdminView()) return;
        if (!confirm("Delete this event?")) return;
        saveSocialRecord(editingSocialKey, null);
        closeSocialModal();
      });
      document.getElementById("social-form").addEventListener("submit", (e) => {
        e.preventDefault();
        if (!isAdminView()) return;
        const dateInput = document.getElementById("social-date");
        if (!dateInput.value) {
          alert("Please choose a date for this event.");
          dateInput.focus();
          return;
        }
        const dateStr = displayDateFromIso(dateInput.value);
        // Keep the existing key when the date is unchanged; otherwise move the event to its new date
        const key = editingSocialKey && editingSocialKey.startsWith(`${dateStr}_SOC_`)
          ? editingSocialKey
          : `${dateStr}_SOC_${Date.now()}`;
        if (editingSocialKey && editingSocialKey !== key) saveSocialRecord(editingSocialKey, null);
        const type = document.getElementById("social-type").value === "summer" ? "summer" : "social";
        const val = (id) => document.getElementById(id).value.trim();
        saveSocialRecord(key, {
          type,
          title: val("social-title"),
          date: dateStr,
          start_time: document.getElementById("social-start-time").value,
          location: type === "social" ? val("social-location") : "",
          leader: type === "summer" ? val("social-leader") : "",
          duration: type === "summer" ? val("social-duration") : "",
          distance: type === "summer" ? val("social-distance") : "",
          ascent: type === "summer" ? val("social-ascent") : "",
          meeting_point: type === "summer" ? val("social-meeting") : "",
          contact: type === "summer" ? val("social-contact") : "",
          description: val("social-description"),
          updated_at: new Date().toISOString(),
        });
        closeSocialModal();
      });
      /* ========================================================= CALENDAR NAVIGATION ========================================================= */ document
      .getElementById("prev-month")
      .addEventListener("click", () => {
        currentDate.setDate(1); // avoids rolling over on the 31st (e.g. 31 Oct + 1 month = 1 Dec)
        currentDate.setMonth(currentDate.getMonth() - 1);
        renderCalendar();
        afterMonthChange();
      });
    document.getElementById("next-month").addEventListener("click", () => {
      currentDate.setDate(1); // avoids rolling over on the 31st (e.g. 31 Oct + 1 month = 1 Dec)
      currentDate.setMonth(currentDate.getMonth() + 1);
      renderCalendar();
      afterMonthChange();
    });
      /* ========================================================= MODAL BUTTON ========================================================= */ document
      .getElementById("close-modal")
      .addEventListener("click", closeModal);
    document
      .getElementById("clear-all")
      .addEventListener("click", clearAllRecords);
      /* ========================================================= VIEW SWITCHER ========================================================= */
      /* ===== Walker View: List / Month / Day mode =====
         List: all upcoming walks (today onwards), calendar hidden.
         Month: the displayed month's walks, calendar shown.
         Day: the selected day's walks, calendar shown; click a day to choose it. */
      let walkerMode = "picker";
      let walkerDay = "";
      const modeIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const gradeFieldHome = (() => {
        const field = document.getElementById("admin-filter-grade")?.closest(".filter-field");
        return field ? { field, parent: field.parentNode, next: field.nextSibling } : null;
      })();
      // The grade filter stays with the other filters in every view, so the view buttons sit together on their own
      function placeGradeFilter() {
        if (!gradeFieldHome) return;
        if (gradeFieldHome.field.parentNode === gradeFieldHome.parent) return;
        gradeFieldHome.parent.insertBefore(gradeFieldHome.field, gradeFieldHome.next);
      }
      function setWalkerRange(from, to) {
        const fromEl = document.getElementById("admin-filter-from");
        const toEl = document.getElementById("admin-filter-to");
        if (fromEl) fromEl.value = from;
        if (toEl) toEl.value = to;
      }
      function syncWalkerRange() {
        if (currentView !== "walker") return;
        // Map keeps the dates of the view it was opened from (e.g. a month), so the map matches the list.
        // The From and To filters can then change them while the map is open.
        if (walkerMode === "map") return;
        if (walkerMode === "list") {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          setWalkerRange(modeIso(today), "");
        } else if (walkerMode === "picker") {
          if (pickerDay) {
            setWalkerRange(pickerDay, pickerDay);
          } else {
            const t = new Date();
            t.setHours(0, 0, 0, 0);
            setWalkerRange(modeIso(t), "");
          }
        } else if (walkerMode === "month") {
          const first = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
          const last = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
          setWalkerRange(modeIso(first), modeIso(last));
        } else {
          setWalkerRange(walkerDay, walkerDay);
        }
      }
      function setWalkerMode(mode) {
        walkerMode = mode;
        if (mode === "day") {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const inMonth = today.getFullYear() === currentDate.getFullYear() && today.getMonth() === currentDate.getMonth();
          walkerDay = modeIso(inMonth ? today : new Date(currentDate.getFullYear(), currentDate.getMonth(), 1));
        }
        document.body.dataset.walkerMode = mode;
        const picker = document.getElementById("walker-day-picker");
        if (picker) {
          picker.hidden = mode !== "day";
          document.getElementById("walker-day-input").value = walkerDay;
        }
        document.querySelectorAll("[data-walker-mode-btn]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.walkerModeBtn === mode)));
        syncWalkerRange();
        updateWalkOffersTitle();
        renderCalendar();
        renderAdminTable();
      }
      // Month arrows and "Go to month": the month range follows the displayed month; the day in Day mode stays selected
      function afterMonthChange() {
        syncWalkerRange();
        updateWalkOffersTitle();
        renderAdminTable();
      }

      /* Preview as walker: shows Walker View for the same page, then returns to the view it came from */
      var previewReturnView = null;

      /* Past walks: hidden from the Walk Offers list in Leader and Admin View until the button is pressed */
      var showPastWalks = false;
      function togglePastWalks(checked) {
        showPastWalks = checked;
        renderAdminTable();
      }

      function updatePreviewControls() {
        const btn = document.getElementById("preview-walker-btn");
        const banner = document.getElementById("preview-banner");
        const back = previewReturnView;
        btn.hidden = currentView === "walker" && !back;
        btn.textContent = back ? `Back to ${back === "admin" ? "Admin View" : "Leader View"}` : "Preview";
        btn.setAttribute("aria-pressed", String(Boolean(back)));
        banner.hidden = !back;
        document.body.classList.toggle("previewing", Boolean(back));
      }

      function syncViewRadio(view) {
        const radio = document.getElementById(`view-${view}`);
        if (radio) radio.checked = true;
      }

      function togglePreviewAsWalker() {
        expandedOfferRows.clear(); // switching into or out of Preview closes any open walk
        const back = previewReturnView;
        if (back) {
          setView(back);
          syncViewRadio(back);
          return;
        }
        const from = currentView;
        setView("walker");
        previewReturnView = from;
        document.getElementById("past-walks-label").hidden = false; // keep the Show past walks tick box in preview
        syncViewRadio(from);
        updatePreviewControls();
        renderCalendar();
        renderAdminTable();
      }

      function setView(view) {
        if (view === "admin" && !staffIsAdmin) {
          alert("Admin view needs an admin sign-in.");
          return;
        }
        previewReturnView = null;
        currentView = view;
        document.getElementById("leader-identify").hidden = true; // identity comes from sign-in
        updatePreviewControls();
        document.getElementById("past-walks-label").hidden = view === "walker";
        editingOfferKey = null;
        selectedWalkerDate = null;
        updateWalkOffersTitle();
        document.querySelectorAll(".walker-only").forEach((el) => {
          el.hidden = view !== "walker";
        });
        document.querySelector(".calendar-container").classList.remove("calendar-collapsed");
        document.getElementById("calendar-collapse").textContent = "Hide calendar";
        document.body.dataset.view = view;
        renderBookingRequestsPanel();
        renderMessagesPane();
        placeLegendForPhones();
        document.getElementById("page-title").textContent = view === "walker" ? "Walk Programme" : "Programme Planner";
        placeGradeFilter();
        if (view !== "walker") setWalkerRange("", "");
        const admin = view === "admin";
        const showPanels = view !== "walker";

        document.getElementById("admin-container").hidden = false;
        document.getElementById("statistics-dashboard").hidden = view === "walker";

        ["add-walk-to-schedule", "add-social-event", "export-csv", "clear-all"].forEach((id) => {
          document.getElementById(id).hidden = !admin;
        });

        closeDetailCard();
        hideHoverCard();
        renderCalendar();
        renderAdminTable();
        if (showPanels) updateStatistics();
        if (view === "walker") setWalkerMode(walkerMode);
      }

      document.querySelectorAll('input[name="viewMode"]').forEach((radio) => {
        radio.addEventListener("change", (e) => {
          if (e.target.checked) setView(e.target.value);
        });
      });
    document.getElementById("preview-walker-btn").addEventListener("click", togglePreviewAsWalker);
    document.getElementById("past-walks-check").addEventListener("change", (e) => togglePastWalks(e.target.checked));


    document.querySelectorAll("[data-walker-mode-btn]").forEach((btn) => {
      btn.addEventListener("click", () => setWalkerMode(btn.dataset.walkerModeBtn));
    });
    document.getElementById("walker-day-input").addEventListener("change", (e) => {
      walkerDay = e.target.value || modeIso(new Date(new Date().setHours(0, 0, 0, 0)));
      e.target.value = walkerDay;
      syncWalkerRange();
      updateWalkOffersTitle();
      renderAdminTable();
    });
    // Clear the selected day from the Date filter
    document.getElementById("admin-filter-date-clear").addEventListener("click", () => {
      selectedWalkerDate = null;
      renderCalendar();
      renderAdminTable();
    });


      /* Walker View: go to a month, and hide or show the calendar */
    document.getElementById("walker-goto-month").addEventListener("change", (e) => {
      const [y, m] = String(e.target.value || "").split("-").map(Number);
      if (!y || !m) return;
      currentDate = new Date(y, m - 1, 1);
      renderCalendar();
      afterMonthChange();
    });

    (function () {
      const calendar = document.querySelector(".calendar-container");
      const btn = document.getElementById("calendar-collapse");
      btn.addEventListener("click", () => {
        const hidden = calendar.classList.toggle("calendar-collapsed");
        btn.textContent = hidden ? "Show calendar" : "Hide calendar";
        btn.setAttribute("aria-expanded", String(!hidden));
      });
    })();

    document.getElementById("override-reset").addEventListener("click", clearOverrideFields);

    /* Walker View shows "Upcoming Walks" as the table title */
    function updateWalkOffersTitle() {
      const title = document.getElementById("walk-offers-title");
      if (isEmbedWeek() && currentView === "walker") { title.textContent = "This week's walks"; return; }
      if (currentView !== "walker") { title.textContent = "Walk Offers"; return; }
      if (walkerMode === "picker") { title.textContent = pickerDay ? `Walks on ${new Date(pickerDay + "T00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}` : "Upcoming Walks"; return; }
      if (walkerMode === "list") { title.textContent = "Upcoming Walks"; return; }
      if (walkerMode === "map") { title.textContent = "Walk Map"; return; }
      if (walkerMode === "month") { title.textContent = `Walks in ${monthNames[currentDate.getMonth()]} ${currentDate.getFullYear()}`; return; }
      const fromVal = document.getElementById("admin-filter-from")?.value || "";
      const toVal = document.getElementById("admin-filter-to")?.value || "";
      if (fromVal && fromVal === toVal) {
        const [y, m, d] = fromVal.split("-");
        title.textContent = `Walks on ${tableDate(`${d}-${m}-${y}`)}`;
      } else {
        title.textContent = "Upcoming Walks";
      }
    }

    /* Walk Offers: collapse / expand in every view (button or title) */
    (function () {
      const container = document.getElementById("admin-container");
      const btn = document.getElementById("walk-offers-collapse"); // retired button; collapse still works from the title
      const title = container.querySelector(".admin-header h3");
      const toggle = () => {
        const collapsed = container.classList.toggle("collapsed");
        btn?.setAttribute("aria-expanded", String(!collapsed));
        btn?.setAttribute("aria-label", collapsed ? "Expand walk offers" : "Collapse walk offers");
      };
      btn?.addEventListener("click", toggle);
      title.addEventListener("click", toggle);
      title.style.cursor = "pointer";
    })();

    /* ========================================================= EMBED: THIS WEEK'S WALKS =========================================================
       Used by the WordPress page (?view=walker&embed=week): the walker list only, filtered to the current Sunday to Saturday week. */
    function isEmbedWeek() {
      return new URLSearchParams(window.location.search).get("embed") === "week";
    }
    function startEmbedWeek() {
      document.body.classList.add("embed-week");
      const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const setWeek = () => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const sun = new Date(today);
        sun.setDate(today.getDate() - today.getDay());
        const sat = new Date(sun);
        sat.setDate(sun.getDate() + 6);
        document.getElementById("admin-filter-from").value = iso(sun);
        document.getElementById("admin-filter-to").value = iso(sat);
        renderAdminTable();
      };
      setWeek();
      setInterval(setWeek, 15 * 60 * 1000); // roll over to the new week at midnight
      // Tell the WordPress page how tall the list is, so the frame fits it
      // The page body keeps the full viewport height, so the list container is what is measured
      const list = document.getElementById("admin-container");
      const sendHeight = () => {
        if (window.parent !== window) {
          const height = Math.ceil(list.getBoundingClientRect().height) + 8;
          window.parent.postMessage({ type: "cbmw-week-height", height }, "*");
        }
      };
      new ResizeObserver(sendHeight).observe(list);
      sendHeight();
    }

    /* ========================================================= START ========================================================= */ // The view switch is hidden on every page. Leaders and walkers open their view from a hub card or the WordPress admin link (?view=...).
    document.querySelector(".view-toggle-container").classList.add("hidden");
    if (VIEW_FROM_HOST) {
      document.querySelector(`input[name="viewMode"][value="${VIEW_FROM_HOST}"]`).checked = true;
    }
    // Data listeners start first, so an error while applying the host view cannot stop the data loading
    authReady.then(() => {
      initDataSync();
      placeGradeFilter();
      if (!isEmbedWeek() && !VIEW_FROM_HOST && currentView === "walker") setWalkerMode(walkerMode);
      if (isEmbedWeek()) startEmbedWeek();
      // No view in the address means Walker View; the host page can still choose another view
      if (VIEW_FROM_HOST || !isEmbedWeek()) {
        try {
          setView(VIEW_FROM_HOST || "walker");
        } catch (err) {
          console.error("Could not apply the view set by the host page:", err);
        }
      }
    });
    /* =========================================================
WALK DATA TABLE SORTING
========================================================= */

    let walkSortColumn = "date";
    let walkSortDirection = "asc";
    const gradeSortOrder = {
      E: 1,
      M: 2,
      MS: 3,
      S: 4,
      VS: 5,
    };

    /* ---------------------------------------------------------
      Get value for sorting
      --------------------------------------------------------- */

    function getWalkSortValue(item, column) {
      switch (column) {
        case "walk_number":
          return Number(item.walk_number) || 0;

        case "date": {
          const d = convertDate(item.date);
          return d ? d.getTime() : 0;
        }
        case "time":
          return item.start_time || "";

        case "walk_grade":
          return gradeSortOrder[item.walk_grade] || 99;

        case "leader_name":
          return bookingLeaderLabel(item).toLowerCase();

        case "pueblo":
          return (item.pueblo || "").toLowerCase();
        default:
          return "";
      }
    }

    /* ---------------------------------------------------------
      Sort data
      --------------------------------------------------------- */

    function sortWalkData(data) {
      return [...data].sort((a, b) => {
        const valueA = getWalkSortValue(a, walkSortColumn);

        const valueB = getWalkSortValue(b, walkSortColumn);

        let result = 0;

        if (typeof valueA === "number" && typeof valueB === "number") {
          result = valueA - valueB;
        } else {
          result = String(valueA).localeCompare(String(valueB), undefined, {
            numeric: true,
            sensitivity: "base",
          });
        }

        return walkSortDirection === "asc" ? result : -result;
      });
    }

    /* ---------------------------------------------------------
      Update arrows in the header
      --------------------------------------------------------- */

    function updateSortIndicators() {
      document.querySelectorAll(".sortable-header").forEach((header) => {
        const column = header.dataset.sort;

        const indicator = header.querySelector(".sort-indicator");

        if (column === walkSortColumn) {
          indicator.textContent = walkSortDirection === "asc" ? "↑" : "↓";

          indicator.classList.add("active");
        } else {
          indicator.textContent = "↕";

          indicator.classList.remove("active");
        }
      });
    }

    /* ---------------------------------------------------------
      Header click handlers
      --------------------------------------------------------- */

    document.querySelectorAll(".sortable-header").forEach((header) => {
      header.addEventListener("click", () => {
        const column = header.dataset.sort;

        if (walkSortColumn === column) {
          walkSortDirection = walkSortDirection === "asc" ? "desc" : "asc";
        } else {
          walkSortColumn = column;

          walkSortDirection = "asc";
        }

        updateStatistics();
      });
    });

    updateSortIndicators();
    /* =========================================================
 COLLAPSIBLE STATISTICS SECTIONS
 ========================================================= */

    function setupCollapsibleSection(container, header, button) {
      function toggleSection(event) {
        /*
         * Prevent an inner section click from
         * bubbling to an outer section.
         */

        if (event) {
          event.stopPropagation();
        }

        const collapsed = container.classList.toggle("collapsed");

        button.setAttribute(
          "aria-label",
          collapsed ? "Expand section" : "Collapse section",
        );
      }

      header.addEventListener("click", toggleSection);

      /*
       * Stop the button from causing
       * a second header click.
       */

      button.addEventListener("click", (event) => {
        event.stopPropagation();

        toggleSection();
      });
    }

    /* =========================================================
 MAIN STATISTICS DASHBOARD
 ========================================================= */

    const statisticsDashboard = document.getElementById(
      "statistics-dashboard",
    );

    setupCollapsibleSection(
      statisticsDashboard,

      statisticsDashboard.querySelector(".stats-header"),

      statisticsDashboard.querySelector(".stats-header .collapse-button"),
    );

    /* =========================================================
 INNER STATISTICS SECTIONS
 ========================================================= */

    document
      .querySelectorAll("#statistics-dashboard .stats-section")
      .forEach((section) => {
        setupCollapsibleSection(
          section,

          section.querySelector(".stats-section-header"),

          section.querySelector(".stats-section-header .collapse-button"),
        );
      });
    

  
