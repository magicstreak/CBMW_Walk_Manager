    import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
    import { getDatabase, ref, set, update, remove, onValue, get } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
    import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

    /* ========================================================= SETUP ========================================================= */
    // Walks live in the programme-planning project (same as the Walk Scheduler's master walks).
    // Change requests are stored beside them in walk_requests. Walk bookings (calendar project) are read only, for delete checks.
    const walksConfig = {
      apiKey: "AIzaSyB9WLJSl4QmubgBW5rknmnMeHcNbkwqOHQ",
      authDomain: "programme-planning.firebaseapp.com",
      databaseURL: "https://programme-planning-default-rtdb.europe-west1.firebasedatabase.app",
      projectId: "programme-planning",
      storageBucket: "programme-planning.firebasestorage.app",
      messagingSenderId: "1028011310189",
      appId: "1:1028011310189:web:8ac4f37a8d248899735364",
      measurementId: "G-BBQ4Q6TQHD"
    };
    const bookingsConfig = {
      apiKey: "AIzaSyC0hEmdWHSlBkdnxrQiNt_RITYsbj3wvi0",
      authDomain: "cbmw-walk-scheduler.firebaseapp.com",
      databaseURL: "https://cbmw-walk-scheduler-default-rtdb.europe-west1.firebasedatabase.app",
      projectId: "cbmw-walk-scheduler",
      storageBucket: "cbmw-walk-scheduler.firebasestorage.app",
      messagingSenderId: "108766389213",
      appId: "1:108766389213:web:cded7ada3d32874b380c34",
      measurementId: "G-QFS6HHL007"
    };

    // View comes from the hosting page: ?view=walker | leader | admin (default walker).
    // Leader view also takes ?leader_id=101 so requests are attributed to that leader; otherwise the leader picks an ID.
    const params = new URLSearchParams(window.location.search);
    const VIEW = (() => {
      const v = params.get("view") || window.WALKS_VIEW || "walker";
      return ["walker", "leader", "admin"].includes(v) ? v : "walker";
    })();
    const isAdmin = VIEW === "admin";
    const isLeader = VIEW === "leader";
    document.body.dataset.wlView = VIEW;
    let myLeaderId = isLeader ? (params.get("leader_id") || "") : "";

    let walksDb = null;
    let bookingsDb = null;
    let walks = [];            // sorted by Walk ID
    let requests = {};         // walk_requests/{id}
    let rejectingRequestId = null; // request whose inline reject box is open
    let rejectReasonDraft = "";    // reason typed so far (kept across re-renders)
    let bookings = {};         // walk_bookings (read only)
    let leaders = [];          // leaders (read only, for the requester picker and names)
    const expandedWalks = new Set();

    /* ========================================================= FIELDS ========================================================= */
    const GRADES = ["E", "M", "MS", "S", "VS"];
    // Every attribute found on walks records in the programme-planning export. All are editable.
    // Field names match the database exactly (note WiS_URL, not WIS_URL).
    const EDITABLE_FIELDS = [
      { key: "Route_Name", label: "Route name", required: true },
      { key: "Pueblo", label: "Pueblo" },
      { key: "Grade", label: "Grade", type: "choice", options: GRADES },
      { key: "Leader", label: "Leader (owner)", type: "choice", source: "leaders" },
      { key: "Permitted_Leaders", label: "Permitted leaders", type: "multichoice", source: "leaders", full: true, hint: "Other leaders who may lead this walk. The owner is always permitted." },
      { key: "Start_Time", label: "Start time" },
      { key: "Distance", label: "Distance" },
      { key: "Ascent", label: "Ascent" },
      { key: "Total_Time", label: "Total time" },
      { key: "Terrain", label: "Terrain" },
      { key: "Scr", label: "SCR", type: "choice", source: "walks" },
      { key: "Dogs", label: "Dogs" },
      { key: "Restrictions", label: "Restrictions", type: "textarea", full: true },
      { key: "Latitude", label: "Latitude" },
      { key: "Longitude", label: "Longitude" },
      { key: "WiS_URL", label: "WiS URL", type: "url", full: true },
      { key: "Image_URL", label: "Image URL (WordPress Media Library)", full: true },
      { key: "WiS_Bitly_Link", label: "WiS short link", type: "url" },
      { key: "KomootBitly", label: "Komoot link", type: "url" },
      { key: "Route_Description", label: "Route description", type: "textarea", full: true },
      { key: "Directions", label: "Driving directions", type: "textarea", full: true },
      { key: "Lunch_or_Break_Notes", label: "Lunch or break notes", type: "textarea", full: true },
      { key: "Reservation_Notes", label: "Reservation notes", type: "textarea", full: true },
      { key: "Season_last_walked_or_offered", label: "Season last walked or offered" },
      { key: "Last_offered_or_led_by", label: "Last offered or led by" },
      { key: "X", label: "X" },
      { key: "walkID", label: "walkID (legacy numeric ID)" },
    ];
    // Leader view (details and change requests) does not show the last walked / last offered history
    const LEADER_HIDDEN_FIELDS = ["Season_last_walked_or_offered", "Last_offered_or_led_by"];
    // Walker view hides these details; leader view also hides the last walked / last offered history; admin keeps all
    const WALKER_HIDDEN = ["Leader", "Permitted_Leaders", "Start_Time", "Lunch_or_Break_Notes", "Reservation_Notes",
      "Season_last_walked_or_offered", "Last_offered_or_led_by", "WiS_Bitly_Link", "KomootBitly", "walkID"];
    // File uploads: shown in the edit and request forms. The walk record keeps the file name; the file itself is stored beside it.
    const FILE_FIELDS = [
      { key: "GPX", nameKey: "GPX_Name", type: "file", label: "GPX route file", accept: ".gpx,application/gpx+xml,text/xml" },
      { key: "Photo", nameKey: "Photo_Name", type: "file", label: "Walk photo (resized automatically)", accept: "image/*" },
    ];
    // The walk key is the database key, e.g. walk_025. Bookings store it as walk_number.
    const ID_FIELD = { key: "walk_key", label: "Walk key", required: true, hint: "e.g. walk_610. Bookings use this as walk number." };
    const LABELS = Object.fromEntries([ID_FIELD, ...EDITABLE_FIELDS].map((f) => [f.key, f.label]));

    /* ========================================================= HELPERS ========================================================= */
    function escapeHtml(value) {
      return String(value ?? "").replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
      }[c]));
    }
    const str = (v) => String(v ?? "").trim();
    const walkById = (id) => walks.find((w) => w.id === id) || null;
    const pendingFor = (id) => Object.values(requests).filter((r) => r && r.status === "pending" && r.walk_id === id);
    const pendingRequests = () => Object.values(requests).filter((r) => r && r.status === "pending")
      .sort((a, b) => String(a.requested_at).localeCompare(String(b.requested_at)));
    const fullName = (l) => `${str(l?.first_name)} ${str(l?.surname)}`.trim();
    const leaderName = (id) => {
      const l = leaders.find((x) => x.leader_id === id);
      return l ? `${l.first_name || ""} ${l.surname || ""}`.trim() : "";
    };
    const sortById = (a, b) => a.id.localeCompare(b.id, undefined, { numeric: true });

    function nextWalkId() {
      const nums = walks.map((w) => { const m = w.id.match(/^walk_(\d{3})$/); return m ? Number(m[1]) : 0; });
      return `walk_${String(Math.max(0, ...nums) + 1).padStart(3, "0")}`;
    }

    // Walk bookings that point at this walk (by walk number or ID)
    function bookingCountFor(id) {
      return Object.values(bookings).filter(Boolean).filter((b) =>
        String(b.walk_number ?? "") === id || String(b.walk_id ?? "") === id
      ).length;
    }

    function formatDate(iso) {
      const d = new Date(iso);
      return isNaN(d) ? "" : d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
    }
    const statusLabel = (s) => ({ pending: "Waiting for approval", approved: "Approved", rejected: "Not approved" }[s] || s);

    // Blank optional values are stored as null so Firebase removes them
    const toStored = (v) => String(v ?? "");

    /* ========================================================= FILES (GPX and photo) =========================================================
       GPX routes are stored as text at walk_gpx/{walk key}; photos as resized JPEG data at walk_photos/{walk key}.
       Leader change requests carry the file contents; an empty GPX_Text or Photo_Data means "remove the file". */
    const MAX_GPX_CHARS = 2000000;
    const PHOTO_MAX_EDGE = 1600;
    const PHOTO_MAX_CHARS = 1000000;

    async function saveFileNode(walkId, path, node) {
      const target = ref(walksDb, `${path}/${walkId}`);
      if (node === null) return remove(target);
      return set(target, node);
    }

    async function photoToDataUrl(file) {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      if (bitmap.close) bitmap.close();
      const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
      if (dataUrl.length > PHOTO_MAX_CHARS) throw new Error("That photo is still too large after resizing. Try a smaller picture.");
      return dataUrl;
    }

    // Reads the chosen files. Returns only what changed: gpx / photo are { name, text|data } or { remove: true }
    // namesOnly (leader requests): only the file names are recorded; the admin adds the files themselves
    async function readFileChanges(namesOnly = false) {
      const out = {};
      if (document.getElementById("f-GPX-remove")?.checked) out.gpx = { remove: true };
      const gpxFile = document.getElementById("f-GPX")?.files?.[0];
      if (gpxFile) {
        if (!/\.gpx$/i.test(gpxFile.name)) throw new Error("The route file must be a .gpx file.");
        if (namesOnly) {
          out.gpx = { name: gpxFile.name };
        } else {
          const text = await gpxFile.text();
          if (new TextEncoder().encode(text).length > MAX_GPX_CHARS) throw new Error("The GPX file is too large (over 2 MB).");
          if (!/<gpx[\s>]/i.test(text)) throw new Error("That file does not look like a GPX route.");
          out.gpx = { name: gpxFile.name, text };
        }
      }
      if (document.getElementById("f-Photo-remove")?.checked) out.photo = { remove: true };
      const photoFile = document.getElementById("f-Photo")?.files?.[0];
      if (photoFile) {
        if (!photoFile.type.startsWith("image/")) throw new Error("The photo must be an image file.");
        out.photo = namesOnly ? { name: photoFile.name } : { name: photoFile.name, data: await photoToDataUrl(photoFile) };
      }
      return out;
    }

    // The walk-record fields that hold the file names
    function fileNameFields(fc) {
      const out = {};
      if (fc.gpx) out.GPX_Name = fc.gpx.remove ? "" : fc.gpx.name;
      if (fc.photo) out.Photo_Name = fc.photo.remove ? "" : fc.photo.name;
      return out;
    }

    // Writes the file contents for an admin save (or an approved request)
    async function saveFileChanges(walkId, fc) {
      const now = new Date().toISOString();
      if (fc.gpx) await saveFileNode(walkId, "walk_gpx", fc.gpx.remove ? null : { name: fc.gpx.name, text: fc.gpx.text, updated_at: now });
      if (fc.photo) await saveFileNode(walkId, "walk_photos", fc.photo.remove ? null : { name: fc.photo.name, data: fc.photo.data, updated_at: now });
    }

    /* ========================================================= RENDER ========================================================= */
    function setupPage() {
      const titles = {
        walker: ["CBMW Walk Library", ""],
        leader: ["CBMW Walk Library", "Browse the walks. You can request a change to any walk; an admin approves it first."],
        admin: ["CBMW Walk Library", "Add, edit or remove walks, and approve or reject change requests."],
      };
      document.getElementById("page-title").textContent = titles[VIEW][0];
      document.getElementById("page-subtitle").textContent = titles[VIEW][1];
      document.getElementById("add-walk").hidden = !isAdmin;
      document.getElementById("actions-head").hidden = VIEW === "walker";
      document.getElementById("pending-panel").hidden = !isAdmin;
      document.getElementById("picker-wrap").hidden = !isLeader || !!params.get("leader_id");
    }

    function renderPicker() {
      if (!isLeader) return;
      const msg = document.getElementById("picker-msg");
      const input = document.getElementById("leader-email");
      const me = leaders.find((l) => l.leader_id === myLeaderId);
      // Once identified, the email is locked and the leader can use Change to switch
      input.disabled = !!me;
      if (me) {
        msg.hidden = false;
        msg.textContent = `I am currently logged in as ${fullName(me)}`;
      } else if (msg.dataset.notFound === "1") {
        msg.hidden = false;
        msg.textContent = "No leader found with that email address.";
      } else {
        msg.hidden = true;
        msg.textContent = "";
      }
    }


    // Leader view: the leader types their email and the page finds their record. The email is never shown back.
    function identifyByEmail() {
      const typed = str(document.getElementById("leader-email").value).toLowerCase();
      if (!typed) return;
      const match = leaders.find((l) => str(l.email_add).toLowerCase() === typed);
      myLeaderId = match ? match.leader_id : "";
      if (match) rememberLeaderEmail(typed);
      document.getElementById("picker-msg").dataset.notFound = match ? "" : "1";
      renderAll();
    }

    // Small markers in the walk name cell, so files show in the list as well as the edit dialog
    function fileBadges(walk) {
      const parts = [];
      if (str(walk.GPX_Name)) parts.push(`<span class="pill pill-file" title="${escapeHtml(walk.GPX_Name)}">GPX</span>`);
      if (str(walk.Photo_Name)) parts.push(`<span class="pill pill-file" title="${escapeHtml(walk.Photo_Name)}">Photo</span>`);
      return parts.length ? ` ${parts.join(" ")}` : "";
    }

    function detailGridHtml(walk) {
      const hidden = VIEW === "walker" ? WALKER_HIDDEN : VIEW === "leader" ? LEADER_HIDDEN_FIELDS : [];
      const visible = new Set(EDITABLE_FIELDS.map((f) => f.key).filter((k) => !hidden.includes(k)));
      const labelOf = (k) => (EDITABLE_FIELDS.find((f) => f.key === k) || {}).label || k;
      const value = (k) => str(walk[k]);
      const has = (k) => visible.has(k) && value(k) !== "";
      const link = (v) => /^https?:\/\//.test(v)
        ? `<a href="${escapeHtml(v)}" target="_blank" rel="noopener noreferrer">${escapeHtml(v)}</a>`
        : escapeHtml(v);

      // Headline numbers
      const statKeys = [["Grade", "Grade"], ["Distance", "Distance"], ["Ascent", "Ascent"], ["Total_Time", "Total time"], ["Terrain", "Terrain"], ["Scr", "SCR"]];
      const stats = statKeys.filter(([k]) => has(k)).map(([k, label]) =>
        `<div class="stat"><span class="stat-label">${escapeHtml(label)}</span><span class="stat-value">${escapeHtml(value(k))}</span></div>`).join("");

      // Where and what to expect
      const overviewKeys = ["Pueblo", "Start_Time", "Dogs", "Restrictions"];
      const overview = overviewKeys.filter(has).map((k) =>
        `<div class="kv"><dt>${escapeHtml(labelOf(k))}</dt><dd>${escapeHtml(value(k))}</dd></div>`).join("");

      // Map and links: each link shows its full address, so leaders can see the values
      const hasCoords = has("Latitude") && has("Longitude");
      const coords = hasCoords ? `<p class="coords">${escapeHtml(value("Latitude"))}, ${escapeHtml(value("Longitude"))}</p>` : "";
      const linkRows = [];
      if (hasCoords) {
        const mapUrl = `https://www.google.com/maps?q=${encodeURIComponent(value("Latitude") + "," + value("Longitude"))}`;
        linkRows.push(`<div class="kv"><dt>Google Maps</dt><dd><a href="${escapeHtml(mapUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(mapUrl)}</a></dd></div>`);
      }
      [["WiS_URL", "Walks in Spain"], ["WiS_Bitly_Link", "Short link"], ["KomootBitly", "Komoot"], ["Image_URL", "Image"]]
        .filter(([k]) => has(k) && /^https?:\/\//.test(value(k)))
        .forEach(([k, label]) => linkRows.push(`<div class="kv"><dt>${escapeHtml(label)}</dt><dd>${link(value(k))}</dd></div>`));
      const mapBlock = (coords || linkRows.length)
        ? `<section class="dsec"><h4>Meeting point and links</h4>${coords}<dl class="kv-list">${linkRows.join("")}</dl></section>` : "";

      // Written notes: each as a block
      const noteKeys = ["Route_Description", "Directions", "Lunch_or_Break_Notes", "Reservation_Notes"];
      const notes = noteKeys.filter(has).map((k) =>
        `<div class="note-block"><h5>${escapeHtml(labelOf(k))}</h5><p>${escapeHtml(value(k))}</p></div>`).join("");
      const notesBlock = notes ? `<section class="dsec"><h4>Notes</h4>${notes}</section>` : "";

      // Files
      const gpx = str(walk.GPX_Name);
      const photo = str(walk.Photo_Name);
      const fileBlock = true
        ? `<section class="dsec"><h4>Files</h4><div class="file-cards">
            <div class="file-card">
              <span class="file-name">${gpx ? escapeHtml(gpx) : '<span class="muted">No GPX file</span>'}</span>
              ${gpx ? `<button type="button" class="btn btn-small" data-action="download-gpx" data-id="${escapeHtml(walk.id)}">Download GPX</button>` : ""}
            </div>
            <div class="file-card">
              <span class="file-name">${photo ? escapeHtml(photo) : '<span class="muted">No photo</span>'}</span>
              ${photo ? `<button type="button" class="btn btn-small" data-action="view-photo" data-id="${escapeHtml(walk.id)}">View photo</button>` : ""}
            </div>
          </div></section>` : "";

      // Leaders and history (hidden from walkers and, for history, from leaders)
      const adminKeys = ["Leader", "Permitted_Leaders", "Season_last_walked_or_offered", "Last_offered_or_led_by", "X", "walkID"];
      const admin = adminKeys.filter(has).map((k) =>
        `<div class="kv"><dt>${escapeHtml(labelOf(k))}</dt><dd>${k === "Last_offered_or_led_by" ? "" : escapeHtml(value(k))}</dd></div>`).join("");
      const adminBlock = admin ? `<section class="dsec dsec-admin"><h4>Leaders and history</h4><dl class="kv-list">${admin}</dl></section>` : "";

      return `<div class="detail-grid walk-detail">
        ${stats ? `<div class="stat-strip">${stats}</div>` : ""}
        <div class="detail-columns">
          ${overview ? `<section class="dsec"><h4>Overview</h4><dl class="kv-list">${overview}</dl></section>` : ""}
          ${mapBlock}
        </div>
        ${notesBlock}
        ${fileBlock}
        ${adminBlock}
      </div>`;
    }

    // The walks that match the search and grade filters. Used by both the list and the map.
    // Leader filter (leader and admin views): options come from the Leader value on the walks
    let leaderFilterKey = "";
    function renderLeaderFilter() {
      const sel = document.getElementById("leader-filter");
      sel.hidden = VIEW === "walker";
      if (VIEW === "walker") return;
      const names = [...new Set(walks.map((w) => str(w.Leader)).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
      const hasBlank = walks.some((w) => !str(w.Leader));
      const key = names.join("|") + (hasBlank ? "|blank" : "");
      if (key === leaderFilterKey) return;
      leaderFilterKey = key;
      const current = sel.value;
      sel.innerHTML = [`<option value="">All leaders</option>`,
        ...names.map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`),
        hasBlank ? `<option value="__blank__">No leader set</option>` : ""].join("");
      sel.value = [...sel.options].some((o) => o.value === current) ? current : "";
    }
    function filterWalks() {
      const term = str(document.getElementById("search").value).toLowerCase();
      const grade = document.getElementById("grade-filter").value;
      const leaderChoice = document.getElementById("leader-filter").hidden ? "" : document.getElementById("leader-filter").value;
      return walks.filter((w) => {
        if (grade && str(w.Grade) !== grade) return false;
        if (leaderChoice === "__blank__" && str(w.Leader)) return false;
        if (leaderChoice && leaderChoice !== "__blank__" && str(w.Leader) !== leaderChoice) return false;
        if (!term) return true;
        return [w.id, w.Route_Name, w.Pueblo, w.Grade].join(" ").toLowerCase().includes(term);
      });
    }

    // Leaders may request changes only to walks they lead, or to walks with no valid leader yet
    // (so they can take it on). A valid leader is one whose full name is in the leaders list.
    function canRequestChange(w) {
      const me = leaders.find((l) => l.leader_id === myLeaderId);
      const myName = me ? fullName(me) : "";
      if (!myName) return false; // nobody identified: no request buttons
      const current = str(w.Leader);
      const validNames = new Set(leaders.map(fullName));
      const unassigned = !current || !validNames.has(current); // no valid leader yet
      return unassigned || current === myName; // walks they own, or walks with no valid leader
    }

    // A walk with no valid leader can be taken on: it moves to the logged-in leader
    // Leader View: walks the logged-in leader owns (listed as leader on the walk)
    function isOwnedWalk(w) {
      if (!isLeader) return false;
      const me = leaders.find((l) => l.leader_id === myLeaderId);
      const myName = me ? fullName(me) : "";
      return !!myName && str(w.Leader) === myName;
    }
    function isUnassignedWalk(w) {
      const current = str(w.Leader);
      const validNames = new Set(leaders.map(fullName));
      return !current || !validNames.has(current);
    }
    function canTakeOwnership(w) {
      if (!isLeader || !isUnassignedWalk(w)) return false;
      const me = leaders.find((l) => l.leader_id === myLeaderId);
      return !!(me && fullName(me));
    }
    async function takeOwnership(w) {
      const me = leaders.find((l) => l.leader_id === myLeaderId);
      const myName = me ? fullName(me) : "";
      if (!myName) return;
      if (!confirm(`Take ownership of walk ${w.id} (${w.Route_Name || "no name"})? It will be listed with ${myName} as leader.`)) return;
      try {
        await update(ref(walksDb, "walks/" + w.id), { Leader: myName });
      } catch (err) {
        alert("This walk could not be taken on. Please try again, or ask an admin.");
      }
    }

    // Walk photos: the uploaded photo (walk_photos/{walk id}) first, else the walk's Image URL, else a mountain placeholder
    const WALK_PHOTO_PLACEHOLDER = '<svg viewBox="0 0 120 80" aria-hidden="true" focusable="false"><circle cx="92" cy="22" r="7" fill="#f4d58d"/><path d="M0 80 L34 30 L52 52 L70 26 L120 80 Z" fill="#9dbaa5"/><path d="M20 80 L50 40 L66 60 L84 38 L108 80 Z" fill="#5f8a6e"/><path d="M50 40 L56 48 L50 46 L44 50 Z" fill="#ffffff" opacity="0.85"/><path d="M70 26 L76 34 L70 32 L64 35 Z" fill="#ffffff" opacity="0.85"/></svg>';
    const walkPhotoCache = new Map();
    const walkPhotoPending = new Set();
    function walkThumbHtml(w) {
      const hasLink = !!String(w.Image_URL || "").trim();
      const hasUpload = !!String(w.Photo_Name || "").trim();
      if (!hasLink && !hasUpload) return `<div class="walk-thumb walk-thumb-empty">${WALK_PHOTO_PLACEHOLDER}</div>`;
      return `<div class="walk-thumb walk-thumb-empty" data-photo-key="${escapeHtml(w.id)}" data-photo-link="${escapeHtml(String(w.Image_URL || ""))}">${WALK_PHOTO_PLACEHOLDER}</div>`;
    }
    function applyWalkThumb(el, src) {
      if (!src) return;
      const img = document.createElement("img");
      img.alt = "";
      img.loading = "lazy";
      img.onerror = () => { el.classList.add("walk-thumb-empty"); el.innerHTML = WALK_PHOTO_PLACEHOLDER; };
      img.src = src;
      el.classList.remove("walk-thumb-empty");
      el.replaceChildren(img);
    }
    function hydrateWalkThumbs() {
      document.querySelectorAll(".walk-thumb[data-photo-key]").forEach((el) => {
        const k = el.dataset.photoKey;
        const link = el.dataset.photoLink || "";
        if (walkPhotoCache.has(k)) { applyWalkThumb(el, walkPhotoCache.get(k) || link); return; }
        if (walkPhotoPending.has(k)) return;
        walkPhotoPending.add(k);
        const finish = (src) => {
          walkPhotoCache.set(k, src);
          document.querySelectorAll(".walk-thumb[data-photo-key]").forEach((node) => {
            if (node.dataset.photoKey === k) applyWalkThumb(node, src);
          });
        };
        get(ref(walksDb, "walk_photos/" + k)).then((snap) => {
          const v = snap.val();
          finish(v && v.data ? String(v.data) : link);
        }).catch(() => finish(link)).finally(() => walkPhotoPending.delete(k));
      });
    }

    // Column sorting: click a sortable header to sort; click again to reverse
    let walkSort = { key: "id", dir: "asc" };
    const GRADE_RANK = { E: 0, M: 1, MS: 2, S: 3, VS: 4 };
    function sortValue(w, key) {
      if (key === "id") return str(w.id);
      if (key === "route") return str(w.Route_Name).toLowerCase();
      if (key === "pueblo") return str(w.Pueblo).toLowerCase();
      if (key === "owner") return str(w.Leader).toLowerCase();
      if (key === "grade") return GRADE_RANK[str(w.Grade).toUpperCase()] ?? 99;
      if (key === "distance" || key === "ascent") { const n = parseFloat(str(w[key === "distance" ? "Distance" : "Ascent"]).replace(",", ".")); return Number.isFinite(n) ? n : null; }
      if (key === "time") { const m = str(w.Total_Time).match(/(\d+)\s*h\s*(\d+)?/i); return m ? Number(m[1]) * 60 + Number(m[2] || 0) : null; }
      return null;
    }
    function sortWalks(rows) {
      const { key, dir } = walkSort;
      const mult = dir === "desc" ? -1 : 1;
      return [...rows].sort((a, b) => {
        const va = sortValue(a, key), vb = sortValue(b, key);
        // Empty values always sort to the bottom
        if (va === null || va === undefined || va === "") return (vb === null || vb === undefined || vb === "") ? 0 : 1;
        if (vb === null || vb === undefined || vb === "") return -1;
        if (typeof va === "number" && typeof vb === "number") return (va - vb) * mult;
        return String(va).localeCompare(String(vb), undefined, { numeric: true }) * mult;
      });
    }
    function updateSortHeaders() {
      document.querySelectorAll(".walks-table th[data-sort]").forEach((th) => {
        const active = th.dataset.sort === walkSort.key;
        th.setAttribute("aria-sort", active ? (walkSort.dir === "desc" ? "descending" : "ascending") : "none");
        const ind = th.querySelector(".sort-indicator");
        if (ind) ind.textContent = active ? (walkSort.dir === "desc" ? "↓" : "↑") : "↕";
      });
    }
    function setWalkSort(key) {
      walkSort = walkSort.key === key
        ? { key, dir: walkSort.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" };
      updateSortHeaders();
      renderTable();
    }
    document.querySelectorAll(".walks-table th[data-sort]").forEach((th) => {
      th.addEventListener("click", () => setWalkSort(th.dataset.sort));
      th.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setWalkSort(th.dataset.sort); } });
    });
    updateSortHeaders();

    function renderTable() {
      renderLeaderFilter();
      const rows = sortWalks(filterWalks());
      const emptyNote = document.getElementById("empty-note");
      emptyNote.textContent = walks.length ? "No walks match the current filters." : "No walks in the database yet.";
      emptyNote.hidden = rows.length > 0;

      const html = [];
      for (const w of rows) {
        const open = expandedWalks.has(w.id);
        const waiting = pendingFor(w.id).length > 0;
        const actions = [];
        if (isAdmin) {
          actions.push(`<button type="button" class="btn btn-small" data-action="edit" data-id="${escapeHtml(w.id)}">Edit</button>`);
          actions.push(`<button type="button" class="btn btn-small btn-danger" data-action="delete" data-id="${escapeHtml(w.id)}">Delete</button>`);
        } else if (canTakeOwnership(w)) {
          actions.push(`<button type="button" class="btn btn-small" data-action="take" data-id="${escapeHtml(w.id)}">Take ownership</button>`);
        } else if (isLeader && canRequestChange(w)) {
          actions.push(`<button type="button" class="btn btn-small" data-action="request" data-id="${escapeHtml(w.id)}" ${waiting ? "disabled" : ""}>${waiting ? "Change pending" : "Request change"}</button>`);
        }

        html.push(`<tr class="walk-row ${open ? "is-open" : ""} ${isOwnedWalk(w) ? "is-owned" : ""}" data-id="${escapeHtml(w.id)}">
          <td class="chev-cell">
            <button type="button" class="chev" aria-expanded="${open}" aria-label="${open ? "Hide" : "Show"} details for walk ${escapeHtml(w.id)}" data-action="toggle" data-id="${escapeHtml(w.id)}">
              <svg class="chev-down" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
              <svg class="chev-up" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 15 12 9 18 15"/></svg>
            </button>
          </td>
          <td class="walk-id col-id">${escapeHtml(w.id)}</td>
          <td>${escapeHtml(w.Route_Name) || "–"}${fileBadges(w)}${waiting ? ` <span class="pill pill-pending">Change pending</span>` : ""}${String(w.Route_Description || "").trim() ? `<div class="route-desc">${escapeHtml(w.Route_Description)}</div>` : ""}</td>
          <td class="col-pueblo">${escapeHtml(w.Pueblo) || "–"}</td>
          <td><span class="grade">${escapeHtml(w.Grade) || "–"}</span></td>
          <td>${escapeHtml(w.Distance) || "–"}</td>
          <td>${escapeHtml(w.Ascent) || "–"}</td>
          <td>${escapeHtml(w.Total_Time) || "–"}</td>
          <td class="col-owner">${escapeHtml(w.Leader) || "–"}</td>
          <td class="photo-cell">${walkThumbHtml(w)}</td>
          ${VIEW === "walker" ? "" : `<td class="actions-cell">${actions.join(" ")}</td>`}
        </tr>`);
        if (open) {
          html.push(`<tr class="details-row"><td colspan="${VIEW === "walker" ? 7 : 10}">${detailGridHtml(w)}</td></tr>`);
        }
      }
      document.getElementById("walks-body").innerHTML = html.join("");
      hydrateWalkThumbs();
      renderPicker();
      // In Map view the list is hidden and the map shows the same filtered walks
      document.querySelector(".table-wrap").hidden = walksView === "map";
      if (walksView === "map") {
        emptyNote.hidden = true;
        renderMap();
      }
    }

    function changeListHtml(request) {
      const changes = request.changes || {};
      const lines = Object.entries(changes).filter(([key]) => key !== "GPX_Text" && key !== "Photo_Data").map(([key, after]) => {
        const before = request.before?.[key];
        const label = { GPX_Name: "GPX file name", Photo_Name: "Photo file name" }[key] || LABELS[key] || key;
        return `<li><strong>${escapeHtml(label)}:</strong> ${escapeHtml(before || "(blank)")} → ${escapeHtml(after || "(blank)")}</li>`;
      });
      // Files are checked by name and downloaded or viewed on demand, never shown as raw data
      if (changes.GPX_Text) {
        lines.push(`<li><strong>GPX file:</strong> ${escapeHtml(changes.GPX_Name || "route.gpx")} <button type="button" class="btn btn-small" data-action="review-gpx" data-request="${escapeHtml(request.request_id)}">Download</button></li>`);
      }
      if (changes.Photo_Data) {
        lines.push(`<li><strong>Photo:</strong> ${escapeHtml(changes.Photo_Name || "photo.jpg")} <button type="button" class="btn btn-small" data-action="review-photo" data-request="${escapeHtml(request.request_id)}">View</button></li>`);
      }
      return `<ul class="change-list">${lines.join("")}</ul>`;
    }

    function renderPending() {
      if (!isAdmin) return;
      const list = pendingRequests();
      document.getElementById("pending-count").textContent = list.length ? `(${list.length})` : "";
      document.getElementById("pending-list").innerHTML = list.length ? list.map((r) => {
        const requester = r.requested_by ? `${escapeHtml(r.requested_by)}${leaderName(r.requested_by) ? " – " + escapeHtml(leaderName(r.requested_by)) : ""}` : "Unknown leader";
        const title = r.request_type === "new"
          ? `New walk: ${escapeHtml(r.changes?.Route_Name || "(no name)")}`
          : `Walk ${escapeHtml(r.walk_id)} – ${escapeHtml(walkById(r.walk_id)?.Route_Name || "")}`;
        return `<div class="request-item">
          <div class="who">${title}</div>
          <div class="meta">Requested by leader ${requester} · ${escapeHtml(formatDate(r.requested_at))}</div>
          ${changeListHtml(r)}
          <div class="request-actions">
            ${r.request_type === "new"
              ? `<button type="button" class="btn btn-small btn-primary" data-action="approve" data-request="${escapeHtml(r.request_id)}">Approve</button>`
              : `<button type="button" class="btn btn-small btn-primary" data-action="review" data-request="${escapeHtml(r.request_id)}">Review</button>`}
            <button type="button" class="btn btn-small btn-danger" data-action="reject" data-request="${escapeHtml(r.request_id)}">Reject</button>
          </div>
          ${rejectingRequestId === r.request_id ? `<div class="reject-box">
            <label class="meta" for="reject-reason-${escapeHtml(r.request_id)}">Reason for rejecting (optional)</label>
            <input type="text" id="reject-reason-${escapeHtml(r.request_id)}" class="reject-reason" data-request="${escapeHtml(r.request_id)}" value="${escapeHtml(rejectReasonDraft)}" />
            <div class="request-actions">
              <button type="button" class="btn btn-small btn-danger" data-action="reject-confirm" data-request="${escapeHtml(r.request_id)}">Confirm reject</button>
              <button type="button" class="btn btn-small" data-action="reject-cancel" data-request="${escapeHtml(r.request_id)}">Cancel</button>
            </div>
          </div>` : ""}
        </div>`;
      }).join("") : `<p class="empty" style="padding:8px 0">No change requests waiting.</p>`;
    }

    function renderMyRequests() {
      const panel = document.getElementById("my-requests-panel");
      if (!isLeader || !myLeaderId) { panel.hidden = true; return; }
      // Requests the leader has cleared stay in Firebase (walk_requests) but are not listed for them
      const mine = Object.values(requests).filter((r) => r && r.requested_by === myLeaderId && !r.hidden_by_requester)
        .sort((a, b) => String(b.requested_at).localeCompare(String(a.requested_at)));
      panel.hidden = mine.length === 0;
      document.getElementById("my-requests-title").textContent = `My change requests (${mine.length})`;
      document.getElementById("my-requests-list").innerHTML = mine.map((r) => `
        <div class="request-item">
          <div class="who">${r.request_type === "new" ? `New walk: ${escapeHtml(r.changes?.Route_Name || "(no name)")}` : `Walk ${escapeHtml(r.walk_id)} – ${escapeHtml(walkById(r.walk_id)?.Route_Name || "")}`}</div>
          <div class="meta">Requested ${escapeHtml(formatDate(r.requested_at))} · <span class="pill pill-${escapeHtml(r.status)}">${escapeHtml(statusLabel(r.status))}</span></div>
          ${changeListHtml(r)}
          ${r.status === "rejected" && r.reason ? `<div class="meta">Reason: ${escapeHtml(r.reason)}</div>` : ""}
          ${r.status !== "pending" ? `<button type="button" class="btn btn-small clear-request-btn" data-action="clear-request" data-request="${escapeHtml(r.request_id)}">Hide</button>` : ""}
        </div>`).join("");
    }

    // Hide: hides the request from this leader only. The record stays in Firebase and admins still see it.
    document.getElementById("my-requests-list").addEventListener("click", async (e) => {
      const btn = e.target.closest('[data-action="clear-request"]');
      if (!btn || !walksDb) return;
      btn.disabled = true;
      try {
        await update(ref(walksDb, "walk_requests/" + btn.dataset.request), {
          hidden_by_requester: true,
          hidden_at: new Date().toISOString(),
        });
      } catch (err) {
        btn.disabled = false;
        alert("Could not hide this request. Please try again.");
        console.error("Hide request failed:", err);
      }
    });

    function renderAll() {
      renderTable();
      renderPending();
      renderMyRequests();
      document.getElementById("request-new-walk").hidden = !(isLeader && myLeaderId);
    }

    /* ========================================================= LIST / MAP VIEW ========================================================= */
    let walksView = "table";
    let walksMap = null;
    let walksMapLayer = null;

    // Popup content for a map pin: the walk's main details, in every view.
    // Each view hides the same fields the list hides from it (walker view hides leader details).
    const POPUP_FIELDS = [
      "Grade", "Pueblo", "Leader", "Permitted_Leaders", "Start_Time", "Distance", "Ascent", "Total_Time",
      "Terrain", "Dogs", "Scr", "Restrictions", "Route_Description", "Directions", "Lunch_or_Break_Notes", "Reservation_Notes",
    ];
    function walkPopupHtml(w) {
      const hidden = VIEW === "walker" ? WALKER_HIDDEN : VIEW === "leader" ? LEADER_HIDDEN_FIELDS : [];
      const rows = POPUP_FIELDS
        .filter((k) => !hidden.includes(k) && str(w[k]) !== "")
        .map((k) => `<div class="walk-pin-row"><span class="walk-pin-label">${escapeHtml(LABELS[k] || k)}</span> ${escapeHtml(str(w[k]))}</div>`)
        .join("");
      return `<div class="walk-pin"><strong>${escapeHtml(w.id)}</strong> ${escapeHtml(str(w.Route_Name))}${rows ? `<div class="walk-pin-rows">${rows}</div>` : ""}</div>`;
    }

    // Pins for the filtered walks that have coordinates. Each pin shows the walk's details in a popup.
    function renderMap() {
      if (walksView !== "map") return;
      const note = document.getElementById("walks-map-note");
      if (typeof L === "undefined") {
        note.textContent = "The map needs an internet connection to load.";
        return;
      }
      // Build a fresh map each time, so it is sized while its panel is visible
      if (walksMap) { walksMap.remove(); walksMap = null; walksMapLayer = null; }
      walksMap = L.map("walks-map").setView([38.8, 0.05], 9);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 18,
        attribution: "&copy; OpenStreetMap contributors",
      }).addTo(walksMap);
      walksMapLayer = L.layerGroup().addTo(walksMap);

      const points = [];
      let missing = 0;
      for (const w of filterWalks()) {
        const lat = Number(str(w.Latitude));
        const lon = Number(str(w.Longitude));
        if (!str(w.Latitude) || !str(w.Longitude) || !Number.isFinite(lat) || !Number.isFinite(lon)) { missing += 1; continue; }
        L.marker([lat, lon]).bindPopup(walkPopupHtml(w), { maxWidth: 320, maxHeight: 360 }).addTo(walksMapLayer);
        points.push([lat, lon]);
      }
      // Measure and centre once visible, and again shortly after
      const fit = () => {
        walksMap.invalidateSize();
        if (points.length) walksMap.fitBounds(points, { padding: [30, 30], maxZoom: 12 });
      };
      fit();
      setTimeout(fit, 150);
      const shown = `${points.length} walk${points.length === 1 ? "" : "s"} on the map.`;
      note.textContent = missing ? `${shown} ${missing} without coordinates are not shown.` : shown;
    }

    function setWalksView(mode) {
      walksView = mode;
      document.querySelectorAll("[data-walks-view]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.walksView === mode)));
      document.getElementById("walks-map-panel").hidden = mode !== "map";
      renderTable();
    }

    window.addEventListener("resize", () => { if (walksMap && walksView === "map") walksMap.invalidateSize(); });

    /* ========================================================= DIALOG ========================================================= */
    const modal = document.getElementById("walk-modal");
    const form = document.getElementById("walk-form");
    let dialogMode = null;   // "create" | "edit" | "request"
    let dialogWalk = null;
    let dialogRequest = null; // change request being reviewed through the admin edit form

    // Dropdown options: fixed list for Grade; Leader from the leaders database (scheduler app);
    // SCR from the values already used in the walks data. The current value is always included.
    const NO_LEADER_OPTIONS = ["~~ No Leader", "~~ Leader TBC"];
    const byName = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
    function choiceOptions(field, current) {
      let values;
      if (field.options) {
        values = [...field.options];
      } else if (field.source === "leaders") {
        values = [...new Set(leaders.map(fullName).filter(Boolean))].sort(byName);
        values = [...NO_LEADER_OPTIONS, ...values];
      } else {
        values = [...new Set(walks.map((w) => str(w[field.key])).filter(Boolean))].sort(byName);
      }
      if (current && !values.includes(current)) values.unshift(current);
      return values;
    }

    function fieldHtml(field, value, disabled) {
      const id = `f-${field.key}`;
      const val = escapeHtml(value ?? "");
      let control;
      if (field.type === "choice") {
        const current = str(value);
        const options = choiceOptions(field, current).map((v) =>
          `<option value="${escapeHtml(v)}" ${v === current ? "selected" : ""}>${escapeHtml(v)}</option>`
        ).join("");
        control = `<select id="${id}" name="${field.key}" ${disabled ? "disabled" : ""}><option value="" ${current ? "" : "selected"}>–</option>${options}</select>`;
      } else if (field.type === "multichoice") {
        const chosen = new Set(str(value).split(",").map((v) => v.trim()).filter(Boolean));
        const names = [...new Set(leaders.map(fullName).filter(Boolean))];
        for (const c of chosen) if (!names.includes(c)) names.unshift(c);
        names.sort(byName);
        control = `<div class="check-list" id="${id}">${names.map((n) =>
          `<label class="check-item"><input type="checkbox" name="${field.key}" value="${escapeHtml(n)}" ${chosen.has(n) ? "checked" : ""} ${disabled ? "disabled" : ""} /> ${escapeHtml(n)}</label>`
        ).join("")}</div>`;
      } else if (field.type === "textarea") {
        control = `<textarea id="${id}" name="${field.key}" ${disabled ? "disabled" : ""}>${val}</textarea>`;
      } else if (field.type === "file") {
        const current = str(value);
        control = `<input id="${id}" name="${field.key}" type="file" accept="${escapeHtml(field.accept || "")}" ${disabled ? "disabled" : ""} />
          ${current
            ? `<label class="file-remove"><input type="checkbox" id="${id}-remove" /> Remove current file (${escapeHtml(current)})</label>`
            : `<div class="hint">No file attached yet.</div>`}`;
      } else {
        const type = "text";
        control = `<input id="${id}" name="${field.key}" type="${type}" value="${val}" ${disabled ? "disabled" : ""} autocomplete="off" />`;
      }
      return `<div class="form-field ${field.full ? "full" : ""} ${field.changed ? "requested-change" : ""}">
        <label for="${id}">${escapeHtml(field.label)}${field.required ? " *" : ""}</label>
        ${control}
        ${field.hint ? `<div class="hint">${escapeHtml(field.hint)}</div>` : ""}
      </div>`;
    }

    function openDialog(mode, walk = null, request = null) {
      dialogMode = mode;
      dialogWalk = walk;
      dialogRequest = request;
      const title = document.getElementById("modal-title");
      const lede = document.getElementById("modal-lede");
      const submit = document.getElementById("modal-submit");
      document.getElementById("form-error").hidden = true;

      let fields;
      if (mode === "create") {
        title.textContent = "Add walk";
        lede.textContent = "Creates a new walk in the walks database.";
        submit.textContent = "Add walk";
        fields = [ID_FIELD, ...EDITABLE_FIELDS, ...FILE_FIELDS];
      } else if (mode === "edit" && request) {
        title.textContent = `Review change request: walk ${walk.id}`;
        lede.textContent = "The leader's requested changes are filled in below, with what they were. Change any value to override it, then approve. Nothing changes until you approve.";
        submit.textContent = "Approve and save";
        fields = [ID_FIELD, ...EDITABLE_FIELDS, ...FILE_FIELDS];
      } else if (mode === "edit") {
        title.textContent = `Edit walk ${walk.id}`;
        lede.textContent = "Changes apply straight away.";
        submit.textContent = "Save changes";
        fields = [ID_FIELD, ...EDITABLE_FIELDS, ...FILE_FIELDS];
      } else if (mode === "new") {
        title.textContent = "Request a new walk";
        lede.textContent = "Your new walk goes to an admin for approval. It is not added to the walks database until it is approved.";
        submit.textContent = "Send request";
        fields = [...EDITABLE_FIELDS.filter((f) => !LEADER_HIDDEN_FIELDS.includes(f.key)),
          ...FILE_FIELDS.map((f) => ({ ...f, hint: "Your file goes to an admin for approval." }))];
      } else {
        title.textContent = `Request a change: walk ${walk.id}`;
        lede.textContent = "Your changes go to an admin for approval. The walk stays the same until then.";
        submit.textContent = "Send request";
        fields = [...EDITABLE_FIELDS.filter((f) => !LEADER_HIDDEN_FIELDS.includes(f.key)),
          ...FILE_FIELDS.map((f) => ({ ...f, hint: "Your file goes to an admin for approval." }))];
      }

      const gridFields = fields.filter((f) => f.type !== "file");
      const fileFields = fields.filter((f) => f.type === "file");
      const asked = request?.changes || {};
      const wasOf = (key) => str(request?.before?.[key] ?? walk?.[key]);
      document.getElementById("form-fields").innerHTML = gridFields.map((f) => {
        const value = mode === "create"
          ? (f.key === "walk_key" ? nextWalkId() : "")
          : mode === "new" ? ""
          : (request && f.key in asked) ? str(asked[f.key])
          : (f.key === "walk_key" ? walk.id : str(walk?.[f.nameKey || f.key]));
        const field = request && f.key in asked
          ? { ...f, changed: true, hint: `Leader asked for this. Was: ${wasOf(f.key) || "(blank)"}` }
          : f;
        return fieldHtml(field, value, f.key === "walk_key" && mode === "edit");
      }).join("") + fileFilesPanelHtml(mode, fileFields, walk);
      wireFileInputs();
      modal.hidden = false;
      // Only focus a field when the user is about to type a new walk. Reviewing or editing an existing walk
      // opens with nothing focused, so typing or Enter cannot change the walk by accident.
      if (mode === "create") document.getElementById("f-walk_key")?.focus();
      else if (mode === "new") document.getElementById("f-Route_Name")?.focus();
    }

    // Files panel in the edit and request dialogs: one card each for the GPX route and the photo
    function fileFilesPanelHtml(mode, fileFields, walk) {
      if (!fileFields.length) return "";
      const cards = fileFields.map((f) => {
        const current = str(walk?.[f.nameKey || f.key]);
        const isGpx = f.key === "GPX";
        const hint = mode === "request" || mode === "new"
          ? "Sent to an admin for approval."
          : isGpx ? "GPX route, up to 2 MB." : "Resized automatically for the website.";
        return `<div class="file-card">
          <div class="file-card-head">
            <span>${isGpx ? "GPX route" : "Walk photo"}</span>
            <span class="file-status ${current ? "has" : ""}">${current ? escapeHtml(current) : "No file yet"}</span>
          </div>
          <label class="file-drop">
            <input type="file" id="f-${f.key}" accept="${escapeHtml(f.accept || "")}" />
            <span class="file-drop-text">${isGpx ? "Choose a GPX file" : "Choose a photo"}</span>
            <span class="file-drop-name" id="f-${f.key}-chosen">${isGpx ? "Click to choose a .gpx file" : "Any image file"}</span>
          </label>
          ${current ? `<label class="file-remove"><input type="checkbox" id="f-${f.key}-remove" /> Remove current file</label>` : ""}
          <div class="hint">${hint}</div>
        </div>`;
      }).join("");
      return `<div class="file-panel"><div class="file-panel-title">Files</div><div class="file-cards">${cards}</div></div>`;
    }

    // Shows the chosen file name, and a preview for a photo
    function wireFileInputs() {
      document.querySelectorAll("#form-fields input[type=file]").forEach((input) => {
        input.addEventListener("change", () => {
          const file = input.files?.[0];
          const chosen = document.getElementById(`${input.id}-chosen`);
          if (chosen) chosen.textContent = file ? file.name : (input.id === "f-GPX" ? "Click to choose a .gpx file" : "Any image file");
          const card = input.closest(".file-card");
          card.querySelector(".file-preview")?.remove();
          if (file && input.id === "f-Photo") {
            const img = document.createElement("img");
            img.className = "file-preview";
            img.alt = "Selected photo preview";
            img.src = URL.createObjectURL(file);
            card.insertBefore(img, card.querySelector(".file-drop"));
          }
        });
      });
    }

    function closeDialog() {
      dialogRequest = null;
      modal.hidden = true;
      dialogMode = null;
      dialogWalk = null;
    }

    function showError(message) {
      const error = document.getElementById("form-error");
      error.textContent = message;
      error.hidden = false;
      return null;
    }

    // Reads and checks the form. Returns the cleaned values, or null after showing an error.
    function readForm(mode) {
      const get = (key) => str(form.elements[key]?.value);
      const record = {};
      for (const f of EDITABLE_FIELDS) {
        record[f.key] = f.type === "multichoice"
          ? Array.from(document.querySelectorAll(`#form-fields input[name="${f.key}"]:checked`)).map((i) => i.value).join(", ")
          : get(f.key);
      }
      if (mode !== "request" && mode !== "new") record.walk_key = get("walk_key");

      if (mode !== "request" && mode !== "new") {
        if (!record.walk_key) return showError("Walk key is required.");
        if (!/^[A-Za-z0-9_-]+$/.test(record.walk_key)) return showError("Walk key can only use letters, numbers, _ and -.");
        if (mode === "create" && walkById(record.walk_key)) return showError(`Walk key ${record.walk_key} is already used.`);
      }
      for (const f of EDITABLE_FIELDS) {
        if (f.required && !record[f.key]) return showError(`${f.label} is required.`);
      }
      if (record.Grade && !GRADES.includes(record.Grade)) return showError("Grade must be E, M, MS, S or VS.");

      const lat = record.Latitude, lon = record.Longitude;
      if (Boolean(lat) !== Boolean(lon)) return showError("Enter both meeting point latitude and longitude, or leave both blank.");
      if (lat && (!Number.isFinite(Number(lat)) || Math.abs(Number(lat)) > 90)) return showError("Latitude must be a number between -90 and 90.");
      if (lon && (!Number.isFinite(Number(lon)) || Math.abs(Number(lon)) > 180)) return showError("Longitude must be a number between -180 and 180.");

      return record;
    }

    /* ========================================================= ACTIONS ========================================================= */
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!dialogMode || !walksDb) return;
      const mode = dialogMode;
      const record = readForm(mode);
      if (!record) return;

      let files;
      try {
        files = await readFileChanges();
      } catch (err) {
        return showError(err.message);
      }

      try {
        if (mode === "create") {
          const data = {};
          for (const f of EDITABLE_FIELDS) data[f.key] = toStored(record[f.key]);
          Object.assign(data, fileNameFields(files));
          await set(ref(walksDb, "walks/" + record.walk_key), data);
          await saveFileChanges(record.walk_key, files);
        } else if (mode === "edit") {
          // update() keeps any fields this page does not manage
          const data = {};
          for (const f of EDITABLE_FIELDS) data[f.key] = toStored(record[f.key]);
          Object.assign(data, fileNameFields(files));
          const req = dialogRequest;
          if (req) {
            // Files the leader sent travel with the request unless the admin uploads a replacement here
            if (!files.gpx && "GPX_Text" in (req.changes || {})) files.gpx = req.changes.GPX_Text ? { name: req.changes.GPX_Name || "", text: req.changes.GPX_Text } : { remove: true };
            if (!files.photo && "Photo_Data" in (req.changes || {})) files.photo = req.changes.Photo_Data ? { name: req.changes.Photo_Name || "", data: req.changes.Photo_Data } : { remove: true };
            Object.assign(data, fileNameFields(files));
          }
          await update(ref(walksDb, "walks/" + dialogWalk.id), data);
          await saveFileChanges(dialogWalk.id, files);
          if (req) {
            const overrides = Object.keys(req.changes || {})
              .filter((k) => !["GPX_Text", "GPX_Name", "Photo_Data", "Photo_Name"].includes(k))
              .filter((k) => record[k] !== str(req.changes[k]));
            const applied = {};
            for (const f of EDITABLE_FIELDS) if (f.key in (req.changes || {})) applied[f.key] = record[f.key];
            await update(ref(walksDb, "walk_requests/" + req.request_id), {
              status: "approved",
              reviewed_changes: applied,
              admin_overrides: overrides,
              reviewed_at: new Date().toISOString(),
            });
          }
        } else if (mode === "new") {
          if (!myLeaderId) return showError("Enter your email address first, so we know which leader is requesting.");
          const changes = {};
          for (const f of EDITABLE_FIELDS) {
            if (LEADER_HIDDEN_FIELDS.includes(f.key)) continue;
            if (record[f.key]) changes[f.key] = record[f.key];
          }
          if (files.gpx && !files.gpx.remove) { changes.GPX_Name = files.gpx.name; changes.GPX_Text = files.gpx.text; }
          if (files.photo && !files.photo.remove) { changes.Photo_Name = files.photo.name; changes.Photo_Data = files.photo.data; }
          const requestId = `new_${Date.now()}`;
          await set(ref(walksDb, "walk_requests/" + requestId), {
            request_id: requestId,
            request_type: "new",
            walk_id: "",
            requested_by: myLeaderId,
            status: "pending",
            requested_at: new Date().toISOString(),
            changes,
            before: {},
          });
        } else {
          const current = dialogWalk;
          const changes = {};
          const before = {};
          for (const f of EDITABLE_FIELDS) {
            if (LEADER_HIDDEN_FIELDS.includes(f.key)) continue;   // not on the leader's form
            const was = str(current[f.key]);
            if (record[f.key] !== was) {
              changes[f.key] = record[f.key];
              before[f.key] = was;
            }
          }
          // Files travel inside the request for approval; an empty GPX_Text or Photo_Data means "remove the file"
          if (files.gpx) {
            changes.GPX_Name = files.gpx.remove ? "" : files.gpx.name;
            changes.GPX_Text = files.gpx.remove ? "" : files.gpx.text;
          }
          if (files.photo) {
            changes.Photo_Name = files.photo.remove ? "" : files.photo.name;
            changes.Photo_Data = files.photo.remove ? "" : files.photo.data;
          }
          if (!Object.keys(changes).length) return showError("No changes to send. Change a field first.");
          if (pendingFor(current.id).length) return showError("This walk already has a change waiting for approval.");
          if (!myLeaderId) return showError("Enter your email address first, so we know which leader is requesting.");

          const requestId = `${current.id}_${Date.now()}`;
          await set(ref(walksDb, "walk_requests/" + requestId), {
            request_id: requestId,
            walk_id: current.id,
            requested_by: myLeaderId,
            status: "pending",
            requested_at: new Date().toISOString(),
            changes,
            before,
          });
        }
        closeDialog();
      } catch (err) {
        console.error("Save failed:", err);
        showError("Could not save. Check the database connection and permissions.");
      }
    });

    document.getElementById("modal-cancel").addEventListener("click", closeDialog);
    modal.addEventListener("click", (e) => { if (e.target === modal) closeDialog(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !modal.hidden) closeDialog(); });

    document.getElementById("add-walk").addEventListener("click", () => openDialog("create"));
    document.getElementById("request-new-walk").addEventListener("click", () => openDialog("new"));
    document.getElementById("search").addEventListener("input", renderTable);
    document.getElementById("grade-filter").addEventListener("change", renderTable);
    document.getElementById("leader-filter").addEventListener("change", renderTable);
    document.querySelectorAll("[data-walks-view]").forEach((b) => b.addEventListener("click", () => setWalksView(b.dataset.walksView)));
    document.getElementById("leader-email").addEventListener("change", identifyByEmail);
    document.getElementById("leader-email").addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); identifyByEmail(); }
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
      identifyByEmail();
    }


    // Table: a click on a row opens the walk card; the chevron expands the row. Card and table share these actions.
    async function handleWalkClick(e) {
      const btn = e.target.closest("[data-action]");
      const clickedRow = e.target.closest("tr.walk-row");

      if (!btn) {
        // Whole row opens the walk card, except when a control is clicked
        if (clickedRow && !e.target.closest("button, a")) openWalkCard(clickedRow.dataset.id);
        return;
      }
      if (btn.dataset.action === "close-card") return closeWalkCard();
      if (btn.dataset.action === "toggle") return toggleWalk(btn.dataset.id);
      const walk = walkById(btn.dataset.id);
      if (!walk) return;

      if (btn.dataset.action === "download-gpx" || btn.dataset.action === "view-photo") return openWalkFile(walk.id, btn.dataset.action);
      if (btn.dataset.action === "edit" && isAdmin) { closeWalkCard(); return openDialog("edit", walk); }
      if (btn.dataset.action === "request" && isLeader) { closeWalkCard(); return openDialog("request", walk); }
      if (btn.dataset.action === "take" && isLeader) { closeWalkCard(); return takeOwnership(walk); }
      if (btn.dataset.action === "delete" && isAdmin) {
        const used = bookingCountFor(walk.id);
        const pending = pendingFor(walk.id).length;
        const notes = [];
        if (used) notes.push(`${used} walk booking(s) use this walk number. They will no longer link to a route.`);
        if (pending) notes.push(`${pending} change request(s) for this walk will also be deleted.`);
        const message = `Delete walk ${walk.id} (${walk.Route_Name || "no name"})?${notes.length ? "\n\n" + notes.join("\n") : ""}`;
        if (!confirm(message)) return;
        try {
          await remove(ref(walksDb, "walks/" + walk.id));
          await Promise.all([remove(ref(walksDb, "walk_gpx/" + walk.id)), remove(ref(walksDb, "walk_photos/" + walk.id))]).catch(() => {});
          await Promise.all(pendingFor(walk.id).map((r) => remove(ref(walksDb, "walk_requests/" + r.request_id)))).catch(() => {});
          expandedWalks.delete(walk.id);
          closeWalkCard();
        } catch (err) {
          console.error("Delete failed:", err);
          alert("Could not delete. Check the database permissions.");
        }
      }
    }
    document.getElementById("walks-body").addEventListener("click", handleWalkClick);

    // Walk card popup: same look as the scheduler's walk card. Opened by a row click, shows the full details and actions.
    function walkCardActionsHtml(w) {
      const buttons = [];
      if (isAdmin) {
        buttons.push(`<button type="button" class="btn btn-small" data-action="edit" data-id="${escapeHtml(w.id)}">Edit</button>`);
        buttons.push(`<button type="button" class="btn btn-small btn-danger" data-action="delete" data-id="${escapeHtml(w.id)}">Delete</button>`);
      } else if (canTakeOwnership(w)) {
        buttons.push(`<button type="button" class="btn btn-small" data-action="take" data-id="${escapeHtml(w.id)}">Take ownership</button>`);
      } else if (isLeader && canRequestChange(w)) {
        const waiting = pendingFor(w.id).length > 0;
        buttons.push(`<button type="button" class="btn btn-small" data-action="request" data-id="${escapeHtml(w.id)}" ${waiting ? "disabled" : ""}>${waiting ? "Change pending" : "Request change"}</button>`);
      }
      return buttons.join("");
    }
    // Walk card: same header, stat tiles, field groups, map and links as the walk scheduler's card
    function walkCardHtml(w) {
      const value = (k) => str(w[k]);
      const labelOf = (k) => (EDITABLE_FIELDS.find((f) => f.key === k) || {}).label || k;
      const hidden = VIEW === "walker" ? WALKER_HIDDEN : VIEW === "leader" ? LEADER_HIDDEN_FIELDS : [];
      const show = (k) => !hidden.includes(k) && value(k) !== "";
      const grade = value("Grade");
      const url = (v) => /^https?:\/\//.test(v);
      const stat = (label, v) => `
        <div class="walk-stat">
          <div class="walk-stat-label">${escapeHtml(label)}</div>
          <div class="walk-stat-value">${escapeHtml(v || "–")}</div>
        </div>`;
      const info = (label, valueHtml) => `<div class="walk-info-row"><span class="walk-info-label">${escapeHtml(label)}</span><span class="walk-info-value">${valueHtml}</span></div>`;
      const linkTo = (v) => `<a href="${escapeHtml(v)}" target="_blank" rel="noopener noreferrer">${escapeHtml(v)}</a>`;

      // Location and links
      const hasCoords = show("Latitude") && show("Longitude");
      const lat = Number(value("Latitude"));
      const lon = Number(value("Longitude"));
      const coordsOk = hasCoords && Number.isFinite(lat) && Number.isFinite(lon);
      const mapUrl = coordsOk ? `https://www.google.com/maps?q=${encodeURIComponent(lat + "," + lon)}` : "";
      const rows = [];
      if (show("Leader")) rows.push(info(labelOf("Leader"), escapeHtml(value("Leader"))));
      if (show("Pueblo")) rows.push(info(labelOf("Pueblo"), escapeHtml(value("Pueblo"))));
      if (show("Start_Time")) rows.push(info(labelOf("Start_Time"), escapeHtml(value("Start_Time"))));
      if (show("WiS_URL") && url(value("WiS_URL"))) rows.push(info("Walks in Spain", linkTo(value("WiS_URL"))));
      if (show("WiS_Bitly_Link") && url(value("WiS_Bitly_Link"))) rows.push(info("Short link", linkTo(value("WiS_Bitly_Link"))));
      if (show("KomootBitly") && url(value("KomootBitly"))) rows.push(info("Komoot", linkTo(value("KomootBitly"))));
      if (show("Image_URL") && url(value("Image_URL"))) rows.push(info("Image", linkTo(value("Image_URL"))));
      if (coordsOk) rows.push(info("Google Maps", `<a href="${escapeHtml(mapUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(mapUrl)}</a>`));
      if (value("GPX_Name")) rows.push(info("GPX route", `<a href="#" data-action="download-gpx" data-id="${escapeHtml(w.id)}">${escapeHtml(value("GPX_Name"))} ↓</a>`));
      const map = coordsOk
        ? `<iframe class="walk-meeting-map" title="Meeting point map" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="https://www.google.com/maps?q=${encodeURIComponent(lat)},${encodeURIComponent(lon)}&amp;z=14&amp;output=embed"></iframe>`
        : "";

      // Written notes and directions
      const quote = show("Route_Description") ? `<blockquote class="walk-quote">${escapeHtml(value("Route_Description"))}</blockquote>` : "";
      const directions = show("Directions") ? `<div class="walk-section-title">${escapeHtml(labelOf("Directions"))}</div><div class="walk-directions">${escapeHtml(value("Directions"))}</div>` : "";
      const noteKeys = ["Restrictions", "Lunch_or_Break_Notes", "Reservation_Notes"].filter(show);
      const notes = noteKeys.length
        ? `<div class="walk-section-title">Notes</div><div class="walk-info">${noteKeys.map((k) => info(labelOf(k), escapeHtml(value(k)))).join("")}</div>` : "";
      const dogs = show("Dogs") ? `<div class="walk-dogs">🐾 ${escapeHtml(value("Dogs"))}</div>` : "";

      // Leaders and history: admin only
      const adminKeys = ["Permitted_Leaders", "Season_last_walked_or_offered", "Last_offered_or_led_by"];
      // Last offered or led by: the label stays, the value is left blank in admin view
      const adminRows = isAdmin ? adminKeys.filter(show).map((k) => info(labelOf(k), k === "Last_offered_or_led_by" ? "" : escapeHtml(value(k)))).join("") : "";
      const admin = adminRows ? `<div class="walk-section-title">Leaders and history</div><div class="walk-info">${adminRows}</div>` : "";

      // Card actions, same rules as the table
      const actions = walkCardActionsHtml(w);

      return `
        <div class="walk-card-header">
          <div>
            <h3 id="detail-title">${escapeHtml(str(w.Route_Name) || "Walk details")}</h3>
            <div class="walk-card-date">Walk ${escapeHtml(w.id)}${grade ? ` • Grade ${escapeHtml(grade)}` : ""}</div>
          </div>
          <div class="walk-card-head-actions">
            <button class="walk-card-close" type="button" data-action="close-card" aria-label="Close">×</button>
          </div>
        </div>
        <div class="walk-card-body">
          ${walkThumbHtml(w).replace('class="walk-thumb ', 'class="walk-card-photo walk-thumb ')}
          <div class="walk-stats">
            ${stat("Distance", value("Distance"))}
            ${stat("Ascent", value("Ascent"))}
            ${stat("Total time", value("Total_Time"))}
            ${stat("Grade", [grade, value("Terrain"), value("Scr")].filter(Boolean).join(" / "))}
          </div>
          ${quote}
          <div class="walk-section-title">Location and links</div>
          <div class="walk-info">${rows.join("")}</div>
          ${map}
          ${directions}
          ${notes}
          ${dogs}
          ${admin}
        </div>
        <div class="walk-card-actions">${actions}</div>`;
    }
    function openWalkCard(id) {
      const w = walkById(id);
      if (!w) return;
      const card = document.getElementById("walk-card");
      card.innerHTML = walkCardHtml(w);
      hydrateWalkThumbs();
      document.getElementById("walk-overlay").classList.add("active");
    }
    function closeWalkCard() {
      document.getElementById("walk-overlay").classList.remove("active");
    }
    document.getElementById("walk-overlay").addEventListener("click", (e) => {
      if (e.target.id === "walk-overlay") return closeWalkCard();
      if (e.target.closest("a[href='#']")) e.preventDefault();
      handleWalkClick(e);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeWalkCard();
    });

    // Loads a walk's GPX or photo from the database, only when asked for
    async function openWalkFile(walkId, action) {
      try {
        if (action === "download-gpx") {
          const file = (await get(ref(walksDb, "walk_gpx/" + walkId))).val();
          if (!file || !file.text) return alert("The GPX file could not be found.");
          const url = URL.createObjectURL(new Blob([file.text], { type: "application/gpx+xml" }));
          const a = document.createElement("a");
          a.href = url;
          a.download = file.name || `${walkId}.gpx`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        } else {
          const photo = (await get(ref(walksDb, "walk_photos/" + walkId))).val();
          if (!photo || !photo.data) return alert("The photo could not be found.");
          const blob = await (await fetch(photo.data)).blob();
          window.open(URL.createObjectURL(blob), "_blank", "noopener");
        }
      } catch (err) {
        console.error("Could not open the file:", err);
        alert("Could not open the file. Check the database connection.");
      }
    }

    function toggleWalk(id) {
      if (expandedWalks.has(id)) expandedWalks.delete(id);
      else expandedWalks.add(id);
      renderTable();
    }

    // Pending request buttons (admin)
    document.getElementById("pending-list").addEventListener("input", (e) => {
      if (e.target.classList.contains("reject-reason")) rejectReasonDraft = e.target.value;
    });

    document.getElementById("pending-list").addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn || !isAdmin) return;
      const request = requests[btn.dataset.request];
      if (!request || request.status !== "pending") return;

      if (btn.dataset.action === "review-gpx" || btn.dataset.action === "review-photo") {
        const c = request.changes || {};
        try {
        if (btn.dataset.action === "review-gpx") {
          const url = URL.createObjectURL(new Blob([c.GPX_Text], { type: "application/gpx+xml" }));
          const a = document.createElement("a");
          a.href = url;
          a.download = c.GPX_Name || "route.gpx";
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        } else {
          const blob = await (await fetch(c.Photo_Data)).blob();
          window.open(URL.createObjectURL(blob), "_blank", "noopener");
        }
        } catch (err) {
          console.error("Could not open the file:", err);
          alert("Could not open the file. Check the database connection.");
        }
        return;
      }

      try {
        if (btn.dataset.action === "review") {
          const walk = walkById(request.walk_id);
          if (!walk) return alert("This walk no longer exists, so the change cannot be applied. Reject the request instead.");
          openDialog("edit", walk, request);
          return;
        }
        if (btn.dataset.action === "approve" && request.request_type === "new") {
          const suggested = nextWalkId();
          const typedKey = prompt("Walk key for the new walk (e.g. walk_610):", suggested);
          if (typedKey === null) return;
          const newKey = str(typedKey);
          if (!/^[A-Za-z0-9_-]+$/.test(newKey)) return alert("Walk key can only use letters, numbers, _ and -.");
          if (walkById(newKey)) return alert(`Walk key ${newKey} is already used. Choose another.`);
          if (!confirm(`Add "${request.changes?.Route_Name || "this walk"}" as ${newKey}?`)) return;
          const data = {};
          const fileWrites = [];
          const now = new Date().toISOString();
          for (const [key, value] of Object.entries(request.changes || {})) {
            if (key === "GPX_Text") fileWrites.push(saveFileNode(newKey, "walk_gpx", value ? { name: request.changes.GPX_Name || "", text: value, updated_at: now } : null));
            else if (key === "Photo_Data") fileWrites.push(saveFileNode(newKey, "walk_photos", value ? { name: request.changes.Photo_Name || "", data: value, updated_at: now } : null));
            else data[key] = toStored(value);
          }
          // The requesting leader becomes the owner of the new walk
          const owner = leaders.find((l) => l.leader_id === request.requested_by);
          if (owner) data.Leader = fullName(owner);
          await set(ref(walksDb, "walks/" + newKey), data);
          await Promise.all(fileWrites);
          await update(ref(walksDb, "walk_requests/" + request.request_id), {
            status: "approved",
            walk_id: newKey,
            reviewed_at: new Date().toISOString(),
          });
          return;
        }
        if (btn.dataset.action === "approve") {
          const walk = walkById(request.walk_id);
          if (!walk) return alert("This walk no longer exists, so the change cannot be applied. Reject the request instead.");
          const fileKeys = ["GPX_Text", "GPX_Name", "Photo_Data", "Photo_Name"];
          const changedSince = Object.keys(request.changes || {})
            .filter((k) => !fileKeys.includes(k) && request.before && str(walkById(request.walk_id)?.[k]) !== str(request.before[k]));
          if (changedSince.length && !confirm(`This walk has changed since this request was sent (${changedSince.join(", ")}). Approve anyway?`)) return;
          if (!confirm(`Approve this change to walk ${walk.id}?`)) return;
          const data = {};
          const fileWrites = [];
          const now = new Date().toISOString();
          for (const [key, value] of Object.entries(request.changes || {})) {
            if (key === "GPX_Text") fileWrites.push(saveFileNode(request.walk_id, "walk_gpx", value ? { name: request.changes.GPX_Name || "", text: value, updated_at: now } : null));
            else if (key === "Photo_Data") fileWrites.push(saveFileNode(request.walk_id, "walk_photos", value ? { name: request.changes.Photo_Name || "", data: value, updated_at: now } : null));
            else data[key] = toStored(value);
          }
          await update(ref(walksDb, "walks/" + request.walk_id), data);
          await Promise.all(fileWrites);
          await update(ref(walksDb, "walk_requests/" + request.request_id), {
            status: "approved",
            reviewed_at: new Date().toISOString(),
          });
        }
        if (btn.dataset.action === "reject") {
          // Opens an inline reason box (no browser pop-up, which some embedded pages block)
          rejectingRequestId = request.request_id;
          rejectReasonDraft = "";
          renderPending();
          document.getElementById("reject-reason-" + request.request_id)?.focus();
          return;
        }
        if (btn.dataset.action === "reject-cancel") {
          rejectingRequestId = null;
          rejectReasonDraft = "";
          renderPending();
          return;
        }
        if (btn.dataset.action === "reject-confirm") {
          const reason = document.getElementById("reject-reason-" + request.request_id)?.value ?? rejectReasonDraft;
          await update(ref(walksDb, "walk_requests/" + request.request_id), {
            status: "rejected",
            reason: str(reason),
            reviewed_at: new Date().toISOString(),
          });
          rejectingRequestId = null;
          rejectReasonDraft = "";
          return;
        }
      } catch (err) {
        console.error("Review failed:", err);
        alert("Could not update the request. Check the database permissions.");
      }
    });

    /* ========================================================= DATA ========================================================= */
    function start() {
      setupPage();
      if (!walksDb) {
        document.getElementById("walks-body").innerHTML = `<tr><td colspan="10" class="empty">The walks database could not be reached.</td></tr>`;
        return;
      }

      onValue(ref(walksDb, "walks"), (snapshot) => {
        const data = snapshot.val() || {};
        walks = Object.entries(data)
          .filter(([, w]) => w)
          .map(([key, w]) => ({ ...w, id: key }))
          .sort(sortById);
        renderAll();
      }, (error) => console.error("Unable to load walks:", error));

      onValue(ref(walksDb, "walk_requests"), (snapshot) => {
        requests = snapshot.val() || {};
        renderAll();
      }, (error) => console.error("Unable to load change requests:", error));

      // Leaders and walk bookings live in the calendar project. Both are read only here.
      if (bookingsDb) {
        onValue(ref(bookingsDb, "leaders"), (snapshot) => {
          leaders = Object.values(snapshot.val() || {}).filter(Boolean)
            .sort((a, b) => Number(a.leader_id) - Number(b.leader_id));
          if (leaders.length) applySavedLeaderEmail();
          renderAll();
        }, (error) => console.error("Unable to load leaders:", error));

        onValue(ref(bookingsDb, "walk_bookings"), (snapshot) => {
          bookings = snapshot.val() || {};
        }, (error) => console.error("Unable to load bookings:", error));
      }
    }

    try {
      const walksApp = initializeApp(walksConfig, "walksDatabase");
      walksDb = getDatabase(walksApp);
      const auth = getAuth(walksApp);
      let bookingsReady = Promise.resolve();
      try {
        const bookingsApp = initializeApp(bookingsConfig, "walksBookingsRead");
        bookingsDb = getDatabase(bookingsApp);
        bookingsReady = signInAnonymously(getAuth(bookingsApp)).catch((err) => console.error("Bookings sign-in failed:", err));
      } catch (err) {
        console.error("Bookings connection failed.", err);
      }
      signInAnonymously(auth)
        .then(() => bookingsReady)
        .then(start)
        .catch((err) => {
          console.error("Anonymous sign-in failed:", err);
          start();
        });
    } catch (err) {
      console.error("Walks Firebase startup failed.", err);
      start();
    }
  
