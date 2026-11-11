// Shared sign-in for the CBMW apps. Every page uses the same app name, so a leader or admin who signs in
// once stays signed in on the other pages on this site.
import { signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { ref, get } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

export const STAFF_APP_NAME = "cbmwStaff";

// Waits for any saved sign-in to load. Signs in anonymously only if nobody is signed in,
// so a staff sign-in is never replaced.
export function ensureSignedIn(auth) {
  return new Promise((resolve, reject) => {
    const stop = onAuthStateChanged(auth, async (user) => {
      stop();
      if (user) return resolve(user);
      try { resolve(await signInAnonymously(auth)); } catch (err) { reject(err); }
    }, reject);
  });
}

// A leader or admin sign-in (an email account), as opposed to the anonymous sign-in used by public pages
export const isStaff = (user) => !!user && !user.isAnonymous;

// Top-of-page note on leader and admin views: says who is signed in, or asks for a sign-in
export function showStaffNotice(user, signInUrl = "./CBMW-Sign-In.html") {
  if (!document.body) return;
  const note = document.createElement("div");
  note.setAttribute("role", "status");
  note.style.cssText = "border:1px solid;padding:10px 14px;margin:8px;border-radius:8px;font:14px system-ui,sans-serif;";
  const link = document.createElement("a");
  link.href = signInUrl; // "Manage sign-in" opens the account page; it must not send signed-in people back
  if (isStaff(user)) {
    note.style.background = "#f0fdf4";
    note.style.borderColor = "#86efac";
    note.style.color = "#14532d";
    note.append(`Signed in as ${user.email || "an account"}. `);
    link.textContent = "Manage sign-in";
  } else {
    note.style.background = "#fff7ed";
    note.style.borderColor = "#fdba74";
    note.style.color = "#7c2d12";
    note.append("Changes need a leader or admin sign-in. ");
    // Signing in from here returns the person to this page afterwards
    link.href = signInUrl + "?next=" + encodeURIComponent(location.pathname + location.search);
    link.textContent = "Sign in";
  }
  note.append(link);
  document.body.prepend(note);
}

// Which roles a signed-in account has: a linked leader ID and/or admin. Anonymous visitors have none.
export async function accountRoles(db, user) {
  if (!isStaff(user)) return { leaderId: null, isAdmin: false };
  try {
    const [link, admin] = await Promise.all([
      get(ref(db, "leader_accounts/" + user.uid)),
      get(ref(db, "admins/" + user.uid)),
    ]);
    return { leaderId: link.exists() ? String(link.val()) : null, isAdmin: admin.val() === true };
  } catch (err) {
    console.error("Could not read account roles:", err);
    return { leaderId: null, isAdmin: false };
  }
}

// The view this person may use. Admin only for admins; leader only for linked leaders; otherwise walker.
export function allowedView(requested, roles) {
  if (requested === "admin") return roles.isAdmin ? "admin" : (roles.leaderId ? "leader" : "walker");
  if (requested === "leader") return roles.leaderId ? "leader" : "walker";
  return "walker";
}

// Reloads the page in the view the person is allowed to use
export function redirectToView(view) {
  const u = new URL(location.href);
  u.searchParams.set("view", view);
  location.replace(u.toString());
}
