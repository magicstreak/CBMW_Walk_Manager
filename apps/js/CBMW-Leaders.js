    import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
    import { getDatabase, ref, set, update, remove, onValue } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
    import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

    /* ========================================================= SETUP ========================================================= */
    // The single cbmw-portal database: reads walk_bookings for delete checks, reads/writes leaders and leader_requests.
import { firebaseConfig as firebaseConfig } from "./firebase-config.js";

    // View comes from the hosting page: ?view=walker | leader | admin (default walker).
    // Leader view also takes ?leader_id=101 so the page knows who is asking. Without it, the leader picks their name.
    const params = new URLSearchParams(window.location.search);
    const VIEW = (() => {
      const v = params.get("view") || window.LEADERS_VIEW || "walker";
      return ["walker", "leader", "admin"].includes(v) ? v : "walker";
    })();
    const isAdmin = VIEW === "admin";
    const isLeader = VIEW === "leader";
    let myLeaderId = isLeader ? (params.get("leader_id") || "") : "";

    let db = null;
    let leaders = [];          // sorted by leader_id
    let requests = {};         // leader_requests/{id}
    let bookings = {};         // walk_bookings (read only, used for delete checks)

    /* ========================================================= HELPERS ========================================================= */
    function escapeHtml(value) {
      return String(value ?? "").replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
      }[c]));
    }

    const EDITABLE_FIELDS = [
      { key: "first_name", label: "First name", required: true },
      { key: "surname", label: "Surname", required: true },
      { key: "display_name", label: "Display name", hint: "Shown to walkers instead of the full name. Leave blank to show the full name." },
      { key: "phone_1", label: "Phone 1", type: "tel", required: true },
      { key: "phone_2", label: "Phone 2", type: "tel" },
      { key: "email_add", label: "Email", type: "email", required: true },
      { key: "whats_app", label: "WhatsApp preferred", type: "whatsapp" },
    ];
    const ID_FIELD = { key: "leader_id", label: "Leader ID", required: true };
    const CHANGE_LABELS = Object.fromEntries([ID_FIELD, ...EDITABLE_FIELDS].map((f) => [f.key, f.label]));

    const leaderById = (id) => leaders.find((l) => l.leader_id === id) || null;
    const fullName = (l) => (l ? `${l.first_name || ""} ${l.surname || ""}`.trim() : "");
    const str = (v) => String(v ?? "").trim();
    const pendingFor = (id) => Object.values(requests).filter((r) => r && r.status === "pending" && r.leader_id === id);
    const pendingRequests = () => Object.values(requests).filter((r) => r && r.status === "pending")
      .sort((a, b) => String(a.requested_at).localeCompare(String(b.requested_at)));

    function nextLeaderId() {
      const max = leaders.reduce((m, l) => Math.max(m, Number(l.leader_id) || 0), 100);
      return String(max + 1);
    }

    // Walk bookings that point at this leader, by leader_id
    function bookingCountFor(leader) {
      return Object.values(bookings).filter(Boolean).filter((b) =>
        String(b.leader_id) === String(leader.leader_id)
      ).length;
    }

    /* ========================================================= RENDER ========================================================= */
    function setupPage() {
      const titles = {
        walker: ["CBMW Leader Network", ""],
        leader: ["CBMW Leader Network", "You can edit your own details. Changes save straight away."],
        admin: ["CBMW Leader Network", "Add, edit or remove leaders, and approve or reject change requests from leaders."],
      };
      document.getElementById("page-title").textContent = titles[VIEW][0];
      document.getElementById("page-subtitle").textContent = titles[VIEW][1];
      document.getElementById("add-leader").hidden = !isAdmin;
      document.getElementById("actions-head").hidden = !isAdmin;
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
      } else {
        msg.hidden = true;
        msg.textContent = "";
      }
    }


    // Column sorting: click a sortable header to sort; click again to reverse
    let leaderSort = { key: "id", dir: "asc" };
    function leaderSortValue(l, key) {
      if (key === "id") return Number(l.leader_id);
      if (key === "name") return fullName(l).toLowerCase();
      if (key === "display") return str(l.display_name).toLowerCase();
      if (key === "phone1") return str(l.phone_1);
      if (key === "email") return str(l.email_add).toLowerCase();
      if (key === "whatsapp") return l.whats_app === "y" ? 0 : 1;
      return "";
    }
    function sortLeaders(rows) {
      const { key, dir } = leaderSort;
      const mult = dir === "desc" ? -1 : 1;
      return [...rows].sort((a, b) => {
        const va = leaderSortValue(a, key), vb = leaderSortValue(b, key);
        const ea = va === "" || va === null || Number.isNaN(va), eb = vb === "" || vb === null || Number.isNaN(vb);
        // Empty values always sort to the bottom
        if (ea || eb) return ea === eb ? 0 : (ea ? 1 : -1);
        if (typeof va === "number" && typeof vb === "number") return (va - vb) * mult;
        return String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: "base" }) * mult;
      });
    }
    function updateLeaderSortHeaders() {
      document.querySelectorAll(".leaders-table th[data-sort]").forEach((th) => {
        const active = th.dataset.sort === leaderSort.key;
        th.setAttribute("aria-sort", active ? (leaderSort.dir === "desc" ? "descending" : "ascending") : "none");
        const ind = th.querySelector(".sort-indicator");
        if (ind) ind.textContent = active ? (leaderSort.dir === "desc" ? "↓" : "↑") : "↕";
      });
    }
    function setLeaderSort(key) {
      leaderSort = leaderSort.key === key
        ? { key, dir: leaderSort.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" };
      updateLeaderSortHeaders();
      renderTable();
    }
    document.querySelectorAll(".leaders-table th[data-sort]").forEach((th) => {
      th.addEventListener("click", () => setLeaderSort(th.dataset.sort));
      th.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setLeaderSort(th.dataset.sort); } });
    });
    updateLeaderSortHeaders();

    function renderTable() {
      const term = str(document.getElementById("search").value).toLowerCase();
      // Leader view: emails are not shown in the list or searched (they remain in the edit/request modal).
      document.getElementById("email-head").hidden = isLeader;
      // Display name: shown to leaders and admins only (walkers do not see the column)
      document.getElementById("display-head").hidden = VIEW === "walker";
      const rows = sortLeaders(leaders.filter((l) => {
        if (!term) return true;
        const searchable = isLeader
          ? [l.leader_id, fullName(l), l.display_name, l.phone_1, l.phone_2]
          : [l.leader_id, fullName(l), l.display_name, l.email_add, l.phone_1, l.phone_2];
        return searchable.join(" ").toLowerCase().includes(term);
      }));
      document.getElementById("empty-note").hidden = rows.length > 0;

      document.getElementById("leaders-body").innerHTML = rows.map((l) => {
        const mine = isLeader && l.leader_id === myLeaderId;
        const waiting = pendingFor(l.leader_id).length > 0;

        let actions = "";
        if (isAdmin) {
          actions = `<button type="button" class="btn btn-small" data-action="edit" data-id="${escapeHtml(l.leader_id)}">Edit</button>
            <button type="button" class="btn btn-small btn-danger" data-action="delete" data-id="${escapeHtml(l.leader_id)}">Delete</button>`;
        }
        // Leader view: the Edit button sits beside the leader's own name, so it shows without scrolling
        const requestBtn = mine
          ? ` <button type="button" class="btn btn-small" data-action="edit" data-id="${escapeHtml(l.leader_id)}">Edit</button>`
          : "";

        return `<tr class="${mine ? "is-me" : ""}">
          ${isAdmin ? `<td class="actions-cell">${actions}</td>` : ""}
          <td class="id-cell" data-label="ID">${escapeHtml(l.leader_id)}</td>
          <td data-label="Name">${escapeHtml(fullName(l))}${mine ? ` <span class="muted">(you)</span>` : ""}${waiting && VIEW !== "walker" ? ` <span class="pill pill-pending">Change pending</span>` : ""}${requestBtn}</td>
          ${VIEW === "walker" ? "" : `<td data-label="Display name">${escapeHtml(str(l.display_name) || "–")}</td>`}
          <td data-label="Phones">${[l.phone_1, l.phone_2].filter((n) => str(n)).map((n) => `<a href="tel:${escapeHtml(str(n).replace(/[^\d+]/g, ""))}">${escapeHtml(str(n))}</a>`).join(", ") || "–"}</td>
          ${isLeader ? "" : `<td data-label="Email">${l.email_add ? `<a href="mailto:${escapeHtml(l.email_add)}">${escapeHtml(l.email_add)}</a>` : "–"}</td>`}
          <td data-label="WhatsApp">${l.whats_app === "y" ? `<span class="pill pill-whatsapp">WhatsApp</span>` : ""}</td>
        </tr>`;
      }).join("");

      renderPicker();
    }

    function changeListHtml(request) {
      return `<ul class="change-list">${Object.entries(request.changes || {}).filter(([key]) => !(isLeader && key === "email_add")).map(([key, after]) => {
        const before = request.before?.[key];
        return `<li><strong>${escapeHtml(CHANGE_LABELS[key] || key)}:</strong> ${escapeHtml(before || "(blank)")} → ${escapeHtml(after || "(blank)")}</li>`;
      }).join("")}</ul>`;
    }

    function renderPending() {
      if (!isAdmin) return;
      const list = pendingRequests();
      document.getElementById("pending-count").textContent = list.length ? `(${list.length})` : "";
      document.getElementById("pending-list").innerHTML = list.length ? list.map((r) => {
        const who = leaderById(r.leader_id);
        return `<div class="request-item">
          <div class="who">${escapeHtml(fullName(who) || "Unknown leader")} <span class="muted">(ID ${escapeHtml(r.leader_id)})</span></div>
          <div class="meta">Requested ${escapeHtml(formatDate(r.requested_at))}</div>
          ${changeListHtml(r)}
          <div class="request-actions">
            <button type="button" class="btn btn-small btn-primary" data-action="approve" data-request="${escapeHtml(r.request_id)}">Approve</button>
            <button type="button" class="btn btn-small btn-danger" data-action="reject" data-request="${escapeHtml(r.request_id)}">Reject</button>
          </div>
        </div>`;
      }).join("") : `<p class="empty" style="padding:8px 0">No change requests waiting.</p>`;
    }

    function renderMyRequests() {
      const panel = document.getElementById("my-requests-panel");
      if (!isLeader || !myLeaderId) { panel.hidden = true; return; }
      // Requests the leader has hidden stay in Firebase (leader_requests) but are not listed for them
      const mine = Object.values(requests).filter((r) => r && r.leader_id === myLeaderId && !r.hidden_by_requester)
        .sort((a, b) => String(b.requested_at).localeCompare(String(a.requested_at)));
      panel.hidden = mine.length === 0;
      document.getElementById("my-requests-title").textContent = `My change requests (${mine.length})`;
      document.getElementById("my-requests-list").innerHTML = mine.map((r) => `
        <div class="request-item">
          <div class="meta">Requested ${escapeHtml(formatDate(r.requested_at))}
            <span class="pill pill-${escapeHtml(r.status)}">${escapeHtml(statusLabel(r.status))}</span></div>
          ${changeListHtml(r)}
          ${r.status === "rejected" && r.reason ? `<div class="meta">Reason: ${escapeHtml(r.reason)}</div>` : ""}
          ${r.status !== "pending" ? `<button type="button" class="btn btn-small hide-request-btn" data-action="hide-request" data-request="${escapeHtml(r.request_id)}">Hide</button>` : ""}
        </div>`).join("");
    }

    // Hide: hides the request from this leader only. The record stays in Firebase and admins still see it.
    document.getElementById("my-requests-list").addEventListener("click", async (e) => {
      const btn = e.target.closest('[data-action="hide-request"]');
      if (!btn || !db) return;
      btn.disabled = true;
      try {
        await update(ref(db, "leader_requests/" + btn.dataset.request), {
          hidden_by_requester: true,
          hidden_at: new Date().toISOString(),
        });
      } catch (err) {
        btn.disabled = false;
        alert("Could not hide this request. Please try again.");
        console.error("Hide request failed:", err);
      }
    });

    function statusLabel(status) {
      return { pending: "Waiting for approval", approved: "Approved", rejected: "Rejected" }[status] || status;
    }
    function formatDate(iso) {
      const d = new Date(iso);
      return isNaN(d) ? "" : d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
    }

    function renderAll() {
      renderTable();
      renderPending();
      renderMyRequests();
    }

    /* ========================================================= DIALOG ========================================================= */
    const modal = document.getElementById("leader-modal");
    const form = document.getElementById("leader-form");
    let dialogMode = null;     // "create" | "edit" | "request"
    let dialogLeader = null;   // leader being edited or requested

    function fieldHtml(field, value, disabled) {
      const id = `f-${field.key}`;
      const val = escapeHtml(value ?? "");
      let control;
      if (field.type === "whatsapp") {
        control = `<select id="${id}" name="${field.key}"><option value="n" ${value !== "y" ? "selected" : ""}>No</option><option value="y" ${value === "y" ? "selected" : ""}>Yes</option></select>`;
      } else if (field.type === "leader") {
        const options = leaders
          .filter((l) => !dialogLeader || l.leader_id !== dialogLeader.leader_id)
          .map((l) => `<option value="${escapeHtml(l.leader_id)}" ${l.leader_id === value ? "selected" : ""}>${escapeHtml(fullName(l))} (${escapeHtml(l.leader_id)})</option>`).join("");
        control = `<select id="${id}" name="${field.key}"><option value="">None</option>${options}</select>`;
      } else {
        const type = field.type || "text";
        control = `<input id="${id}" name="${field.key}" type="${type}" value="${val}" ${disabled ? "disabled" : ""} autocomplete="off" />`;
      }
      return `<div class="form-field ${field.type === "leader" || field.key === "email_add" ? "full" : ""}">
        <label for="${id}">${escapeHtml(field.label)}${field.required ? " *" : ""}</label>
        ${control}
        ${field.hint ? `<div class="hint">${escapeHtml(field.hint)}</div>` : ""}
      </div>`;
    }

    function openDialog(mode, leader = null) {
      dialogMode = mode;
      dialogLeader = leader;
      const title = document.getElementById("modal-title");
      const lede = document.getElementById("modal-lede");
      const submit = document.getElementById("modal-submit");
      const error = document.getElementById("form-error");
      error.hidden = true;
      error.textContent = "";

      let fields = [];
      if (mode === "create") {
        title.textContent = "Add leader";
        lede.textContent = "Creates a new leader in the database.";
        submit.textContent = "Add leader";
        fields = [ID_FIELD, ...EDITABLE_FIELDS];
      } else if (mode === "edit") {
        title.textContent = `Edit ${fullName(leader)}`;
        // Admins can change the leader ID too; a leader edits only their own details, which save straight away
        lede.textContent = isAdmin ? "Admin changes apply straight away." : "Your changes save straight away.";
        submit.textContent = "Save changes";
        fields = isAdmin ? [ID_FIELD, ...EDITABLE_FIELDS] : EDITABLE_FIELDS;
      } else {
        title.textContent = `Request a change for ${fullName(leader)}`;
        lede.textContent = "Your changes are sent to an admin for approval. Your details stay the same until then.";
        submit.textContent = "Send request";
        fields = EDITABLE_FIELDS;
      }

      document.getElementById("form-fields").innerHTML = fields.map((f) => {
        const value = mode === "create"
          ? (f.key === "leader_id" ? nextLeaderId() : (f.key === "whats_app" ? "n" : ""))
          : leader?.[f.key] ?? "";
        return fieldHtml(f, value, f.key === "leader_id" && mode === "edit");
      }).join("");
      modal.hidden = false;
      document.getElementById(mode === "create" ? "f-leader_id" : "f-first_name")?.focus();
    }

    function closeDialog() {
      modal.hidden = true;
      dialogMode = null;
      dialogLeader = null;
    }

    function showError(message) {
      const error = document.getElementById("form-error");
      error.textContent = message;
      error.hidden = false;
    }

    // Reads and checks the form; returns the cleaned record or null (after showing an error)
    function readForm(mode) {
      const get = (key) => str(form.elements[key]?.value);
      const record = {};
      // A leader editing their own details keeps their existing ID
      if (mode !== "request") record.leader_id = mode === "edit" && !isAdmin && dialogLeader ? String(dialogLeader.leader_id) : get("leader_id");
      for (const f of EDITABLE_FIELDS) record[f.key] = get(f.key);
      if (record.whats_app !== "y") record.whats_app = "n";

      if (mode !== "request") {
        if (record.leader_id && !/^\d+$/.test(record.leader_id)) return showError("Leader ID must be a number."), null;
        if (mode === "create" && leaderById(record.leader_id)) return showError(`Leader ID ${record.leader_id} is already used.`), null;
      }
      const idFields = mode === "request" || (mode === "edit" && !isAdmin) ? [] : [ID_FIELD];
      for (const f of [...idFields, ...EDITABLE_FIELDS]) {
        if (f.required && !record[f.key]) return showError(`${f.label} is required.`), null;
      }
      if (!/^[+\d][\d\s()-]{5,}$/.test(record.phone_1)) return showError("Phone 1 should be a phone number."), null;
      if (record.phone_2 && !/^[+\d][\d\s()-]{5,}$/.test(record.phone_2)) return showError("Phone 2 should be a phone number, or left blank."), null;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(record.email_add)) return showError("Email does not look valid."), null;
      return record;
    }

    /* ========================================================= ACTIONS ========================================================= */
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!dialogMode || !db) return;
      const mode = dialogMode;
      const record = readForm(mode);
      if (!record) return;

      try {
        if (mode === "create" || mode === "edit") {
          if (mode === "edit" && !isAdmin) {
            // A leader's own details save straight away, without an admin approval step
            await update(ref(db, "leaders/" + record.leader_id), record);
          } else {
            const waitingFor = Object.values(requests).filter((r) => r && r.status === "pending" && String(r.leader_id) === String(record.leader_id));
            if (mode === "edit" && waitingFor.length && !confirm("This leader has a change waiting for approval. Save anyway?")) return;
            await set(ref(db, "leaders/" + record.leader_id), record);
          }
        } else {
          const current = dialogLeader;
          const changes = {};
          const before = {};
          for (const f of EDITABLE_FIELDS) {
            const was = f.key === "whats_app" ? (current.whats_app === "y" ? "y" : "n") : str(current[f.key]);
            if (record[f.key] !== was) {
              changes[f.key] = record[f.key];
              before[f.key] = was;
            }
          }
          if (!Object.keys(changes).length) return showError("No changes to send. Change a field first."), undefined;
          if (pendingFor(current.leader_id).length) {
            return showError("You already have a change waiting for approval. Ask an admin to review it first."), undefined;
          }
          const requestId = `${current.leader_id}_${Date.now()}`;
          await set(ref(db, "leader_requests/" + requestId), {
            request_id: requestId,
            leader_id: current.leader_id,
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

    document.getElementById("add-leader").addEventListener("click", () => openDialog("create"));
    document.getElementById("search").addEventListener("input", renderTable);

    // Leader view: the leader types their email and the page finds their record. The email is never shown back.
    function identifyByEmail() {
      const typed = str(document.getElementById("leader-email").value).toLowerCase();
      if (!typed) return;
      const match = leaders.find((l) => str(l.email_add).toLowerCase() === typed);
      if (!match) {
        myLeaderId = "";
        renderAll();
        const msg = document.getElementById("picker-msg");
        msg.hidden = false;
        msg.textContent = "No leader found with that email address.";
        return;
      }
      myLeaderId = match.leader_id;
      rememberLeaderEmail(typed);
      renderAll();
    }
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


    // Row buttons (edit, delete, request change)
    document.getElementById("leaders-body").addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const leader = leaderById(btn.dataset.id);
      if (!leader) return;

      if (btn.dataset.action === "edit" && (isAdmin || (isLeader && String(leader.leader_id) === String(myLeaderId)))) openDialog("edit", leader);
      if (btn.dataset.action === "request" && isLeader) openDialog("request", leader);
      if (btn.dataset.action === "delete" && isAdmin) {
        const usedBy = bookingCountFor(leader);
        const notes = [];
        if (usedBy) notes.push(`${usedBy} walk booking(s) use this leader. Their name stays on the booking, but the contact details will no longer show.`);
        const pendingReqs = Object.values(requests).filter((r) => r && r.status === "pending" && String(r.leader_id) === String(leader.leader_id));
        if (pendingReqs.length) notes.push(`${pendingReqs.length} change request(s) from this leader will also be deleted.`);
        const message = `Delete ${fullName(leader)} (ID ${leader.leader_id})?${notes.length ? "\n\n" + notes.join("\n") : ""}`;
        if (!confirm(message)) return;
        try {
          await remove(ref(db, "leaders/" + leader.leader_id));
          await Promise.all(pendingReqs.map((r) => remove(ref(db, "leader_requests/" + r.request_id)))).catch(() => {});
        } catch (err) {
          console.error("Delete failed:", err);
          alert("Could not delete. Check the database permissions.");
        }
      }
    });

    // Pending request buttons (admin)
    document.getElementById("pending-list").addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn || !isAdmin) return;
      const request = requests[btn.dataset.request];
      if (!request || request.status !== "pending") return;

      try {
        if (btn.dataset.action === "approve") {
          const leader = leaderById(request.leader_id);
          if (!leader) return alert("This leader no longer exists, so the change cannot be applied. Reject the request instead.");
          if (!confirm(`Approve this change for ${fullName(leader)}?`)) return;
          await update(ref(db, "leaders/" + request.leader_id), request.changes);
          await update(ref(db, "leader_requests/" + request.request_id), {
            status: "approved",
            reviewed_at: new Date().toISOString(),
          });
        }
        if (btn.dataset.action === "reject") {
          const reason = prompt("Reason for rejecting (optional):", "");
          if (reason === null) return;
          await update(ref(db, "leader_requests/" + request.request_id), {
            status: "rejected",
            reason: str(reason),
            reviewed_at: new Date().toISOString(),
          });
        }
      } catch (err) {
        console.error("Review failed:", err);
        alert("Could not update the request. Check the database permissions.");
      }
    });

    /* ========================================================= DATA ========================================================= */
    function start() {
      setupPage();
      if (!db) {
        document.getElementById("leaders-body").innerHTML = `<tr><td colspan="9" class="empty">The database could not be reached.</td></tr>`;
        return;
      }
      onValue(ref(db, "leaders"), (snapshot) => {
        const data = snapshot.val() || {};
        leaders = Object.values(data).filter(Boolean)
          .sort((a, b) => Number(a.leader_id) - Number(b.leader_id));
        if (leaders.length) applySavedLeaderEmail();
        renderAll();
      }, (error) => console.error("Unable to load leaders:", error));

      onValue(ref(db, "leader_requests"), (snapshot) => {
        requests = snapshot.val() || {};
        renderAll();
      }, (error) => console.error("Unable to load change requests:", error));

      // Read only: used to warn before a leader is deleted
      onValue(ref(db, "walk_bookings"), (snapshot) => {
        bookings = snapshot.val() || {};
      }, (error) => console.error("Unable to load bookings:", error));
    }

    try {
      const app = initializeApp(firebaseConfig, "leadersApp");
      db = getDatabase(app);
      const auth = getAuth(app);
      signInAnonymously(auth).then(start).catch((err) => {
        console.error("Anonymous sign-in failed:", err);
        start();
      });
    } catch (err) {
      console.error("Leaders Firebase startup failed.", err);
      start();
    }
  
