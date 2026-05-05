// ─── Firebase Imports ─────────────────────────────────────────────────────────
import { initializeApp }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, runTransaction, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ─── Firebase Config ──────────────────────────────────────────────────────────
// Replace these values with your own from:
// Firebase Console → Project Settings → Your Apps → SDK setup
const firebaseConfig = {
  apiKey:            "AIzaSyDzkCVvQqB1T_nM4ZuxHGgToxB2zH71QsI",
  authDomain:        "zestyop-f2133.firebaseapp.com",
  projectId:         "zestyop-f2133",
  storageBucket:     "zestyop-f2133.firebasestorage.app",
  messagingSenderId: "382463023165",
  appId:             "1:382463023165:web:b6e9c4137f08d14cd53254",
};

// ─── Init ─────────────────────────────────────────────────────────────────────
const app      = initializeApp(firebaseConfig);
const auth     = getAuth(app);
const db       = getFirestore(app);
const provider = new GoogleAuthProvider();

// ─── State ────────────────────────────────────────────────────────────────────
let currentUser = null;
let referredBy  = null;

// ─── DOM ──────────────────────────────────────────────────────────────────────
const loadingScreen = document.getElementById("loading-screen");
const stepGoogle    = document.getElementById("step-google");
const stepTwitter   = document.getElementById("step-twitter");
const successCard   = document.getElementById("success-card");

// ─── Helpers ──────────────────────────────────────────────────────────────────
function generateCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function getReferralLink(code) {
  return `${window.location.origin}${window.location.pathname}?ref=${code}`;
}

function show(el)  { el.style.display = "block"; }
function hide(el)  { el.style.display = "none";  }

function showSuccess(data) {
  hide(loadingScreen);
  hide(stepGoogle);
  hide(stepTwitter);
  show(successCard);

  document.getElementById("success-twitter").textContent   = "@" + data.twitter;
  document.getElementById("success-position").textContent  = "#" + (data.position?.toLocaleString() ?? "—");
  document.getElementById("success-referrals").textContent = data.referrals ?? 0;
  document.getElementById("referral-link-box").textContent = getReferralLink(data.referralCode);
}

// ─── On Load ──────────────────────────────────────────────────────────────────
referredBy = new URLSearchParams(window.location.search).get("ref");

async function fetchCount() {
  try {
    const snap = await getDoc(doc(db, "meta", "stats"));
    document.getElementById("counter-num").textContent =
      snap.exists() ? snap.data().count.toLocaleString() : "0";
  } catch {
    document.getElementById("counter-num").textContent = "0";
  }
}

// Check if user is already signed in and on the waitlist
onAuthStateChanged(auth, async (user) => {
  if (user) {
    const snap = await getDoc(doc(db, "waitlist", user.uid));
    if (snap.exists()) {
      showSuccess(snap.data());
      return;
    }
    // Signed in but not on waitlist yet — go to step 2
    currentUser = user;
    populateUserRow(user);
    hide(loadingScreen);
    hide(stepGoogle);
    show(stepTwitter);
    return;
  }

  // Not signed in — show step 1
  await fetchCount();
  if (referredBy) document.getElementById("ref-banner").style.display = "block";
  hide(loadingScreen);
  show(stepGoogle);
});

// ─── Step 1: Google Sign-In ───────────────────────────────────────────────────
window.handleGoogleSignIn = async function () {
  const btn = document.getElementById("google-btn");
  const err = document.getElementById("google-error");

  btn.disabled    = true;
  btn.textContent = "Signing in…";
  err.textContent = "";

  try {
    const result = await signInWithPopup(auth, provider);
    currentUser  = result.user;

    // Already on waitlist?
    const snap = await getDoc(doc(db, "waitlist", currentUser.uid));
    if (snap.exists()) {
      showSuccess(snap.data());
      return;
    }

    // Move to step 2
    populateUserRow(currentUser);
    hide(stepGoogle);
    show(stepTwitter);
    document.getElementById("twitter-input").focus();

  } catch (e) {
    if (e.code !== "auth/popup-closed-by-user") {
      err.textContent = friendlyError(e);
    }
    btn.disabled  = false;
    btn.innerHTML = googleBtnHTML();
  }
};

function populateUserRow(user) {
  const initials = (user.displayName || user.email || "?")
    .split(" ").map((w) => w[0]).join("").substring(0, 2).toUpperCase();

  const avatarEl = document.getElementById("google-avatar");
  if (user.photoURL) {
    avatarEl.innerHTML = `<img src="${user.photoURL}" alt="avatar" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" />`;
  } else {
    avatarEl.textContent = initials;
  }

  document.getElementById("google-name").textContent  = user.displayName || "—";
  document.getElementById("google-email").textContent = user.email || "—";
}

