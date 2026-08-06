/* TRACE Creator Ritual V1
 * Integrates with the existing TRACE proof, glyph, share and social systems.
 * It does not create proofs, signatures, hashes or registry records itself.
 */
(() => {
  "use strict";

  const BUILD = "trace-v51-creator-ritual-archive-activity";
  const SESSION_KEY = "trace_social_session_v1";
  const PROFILE_KEY = "trace_social_profile_v1";
  const REVEAL_PREFIX = "trace_proof_reveal_seen_v1:";
  const RETURN_KEY = "trace_creator_return_after_proof_v1";
  const ALLOWED_EVENTS = new Set([
    "proof_creation_started",
    "proof_creation_completed",
    "proof_reveal_started",
    "proof_reveal_completed",
    "proof_reveal_skipped",
    "artifact_downloaded",
    "share_link_copied",
    "story_artifact_downloaded",
    "archive_opened",
    "archive_work_opened",
    "collection_created",
    "work_added_to_collection",
    "creator_returned_after_proof"
  ]);

  const state = {
    proof: null,
    publication: null,
    artifact: null,
    formats: null,
    revealTimers: [],
    lastFocus: null,
    archiveHandle: "",
    archiveRequest: 0,
    archiveData: null,
    activeFormat: "square",
    initialized: false,
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const reducedMotion = () => Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  const safeJson = (value, fallback = null) => { try { return JSON.parse(value); } catch { return fallback; } };
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const attr = escapeHtml;

  function proofId(proof) {
    return String(proof?.badge_key || proof?.badge_id || "").replace(/^sha256:/i, "").toLowerCase();
  }

  function currentSession() {
    return safeJson(localStorage.getItem(SESSION_KEY), null);
  }

  function currentProfile() {
    return safeJson(localStorage.getItem(PROFILE_KEY), null);
  }

  function authHeaders(extra = {}) {
    const token = currentSession()?.access_token;
    return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
  }

  async function api(path, options = {}) {
    const headers = authHeaders(options.headers || {});
    if (options.body && !(options.body instanceof FormData) && !headers["Content-Type"] && !headers["content-type"]) {
      headers["Content-Type"] = "application/json";
    }
    const response = await fetch(path, { ...options, headers });
    const data = response.status === 204 ? { ok: true } : await response.json().catch(() => ({ ok: false, error: "Invalid server response" }));
    if (!response.ok || data?.ok === false) {
      const error = new Error(data?.error || `Request failed (${response.status})`);
      error.status = response.status;
      error.code = data?.code || "";
      throw error;
    }
    return data;
  }

  function track(name, payload = {}) {
    if (!ALLOWED_EVENTS.has(name)) return;
    const clean = {
      event_name: name,
      proof_id: /^[a-f0-9]{64}$/.test(String(payload.proof_id || "")) ? payload.proof_id : null,
      work_id: /^[0-9a-f-]{36}$/i.test(String(payload.work_id || "")) ? payload.work_id : null,
      surface: String(payload.surface || "").slice(0, 40) || null,
      format: String(payload.format || "").slice(0, 30) || null,
      reduced_motion: reducedMotion(),
    };
    const body = JSON.stringify(clean);
    try {
      if (currentSession()?.access_token) {
        fetch("/api/product-events", { method: "POST", headers: authHeaders({ "Content-Type": "application/json" }), body, keepalive: true }).catch(() => {});
      } else if (navigator.sendBeacon) {
        navigator.sendBeacon("/api/product-events", new Blob([body], { type: "application/json" }));
      } else {
        fetch("/api/product-events", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
      }
    } catch {}
  }

  function announce(message) {
    let node = $("#trace_ritual_live_region");
    if (!node) {
      node = document.createElement("div");
      node.id = "trace_ritual_live_region";
      node.className = "trace-ritual-live-region";
      node.setAttribute("aria-live", "polite");
      node.setAttribute("aria-atomic", "true");
      document.body.appendChild(node);
    }
    node.textContent = "";
    requestAnimationFrame(() => { node.textContent = message; });
  }

  function publicVerificationUrl(proof, publication = null) {
    const id = proofId(proof);
    const candidate = publication?.verification_url || proof?.verification_url || proof?.public_verification_url || (id ? `${location.origin}/verify/${id}` : "");
    try {
      const url = new URL(candidate, location.origin);
      if (!id || url.pathname !== `/verify/${id}`) return "";
      return url.href;
    } catch { return ""; }
  }

  function artworkSource(proof) {
    const currentImage = $("#app_image_preview img")?.src;
    if (currentImage && !currentImage.endsWith("/")) return currentImage;
    const style = $("#app_image_preview")?.style?.backgroundImage || "";
    const match = style.match(/^url\(["']?(.*?)["']?\)$/);
    return proof?.img_data_url || proof?.img_preview_url || proof?.thumb_data_url || proof?.wm_data_url || match?.[1] || "";
  }

  function titleFromProof(proof) {
    return String(proof?.payload_text || proof?.title || "Untitled work").split(/\r?\n/)[0].trim().slice(0, 140) || "Untitled work";
  }

  function creatorLabel(proof) {
    const profile = currentProfile();
    return profile?.display_name || (profile?.handle ? `@${profile.handle}` : String(proof?.creator_id || "Creator").slice(0, 18));
  }

  function finalGlyphMarkup(proof) {
    try {
      if (proof?.glyph_spec?.version === "trace-glyph-v1" && window.TraceGlyphV1) {
        return window.TraceGlyphV1.renderGlyphFromSpecification(proof.glyph_spec, { mode: "public", width: 320, height: 320 });
      }
      if (typeof window.renderProofGlyph === "function") return window.renderProofGlyph(proof, "badge", { width: 320, height: 320 });
      if (proof?.glyph_seed && typeof window.makeHelixSvg === "function") {
        const ai = Number(proof?.origin?.ai_probability ?? proof?.origin?.score_0_1);
        return window.makeHelixSvg(proof.glyph_seed, Number.isFinite(ai) && ai >= .65, ai, null, { mode: "badge", style: proof.glyph_style || "spiro_flow" });
      }
    } catch {}
    return `<svg viewBox="0 0 260 260" role="img" aria-label="TRACE proof glyph"><circle cx="130" cy="130" r="72" fill="none" stroke="rgba(105,231,176,.5)"/><circle cx="130" cy="130" r="34" fill="none" stroke="rgba(122,217,248,.4)"/></svg>`;
  }

  function ensureReveal() {
    let modal = $("#trace_proof_reveal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "trace_proof_reveal";
      modal.className = "trace-proof-reveal";
      document.body.appendChild(modal);
    }
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "trace_ritual_title");
    return modal;
  }

  function clearRevealTimers() {
    state.revealTimers.forEach(clearTimeout);
    state.revealTimers = [];
  }

  function setRevealPhase(modal, phase, index, copy = null) {
    modal.dataset.phase = phase;
    modal.dataset.phaseIndex = String(index);
    if (copy) {
      const title = $("#trace_ritual_title", modal);
      const text = $("#trace_ritual_copy", modal);
      if (title) title.textContent = copy.title;
      if (text) text.textContent = copy.text;
    }
  }

  function focusables(root) {
    return $$('button:not([disabled]),a[href],input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])', root).filter((el) => !el.hidden && el.offsetParent !== null);
  }

  function trapKeydown(event) {
    const modal = $("#trace_proof_reveal.show");
    if (!modal) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeReveal("skipped");
      return;
    }
    if (event.key !== "Tab") return;
    const items = focusables(modal);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  async function prepareBaseArtifact(proof) {
    if (!window.TRACE_V2?.makeShareArtifact) throw new Error("Share artifact renderer is unavailable");
    return window.TRACE_V2.makeShareArtifact(proof);
  }

  function dataUrlToBlob(dataUrl) {
    const [header, body] = String(dataUrl || "").split(",");
    const mime = header?.match(/data:([^;]+)/)?.[1] || "image/png";
    const bytes = Uint8Array.from(atob(body || ""), (char) => char.charCodeAt(0));
    return new Blob([bytes], { type: mime });
  }

  function loadImage(src) {
    return new Promise((resolve) => {
      if (!src) return resolve(null);
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = src;
    });
  }

  function roundedRect(ctx, x, y, w, h, radius) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, radius);
    else {
      const r = Math.min(radius, w / 2, h / 2);
      ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
    }
  }

  function drawContain(ctx, image, x, y, w, h) {
    if (!image) return;
    const scale = Math.min(w / image.width, h / image.height);
    const dw = image.width * scale, dh = image.height * scale;
    ctx.drawImage(image, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }

  async function derivativeFormat({ key, width, height, artworkPage, verifyPage, proof, verificationUrl }) {
    const [artImage, verifyImage] = await Promise.all([loadImage(artworkPage), loadImage(verifyPage)]);
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    const bg = ctx.createLinearGradient(0, 0, width, height);
    bg.addColorStop(0, "#020304"); bg.addColorStop(.55, "#071019"); bg.addColorStop(1, "#020304");
    ctx.fillStyle = bg; ctx.fillRect(0, 0, width, height);
    const margin = Math.round(Math.min(width, height) * .055);
    ctx.strokeStyle = "rgba(255,255,255,.10)"; ctx.lineWidth = 2;

    if (key === "story") {
      const artSize = width - margin * 2;
      ctx.save(); roundedRect(ctx, margin, margin + 70, artSize, artSize, 34); ctx.clip(); drawContain(ctx, artImage, margin, margin + 70, artSize, artSize); ctx.restore();
      const qrSize = Math.round(width * .43);
      ctx.save(); roundedRect(ctx, width - margin - qrSize, height - margin - qrSize - 100, qrSize, qrSize, 26); ctx.clip(); drawContain(ctx, verifyImage, width - margin - qrSize, height - margin - qrSize - 100, qrSize, qrSize); ctx.restore();
      ctx.fillStyle = "#edf6ff"; ctx.font = "800 48px system-ui"; ctx.fillText(titleFromProof(proof).slice(0, 34), margin, height - margin - 125);
      ctx.fillStyle = "rgba(237,246,255,.62)"; ctx.font = "600 24px system-ui"; ctx.fillText("TRACE CREATOR PROOF", margin, height - margin - 78);
    } else {
      const leftW = Math.round(width * .57), square = Math.min(height - margin * 2, leftW - margin * 2);
      ctx.save(); roundedRect(ctx, margin, (height - square) / 2, square, square, 30); ctx.clip(); drawContain(ctx, artImage, margin, (height - square) / 2, square, square); ctx.restore();
      const qrSize = Math.min(Math.round(width * .30), Math.round(height * .58));
      const qx = width - margin - qrSize, qy = Math.round((height - qrSize) / 2) - 25;
      ctx.save(); roundedRect(ctx, qx, qy, qrSize, qrSize, 25); ctx.clip(); drawContain(ctx, verifyImage, qx, qy, qrSize, qrSize); ctx.restore();
      ctx.fillStyle = "#edf6ff"; ctx.font = "800 42px system-ui"; ctx.fillText(titleFromProof(proof).slice(0, 34), leftW, height - 126);
      ctx.fillStyle = "rgba(237,246,255,.62)"; ctx.font = "600 20px system-ui"; ctx.fillText("Public TRACE creator proof", leftW, height - 85);
      ctx.fillStyle = "rgba(237,246,255,.42)"; ctx.font = "500 14px system-ui"; ctx.fillText(String(verificationUrl).replace(/^https?:\/\//, "").slice(0, 52), leftW, height - 52);
    }
    return canvas.toDataURL("image/png");
  }

  async function buildFormats(proof, artifact, verificationUrl) {
    const artwork = artifact?.pages?.find((page) => page.key === "artwork") || artifact?.pages?.[0];
    const verify = artifact?.pages?.find((page) => page.key === "verify") || artifact?.pages?.[1] || artwork;
    if (!artwork?.dataUrl) throw new Error("Artifact image is unavailable");
    const base = `trace-${proofId(proof).slice(0, 10)}`;
    const [story, landscape] = await Promise.all([
      derivativeFormat({ key: "story", width: 1080, height: 1920, artworkPage: artwork.dataUrl, verifyPage: verify?.dataUrl, proof, verificationUrl }),
      derivativeFormat({ key: "landscape", width: 1600, height: 900, artworkPage: artwork.dataUrl, verifyPage: verify?.dataUrl, proof, verificationUrl })
    ]);
    return {
      square: { key: "square", label: "Square feed", meta: "1080 × 1080", dataUrl: artwork.dataUrl, filename: artwork.filename || `${base}-square.png` },
      story: { key: "story", label: "Portrait Story", meta: "1080 × 1920", dataUrl: story, filename: `${base}-story.png` },
      landscape: { key: "landscape", label: "Landscape proof card", meta: "1600 × 900", dataUrl: landscape, filename: `${base}-landscape.png` },
      artwork: { key: "artwork", label: "Artwork + TRACE footer", meta: "Artwork-first", dataUrl: artwork.dataUrl, filename: `${base}-artwork.png` },
      qr: { key: "qr", label: "QR verification card", meta: "1080 × 1080", dataUrl: verify?.dataUrl || artwork.dataUrl, filename: verify?.filename || `${base}-verify.png` },
    };
  }

  function defaultCaption(verificationUrl) {
    return `This work is now linked to a public TRACE creator proof.\nScan or open the verification link to view its origin record.\n${verificationUrl}`;
  }

  async function showReveal(proof, publication, artifact) {
    const id = proofId(proof);
    const verificationUrl = publicVerificationUrl(proof, publication);
    if (!id || !proof?.creator_id || !proof?.sig_b64 || !proof?.pub_jwk || !verificationUrl) return;
    if (localStorage.getItem(REVEAL_PREFIX + id)) return;

    state.proof = proof;
    state.publication = publication;
    state.artifact = artifact;
    state.formats = null;
    state.lastFocus = document.activeElement;
    const modal = ensureReveal();
    const art = artworkSource(proof);
    const date = new Date(Number(proof.ts || Date.now())).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    const shortHash = String(proof.img_hash || "").replace(/^sha256:/i, "").slice(0, 16).toUpperCase() || "Recorded";
    const shortCreator = String(proof.creator_id || "").replace(/^sha256:/i, "").slice(0, 16).toUpperCase();
    const preview = artifact?.pages?.find((page) => page.key === "artwork")?.dataUrl || artifact?.pages?.[0]?.dataUrl || "";
    modal.innerHTML = `<div class="trace-ritual-dialog">
      <div class="trace-ritual-top">
        <div class="trace-ritual-brand"><i>T</i><b>Creator Proof Reveal</b></div>
        <button type="button" class="trace-ritual-skip" data-ritual-skip>Skip reveal</button>
      </div>
      <div class="trace-ritual-stage">
        <div class="trace-ritual-scene">
          <div class="trace-ritual-art-column">
            <div class="trace-ritual-artwork ${art ? "" : "empty"}">${art ? `<img src="${attr(art)}" alt="${attr(titleFromProof(proof))}">` : ""}<div class="trace-ritual-scan"></div></div>
            <div class="trace-ritual-art-caption"><div><b>${escapeHtml(titleFromProof(proof))}</b><span>${escapeHtml(creatorLabel(proof))} · ${escapeHtml(date)}</span></div><div class="trace-ritual-lock" aria-label="Signed proof">✓</div></div>
          </div>
          <div class="trace-ritual-proof-column">
            <div class="trace-ritual-proof-copy"><div class="trace-ritual-kicker">Linking creator, work and time</div><h2 id="trace_ritual_title" class="trace-ritual-title">Preparing the proof reveal</h2><p id="trace_ritual_copy" class="trace-ritual-copy">The proof exists. TRACE is assembling its final public artifact.</p></div>
            <div class="trace-ritual-glyph-shell"><div class="trace-ritual-glyph">${finalGlyphMarkup(proof)}</div></div>
            <div class="trace-ritual-integrity">
              <div><span>File fingerprint</span><b>${escapeHtml(shortHash)}</b></div>
              <div><span>Creator ID</span><b>${escapeHtml(shortCreator)}</b></div>
              <div><span>Signed</span><b>Local signature valid</b></div>
              <div><span>Public record</span><b>Verification active</b></div>
            </div>
            <div class="trace-ritual-artifact-preview">${preview ? `<img src="${attr(preview)}" alt="Completed TRACE share artifact">` : ""}<div><b>Shareable proof artifact</b><span>Artwork, proof-derived glyph, creation date and QR verification in one public-facing record.</span></div></div>
          </div>
        </div>
      </div>
      <div>
        <div class="trace-ritual-progress" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
        <div class="trace-ritual-actions">
          <button type="button" class="primary" data-ritual-share>Share proof</button>
          <button type="button" data-ritual-download>Download artifact</button>
          <button type="button" data-ritual-archive>View in archive</button>
          <div class="trace-ritual-secondary">
            <button type="button" data-ritual-copy-link>Copy verification link</button>
            <button type="button" data-ritual-open-public>Open public proof</button>
            <button type="button" data-ritual-close>Close</button>
          </div>
        </div>
      </div>
    </div>`;

    modal.classList.add("show");
    modal.dataset.phase = "transition";
    modal.dataset.phaseIndex = "1";
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", trapKeydown, true);
    $("[data-ritual-skip]", modal)?.focus();
    announce("Proof created. This work now has a verifiable origin.");
    track("proof_reveal_started", { proof_id: id, surface: "proof_reveal" });

    const glyph = $(".trace-ritual-glyph svg", modal);
    if (glyph && !reducedMotion()) {
      try { window.TraceGlyphV1?.startGlyphMotion?.(glyph); window.startGlyphMotion?.(glyph); } catch {}
    }

    clearRevealTimers();
    if (reducedMotion()) {
      setRevealPhase(modal, "final", 5, { title: "This work now has a verifiable origin", text: "The signed Creator Proof is published and ready to share." });
      return;
    }
    const phases = [
      [500, "integrity", 2, "Linking the work", "The file fingerprint, Creator ID and creation time are being resolved."],
      [1350, "glyph", 3, "Revealing its proof glyph", "The final deterministic glyph resolves from the real signed proof."],
      [2500, "statement", 4, "This work now has a verifiable origin", "A creator-linked proof is signed, published and available through its public verification link."],
      [3400, "artifact", 5, "A new archive record", "The work is ready to share and has joined your documented creative history."],
      [4100, "final", 5, "This work now has a verifiable origin", "Share it, download the artifact, or open the work in your creator archive."]
    ];
    for (const [delay, phase, index, title, text] of phases) {
      state.revealTimers.push(setTimeout(() => setRevealPhase(modal, phase, index, { title, text }), delay));
    }
  }

  function markRevealSeen(reason) {
    const id = proofId(state.proof);
    if (id) localStorage.setItem(REVEAL_PREFIX + id, new Date().toISOString());
    if (id) localStorage.setItem(RETURN_KEY, JSON.stringify({ proof_id: id, at: Date.now() }));
    if (reason === "skipped") track("proof_reveal_skipped", { proof_id: id, surface: "proof_reveal" });
    else track("proof_reveal_completed", { proof_id: id, surface: "proof_reveal" });
  }

  function closeReveal(reason = "completed", navigate = true) {
    const modal = $("#trace_proof_reveal");
    if (!modal?.classList.contains("show")) return;
    clearRevealTimers();
    markRevealSeen(reason);
    modal.classList.remove("show");
    document.body.style.overflow = "";
    document.removeEventListener("keydown", trapKeydown, true);
    try { state.lastFocus?.focus?.(); } catch {}
    if (navigate) setTimeout(openOwnArchive, 160);
  }

  function showPendingPublication(proof, error) {
    const id = proofId(proof);
    if (!id) return;
    const modal = ensureReveal();
    state.proof = proof;
    state.publication = null;
    modal.innerHTML = `<div class="trace-ritual-pending" role="document"><div class="trace-ritual-kicker">Local proof preserved</div><h2>The proof could not yet be published.</h2><p>The signed proof was created locally, but its public verification record is not active yet. Nothing successful has been discarded.</p><p class="trace-ritual-copy">${escapeHtml(error?.message || "The registry could not be reached.")}</p><div class="trace-ritual-pending-actions"><button class="trace-ritual-close" type="button" data-ritual-retry>Retry publication</button><button class="trace-ritual-close" type="button" data-ritual-close-pending>Close</button></div></div>`;
    modal.dataset.phase = "pending";
    modal.dataset.phaseIndex = "0";
    modal.classList.add("show");
    document.body.style.overflow = "hidden";
    $("[data-ritual-retry]", modal)?.focus();
  }

  async function retryPublication() {
    if (!state.proof || typeof window.tracePublishPublicProof !== "function") return;
    const button = $("[data-ritual-retry]");
    if (button) { button.disabled = true; button.textContent = "Publishing proof…"; }
    try {
      const publication = await window.tracePublishPublicProof(state.proof);
      const artifact = await prepareBaseArtifact(state.proof);
      $("#trace_proof_reveal")?.classList.remove("show");
      document.body.style.overflow = "";
      await showReveal(state.proof, publication, artifact);
    } catch (error) {
      if (button) { button.disabled = false; button.textContent = "Retry publication"; }
      const copy = $(".trace-ritual-pending .trace-ritual-copy");
      if (copy) copy.textContent = error?.message || "Publication failed again.";
    }
  }

  function ensureShareSheet() {
    let sheet = $("#trace_share_sheet");
    if (!sheet) {
      sheet = document.createElement("div");
      sheet.id = "trace_share_sheet";
      sheet.className = "trace-share-sheet";
      sheet.setAttribute("role", "dialog");
      sheet.setAttribute("aria-modal", "true");
      sheet.setAttribute("aria-labelledby", "trace_share_sheet_title");
      document.body.appendChild(sheet);
    }
    return sheet;
  }

  async function openShareSheet(mode = "share") {
    if (!state.proof || !state.artifact) return;
    const verificationUrl = publicVerificationUrl(state.proof, state.publication);
    if (!state.formats) state.formats = await buildFormats(state.proof, state.artifact, verificationUrl);
    state.activeFormat = mode === "download" ? "square" : state.activeFormat;
    const formats = Object.values(state.formats);
    const sheet = ensureShareSheet();
    sheet.innerHTML = `<div class="trace-share-sheet-card">
      <div class="trace-share-sheet-head"><div><h2 id="trace_share_sheet_title">${mode === "download" ? "Download artifact" : "Share proof"}</h2><p>Choose a format. The artwork stays central and the public proof remains checkable.</p></div><button type="button" class="trace-ritual-close" data-share-sheet-close aria-label="Close">×</button></div>
      <div class="trace-share-formats">${formats.map((format) => `<button type="button" class="trace-share-format ${format.key === state.activeFormat ? "active" : ""}" data-share-format="${attr(format.key)}"><img src="${attr(format.dataUrl)}" alt="${attr(format.label)} preview"><div><b>${escapeHtml(format.label)}</b><span>${escapeHtml(format.meta)}</span></div></button>`).join("")}</div>
      <label class="trace-caption-editor"><span>Caption</span><textarea id="trace_share_caption">${escapeHtml(defaultCaption(verificationUrl))}</textarea></label>
      <div class="trace-share-sheet-actions"><button type="button" class="primary" data-share-native>${mode === "download" ? "Download selected" : "Share selected"}</button><button type="button" data-share-copy-caption>Copy caption</button><button type="button" data-share-copy-link>Copy link</button></div>
    </div>`;
    sheet.dataset.mode = mode;
    sheet.classList.add("show");
    $("[data-share-sheet-close]", sheet)?.focus();
  }

  function closeShareSheet() { $("#trace_share_sheet")?.classList.remove("show"); }

  function selectedFormat() { return state.formats?.[state.activeFormat] || state.formats?.square; }

  function downloadFormat(format) {
    if (!format?.dataUrl) return;
    const link = document.createElement("a");
    link.href = format.dataUrl;
    link.download = format.filename;
    document.body.appendChild(link); link.click(); link.remove();
    track(format.key === "story" ? "story_artifact_downloaded" : "artifact_downloaded", { proof_id: proofId(state.proof), format: format.key, surface: "share_sheet" });
  }

  async function nativeShareSelected() {
    const format = selectedFormat();
    if (!format) return;
    const sheet = $("#trace_share_sheet");
    const mode = sheet?.dataset.mode || "share";
    if (mode === "download") { downloadFormat(format); return; }
    const caption = $("#trace_share_caption", sheet)?.value || defaultCaption(publicVerificationUrl(state.proof, state.publication));
    const url = publicVerificationUrl(state.proof, state.publication);
    try {
      const file = new File([dataUrlToBlob(format.dataUrl)], format.filename, { type: "image/png" });
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ title: titleFromProof(state.proof), text: caption, url, files: [file] });
      } else if (navigator.share) {
        await navigator.share({ title: titleFromProof(state.proof), text: caption, url });
      } else {
        await navigator.clipboard.writeText(caption);
        downloadFormat(format);
      }
      track("share_link_copied", { proof_id: proofId(state.proof), format: format.key, surface: "share_sheet" });
    } catch (error) {
      if (error?.name !== "AbortError") downloadFormat(format);
    }
  }

  async function copyText(text, success) {
    try { await navigator.clipboard.writeText(text); announce(success); } catch {}
  }

  function ownHandle() { return currentProfile()?.handle || ""; }

  function openOwnArchive() {
    const handle = ownHandle();
    if (!handle) return;
    location.hash = `creator/${encodeURIComponent(handle)}`;
    const profileButton = $('[data-social-view="profile"]');
    profileButton?.click?.();
    setTimeout(() => enhanceArchive(), 120);
  }

  function verificationLinkForWork(work) {
    const id = String(work?.proof_id || "").replace(/^sha256:/i, "");
    return /^[a-f0-9]{64}$/.test(id) ? `/verify/${id}` : "";
  }

  function statusForWork(work) {
    if (["expired", "expired_preserved"].includes(work?.proof_status)) return "Expired · record preserved";
    if (work?.proof_status === "active") return "Active proof";
    if (work?.proof_status === "registry_unavailable") return "Proof record unavailable";
    return "Proof record";
  }

  function workGlyphMarkup(work) {
    try {
      if (work?.glyph_spec?.version === "trace-glyph-v1" && window.TraceGlyphV1) return window.TraceGlyphV1.renderGlyphFromSpecification(work.glyph_spec, { mode: "avatar", width: 72, height: 72, reducedMotion: true });
      if (work?.glyph_seed && typeof window.makeHelixSvg === "function") return window.makeHelixSvg(work.glyph_seed, false, NaN, null, { mode: "avatar", style: work.glyph_style || "spiro_flow" });
    } catch {}
    const seed = String(work?.proof_id || work?.id || "trace");
    let hash = 0; for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
    const hue = hash % 360;
    return `<svg viewBox="0 0 64 64" role="img" aria-label="Proof glyph"><circle cx="32" cy="32" r="22" fill="none" stroke="hsl(${hue} 70% 65% / .7)"/><path d="M14 34Q32 8 50 34Q32 56 14 34Z" fill="none" stroke="hsl(${(hue + 90) % 360} 70% 70% / .65)"/></svg>`;
  }

  function archiveWorkCard(work) {
    const image = work.thumbnail_url || work.artwork_url || "";
    const verify = verificationLinkForWork(work);
    return `<article class="trace-archive-work">
      <div class="trace-archive-work-art ${image ? "" : "empty"}">${image ? `<img loading="lazy" src="${attr(image)}" alt="${attr(work.alt_text || work.title || "Artwork")}">` : ""}<div class="trace-archive-work-glyph">${workGlyphMarkup(work)}</div></div>
      <div class="trace-archive-work-body"><b>${escapeHtml(work.title || "Untitled work")}</b><span>${escapeHtml(statusForWork(work))} · ${escapeHtml(new Date(work.created_at).toLocaleDateString())}</span><div class="trace-archive-work-actions"><button type="button" data-archive-open-work="${attr(work.id)}">Open</button>${verify ? `<a href="${attr(verify)}" target="_blank" rel="noopener">Verify</a>` : ""}${work.viewer?.is_owner ? `<button type="button" data-add-collection="${attr(work.id)}">Collection</button>` : ""}</div></div>
    </article>`;
  }

  function galleryView(works) {
    if (!works.length) return `<div class="trace-archive-empty"><b>Your creator archive is ready.</b><span>Your first published Creator Proof will begin the timeline.</span></div>`;
    return `<div class="trace-archive-grid">${works.map(archiveWorkCard).join("")}</div>`;
  }

  function timelineView(works) {
    if (!works.length) return galleryView(works);
    const groups = new Map();
    for (const work of works) {
      const date = new Date(work.created_at);
      const year = String(date.getFullYear());
      const month = date.toLocaleDateString(undefined, { month: "long" });
      if (!groups.has(year)) groups.set(year, new Map());
      if (!groups.get(year).has(month)) groups.get(year).set(month, []);
      groups.get(year).get(month).push(work);
    }
    return `<div class="trace-archive-timeline">${Array.from(groups, ([year, months]) => `<section class="trace-archive-year"><div class="trace-archive-year-label">${escapeHtml(year)}</div><div class="trace-archive-months">${Array.from(months, ([month, items]) => `<div class="trace-archive-month"><h3>${escapeHtml(month)}</h3><div class="trace-archive-month-list">${items.map((work) => { const image = work.thumbnail_url || work.artwork_url || ""; return `<article class="trace-timeline-work">${image ? `<img loading="lazy" src="${attr(image)}" alt="">` : `<div></div>`}<div><b>${escapeHtml(work.title || "Untitled work")}</b><span>${escapeHtml(statusForWork(work))} · ${escapeHtml(new Date(work.created_at).toLocaleDateString())}</span></div><button type="button" data-archive-open-work="${attr(work.id)}">Open proof</button></article>`; }).join("")}</div></div>`).join("")}</div></section>`).join("")}</div>`;
  }

  function constellationPosition(index, total, proofIdValue) {
    const golden = 2.399963229728653;
    const ratio = total <= 1 ? 0 : Math.sqrt((index + .65) / total);
    let seed = 0; for (const char of String(proofIdValue || index)) seed = (seed * 33 + char.charCodeAt(0)) >>> 0;
    const angle = index * golden + (seed % 1000) / 1000;
    const radius = 8 + ratio * 38;
    return { left: 50 + Math.cos(angle) * radius, top: 50 + Math.sin(angle) * radius };
  }

  function constellationView(works) {
    if (!works.length) return galleryView(works);
    const label = works.length === 1 ? "Your creator archive has begun." : `${works.length} real proof glyphs in this archive.`;
    return `<div class="trace-constellation" aria-label="Creator proof glyph constellation">${works.map((work, index) => { const pos = constellationPosition(index, works.length, work.proof_id); return `<button type="button" class="trace-constellation-node" style="left:${pos.left.toFixed(2)}%;top:${pos.top.toFixed(2)}%" data-archive-open-work="${attr(work.id)}" aria-label="Open ${attr(work.title || "work")}">${workGlyphMarkup(work)}</button>`; }).join("")}<div class="trace-constellation-label">${escapeHtml(label)}</div></div>`;
  }

  function activityMessage(event) {
    const title = event.work?.title || event.work_title || "your work";
    const source = event.event_type === "qr_open" || event.source === "qr" ? "A QR scan opened" : event.event_type === "verification_completed" ? "Someone checked" : "Someone opened";
    const region = event.country_code ? ` from ${event.country_name || event.country_code}` : "";
    return `${source} “${title}”${region}.`;
  }

  function relativeTime(value) {
    const ms = Date.now() - new Date(value).getTime();
    const mins = Math.max(0, Math.floor(ms / 60000));
    if (mins < 1) return "now";
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60); if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24); if (days < 30) return `${days}d`;
    return new Date(value).toLocaleDateString();
  }

  function activityPanel(archive) {
    if (!archive.is_owner) return "";
    const activity = archive.activity || { events: [], weekly_total: 0, total: 0 };
    const events = activity.events || [];
    return `<section class="trace-activity-panel"><div class="trace-activity-head"><div><div class="trace-archive-kicker">Verification activity</div><h3>People are checking the record</h3></div><div class="trace-activity-summary"><span>${Number(activity.weekly_total || 0)} this week</span><span>${Number(activity.total || 0)} total filtered events</span></div></div><div class="trace-activity-list">${events.length ? events.slice(0, 8).map((event) => `<div class="trace-activity-item"><i>✓</i><div><b>${escapeHtml(activityMessage(event))}</b><span>${escapeHtml(event.source_label || (event.source === "qr" ? "QR scan" : "Public proof"))}${event.is_suspected_bot ? " · filtered bot" : ""}</span></div><time datetime="${attr(event.created_at)}">${escapeHtml(relativeTime(event.created_at))}</time></div>`).join("") : `<div class="trace-archive-empty"><b>No verification activity yet.</b><span>Real public proof opens will appear here after filtering duplicates and suspected bots.</span></div>`}</div></section>`;
  }

  function milestonePanel(archive) {
    if (!archive.is_owner || !archive.milestones?.length) return "";
    return `<section class="trace-activity-panel"><div class="trace-archive-kicker">Archive milestones</div><div class="trace-milestones">${archive.milestones.map((milestone) => `<div class="trace-milestone"><div><b>${escapeHtml(milestone.title)}</b><span>${escapeHtml(milestone.description)}</span></div><button type="button" data-dismiss-milestone="${attr(milestone.id)}" aria-label="Dismiss milestone">×</button></div>`).join("")}</div></section>`;
  }

  function archiveSummaryCopy(summary) {
    const total = Number(summary.total_historical_proofs || 0);
    if (total === 0) return "A permanent creative history begins with the first published proof.";
    if (total === 1) return "Your creator archive has begun.";
    return `${total} creator-linked works now form a chronological creative history.`;
  }

  function featuredMarkup(work) {
    if (!work) return "";
    const image = work.artwork_url || work.thumbnail_url || "";
    return `<section class="trace-archive-featured">${image ? `<img src="${attr(image)}" alt="${attr(work.alt_text || work.title || "Featured artwork")}">` : `<div class="trace-archive-work-art empty"></div>`}<div><div class="trace-archive-kicker">Featured work</div><h3>${escapeHtml(work.title || "Untitled work")}</h3><p>${escapeHtml(work.caption || "A selected work from this creator archive.")}</p><div class="trace-archive-featured-actions"><button type="button" data-archive-open-work="${attr(work.id)}">Open work</button>${verificationLinkForWork(work) ? `<a href="${attr(verificationLinkForWork(work))}" target="_blank" rel="noopener">Verify proof</a>` : ""}</div></div></section>`;
  }

  function collectionsMarkup(collections) {
    if (!collections?.length) return "";
    return `<section class="trace-activity-panel"><div class="trace-archive-kicker">Creative periods and collections</div><div class="trace-share-formats">${collections.map((collection) => `<button type="button" class="trace-share-format" data-open-collection="${attr(collection.id)}"><div style="width:74px;height:74px;border-radius:12px;background:linear-gradient(135deg,rgba(105,231,176,.08),rgba(122,217,248,.06));display:grid;place-items:center;color:rgba(237,246,255,.45);font-weight:950">${escapeHtml(String(collection.item_count || 0))}</div><div><b>${escapeHtml(collection.name)}</b><span>${escapeHtml([collection.period_name, collection.period_year].filter(Boolean).join(" · ") || `${collection.item_count || 0} works`)}</span></div></button>`).join("")}</div></section>`;
  }

  function renderArchive(mount, archive) {
    const creator = archive.creator || {};
    const summary = archive.summary || {};
    const works = archive.works || [];
    const featured = works.find((work) => work.featured) || works[0] || null;
    const firstDate = summary.first_proof_date ? new Date(summary.first_proof_date).toLocaleDateString() : "—";
    const latestDate = summary.latest_proof_date ? new Date(summary.latest_proof_date).toLocaleDateString() : "—";
    mount.innerHTML = `<section class="trace-archive-shell" data-archive-handle="${attr(creator.handle || "")}">
      <section class="trace-archive-hero"><div><div class="trace-archive-kicker">Creator Archive</div><h2>${escapeHtml(archiveSummaryCopy(summary))}</h2><p>Works are organized as a documented creative history—not an endless social feed.</p></div><div class="trace-archive-stats"><div><span>First proof</span><b>${escapeHtml(firstDate)}</b></div><div><span>Latest proof</span><b>${escapeHtml(latestDate)}</b></div><div><span>Active proofs</span><b>${Number(summary.active_proofs || 0)}</b></div><div><span>Historical proofs</span><b>${Number(summary.total_historical_proofs || works.length)}</b></div>${summary.verification_events !== null && summary.verification_events !== undefined ? `<div><span>Verification events</span><b>${Number(summary.verification_events || 0)}</b></div>` : ""}</div></section>
      ${featuredMarkup(featured)}
      <div class="trace-archive-tabs" role="tablist" aria-label="Archive views"><button type="button" class="active" data-archive-tab="gallery" role="tab" aria-selected="true">Gallery</button><button type="button" data-archive-tab="timeline" role="tab" aria-selected="false">Timeline</button><button type="button" data-archive-tab="constellation" role="tab" aria-selected="false">Glyph constellation</button></div>
      <div class="trace-archive-view active" data-archive-view="gallery">${galleryView(works)}</div>
      <div class="trace-archive-view" data-archive-view="timeline">${timelineView(works)}</div>
      <div class="trace-archive-view" data-archive-view="constellation">${constellationView(works)}</div>
      ${archive.is_owner && works.length ? `<div class="trace-continuity-note"><div><b>Added to your creator archive.</b><span>Your archive now contains ${works.length} creator-linked work${works.length === 1 ? "" : "s"}.</span></div><button type="button" data-archive-add-next>Add your next work</button></div>` : ""}
      ${activityPanel(archive)}
      ${collectionsMarkup(archive.collections)}
      ${milestonePanel(archive)}
    </section>`;
    track("archive_opened", { surface: archive.is_owner ? "own_archive" : "public_archive" });
  }

  async function enhanceArchive(force = false) {
    const view = $("#app_social_profile_view.active") || $("#app_social_profile_view");
    const page = $(".trace-social-page", view);
    if (!page || !view?.classList.contains("active")) return;
    const handleText = $(".trace-profile-handle", page)?.textContent || "";
    const handle = handleText.replace(/^@/, "").trim() || location.hash.match(/^#creator\/(.+)$/)?.[1];
    if (!handle) return;
    const decoded = decodeURIComponent(handle);
    let mount = $(".trace-archive-integration", page);
    if (!mount) {
      mount = document.createElement("div");
      mount.className = "trace-archive-integration";
      const panels = $$(":scope > .trace-social-panel", page);
      (panels[0] || page.firstElementChild)?.insertAdjacentElement("afterend", mount);
    }
    if (!force && mount.dataset.loadedHandle === decoded) return;
    mount.dataset.loadedHandle = decoded;
    mount.innerHTML = `<div class="trace-social-loading">Loading creator archive…</div>`;
    const request = ++state.archiveRequest;
    try {
      const data = await api(`/api/archive/${encodeURIComponent(decoded)}?limit=120`);
      if (request !== state.archiveRequest) return;
      state.archiveData = data.archive;
      state.archiveHandle = decoded;
      renderArchive(mount, data.archive);
    } catch (error) {
      mount.innerHTML = `<div class="trace-social-error">${escapeHtml(error.message || "Creator archive could not be loaded")}</div>`;
    }
  }

  async function dismissMilestone(id, button) {
    try {
      await api(`/api/milestones/${encodeURIComponent(id)}/dismiss`, { method: "POST", body: "{}" });
      button.closest(".trace-milestone")?.remove();
    } catch {}
  }

  async function injectHomeActivity() {
    const root = $("#app_home_view.active .trace-social-page");
    if (!root || !currentSession()) return;
    let mount = $("#trace_ritual_home_activity", root);
    if (!mount) {
      mount = document.createElement("div");
      mount.id = "trace_ritual_home_activity";
      const head = $(".trace-social-page-head", root);
      head?.insertAdjacentElement("afterend", mount);
    }
    if (mount.dataset.loading === "1") return;
    mount.dataset.loading = "1";
    try {
      const data = await api("/api/activity?limit=5");
      const activity = data.activity || {};
      const returned = safeJson(localStorage.getItem(RETURN_KEY), null);
      const returnedCopy = returned && Date.now() - Number(returned.at || 0) < 30 * 24 * 60 * 60 * 1000
        ? `<div class="trace-continuity-note"><div><b>Your last proof is part of the archive.</b><span>Add the next completed work whenever it is ready.</span></div><button type="button" data-archive-add-next>Add your next work</button></div>` : "";
      mount.innerHTML = `${returnedCopy}<section class="trace-activity-panel"><div class="trace-activity-head"><div><div class="trace-archive-kicker">Verification activity</div><h3>Recent checks of your work</h3></div><div class="trace-activity-summary"><span>${Number(activity.weekly_total || 0)} this week</span><span>${Number(activity.total || 0)} total</span></div></div><div class="trace-activity-list">${(activity.events || []).length ? activity.events.map((event) => `<div class="trace-activity-item"><i>✓</i><div><b>${escapeHtml(activityMessage(event))}</b><span>${escapeHtml(event.source_label || "Public proof")}</span></div><time>${escapeHtml(relativeTime(event.created_at))}</time></div>`).join("") : `<div class="trace-archive-empty"><b>No verification activity yet.</b><span>Real checks will appear here without exposing visitor IP addresses.</span></div>`}</div></section>`;
      if (returned) { track("creator_returned_after_proof", { proof_id: returned.proof_id, surface: "home" }); localStorage.removeItem(RETURN_KEY); }
    } catch { mount.innerHTML = ""; }
    finally { mount.dataset.loading = "0"; }
  }

  async function onProofPublished(proof, publication) {
    if (!proof) return;
    const id = proofId(proof);
    track("proof_creation_completed", { proof_id: id, surface: "create" });
    try {
      const url = publicVerificationUrl(proof, publication);
      if (!url) return;
      const artifact = await prepareBaseArtifact(proof);
      await showReveal(proof, publication, artifact);
    } catch (error) {
      console.warn("TRACE proof reveal artifact preparation failed", error);
    }
  }

  function wireEvents() {
    document.addEventListener("trace:proof-published", (event) => onProofPublished(event.detail?.proof, event.detail?.publication));
    document.addEventListener("trace:proof-publish-failed", (event) => showPendingPublication(event.detail?.proof, event.detail?.error));
    document.addEventListener("trace:social-work-published", () => setTimeout(() => enhanceArchive(true), 250));

    document.addEventListener("click", async (event) => {
      const target = event.target.closest?.("button,a");
      if (!target) return;
      if (target.closest("#app_create_badge")) track("proof_creation_started", { surface: "create" });
      if (target.matches("[data-ritual-skip]")) { closeReveal("skipped", false); return; }
      if (target.matches("[data-ritual-close]")) { closeReveal("completed", true); return; }
      if (target.matches("[data-ritual-close-pending]")) { $("#trace_proof_reveal")?.classList.remove("show"); document.body.style.overflow = ""; return; }
      if (target.matches("[data-ritual-retry]")) { retryPublication(); return; }
      if (target.matches("[data-ritual-share]")) { await openShareSheet("share"); return; }
      if (target.matches("[data-ritual-download]")) { await openShareSheet("download"); return; }
      if (target.matches("[data-ritual-archive]")) { closeReveal("completed", true); return; }
      if (target.matches("[data-ritual-copy-link]")) { const url = publicVerificationUrl(state.proof, state.publication); await copyText(url, "Verification link copied"); track("share_link_copied", { proof_id: proofId(state.proof), surface: "proof_reveal" }); return; }
      if (target.matches("[data-ritual-open-public]")) { window.open(publicVerificationUrl(state.proof, state.publication), "_blank", "noopener"); return; }
      if (target.matches("[data-share-sheet-close]")) { closeShareSheet(); return; }
      if (target.dataset.shareFormat) { state.activeFormat = target.dataset.shareFormat; $$("[data-share-format]", target.closest(".trace-share-sheet")).forEach((button) => button.classList.toggle("active", button === target)); return; }
      if (target.matches("[data-share-native]")) { await nativeShareSelected(); return; }
      if (target.matches("[data-share-copy-caption]")) { await copyText($("#trace_share_caption")?.value || "", "Caption copied"); return; }
      if (target.matches("[data-share-copy-link]")) { const url = publicVerificationUrl(state.proof, state.publication); await copyText(url, "Verification link copied"); track("share_link_copied", { proof_id: proofId(state.proof), surface: "share_sheet" }); return; }
      if (target.dataset.archiveTab) {
        const shell = target.closest(".trace-archive-shell");
        $$('[data-archive-tab]', shell).forEach((button) => { const active = button === target; button.classList.toggle("active", active); button.setAttribute("aria-selected", String(active)); });
        $$('[data-archive-view]', shell).forEach((view) => view.classList.toggle("active", view.dataset.archiveView === target.dataset.archiveTab));
        return;
      }
      if (target.dataset.archiveOpenWork) {
        const id = target.dataset.archiveOpenWork;
        track("archive_work_opened", { work_id: id, surface: "archive" });
        location.hash = `work/${encodeURIComponent(id)}`;
        document.querySelector(`[data-open-work="${CSS.escape(id)}"]`)?.click?.();
        window.dispatchEvent(new HashChangeEvent("hashchange"));
        return;
      }
      if (target.dataset.dismissMilestone) { dismissMilestone(target.dataset.dismissMilestone, target); return; }
      if (target.matches("[data-archive-add-next]")) { document.querySelector('[data-trace-tab="use"]')?.click?.(); return; }
      if (target.dataset.openCollection) {
        const existing = document.querySelector(`[data-open-collection="${CSS.escape(target.dataset.openCollection)}"]:not(.trace-share-format)`);
        existing?.click?.();
        return;
      }
      if (target.dataset.addCollection) {
        const existing = document.querySelector(`[data-add-collection="${CSS.escape(target.dataset.addCollection)}"]:not(.trace-archive-work-actions button)`);
        existing?.click?.();
      }
    });

    document.addEventListener("trace:collection-created", () => track("collection_created", { surface: "collections" }));
    document.addEventListener("trace:work-added-to-collection", (event) => track("work_added_to_collection", { work_id: event.detail?.work_id, surface: "collections" }));

    const observer = new MutationObserver(() => {
      if ($("#app_social_profile_view.active")) requestAnimationFrame(() => enhanceArchive());
      if ($("#app_home_view.active")) requestAnimationFrame(injectHomeActivity);
    });
    const shell = $("#trace_app_shell");
    if (shell) observer.observe(shell, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });

    window.addEventListener("hashchange", () => setTimeout(() => { enhanceArchive(); injectHomeActivity(); }, 120));
    document.addEventListener("visibilitychange", () => {
      const glyph = $("#trace_proof_reveal .trace-ritual-glyph svg");
      if (!glyph) return;
      glyph.classList.toggle("trace-ritual-motion-paused", document.visibilityState !== "visible");
      if (document.visibilityState === "visible" && !reducedMotion()) {
        try { window.TraceGlyphV1?.startGlyphMotion?.(glyph); } catch {}
      }
    });
  }

  function init() {
    if (state.initialized) return;
    state.initialized = true;
    console.info("TRACE creator ritual build:", BUILD);
    wireEvents();
    setTimeout(() => { enhanceArchive(); injectHomeActivity(); }, 500);
  }

  window.TraceCreatorRitual = {
    build: BUILD,
    onProofPublished,
    showPendingPublication,
    enhanceArchive,
    openArchive: openOwnArchive,
    track,
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