// ─── Step 2: Submit Twitter handle ───────────────────────────────────────────
window.handleSubmit = async function () {
  const twitterInput = document.getElementById("twitter-input");
  const twitterError = document.getElementById("twitter-error");
  const submitError  = document.getElementById("submit-error");
  const submitBtn    = document.getElementById("submit-btn");

  twitterError.textContent = "";
  submitError.textContent  = "";

  const twitter = twitterInput.value.trim();

  if (!twitter || twitter.length < 2) {
    twitterError.textContent = "Enter your Twitter/X handle";
    twitterInput.classList.add("err");
    return;
  }
  twitterInput.classList.remove("err");

  if (!currentUser) {
    submitError.textContent = "Session expired. Please refresh and try again.";
    return;
  }

  submitBtn.disabled  = true;
  submitBtn.innerHTML = `<span class="spinner"></span> Joining…`;

  try {
    // Double-check not already on waitlist
    const existing = await getDoc(doc(db, "waitlist", currentUser.uid));
    if (existing.exists()) {
      showSuccess(existing.data());
      return;
    }

    // Atomic counter for position
    const statsRef = doc(db, "meta", "stats");
    let newPosition;
    await runTransaction(db, async (tx) => {
      const snap   = await tx.get(statsRef);
      const count  = snap.exists() ? snap.data().count : 0;
      newPosition  = count + 1;
      tx.set(statsRef, { count: newPosition }, { merge: true });
    });

    // Build entry
    const referralCode = generateCode();
    const cleanTwitter = twitter.replace(/^@/, "");

    const entry = {
      uid:          currentUser.uid,
      email:        currentUser.email,
      displayName:  currentUser.displayName || "",
      photoURL:     currentUser.photoURL    || "",
      twitter:      cleanTwitter,
      referralCode,
      position:     newPosition,
      referrals:    0,
      referredBy:   referredBy || null,
      createdAt:    serverTimestamp(),
    };

    await setDoc(doc(db, "waitlist", currentUser.uid), entry);
    await setDoc(doc(db, "referralCodes", referralCode), { uid: currentUser.uid });

    if (referredBy) await creditReferrer(referredBy);

    showSuccess(entry);

  } catch (e) {
    console.error(e);
    submitError.textContent = friendlyError(e);
    submitError.style.color = "#ff4444";
  } finally {
    submitBtn.disabled  = false;
    submitBtn.innerHTML = "Join the Waitlist →";
  }
};

// ─── Credit Referrer ──────────────────────────────────────────────────────────
async function creditReferrer(refCode) {
  try {
    const codeSnap = await getDoc(doc(db, "referralCodes", refCode));
    if (!codeSnap.exists()) return;
    const { uid } = codeSnap.data();

    await runTransaction(db, async (tx) => {
      const snap = await tx.get(doc(db, "waitlist", uid));
      if (!snap.exists()) return;
      const d = snap.data();
      tx.update(doc(db, "waitlist", uid), {
        referrals: (d.referrals || 0) + 1,
        position:  Math.max(1, (d.position || 9999) - 10),
      });
    });
  } catch (e) {
    console.error("Referral error:", e);
  }
}

// ─── Copy Link ────────────────────────────────────────────────────────────────
window.copyLink = async function () {
  const box  = document.getElementById("referral-link-box");
  const btn  = document.getElementById("copy-btn");
  const link = box.textContent;
  try { await navigator.clipboard.writeText(link); } catch {}
  btn.textContent = "Copied!";
  btn.classList.add("ok");
  setTimeout(() => { btn.textContent = "Copy link"; btn.classList.remove("ok"); }, 2000);
};

// ─── Share on X ───────────────────────────────────────────────────────────────
window.shareOnTwitter = function () {
  const link = document.getElementById("referral-link-box").textContent;
  const text = encodeURIComponent(
    `I just joined the ZestyOP waitlist — the SocialFi app where your influence earns onchain.\n\nJoin me 👇`
  );
  window.open(`https://twitter.com/intent/tweet?text=${text}&url=${encodeURIComponent(link)}`, "_blank");
};

// ─── Error Messages ───────────────────────────────────────────────────────────
function friendlyError(e) {
  const map = {
    "auth/invalid-api-key":         "❌ Invalid Firebase API key. Check your config.",
    "auth/operation-not-allowed":   "❌ Google sign-in not enabled in Firebase Console.",
    "auth/network-request-failed":  "❌ Network error. Check your connection.",
    "auth/unauthorized-domain":     "❌ This domain isn't authorised in Firebase. Add it under Authentication → Settings → Authorised domains.",
    "permission-denied":            "❌ Firestore permission denied. Check your security rules.",
  };
  return map[e.code] || `❌ ${e.code || e.message || "Unknown error — check browser console (F12)."}`;
}

// ─── Google Button HTML ───────────────────────────────────────────────────────
function googleBtnHTML() {
  return `
    <svg width="18" height="18" viewBox="0 0 48 48">
      <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"/>
      <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 19.001 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"/>
      <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"/>
      <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571l6.19 5.238C42.021 35.556 44 30.038 44 24c0-1.341-.138-2.65-.389-3.917z"/>
    </svg>
    Continue with Google`;
}
