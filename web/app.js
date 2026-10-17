// Click landing page: announcement bar, menu, particle-brain hero, and the chat wired to POST /chat.
import { assistantMessageFrom, browserStorage, createConversationStore, createSidebarController, relativeTime } from "/conversations.js";

(() => {
  "use strict";

  // Small per-browser UI preferences (the banner); conversations have their own store below.
  const prefs = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
  };
  const clickConfig = window.CLICK_CONFIG || {};
  const socialConfig = clickConfig.social || {};
  for (const node of document.querySelectorAll("[data-social]")) {
    const key = node.dataset.social;
    const href = typeof socialConfig[key] === "string" ? socialConfig[key].trim() : "";
    if (!href) { node.hidden = true; continue; }
    node.href = href;
    node.hidden = false;
  }

  // ── Announcement bar ───────────────────────────────
  const announce = document.getElementById("announce");
  if (prefs.get("click.announce.dismissed") === "1") announce.hidden = true;
  announce.querySelector("[data-dismiss]").addEventListener("click", () => {
    announce.hidden = true;
    prefs.set("click.announce.dismissed", "1");
  });

  // ── Landing motion: endless marquee + reveal-on-scroll (content stays visible without JS / with reduced motion) ──
  const track = document.querySelector(".marquee-track");
  if (track) {
    // A second copy makes the loop seamless; it is hidden from screen readers and skipped by Tab.
    for (const item of [...track.children]) {
      const copy = item.cloneNode(true);
      copy.setAttribute("aria-hidden", "true");
      copy.tabIndex = -1;
      track.append(copy);
    }
  }
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches && "IntersectionObserver" in window) {
    document.documentElement.classList.add("js-reveal");
    const revealer = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add("in"); revealer.unobserve(e.target); }
    }, { rootMargin: "0px 0px -8% 0px" });
    document.querySelectorAll(".reveal").forEach((n, i) => {
      n.style.transitionDelay = `${(i % 4) * 70}ms`;
      revealer.observe(n);
    });
  }

  // ── Menu (everything except Ask) ───────────────────
  const menuBtn = document.querySelector("[data-menu]");
  const menu = document.getElementById("menu");
  const setMenu = (open) => {
    if (open) {
      const nav = document.querySelector(".nav").getBoundingClientRect();
      menu.style.setProperty("--menu-top", `${Math.max(0, nav.bottom)}px`);
    }
    menu.hidden = !open;
    document.body.classList.toggle("locked", open);
    menuBtn.setAttribute("aria-expanded", String(open));
    menuBtn.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  };
  menuBtn.addEventListener("click", () => setMenu(menu.hidden));
  menu.addEventListener("click", (e) => { if (e.target === menu || e.target.closest("a")) setMenu(false); });
  document.querySelectorAll("[data-open-menu]").forEach((b) =>
    b.addEventListener("click", () => {
      const section = document.getElementById(b.dataset.openMenu);
      if (section) section.open = true;
      setMenu(true);
      section?.scrollIntoView({ block: "start" });
    }),
  );

  // ── Particle brain ─────────────────────────────────
  // A folded brain as a signed-distance shape; tens of thousands of fine particles sit on its surface and
  // are drawn straight into a pixel buffer (additive), which gives the soft "point cloud" texture.
  const v = (x, y, z) => [x, y, z];
  const ellipsoid = (p, c, r) => {
    const qx = (p[0] - c[0]) / r[0], qy = (p[1] - c[1]) / r[1], qz = (p[2] - c[2]) / r[2];
    const k0 = Math.hypot(qx, qy, qz);
    const k1 = Math.hypot(qx / r[0], qy / r[1], qz / r[2]);
    return k1 === 0 ? -Math.min(...r) : (k0 * (k0 - 1)) / k1;
  };
  const capsuleY = (p, x, z, y0, y1, rad) => {
    const y = Math.min(Math.max(p[1], y0), y1);
    return Math.hypot(p[0] - x, p[1] - y, p[2] - z) - rad;
  };
  const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
  const smax = (a, b, k) => -smin(-a, -b, k);

  // Two folded hemispheres split by a fissure, temporal lobes, cerebellum and stem; BRAIN_SIZE scales it.
  const BRAIN_C = [0, 0.4, -0.12], BRAIN_SIZE = 1.3;
  const folds = (p) =>
    Math.sin(p[0] * 15 + 3 * Math.sin(p[2] * 12)) *
    Math.sin(p[1] * 15 + 3 * Math.sin(p[0] * 13)) *
    Math.sin(p[2] * 15 + 3 * Math.sin(p[1] * 12));
  const brainUnit = (p) => {
    let d = smin(ellipsoid(p, v(0.17, 0.4, -0.12), v(0.29, 0.4, 0.6)), ellipsoid(p, v(-0.17, 0.4, -0.12), v(0.29, 0.4, 0.6)), 0.06);
    d = smin(d, ellipsoid(p, v(0.22, 0.13, 0.0), v(0.2, 0.17, 0.38)), 0.1); // temporal lobes
    d = smin(d, ellipsoid(p, v(-0.22, 0.13, 0.0), v(0.2, 0.17, 0.38)), 0.1);
    d = smax(d, -(Math.abs(p[0]) - 0.012), 0.03); // longitudinal fissure
    d += 0.045 * folds(p); // gyri
    d = smin(d, ellipsoid(p, v(0, 0.05, -0.55), v(0.3, 0.15, 0.2)) + 0.012 * Math.sin(p[1] * 70), 0.03); // cerebellum
    d = smin(d, capsuleY(p, 0, -0.3, -0.32, 0.1, 0.06), 0.05); // brain stem
    return d;
  };
  const brain = (p) =>
    brainUnit([
      BRAIN_C[0] + (p[0] - BRAIN_C[0]) / BRAIN_SIZE,
      BRAIN_C[1] + (p[1] - BRAIN_C[1]) / BRAIN_SIZE,
      BRAIN_C[2] + (p[2] - BRAIN_C[2]) / BRAIN_SIZE,
    ]) * BRAIN_SIZE;

  // Particles on a surface: pick points near it, snap them onto it along the normal, keep the normal.
  const surface = (sdf, count, box, keep) => {
    const out = new Float32Array(count * 6);
    const e = 0.008;
    let n = 0;
    for (let tries = 0; n < count && tries < 8_000_000; tries++) {
      let x = box[0] + Math.random() * (box[1] - box[0]);
      let y = box[2] + Math.random() * (box[3] - box[2]);
      let z = box[4] + Math.random() * (box[5] - box[4]);
      const d = sdf([x, y, z]);
      if (Math.abs(d) > 0.05) continue;
      let nx = sdf([x + e, y, z]) - sdf([x - e, y, z]);
      let ny = sdf([x, y + e, z]) - sdf([x, y - e, z]);
      let nz = sdf([x, y, z + e]) - sdf([x, y, z - e]);
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      x -= nx * d; y -= ny * d; z -= nz * d;
      if (keep && !keep(x, y, z)) continue;
      out.set([x, y, z, nx, ny, nz], n * 6);
      n++;
    }
    return out.subarray(0, n * 6);
  };
  const small = innerWidth < 640;
  const cortex = surface(brain, small ? 42000 : 70000, [-0.66, 0.66, -0.62, 1.02, -1.02, 0.66]);
  // Ridge brightness per brain particle: gyri crests light up, sulci stay dark (the reference's fold texture).
  const ridge = new Float32Array(cortex.length / 6);
  for (let k = 0; k < ridge.length; k++) {
    const o = k * 6;
    const f = folds([
      BRAIN_C[0] + (cortex[o] - BRAIN_C[0]) / BRAIN_SIZE,
      BRAIN_C[1] + (cortex[o + 1] - BRAIN_C[1]) / BRAIN_SIZE,
      BRAIN_C[2] + (cortex[o + 2] - BRAIN_C[2]) / BRAIN_SIZE,
    ]);
    ridge[k] = 0.5 + 0.9 * Math.max(0, -f); // folds < 0 pushes the surface outward = a crest
  }
  const LIGHT = (() => { const l = [0.45, 0.6, 0.66], n = Math.hypot(...l); return l.map((c) => c / n); })();

  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  /** One canvas showing the brain; `place(w, h, t)` returns where it floats ({ cx, cy }) and how big (scale). */
  const brainView = (canvas, place) => {
    const ctx = canvas.getContext("2d");
    let w = 0, h = 0, W = 0, H = 0, img, R, G, B, touched, nTouched = 0;
    const resize = () => {
      // One particle = one CSS pixel, the dot size seen in the reference.
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      W = Math.max(1, Math.round(w));
      H = Math.max(1, Math.round(h));
      canvas.width = W;
      canvas.height = H;
      img = ctx.createImageData(W, H);
      R = new Float32Array(W * H);
      G = new Float32Array(W * H);
      B = new Float32Array(W * H);
      touched = new Int32Array(cortex.length / 6);
      nTouched = 0;
    };
    const draw = (time) => {
      const t = time / 1000;
      const data = img.data;
      for (let k = 0; k < nTouched; k++) {
        const i = touched[k];
        R[i] = G[i] = B[i] = 0;
        data[i * 4 + 3] = 0;
      }
      nTouched = 0;

      const yaw = 1.3 + Math.sin(t * 0.45) * 0.55; // faces right, turning back and forth (~±30°)
      const pitch = 0.05 + Math.sin(t * 0.3) * 0.08; // and nodding slightly
      const cY = Math.cos(yaw), sY = Math.sin(yaw), cP = Math.cos(pitch), sP = Math.sin(pitch);
      const { scale, cx, cy } = place(w, h, t);
      const ax0 = BRAIN_C[0] * cY + BRAIN_C[2] * sY;
      const az0 = -BRAIN_C[0] * sY + BRAIN_C[2] * cY;
      const ax = ax0, ay = BRAIN_C[1] * cP - az0 * sP;

      for (let o = 0; o < cortex.length; o += 6) {
        const x = cortex[o], y = cortex[o + 1], z = cortex[o + 2];
        const x1 = x * cY + z * sY, z1 = -x * sY + z * cY;
        const y2 = y * cP - z1 * sP, z2 = y * sP + z1 * cP;
        const persp = 7 / (7 - z2);
        const px = (cx + (x1 - ax) * scale * persp) | 0;
        const py = (cy - (y2 - ay) * scale * persp) | 0;
        if (px < 0 || py < 0 || px >= W || py >= H) continue;
        const nx0 = cortex[o + 3], ny0 = cortex[o + 4], nz0 = cortex[o + 5];
        const nx = nx0 * cY + nz0 * sY, nz1 = -nx0 * sY + nz0 * cY;
        const ny = ny0 * cP - nz1 * sP, nz = ny0 * sP + nz1 * cP;
        const diffuse = Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
        const rim = (1 - Math.abs(nz)) ** 3;
        const i = py * W + px;
        if (R[i] === 0 && G[i] === 0 && B[i] === 0) touched[nTouched++] = i;
        const a = (nz > 0 ? 0.2 + diffuse * 0.28 + rim * 0.04 : 0.09) * ridge[o / 6];
        const core = Math.max(0, 1 - Math.hypot(y - 0.3, z + 0.05) / 0.55); // soft blue core
        R[i] += a * (0.55 - core * 0.2); G[i] += a * (0.88 - core * 0.1); B[i] += a * (0.98 + core * 0.02);
      }

      for (let k = 0; k < nTouched; k++) {
        const i = touched[k], j = i * 4;
        data[j] = Math.min(255, R[i] * 255);
        data[j + 1] = Math.min(255, G[i] * 255);
        data[j + 2] = Math.min(255, B[i] * 255);
        data[j + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
    };
    resize();
    return { resize, draw };
  };

  // Hero: centered behind the title, floating gently.
  const heroCanvas = document.querySelector(".hero-canvas");
  const heroBrain = brainView(heroCanvas, (w, h, t) => {
    const scale = Math.min(w * 0.45, 280);
    return { scale, cx: w / 2, cy: (w < 768 ? 110 : 150) + scale * 0.55 + Math.sin(t * 0.6) * 6 };
  });
  let heroVisible = true;
  addEventListener("resize", () => heroBrain.resize());
  new IntersectionObserver(([entry]) => { heroVisible = entry.isIntersecting; }).observe(heroCanvas);

  // Empty chat: the same brain behind "Click / Ask anything", shown until the first message.
  const chatShell = document.getElementById("chat");
  const chatCanvas = document.querySelector(".chat-canvas");
  let chatBrainOn = false;
  let chatAnchorY = 0; // canvas y of the empty state's title
  const chatBrain = brainView(chatCanvas, (w, h, t) => {
    const scale = Math.min(w * 0.45, h * 0.36, 280);
    const top = chatAnchorY || h * 0.35;
    return { scale, cx: w / 2, cy: top + scale * 0.3 + Math.sin(t * 0.6) * 6 };
  });
  const placeChatBrain = () => {
    const logo = chatShell.querySelector(".chat-empty .empty-logo");
    if (logo && chatCanvas.clientHeight) chatAnchorY = logo.getBoundingClientRect().top - chatCanvas.getBoundingClientRect().top;
    if (reduceMotion && chatBrainOn) chatBrain.draw(0);
  };
  const setChatBrain = (on) => {
    chatBrainOn = on;
    chatShell.classList.toggle("is-empty", on);
    if (on) placeChatBrain();
  };
  new ResizeObserver(() => { chatBrain.resize(); placeChatBrain(); }).observe(chatCanvas);

  // One animation loop: the hero while the page is showing, the chat brain while the chat is open and empty.
  const loop = (time) => {
    if (chatShell.hidden) { if (heroVisible) heroBrain.draw(time); }
    else if (chatBrainOn) chatBrain.draw(time);
    requestAnimationFrame(loop);
  };
  if (reduceMotion) heroBrain.draw(0);
  else requestAnimationFrame(loop);

  // ── Chat: POST /chat (stream: true, v2 events) ─────
  const chat = document.getElementById("chat");
  const log = document.getElementById("chat-log");
  const form = document.getElementById("chat-form");
  const input = document.getElementById("chat-input");
  const submit = document.getElementById("chat-send");
  const historyList = document.getElementById("history-list");
  const historyEmpty = document.getElementById("history-empty");
  const historyToggle = chat.querySelector("[data-toggle-history]");
  const backdrop = chat.querySelector(".history-backdrop");
  const warning = document.getElementById("persist-warning");
  let inflight = null; // AbortController of the request being streamed (one at a time)
  let pending = null; // { conversationId, root } of the turn still streaming, so it survives switching chats

  // Conversations live in this browser (localStorage). If storage fails, chat keeps working in memory
  // and a quiet one-line notice explains it.
  const showStorageWarning = (kind) => {
    warning.textContent =
      kind === "corrupt" ? "Saved chat history couldn't be read, so it starts fresh." :
      kind === "quota" ? "Browser storage is full, so this chat may not be saved." :
      "Chat history can't be saved in this browser. Conversations last until you close the tab.";
    warning.hidden = false;
  };
  const store = createConversationStore({ storage: browserStorage(), onError: showStorageWarning }).load();
  if (!store.persistent) showStorageWarning("unavailable");
  addEventListener("pagehide", () => store.flush());

  const mobile = matchMedia("(max-width: 899px)");
  const sidebar = createSidebarController({
    isMobile: () => mobile.matches,
    render: (open) => {
      chat.classList.toggle("history-open", open);
      backdrop.hidden = !open;
      historyToggle.setAttribute("aria-expanded", String(open));
    },
  });
  mobile.addEventListener("change", () => sidebar.resized());
  historyToggle.addEventListener("click", () => sidebar.toggle());
  backdrop.addEventListener("click", () => sidebar.close());

  const autosize = () => { input.style.height = "auto"; input.style.height = `${Math.min(input.scrollHeight, 180)}px`; };
  input.addEventListener("input", autosize);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
  });

  // ── Routing: /chat/<conversationId> is addressable; "/" is the landing page ──
  const CHAT_PATH = /^\/chat\/([A-Za-z0-9_-]{1,64})\/?$/;
  const setPath = (id, push) => {
    const path = id ? `/chat/${id}` : "/";
    if (location.pathname === path) return;
    try { history[push ? "pushState" : "replaceState"]({ clickChatId: id ?? null }, "", path); } catch { /* sandboxed: URL stays */ }
  };

  const showChat = () => {
    setMenu(false);
    chat.hidden = false;
    document.body.classList.add("locked");
  };
  /** Opens the chat on a conversation: the requested one, else the active/most recent, else a new one. */
  const openChat = ({ conversationId, question, push = true } = {}) => {
    showChat();
    const target =
      (conversationId && store.get(conversationId)) ||
      (question ? null : store.active() ?? store.list()[0] ?? null);
    const c = target ? store.setActive(target.id) ?? target : store.create();
    renderConversation(c.id);
    setPath(c.id, push && !CHAT_PATH.test(location.pathname));
    if (question) { input.value = question; autosize(); }
    input.focus();
  };
  const closeChat = () => {
    chat.hidden = true;
    document.body.classList.remove("locked");
    sidebar.close();
    setPath(null, false);
  };
  const newChat = () => {
    const c = store.create();
    renderConversation(c.id);
    setPath(c.id, false);
    sidebar.selected();
    input.value = "";
    autosize();
    input.focus();
  };
  const selectConversation = (id) => {
    if (!store.setActive(id)) return;
    renderConversation(id);
    setPath(id, false);
    sidebar.selected();
    input.focus();
  };

  document.querySelectorAll("[data-open-chat]").forEach((b) => b.addEventListener("click", () => openChat({ question: b.dataset.openChat })));
  chat.querySelector("[data-close-chat]").addEventListener("click", closeChat);
  chat.querySelectorAll("[data-new-chat]").forEach((b) => b.addEventListener("click", newChat));
  addEventListener("popstate", () => {
    const m = location.pathname.match(CHAT_PATH);
    if (m) openChat({ conversationId: m[1], push: false });
    else if (!chat.hidden) { chat.hidden = true; document.body.classList.remove("locked"); sidebar.close(); }
  });
  addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (closeConversationMenus()) return;
    if (!chat.hidden && sidebar.open) sidebar.close();
    else if (!chat.hidden) closeChat();
    else if (!menu.hidden) setMenu(false);
  });

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text; // never innerHTML: answers and sources are untrusted
    return node;
  };
  const safeUrl = (u) => {
    try { const url = new URL(u); return url.protocol === "https:" || url.protocol === "http:" ? url.href : null; } catch { return null; }
  };

  const link = (href, text, className) => {
    const a = el("a", className, text);
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    return a;
  };
  const nearBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 120;
  const follow = (wasNear) => { if (wasNear) log.scrollTop = log.scrollHeight; };

  // Users never see raw server errors: every failure maps to a short, friendly message.
  const friendlyError = (kind, status) => {
    if (kind === "validation" || status === 400) return "Please enter a question (up to 8,000 characters).";
    if (kind === "unauthorized" || status === 401) return "This Click server needs an access key.";
    if (kind === "rate_limit" || kind === "quota" || kind === "budget" || status === 429) return "Click is busy right now. Please wait a moment and try again.";
    if (kind === "timeout") return "That took too long. Please try again.";
    if (kind === "network") return "Can't reach Click. Check your connection and try again.";
    if (kind === "upstream" || kind === "not_configured" || kind === "auth" || status === 503) return "Click's AI models aren't available right now. Please try again in a moment.";
    return "Something went wrong on our side. Please try again.";
  };

  const INTENT_LABEL = {
    GENERAL: "General", WEB_SEARCH: "Web search", DEEP_RESEARCH: "Deep research", URL_ANALYSIS: "Page analysis",
    GITHUB: "GitHub", NEWS: "News", SOLANA_ONCHAIN: "Solana", MARKET: "Market", ONCHAIN_MARKET: "On-chain market",
    COMBINED_RESEARCH: "Combined", CODING: "Coding", SUMMARIZATION: "Summary",
  };
  const TYPE_LABEL = { normal: "Answer", research: "Research", github: "GitHub", onchain: "Solana", market: "Market", combined: "Combined" };

  // ── Formatting helpers ─────────────────────────────
  const num = (n, opts) => (typeof n === "number" && Number.isFinite(n) ? new Intl.NumberFormat("en-US", opts).format(n) : "—");
  const usd = (n) => num(n, { style: "currency", currency: "USD", notation: Math.abs(n) >= 1e5 ? "compact" : "standard", maximumFractionDigits: Math.abs(n) >= 1 ? 2 : 6 });
  const compact = (n) => num(n, { notation: "compact", maximumFractionDigits: 1 });
  const pct = (n) => (typeof n === "number" && Number.isFinite(n) ? `${n > 0 ? "+" : ""}${n.toFixed(2)}%` : "—");
  const usdS = (n) => (typeof n === "number" ? usd(n) : "—");
  const ago = (iso) => {
    const ms = Date.now() - Date.parse(iso);
    if (!Number.isFinite(ms)) return "";
    const m = Math.round(ms / 60000);
    return m < 60 ? `${Math.max(1, m)}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
  };

  // ── Address & transaction lookup: /api/lookup/:id (RPC-first Solana facts; no model) ──
  // Results are shareable: the URL becomes /address/<pubkey> or /tx/<signature>.
  const lookupForm = document.getElementById("lookup-form");
  if (lookupForm) {
    const lookupInput = document.getElementById("lookup-input");
    const lookupOut = document.getElementById("lookup-result");
    const ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
    const HASH = /^[1-9A-HJ-NP-Za-km-z]{86,88}$/;
    const shortA = (a) => (a ? a.slice(0, 6) + "…" + a.slice(-4) : "");
    const KIND = { address: "Address", signature: "Transaction signature" };
    const stat = (label, value, sub) => {
      const d = el("div", "lk-stat");
      d.append(el("span", "lk-label", label), el("b", "lk-value", value));
      if (sub) d.append(el("span", "lk-sub", sub));
      return d;
    };
    const addrBtn = (a, label, copy = false) => {
      const b = el("button", "lk-addr-btn mono", label || shortA(a));
      b.type = "button";
      b.title = a;
      b.addEventListener("click", async () => {
        if (copy) {
          try { await navigator.clipboard.writeText(a); b.textContent = "Copied ✓"; } catch { b.textContent = "Copy failed"; }
          setTimeout(() => { b.textContent = label || shortA(a); }, 1200);
          return;
        }
        run(a);
      });
      return b;
    };
    const shareUrl = (kind, value) => location.origin + "/" + kind + "/" + value;
    const actionsFor = (ask, explorerUrl, kind, value) => {
      const actions = el("div", "lk-actions");
      if (ask) {
        const askBtn = el("button", "btn btn-primary", ask.label);
        askBtn.type = "button";
        askBtn.addEventListener("click", () => openChat({ question: ask.question }));
        actions.append(askBtn);
      }
      const copy = el("button", "btn btn-ghost", "Copy link");
      copy.type = "button";
      copy.addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(shareUrl(kind, value)); copy.textContent = "Link copied ✓"; } catch { copy.textContent = "Copy failed"; }
        setTimeout(() => { copy.textContent = "Copy link"; }, 1800);
      });
      actions.append(copy);
      if (kind === "address") actions.append(watchBtn("wallet", value));
      if (safeUrl(explorerUrl)) actions.append(link(safeUrl(explorerUrl), "Open in explorer ↗", "btn btn-ghost"));
      return actions;
    };
    const foot = (at) => el("p", "lk-foot mono", "Fetched " + new Date(at).toLocaleTimeString());
    const factLabel = (id) => id.replace(/_/g, " ");
    const factValue = (v, id = "") => {
      if (v === null || v === undefined) return "—";
      if (id === "mint_authority" || id === "freeze_authority") return v ? (typeof v === "string" ? shortA(v) : String(v)) : "renounced";
      if (id === "token_program" && v && typeof v === "object" && v.program) {
        const names = Array.isArray(v.extensions) ? v.extensions : [];
        const ext = names.length ? names.slice(0, 4).join(", ") + (names.length > 4 ? "…" : "") : "no extensions";
        return `${v.program} · ${ext}`;
      }
      if (id === "supply" && v && typeof v === "object") return v.amount != null ? "on-chain" : "—";
      if (id === "holder_concentration" && v && typeof v === "object") {
        return typeof v.top1Pct === "number" ? `top ~${v.top1Pct}%` : "—";
      }
      if (typeof v === "boolean") return v ? "yes" : "no";
      if (typeof v === "object") return "—";
      return String(v);
    };
    const launchSafetySignals = (signals) =>
      (signals ?? []).filter((s) => {
        if (s.id === "token_program" || s.id === "supply" || s.id === "holder_concentration") return false;
        if (typeof s.value === "object" && s.value !== null) return false;
        return true;
      });

    const renderSafety = async (mint, host) => {
      host.replaceChildren(el("p", "lk-loading", "Loading safety facts…"));
      try {
        const res = await fetch("/api/token/" + encodeURIComponent(mint) + "/safety", { headers: { Accept: "application/json" } });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          host.replaceChildren(el("p", "lk-note", (body && body.error && body.error.message) || "Safety facts unavailable."));
          return;
        }
        const wrap = el("div", "ti-checks");
        wrap.append(el("h4", "", "Safety facts"));
        const ul = el("ul");
        for (const s of body.signals || []) {
          const li = el("li", "ti-check");
          const txt = el("div");
          txt.append(el("b", "", factLabel(s.id) + ": " + factValue(s.value, s.id)));
          txt.append(el("span", "", s.meaning));
          txt.append(el("span", "lk-dim mono", (s.source || "source") + " · " + ago(s.fetchedAt)));
          li.append(txt);
          ul.append(li);
        }
        wrap.append(ul, el("p", "lk-foot", body.disclaimer || "Facts from Solana RPC and market data."));
        if (body.notices?.length) wrap.append(el("p", "lk-note", body.notices.join(" ")));
        host.replaceChildren(wrap);
      } catch {
        host.replaceChildren(el("p", "lk-note", "Safety facts unavailable."));
      }
    };

    const renderLookup = (p) => {
      const card = el("article", "lk-card");
      const head = el("div", "lk-head");
      head.append(el("span", "lk-kind", KIND[p.kind] || "Lookup"));
      head.append(el("span", "lk-addr mono", p.id));
      card.append(head);
      if (p.classification) card.append(el("p", "lk-dim", "Classification: " + p.classification));
      const sec = el("div", "lk-lists");
      for (const s of p.sections || []) {
        const block = el("div", "lk-list");
        block.append(el("h4", "", s.title));
        if (safeUrl(s.url)) block.append(link(safeUrl(s.url), "Open source ↗", "lk-time"));
        const pre = el("pre", "mono");
        pre.textContent = s.content || "No content.";
        block.append(pre);
        sec.append(block);
      }
      card.append(sec);
      if (p.kind === "address") {
        const mintRow = el("div", "lk-route");
        mintRow.append(el("span", "lk-label", "Mint / account"), el("span", "mono", p.id), addrBtn(p.id, "Copy mint", true));
        card.append(mintRow);
        const safety = el("div", "ti-wrap");
        card.append(safety);
        renderSafety(p.id, safety);
      }
      const ask = p.kind === "signature"
        ? { label: "Explain this transaction", question: "Explain transaction " + p.id + " on Solana" }
        : { label: "Analyze this address", question: "Analyze address " + p.id + " on Solana" };
      const explorer = p.kind === "signature" ? "https://solscan.io/tx/" + encodeURIComponent(p.id) : "https://solscan.io/account/" + encodeURIComponent(p.id);
      card.append(actionsFor(ask, explorer, p.kind === "signature" ? "tx" : "address", p.id));
      card.append(foot(p.generatedAt || new Date().toISOString()));
      return card;
    };

    // Market data can be briefly busy upstream: try once more on our own before asking the visitor.
    const fetchMarket = async (url) => {
      for (let attempt = 0; ; attempt++) {
        const r = await fetch(url, { headers: { Accept: "application/json" } });
        if (r.status !== 503 || attempt >= 1) return r;
        await new Promise((res) => setTimeout(res, 3000));
      }
    };
    const retryNote = (text, again) => {
      const p = el("p", "lk-note", text + " ");
      const b = el("button", "chip-btn mono", "Retry");
      b.type = "button";
      b.addEventListener("click", again);
      p.append(b);
      return p;
    };
    const show = (cls, text) => { lookupOut.replaceChildren(el("p", cls, text)); };
    let busy = false;
    const run = async (value, opts = {}) => {
      value = String(value || "").trim();
      lookupInput.value = value;
      const isAddr = ADDR.test(value), isTx = HASH.test(value);
      if (!isAddr && !isTx) return show("lk-error", "Enter a valid Solana address (base58, 32-44 chars) or transaction signature.");
      if (busy) return;
      busy = true;
      show("lk-loading", "Reading Solana…");
      if (opts.scroll !== false) lookupOut.scrollIntoView({ block: "nearest", behavior: "smooth" });
      try {
        const res = await fetch("/api/lookup/" + encodeURIComponent(value), { headers: { Accept: "application/json" } });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) return show("lk-error", res.status === 429 ? "Too many lookups. Please wait a minute." : (body && body.error && body.error.message) || "Solana data could not be read right now.");
        lookupOut.replaceChildren(renderLookup(body));
        try { history.replaceState(null, "", "/" + (isTx ? "tx" : "address") + "/" + value); } catch { /* sandboxed */ }
      } catch {
        show("lk-error", "Can't reach Click. Check your connection and try again.");
      } finally {
        busy = false;
      }
    };
    lookupForm.addEventListener("submit", (e) => { e.preventDefault(); run(lookupInput.value); });
    for (const b of document.querySelectorAll("[data-lookup]")) b.addEventListener("click", () => run(b.dataset.lookup));

    // Shared link: /address/<pubkey> or /tx/<signature> runs the lookup on arrival.
    const params = new URLSearchParams(location.search);
    const pathMatch = location.pathname.match(/^\/(?:address|tx)\/([1-9A-HJ-NP-Za-km-z]{32,88})\/?$/);
    const shared = (pathMatch && pathMatch[1]) || params.get("address") || params.get("tx");
    if (shared && (ADDR.test(shared) || HASH.test(shared))) {
      document.getElementById("lookup")?.scrollIntoView({ block: "start" });
      run(shared, { scroll: false });
    }

    // ── Token radar: trending and new pools on Solana (/api/radar) ──
    const radar = document.getElementById("radar-list");
    if (radar) {
      let data = null, tab = "trending";
      const draw = () => {
        radar.replaceChildren();
        const list = data ? data[tab] : [];
        if (!data) { radar.append(el("p", "lk-loading", "Loading the radar…")); return; }
        if (!list.length) { radar.append(el("p", "lk-note", "Nothing to show right now.")); return; }
        for (const pl of list) {
          const row = el("button", "rd-row");
          row.type = "button";
          const name = el("span", "rd-name");
          name.append(el("b", "", pl.name), el("span", "lk-dim", pl.dex.replace(/-/g, " ")));
          const chg = typeof pl.change24hPct === "number" ? pl.change24hPct : null;
          row.append(name,
            el("span", "rd-cell", usdS(pl.liquidityUsd)),
            el("span", "rd-cell", usdS(pl.volume24hUsd)),
            el("span", "rd-cell " + (chg === null ? "" : chg >= 0 ? "up" : "down"), chg === null ? "—" : pct(chg)),
            el("span", "rd-cell lk-dim", pl.createdAt ? ago(pl.createdAt) : ""),
            el("span", "rd-go", "Check →"));
          row.addEventListener("click", () => {
            const mint = pl.token?.address;
            if (!mint) return;
            document.getElementById("lookup").scrollIntoView({ block: "start", behavior: "smooth" });
            run(mint, { scroll: false });
          });
          radar.append(row);
        }
      };
      for (const b of document.querySelectorAll("[data-radar]")) {
        b.addEventListener("click", () => {
          tab = b.dataset.radar;
          for (const x of document.querySelectorAll("[data-radar]")) x.setAttribute("aria-selected", String(x === b));
          draw();
        });
      }
      draw();
      fetch("/api/radar", { headers: { Accept: "application/json" } })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { data = d || { trending: [], fresh: [] }; draw(); })
        .catch(() => { data = { trending: [], fresh: [] }; draw(); });
    }

    // ── Watchlist (this browser only) ──
    const WL_KEY = "click.watchlist.v1";
    const wlRead = () => { try { const v = JSON.parse(localStorage.getItem(WL_KEY) || "[]"); return Array.isArray(v) ? v.filter((x) => x && ADDR.test(x.address) && (x.type === "token" || x.type === "wallet")).slice(0, 30) : []; } catch { return []; } };
    const wlWrite = (list) => { try { localStorage.setItem(WL_KEY, JSON.stringify(list.slice(0, 30))); } catch { /* storage blocked */ } renderWatchlist(); };
    const wlHas = (a) => wlRead().some((x) => x.address.toLowerCase() === a.toLowerCase());
    const wlToggle = (type, address, label) => {
      const list = wlRead();
      const i = list.findIndex((x) => x.address.toLowerCase() === address.toLowerCase());
      if (i >= 0) list.splice(i, 1); else list.unshift({ type, address, ...(label ? { label: String(label).slice(0, 24) } : {}) });
      wlWrite(list);
    };
    function watchBtn(type, address, label) {
      const b = el("button", "btn btn-ghost wl-star", "");
      b.type = "button";
      const sync = () => { const on = wlHas(address); b.textContent = on ? "★ Watching" : "☆ Watch"; b.classList.toggle("on", on); };
      b.addEventListener("click", () => {
        const sym = label || (document.querySelector(".lk-card .lk-stat .lk-value") || {}).textContent;
        wlToggle(type, address, type === "token" ? sym : undefined);
        sync();
      });
      sync();
      return b;
    }
    const wlBody = document.getElementById("wl-body");
    async function renderWatchlist() {
      if (!wlBody) return;
      const list = wlRead();
      wlBody.replaceChildren();
      if (!list.length) {
        const empty = el("div", "wl-empty");
        empty.append(el("p", "", "Nothing here yet. Tap ☆ Watch on any token or wallet result."));
        wlBody.append(empty);
        return;
      }
      const ul = el("ul", "wl-list");
      const rows = new Map();
      for (const item of list) {
        const li = el("li", "wl-row");
        const name = addrBtn(item.address, item.type === "token" ? "$" + (item.label || shortA(item.address)) : "👛 " + shortA(item.address));
        name.classList.add("lk-strong");
        if (item.type === "wallet") { name.replaceWith(name); name.onclick = null; }
        const val = el("span", "wl-val mono", "…"), chg = el("span", "wl-chg mono", "");
        const rm = el("button", "wl-rm", "✕");
        rm.type = "button"; rm.setAttribute("aria-label", "Remove from watchlist");
        rm.addEventListener("click", () => wlToggle(item.type, item.address));
        li.append(name, val, chg, rm);
        if (item.type === "wallet") {
          name.addEventListener("click", (e) => { e.stopImmediatePropagation(); runPortfolio(item.address); }, { capture: true });
        }
        rows.set(item.address.toLowerCase(), { item, val, chg });
        ul.append(li);
      }
      wlBody.append(ul);
      const setChg = (node, v) => { node.textContent = typeof v === "number" ? pct(v) : ""; node.className = "wl-chg mono " + (typeof v !== "number" ? "" : v >= 0 ? "up" : "down"); };
      const tokens = list.filter((x) => x.type === "token").map((x) => x.address);
      if (tokens.length) {
        try {
          const r = await fetchMarket("/api/prices?tokens=" + tokens.join(","));
          const d = r.ok ? await r.json() : { prices: {} };
          for (const t of tokens) {
            const row = rows.get(t.toLowerCase()), p = d.prices[t.toLowerCase()];
            if (!row) continue;
            row.val.textContent = p && typeof p.priceUsd === "number" ? "$" + (p.priceUsd >= 1 ? p.priceUsd.toFixed(2) : p.priceUsd.toPrecision(3)) : "no market";
            setChg(row.chg, p && p.change24hPct);
          }
        } catch { /* keep "…" */ }
      }
      for (const w of list.filter((x) => x.type === "wallet").slice(0, 6)) {
        fetchMarket("/api/portfolio/" + w.address).then((r) => (r.ok ? r.json() : null)).then((p) => {
          const row = rows.get(w.address.toLowerCase());
          if (!row) return;
          row.val.textContent = p ? usd(p.totalUsd) : "—";
          setChg(row.chg, p && p.change24hPct);
        }).catch(() => {});
      }
      const upd = document.getElementById("wl-updated");
      if (upd) upd.textContent = "updated " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }

    // ── Portfolio: what a wallet holds, priced live (/api/portfolio/:wallet) ──
    const pfForm = document.getElementById("pf-form"), pfInput = document.getElementById("pf-input"), pfOut = document.getElementById("pf-result");
    async function runPortfolio(address, opts = {}) {
      if (!pfForm) return;
      address = String(address || "").trim();
      pfInput.value = address;
      if (!ADDR.test(address)) { pfOut.replaceChildren(el("p", "lk-error", "Enter a valid Solana wallet address.")); return; }
      if (opts.scroll !== false) document.getElementById("portfolio").scrollIntoView({ block: "start", behavior: "smooth" });
      pfOut.replaceChildren(el("p", "lk-loading", "Reading the wallet and pricing every token…"));
      try {
        const r = await fetchMarket("/api/portfolio/" + encodeURIComponent(address));
        const p = await r.json().catch(() => ({}));
        if (!r.ok) { pfOut.replaceChildren(retryNote((p && p.error && p.error.message) || "This wallet could not be read.", () => runPortfolio(address, { scroll: false }))); return; }
        const card = el("article", "lk-card");
        const head = el("div", "lk-head");
        head.append(el("span", "lk-kind wallet", "Portfolio"), link(location.origin + "/address/" + p.wallet, p.wallet, "lk-addr mono"));
        card.append(head);
        const hero = el("div", "pf-hero");
        const tot = el("div");
        tot.append(el("span", "lk-label", "Total value"), el("b", "pf-total", usd(p.totalUsd)));
        const ch = el("div");
        const up = p.change24hUsd >= 0;
        ch.append(el("span", "lk-label", "24h change"), el("b", "pf-chg " + (up ? "up" : "down"), (up ? "+" : "−") + usd(Math.abs(p.change24hUsd || 0)) + (typeof p.change24hPct === "number" ? " (" + pct(p.change24hPct) + ")" : "")));
        hero.append(tot, ch);
        card.append(hero);
        const counted = p.holdings.filter((h) => typeof h.valueUsd === "number" && h.valueUsd > 0);
        if (counted.length && p.totalUsd > 0) {
          const bar = el("div", "pf-bar");
          const COLORS = ["#38d6f5", "#5ce4ff", "#ff4d8d", "#7cff6b", "#b44dff", "#ffb21e"];
          counted.slice(0, 6).forEach((h, i) => {
            const seg = el("span", "", "");
            seg.style.setProperty("--w", Math.max(1, (h.valueUsd / p.totalUsd) * 100) + "%");
            seg.style.setProperty("--c", COLORS[i]);
            seg.title = (h.symbol || "?") + " " + Math.round((h.valueUsd / p.totalUsd) * 100) + "%";
            bar.append(seg);
          });
          card.append(bar);
        }
        const ul = el("ul", "pf-list");
        // Valued holdings first; dust, thin markets and unpriced tokens fold away behind "Show more".
        const main = p.holdings.filter((h) => typeof h.valueUsd === "number" && h.valueUsd >= 0.01);
        const rest = p.holdings.filter((h) => !main.includes(h));
        let more = null;
        if (rest.length) {
          more = el("button", "chip-btn mono pf-more", "Show " + rest.length + " more (dust, thin or no market)");
          more.type = "button";
        }
        for (const h of [...main, ...rest]) {
          const li = el("li", "pf-row" + (h.valueUsd === undefined ? " none" : ""));
          const sym = h.mint ? addrBtn(h.mint, shortA(h.mint)) : el("span", "", "SOL");
          sym.classList.add("lk-strong");
          li.append(sym, el("span", "lk-dim", h.program || ""), el("span", "lk-num mono", h.uiAmount));
          li.append(el("span", "lk-num mono pf-v", h.valueUsd !== undefined ? usd(h.valueUsd) : "no market"));
          const c = el("span", "mono " + (typeof h.change24hPct !== "number" ? "lk-dim" : h.change24hPct >= 0 ? "up" : "down"), typeof h.change24hPct === "number" ? pct(h.change24hPct) : "");
          li.append(c, el("span", "pf-share mono lk-dim", h.valueUsd && p.totalUsd ? Math.round((h.valueUsd / p.totalUsd) * 100) + "%" : ""));
          if (rest.includes(h)) li.hidden = true;
          ul.append(li);
        }
        card.append(ul);
        if (more) {
          more.addEventListener("click", () => { for (const li of ul.children) li.hidden = false; more.remove(); });
          card.append(more);
        }
        card.append(el("p", "lk-foot", (p.unpriced ? p.unpriced + " token(s) have no market price. " : "") + "Prices via GeckoTerminal; balances from Solana RPC."));
        const actions = actionsFor({ label: "Ask Click about this wallet", question: "Analyze wallet " + p.wallet + " on Solana" }, "https://solscan.io/account/" + encodeURIComponent(p.wallet), "portfolio", p.wallet);
        card.append(actions);
        pfOut.replaceChildren(card);
        try { history.replaceState(null, "", "/portfolio/" + p.wallet); } catch { /* sandboxed */ }
      } catch {
        pfOut.replaceChildren(retryNote("Can't reach Click right now.", () => runPortfolio(address, { scroll: false })));
      }
    }
    pfForm?.addEventListener("submit", (e) => { e.preventDefault(); runPortfolio(pfInput.value); });
    const pfPath = location.pathname.match(/^\/portfolio\/([1-9A-HJ-NP-Za-km-z]{32,44})\/?$/);
    if (pfPath) { document.getElementById("portfolio")?.scrollIntoView({ block: "start" }); runPortfolio(pfPath[1], { scroll: false }); }
    renderWatchlist();

    // ── New launch feed (/api/launches) ──
    const lfList = document.getElementById("launches-list");
    if (lfList) {
      const drawLaunches = async () => {
        try {
          const r = await fetchMarket("/api/launches");
          const d = await r.json().catch(() => ({}));
          if (!r.ok) { lfList.replaceChildren(retryNote((d && d.error && d.error.message) || "New launches are unavailable.", drawLaunches)); return; }
          lfList.replaceChildren();
          for (const l of d.launches) {
            const card = el("article", "lf-card");
            const head = el("div", "lf-head");
            const name = el("div", "lf-name");
            const mint = l.pool?.token?.address;
            const symbol = l.pool?.token?.symbol ? "$" + l.pool.token.symbol : shortA(mint || "");
            name.append(el("b", "", symbol), el("span", "lk-dim", l.pool?.token?.name || ""));
            head.append(name);
            card.append(head);
            const st = el("div", "lf-stats mono");
            st.append(
              el("span", "", "liq " + (typeof l.pool?.liquidityUsd === "number" ? usd(l.pool.liquidityUsd) : "—")),
              el("span", "", "24h " + (l.pool?.buys ?? 0) + "↑ " + (l.pool?.sells ?? 0) + "↓"),
              el("span", "", l.pool?.createdAt ? ago(l.pool.createdAt) : ""),
            );
            card.append(st, el("p", "lf-dex lk-dim", (l.pool?.dex || "").replace(/-/g, " ")));
            if (mint) {
              const mintRow = el("p", "lf-mint lk-dim");
              mintRow.append(el("span", "", "Mint: "), addrBtn(mint, shortA(mint)));
              card.append(mintRow);
            }
            const compactSafety = launchSafetySignals(l.safety?.signals);
            if (compactSafety.length) {
              const fl = el("ul", "lf-flags");
              for (const s of compactSafety.slice(0, 4)) {
                const li = el("li", "");
                li.append(el("span", "", factLabel(s.id) + ": " + factValue(s.value, s.id)));
                fl.append(li);
              }
              card.append(fl);
            }
            const go = el("button", "btn btn-ghost lf-go", "Full check →");
            go.type = "button";
            go.addEventListener("click", () => {
              if (!mint) return;
              document.getElementById("lookup").scrollIntoView({ block: "start", behavior: "smooth" });
              run(mint, { scroll: false });
            });
            card.append(go);
            lfList.append(card);
          }
          const up = document.getElementById("launches-updated");
          if (up) up.textContent = "updated " + new Date(d.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        } catch { lfList.replaceChildren(retryNote("New launches are unavailable.", drawLaunches)); }
      };
      lfList.append(el("p", "lk-loading", "Checking the newest tokens…"));
      drawLaunches();
      setInterval(() => { if (!document.hidden) drawLaunches(); }, 90_000);
    }

    // ── Token compare (/api/compare?a=&b=) ──
    const cmpForm = document.getElementById("cmp-form");
    if (cmpForm) {
      const ca = document.getElementById("cmp-a"), cb = document.getElementById("cmp-b"), cout = document.getElementById("cmp-result");
      const fetchToken = async (a, b) => {
        const r = await fetchMarket("/api/compare?a=" + encodeURIComponent(a) + "&b=" + encodeURIComponent(b));
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error((d && d.error && d.error.message) || "Comparison unavailable.");
        return d;
      };
      const getSignal = (side, id) => (side?.safety?.signals || []).find((s) => s.id === id)?.value;
      const ROWS = [
        ["Price", (t) => t.token?.priceUsd, (v) => (v >= 1 ? "$" + v.toFixed(2) : "$" + v.toPrecision(3)), null],
        ["Liquidity", (t) => t.liquidityUsd, usd, "high"],
        ["Pools", (t) => t.pools?.length, (v) => String(v), "high"],
        ["Holders top10%", (t) => getSignal(t, "holder_concentration")?.top10Pct, (v) => String(v) + "%", "low"],
        ["Mint authority active", (t) => getSignal(t, "mint_authority"), (v) => (v ? "Yes" : "No"), "low"],
        ["Freeze authority active", (t) => getSignal(t, "freeze_authority"), (v) => (v ? "Yes" : "No"), "low"],
      ];
      const runCompare = async (a, b, opts = {}) => {
        a = String(a || "").trim(); b = String(b || "").trim();
        ca.value = a; cb.value = b;
        if (!ADDR.test(a) || !ADDR.test(b)) { cout.replaceChildren(el("p", "lk-error", "Enter two valid Solana mint addresses.")); return; }
        if (a.toLowerCase() === b.toLowerCase()) { cout.replaceChildren(el("p", "lk-error", "Pick two different tokens.")); return; }
        if (opts.scroll !== false) document.getElementById("compare").scrollIntoView({ block: "start", behavior: "smooth" });
        cout.replaceChildren(el("p", "lk-loading", "Reading both tokens…"));
        try {
          const cmp = await fetchToken(a, b);
          const ta = cmp.a;
          const tb = cmp.b;
          const card = el("article", "lk-card");
          const table = el("div", "cmp-table");
          const label = (t) => (t.token?.symbol ? "$" + t.token.symbol : shortA(t.mint));
          const hd = (t) => { const c = el("div", "cmp-h"); const n = addrBtn(t.mint, label(t)); n.classList.add("lk-strong"); c.append(n, el("span", "lk-dim", t.token?.name || ""), addrBtn(t.mint, "Copy mint", true)); return c; };
          table.append(el("div", "cmp-h cmp-k", ""), hd(ta), hd(tb));
          for (const [name, get, fmt, better] of ROWS) {
            const va = get(ta), vb = get(tb);
            if (va === undefined && vb === undefined) continue;
            table.append(el("div", "cmp-k", name));
            for (const [v, o] of [[va, vb], [vb, va]]) {
              const win = better && typeof v === "number" && typeof o === "number" && v !== o && (better === "high" ? v > o : v < o);
              table.append(el("div", "cmp-v mono" + (win ? " win" : ""), v === undefined || v === null ? "—" : fmt(v)));
            }
          }
          card.append(table);
          card.append(el("p", "lk-foot", cmp.disclaimer || "Facts from Solana + market data."));
          card.append(actionsFor({ label: "Ask Click to compare them", question: "Compare Solana mints " + ta.mint + " and " + tb.mint }, null, "compare", ta.mint + "/" + tb.mint));
          cout.replaceChildren(card);
          try { history.replaceState(null, "", "/compare/" + ta.mint + "/" + tb.mint); } catch { /* sandboxed */ }
        } catch (err) {
          cout.replaceChildren(retryNote(err.message || "Comparison unavailable.", () => runCompare(a, b, { scroll: false })));
        }
      };
      cmpForm.addEventListener("submit", (e) => { e.preventDefault(); runCompare(ca.value, cb.value); });
      for (const btn of document.querySelectorAll("[data-compare]")) btn.addEventListener("click", () => { const [x, y] = btn.dataset.compare.split(","); runCompare(x, y); });
      const cm = location.pathname.match(/^\/compare\/([1-9A-HJ-NP-Za-km-z]{32,44})\/([1-9A-HJ-NP-Za-km-z]{32,44})\/?$/);
      if (cm) { document.getElementById("compare")?.scrollIntoView({ block: "start" }); runCompare(cm[1], cm[2], { scroll: false }); }
    }

    // Removed fixed token spotlight; page now stays chain-agnostic and config-driven.
  }

  // ── Answer text: a tiny, safe markdown subset (no HTML ever) with clickable [n] citations ──
  const inline = (text, sources) => {
    const frag = document.createDocumentFragment();
    const re = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\[\d+(?:\s*,\s*\d+)*\])/g;
    let last = 0;
    for (const m of text.matchAll(re)) {
      if (m.index > last) frag.append(text.slice(last, m.index));
      const tok = m[0];
      if (tok.startsWith("**")) frag.append(el("strong", "", tok.slice(2, -2)));
      else if (tok.startsWith("`")) frag.append(el("code", "", tok.slice(1, -1)));
      else {
        const ids = tok.slice(1, -1).split(",").map((s) => Number(s.trim()));
        ids.forEach((id) => {
          const src = sources.get(id);
          const url = src && safeUrl(src.url);
          frag.append(url ? link(url, String(id), "cite") : el("span", "cite", String(id)));
        });
      }
      last = m.index + tok.length;
    }
    if (last < text.length) frag.append(text.slice(last));
    return frag;
  };
  // Markdown tables ("| a | b |" rows, optional "|---|---|" separator under the header), built as real tables.
  const TABLE_ROW = /^\s*\|.*\|?\s*$/;
  const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
  const tableCells = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
  // Models often write <br> inside a cell for a line break: shown as a real break (never parsed as HTML).
  const tableCell = (tag, text, sources) => {
    const cell = el(tag);
    text.split(/<br\s*\/?>/i).forEach((part, i) => {
      if (i) cell.append(document.createElement("br"));
      cell.append(inline(part.trim(), sources));
    });
    return cell;
  };
  const mdTable = (rows, sources) => {
    const wrap = el("div", "md-table-wrap");
    const table = el("table", "md-table");
    const hasHead = rows.length > 1 && TABLE_SEP.test(rows[1]);
    const body = hasHead ? rows.slice(2) : rows;
    if (hasHead) {
      const thead = el("thead");
      const tr = el("tr");
      for (const c of tableCells(rows[0])) tr.append(tableCell("th", c, sources));
      thead.append(tr);
      table.append(thead);
    }
    const tbody = el("tbody");
    for (const row of body) {
      if (TABLE_SEP.test(row)) continue;
      const tr = el("tr");
      for (const c of tableCells(row)) tr.append(tableCell("td", c, sources));
      tbody.append(tr);
    }
    table.append(tbody);
    wrap.append(table);
    return wrap;
  };
  const markdown = (text, sources) => {
    const root = el("div", "msg-answer");
    let list = null;
    let para = null;
    const lines = text.split("\n");
    for (let n = 0; n < lines.length; n++) {
      const line = lines[n].trimEnd();
      const heading = line.match(/^(#{1,4})\s+(.*)$/);
      const bullet = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
      if (!line.trim()) { list = null; para = null; continue; }
      if (line.trim().startsWith("|") && TABLE_ROW.test(line)) {
        list = null; para = null;
        const rows = [];
        while (n < lines.length && lines[n].trim().startsWith("|")) rows.push(lines[n++].trimEnd());
        n--;
        root.append(mdTable(rows, sources));
      } else if (heading) {
        list = null; para = null;
        const h = el(heading[1].length <= 2 ? "h3" : "h4", "");
        h.append(inline(heading[2], sources));
        root.append(h);
      } else if (bullet) {
        para = null;
        if (!list) { list = el(/^\s*\d/.test(line) ? "ol" : "ul", ""); root.append(list); }
        const li = el("li", "");
        li.append(inline(bullet[1], sources));
        list.append(li);
      } else {
        list = null;
        if (!para) { para = el("p", ""); root.append(para); } else para.append(document.createElement("br"));
        para.append(inline(line, sources));
      }
    }
    return root;
  };

  // ── Structured cards from `data` (per kind of data) ──
  const stat = (label, value, tone) => {
    const s = el("div", "stat");
    s.append(el("span", "stat-label", label), el("span", `stat-value${tone ? " " + tone : ""}`, value));
    return s;
  };
  const card = (title, href) => {
    const c = el("div", "card");
    const head = el("div", "card-head");
    head.append(href ? link(href, title, "card-title") : el("span", "card-title", title));
    c.append(head);
    return c;
  };
  const renderCards = (data) => {
    const wrap = el("div", "cards");
    for (const { data: d } of data["market.data"] ?? []) {
      for (const p of (d?.pools ?? []).slice(0, 3)) {
        const c = card(p.name ?? "Pool", p.address ? `https://www.geckoterminal.com/solana/pools/${encodeURIComponent(p.address)}` : null);
        c.firstChild.append(el("span", "card-tag", "MARKET"));
        const grid = el("div", "stats");
        const ch = p.priceChangePct?.h24;
        grid.append(
          stat("Price", usd(p.basePriceUsd)),
          stat("24h", pct(ch), ch > 0 ? "up" : ch < 0 ? "down" : ""),
          stat("Liquidity", usd(p.liquidityUsd)),
          stat("Volume 24h", usd(p.volumeUsd?.h24)),
        );
        c.append(grid);
        if (p.dex) c.append(el("p", "card-note", `${p.dex}${d.fetchedAt ? ` · ${ago(d.fetchedAt)}` : ""}`));
        wrap.append(c);
      }
    }
    for (const { data: d } of data["chain.data"] ?? []) {
      if (!d?.chain) continue;
      const explorerHref = safeUrl(d.chain.explorer);
      const c = card("Solana", explorerHref);
      c.firstChild.append(el("span", "card-tag", "ON-CHAIN"));
      const grid = el("div", "stats");
      const explorerLive = d.dataSources?.explorer === "ok" || Boolean(explorerHref);
      let explorerLabel = "Not configured";
      if (explorerLive && explorerHref) {
        try {
          explorerLabel = new URL(explorerHref).hostname.replace(/^www\./, "");
        } catch {
          explorerLabel = "Live";
        }
      } else if (explorerLive) explorerLabel = "Live";
      grid.append(
        stat("Cluster", String(d.chain.cluster ?? "—")),
        stat("RPC", d.dataSources?.rpc === "ok" ? "Live" : "Unavailable", d.dataSources?.rpc === "ok" ? "up" : "down"),
        stat("Explorer", explorerLabel, explorerLive ? "up" : ""),
      );
      c.append(grid);
      wrap.append(c);
    }
    for (const { data: d } of data["github.repo"] ?? []) {
      const r = d?.repo;
      if (!r) continue;
      const c = card(r.fullName, safeUrl(r.url));
      c.firstChild.append(el("span", "card-tag", "GITHUB"));
      if (r.description) c.append(el("p", "card-desc", r.description));
      const grid = el("div", "stats");
      grid.append(
        stat("Stars", compact(r.stars)),
        stat("Forks", compact(r.forks)),
        stat("Language", r.language ?? "—"),
        stat("Updated", r.pushedAt ? ago(r.pushedAt) : "—"),
      );
      c.append(grid);
      if (r.license) c.append(el("p", "card-note", `${r.license} license`));
      wrap.append(c);
    }
    for (const { data: d } of data["news.feed"] ?? []) {
      const stories = (d?.stories ?? []).slice(0, 4);
      if (!stories.length) continue;
      const c = card("Latest news");
      c.firstChild.append(el("span", "card-tag", "NEWS"));
      const ul = el("ul", "news");
      for (const s of stories) {
        const li = el("li");
        const url = safeUrl(s.sources?.[0]?.url);
        li.append(url ? link(url, s.title) : el("span", "", s.title));
        const meta = [s.sources?.[0]?.source, s.publishedAt ? ago(s.publishedAt) : ""].filter(Boolean).join(" · ");
        if (meta) li.append(el("span", "news-meta", meta));
        ul.append(li);
      }
      c.append(ul);
      wrap.append(c);
    }
    return wrap.childElementCount ? wrap : null;
  };

  // Every source is listed (live RPC data may have no URL); only http(s) URLs become links.
  const renderSources = (sources) => {
    if (!sources.length) return null;
    const box = el("details", "msg-sources");
    box.open = sources.length <= 6;
    box.append(el("summary", "", `Sources (${sources.length})`));
    const ol = el("ol");
    for (const s of sources) {
      const li = el("li");
      li.append(el("span", "n", String(s.id)));
      const body = el("div", "src");
      const url = safeUrl(s.url);
      body.append(url ? link(url, s.title || url, "src-title") : el("span", "src-title", s.title || "Live data"));
      const meta = el("span", "src-meta", [s.domain, s.authority].filter(Boolean).join(" · "));
      body.append(meta);
      li.append(body);
      ol.append(li);
    }
    box.append(ol);
    return box;
  };

  // ── One assistant turn, built up from the event stream ──
  const createTurn = () => {
    const root = el("div", "msg-bot");
    const meta = el("div", "msg-meta");
    const steps = el("details", "msg-steps");
    const stepsSummary = el("summary", "", "");
    const stepList = el("ol", "");
    steps.append(stepsSummary, stepList);
    steps.open = true;
    const body = el("div", "msg-body");
    const status = el("span", "loading", "Starting…");
    body.append(status);
    root.append(meta, steps, body);

    const sources = new Map();
    const toolRows = new Map();
    let answer = "";
    let drawPending = false;
    let settled = false; // completed or failed: queued streaming redraws must not overwrite the final view
    const started = performance.now();

    const addStep = (text, state = "done") => {
      const li = el("li", `step ${state}`, text);
      stepList.append(li);
      return li;
    };
    const drawAnswer = () => {
      drawPending = false;
      if (settled) return;
      const near = nearBottom();
      body.replaceChildren(markdown(answer, sources));
      body.firstChild.classList.add("streaming");
      follow(near);
    };

    return {
      root,
      event(type, d) {
        const near = nearBottom();
        switch (type) {
          case "status":
            status.textContent = d.message;
            break;
          case "intent.detected": {
            const labels = [...new Set((d.unified ?? []).map((u) => INTENT_LABEL[u]).filter(Boolean))];
            for (const l of labels) meta.append(el("span", "chip", l));
            addStep(`Understood: ${labels.join(", ") || "question"}`);
            break;
          }
          case "tool.started":
            toolRows.set(d.step, addStep(d.label || d.tool, "running"));
            break;
          case "tool.completed": {
            const run = d.run ?? {};
            const row = toolRows.get(run.step);
            const ok = run.status === "ok";
            const text = `${row ? row.textContent : run.tool} · ${ok ? `${(run.ms / 1000).toFixed(1)}s` : run.status === "skipped" ? "skipped" : "unavailable"}`;
            if (row) { row.className = `step ${ok ? "done" : "failed"}`; row.textContent = text; } else addStep(text, ok ? "done" : "failed");
            break;
          }
          case "source.discovered":
            if (d.source) sources.set(d.source.id, d.source);
            break;
          case "model.selected":
            addStep(`Writing the answer (${d.provider} · ${d.model})`);
            status.textContent = "Writing…";
            break;
          case "response.delta":
            answer += d.text ?? "";
            if (!drawPending) { drawPending = true; requestAnimationFrame(drawAnswer); }
            break;
          case "response.completed":
            this.complete(d.response);
            break;
          case "error":
            this.fail(d?.error?.kind);
            break;
        }
        stepsSummary.textContent = `${stepList.childElementCount} step${stepList.childElementCount === 1 ? "" : "s"}`;
        follow(near);
      },
      complete(res) {
        settled = true;
        const near = nearBottom();
        for (const s of res.sources ?? []) sources.set(s.id, s);
        const secs = ((res.timings?.totalMs ?? performance.now() - started) / 1000).toFixed(1);
        stepsSummary.textContent = `${stepList.childElementCount} steps · ${(res.toolRuns ?? []).length} tools · ${secs}s`;
        steps.open = false;
        renderFinal(meta, body, {
          type: res.type,
          provider: res.model?.provider,
          grounded: res.grounded,
          data: res.data ?? {},
          answer: res.answer ?? answer,
          sources: [...sources.values()],
        });
        follow(near);
      },
      fail(kind, status) {
        if (kind === "aborted") return null;
        settled = true;
        steps.open = false;
        const message = friendlyError(kind, status);
        body.replaceChildren(el("p", "msg-error", message));
        return message;
      },
    };
  };

  /** Final view of an answer — shared by a just-completed stream and a conversation restored from storage. */
  function renderFinal(meta, body, view) {
    const typeLabel = TYPE_LABEL[view.type] ?? "Answer";
    for (const c of [...meta.children]) if (c.textContent === typeLabel) c.remove(); // no duplicate chip
    meta.prepend(el("span", "chip type", typeLabel));
    if (view.provider === "dev-mock" && !meta.querySelector(".chip.warn")) meta.append(el("span", "chip warn", "DEV MOCK"));
    const sources = new Map((view.sources ?? []).map((s) => [s.id, s]));
    const parts = [];
    if (view.grounded === false) parts.push(el("p", "notice", "Some live data couldn't be retrieved, so this answer contains no real-time facts for that part."));
    const cards = renderCards(view.data ?? {});
    if (cards) parts.push(cards);
    parts.push(markdown(view.answer ?? "", sources));
    const src = renderSources([...sources.values()].sort((a, b) => a.id - b.id));
    if (src) parts.push(src);
    body.replaceChildren(...parts);
  }

  // ── Conversation view (restored from storage) ─────
  const SUGGESTIONS = [
    ["Research a topic", "Research the latest developments in "],
    ["Analyze a repository", "Analyze https://github.com/"],
    ["Explore Solana", "What's happening on Solana right now?"],
    ["Analyze an asset", "What is the price and liquidity of USDG on Solana?"],
  ];
  const emptyState = () => {
    const box = el("div", "chat-empty");
    box.append(el("p", "empty-logo", "Click"), el("p", "empty-lede", "Ask anything."));
    const list = el("div", "suggestions");
    for (const [label, prompt] of SUGGESTIONS) {
      const b = el("button", "suggestion", label);
      b.type = "button";
      b.addEventListener("click", () => { input.value = prompt; autosize(); input.focus(); input.setSelectionRange(prompt.length, prompt.length); });
      list.append(b);
    }
    box.append(list);
    return box;
  };
  const storedAssistant = (m) => {
    const root = el("div", "msg-bot");
    const meta = el("div", "msg-meta");
    const body = el("div", "msg-body");
    root.append(meta, body);
    if (m.metadata?.error) {
      body.append(el("p", "msg-error", m.metadata.error));
      return root;
    }
    for (const l of [...new Set((m.metadata?.intents ?? []).map((u) => INTENT_LABEL[u]).filter(Boolean))]) meta.append(el("span", "chip", l));
    renderFinal(meta, body, {
      type: m.type,
      provider: m.metadata?.provider,
      grounded: m.metadata?.grounded,
      data: m.metadata?.data ?? {},
      answer: m.content,
      sources: m.sources ?? [],
    });
    return root;
  };
  function renderConversation(id) {
    const c = store.get(id);
    const nodes = (c?.messages ?? []).map((m) => (m.role === "user" ? el("div", "msg-user", m.content) : storedAssistant(m)));
    if (pending && pending.conversationId === id) nodes.push(pending.root);
    log.replaceChildren(...(nodes.length ? nodes : [emptyState()]));
    setChatBrain(nodes.length === 0);
    log.scrollTop = log.scrollHeight;
    renderHistory();
  }

  // ── History sidebar ───────────────────────────────
  const closeConversationMenus = () => {
    let closed = false;
    for (const m of historyList.querySelectorAll(".conv-menu:not([hidden])")) { m.hidden = true; closed = true; }
    for (const b of historyList.querySelectorAll(".conv-menu-btn[aria-expanded='true']")) b.setAttribute("aria-expanded", "false");
    return closed;
  };
  document.addEventListener("click", (e) => { if (!e.target.closest?.(".conv")) closeConversationMenus(); });

  function renderHistory() {
    const items = store.list();
    historyEmpty.hidden = items.length > 0;
    renderRecent(items);
    const now = Date.now();
    historyList.replaceChildren(
      ...items.map((c) => {
        const li = el("li", `conv${c.id === store.activeId ? " active" : ""}`);
        li.dataset.id = c.id;
        const open = el("button", "conv-open");
        open.type = "button";
        open.append(el("span", "conv-title", c.title), el("span", "conv-time", relativeTime(c.updatedAt, now)));
        if (c.id === store.activeId) open.setAttribute("aria-current", "true");
        open.addEventListener("click", () => selectConversation(c.id));

        const menuBtn = el("button", "conv-menu-btn", "⋯");
        menuBtn.type = "button";
        menuBtn.setAttribute("aria-label", `Options for ${c.title}`);
        menuBtn.setAttribute("aria-haspopup", "menu");
        menuBtn.setAttribute("aria-expanded", "false");
        const pop = el("div", "conv-menu");
        pop.setAttribute("role", "menu");
        pop.hidden = true;
        const item = (label, onClick, cls = "") => {
          const b = el("button", cls, label);
          b.type = "button";
          b.setAttribute("role", "menuitem");
          b.addEventListener("click", onClick);
          return b;
        };
        const showActions = () => pop.replaceChildren(item("Rename", () => startRename(li, c)), item("Delete", confirmDelete, "danger"));
        function confirmDelete() {
          pop.replaceChildren(el("span", "confirm-text", "Delete this chat?"), item("Delete", () => deleteConversation(c.id), "danger"), item("Cancel", () => { pop.hidden = true; menuBtn.setAttribute("aria-expanded", "false"); }));
        }
        menuBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const wasOpen = !pop.hidden;
          closeConversationMenus();
          if (!wasOpen) {
            showActions();
            pop.hidden = false;
            menuBtn.setAttribute("aria-expanded", "true");
            pop.querySelector("button")?.focus();
          }
        });
        li.append(open, menuBtn, pop);
        return li;
      }),
    );
  }
  const startRename = (li, c) => {
    const field = el("input", "conv-rename");
    field.type = "text";
    field.value = c.title;
    field.maxLength = 120;
    field.setAttribute("aria-label", "Conversation title");
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      if (save) store.rename(c.id, field.value);
      renderHistory();
    };
    field.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); finish(true); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(false); }
    });
    field.addEventListener("blur", () => finish(true));
    li.replaceChildren(field);
    field.focus();
    field.select();
  };
  const deleteConversation = (id) => {
    const wasActive = store.remove(id);
    if (pending?.conversationId === id) pending = null; // its answer has nowhere to go any more
    if (wasActive) newChat();
    else renderHistory();
  };
  // Keep "2 minutes ago" fresh — but never while a rename or an item menu is open.
  setInterval(() => {
    if (!chat.hidden && !historyList.querySelector(".conv-rename, .conv-menu:not([hidden])")) renderHistory();
  }, 60_000);

  // Server-Sent Events over fetch (EventSource can't POST).
  async function* sse(res) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let cut;
      while ((cut = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, cut);
        buf = buf.slice(cut + 2);
        let event = "message";
        const data = [];
        for (const line of block.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
        }
        if (!data.length) continue;
        try { yield { event, data: JSON.parse(data.join("\n")) }; } catch { /* ignore malformed frame */ }
      }
    }
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const message = input.value.trim();
    if (!message || inflight) return;
    const conversation = store.active() ?? store.create();
    const conversationId = conversation.id;
    // Follow-up context from what was said before this message (bounded: recent turns + structured references).
    const { history, context } = store.contextFor(conversationId);
    store.addMessage(conversationId, { role: "user", content: message });
    setPath(conversationId, false);
    renderConversation(conversationId);

    const turn = createTurn();
    pending = { conversationId, root: turn.root };
    log.append(turn.root);
    log.scrollTop = log.scrollHeight;
    input.value = "";
    autosize();
    submit.disabled = true;
    const ctrl = new AbortController();
    inflight = ctrl;
    let outcome = null; // { response } | { error }
    try {
      const res = await fetch("/chat", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify({ message, stream: true, history, ...(context ? { context } : {}) }),
        signal: ctrl.signal,
      });
      const sseType = (res.headers.get("content-type") || "").includes("text/event-stream");
      if (!res.ok || !res.body || !sseType) {
        const body = await res.json().catch(() => null);
        outcome = { error: turn.fail(body?.error?.kind, res.status) };
      } else {
        for await (const { event, data } of sse(res)) {
          turn.event(event, data);
          if (event === "response.completed") outcome = { response: data.response };
          else if (event === "error") outcome = { error: friendlyError(data?.error?.kind) };
        }
        if (!outcome) outcome = { error: turn.fail("internal") };
      }
    } catch (err) {
      if (err?.name !== "AbortError") outcome = { error: turn.fail("network") };
    } finally {
      inflight = null;
      submit.disabled = false;
      // Persist once, after the answer is complete (never per streamed token).
      const stillThere = store.get(conversationId);
      if (stillThere && outcome?.response) store.addMessage(conversationId, assistantMessageFrom(outcome.response));
      else if (stillThere && outcome?.error) store.addMessage(conversationId, { role: "assistant", content: "", metadata: { error: outcome.error } });
      if (pending?.conversationId === conversationId) pending = null;
      // The visible turn already shows the final answer; if the user switched chats meanwhile, the answer
      // is stored in its own conversation and appears when they go back. Only the list order changes.
      renderHistory();
      if (!chat.hidden) input.focus();
    }
  });

  // ── Landing: "Continue" (recent chats in this browser) ──
  const continueSection = document.getElementById("continue");
  const recentGrid = document.getElementById("recent-grid");
  function renderRecent(items) {
    const recent = items.slice(0, 3);
    continueSection.hidden = recent.length === 0;
    const now = Date.now();
    recentGrid.replaceChildren(
      ...recent.map((c) => {
        const b = el("button", "recent");
        b.type = "button";
        const turns = c.messages.filter((m) => m.role === "user").length;
        b.append(el("span", "recent-title", c.title), el("span", "recent-meta", `${relativeTime(c.updatedAt, now)} · ${turns} question${turns === 1 ? "" : "s"}`));
        b.addEventListener("click", () => openChat({ conversationId: c.id }));
        return b;
      }),
    );
  }

  // ── Ask boxes on the page (hero, "Try it"): what the visitor types is sent as soon as they press Enter
  //    (their explicit action) ──
  const heroInput = document.getElementById("hero-ask-input");
  // The example in the placeholder doesn't fit a phone-width box; there it would be cut off mid-word.
  const heroPlaceholder = heroInput.placeholder;
  const narrow = matchMedia("(max-width: 560px)");
  const fitPlaceholder = () => { heroInput.placeholder = narrow.matches ? "Ask Click anything…" : heroPlaceholder; };
  narrow.addEventListener("change", fitPlaceholder);
  fitPlaceholder();
  for (const askForm of document.querySelectorAll("form[data-ask]")) {
    const field = askForm.querySelector("input");
    askForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const q = field.value.trim();
      if (!q) { field.focus(); return; }
      openChat({ question: q });
      field.value = "";
      form.requestSubmit();
    });
  }

  // ── Landing: live pulse from /api/pulse (real data, cached server-side; rendered as text only) ──
  const pulseSection = document.getElementById("pulse");
  const pulseUpdated = document.getElementById("pulse-updated");
  const pulseBody = (id) => document.querySelector(`#${id} .pulse-body`);
  const askButton = (label, question, cls = "pulse-ask") => {
    const b = el("button", cls, label);
    b.type = "button";
    b.addEventListener("click", () => openChat({ question }));
    return b;
  };
  const kv = (pairs) => {
    const dl = el("dl", "pulse-kv");
    for (const [k, v] of pairs) {
      const d = el("div");
      d.append(el("dt", "", k), el("dd", "", v));
      dl.append(d);
    }
    return dl;
  };
  const poolQuestion = (pool) => `Tell me about the ${pool.name} pool on Solana (pool ${pool.address}): price, liquidity and volume.`;
  // Quick panel (wide screens): the top pool by liquidity, one click to ask about it.
  const quickLive = document.getElementById("quick-live");
  const quickPool = document.getElementById("quick-pool");
  let quickPoolData = null;
  quickPool.addEventListener("click", () => { if (quickPoolData) openChat({ question: poolQuestion(quickPoolData) }); });
  function renderQuickPool(pool) {
    quickPoolData = pool ?? null;
    quickLive.hidden = !pool;
    if (!pool) return;
    const ch = pool.change24hPct;
    const change = el("span", "qp-meta");
    change.append(el("span", ch > 0 ? "up" : ch < 0 ? "down" : "", pct(ch)), " 24h");
    quickPool.replaceChildren(
      el("span", "qp-name", pool.name),
      el("span", "qp-price", usd(pool.priceUsd)),
      change,
      el("span", "qp-meta", `Liq ${usd(pool.liquidityUsd)}`),
    );
  }
  function renderPulse(p) {
    // Chain
    const chainBody = pulseBody("pulse-chain");
    const c = p.chain ?? {};
    if (c.ok) {
      const actions = el("div", "pulse-actions");
      const explorer = safeUrl(c.explorerUrl);
      if (explorer) actions.append(link(explorer, "View slot ↗", "pulse-link"));
      actions.append(askButton("Ask what's happening", "What's happening on Solana right now?"));
      chainBody.replaceChildren(
        el("p", "pulse-big", `#${num(c.slot, { maximumFractionDigits: 0 })}`),
        kv([
          ["Cluster", c.cluster ?? "mainnet-beta"],
          ["Est. TPS", typeof c.estimatedTps === "number" ? num(c.estimatedTps, { maximumFractionDigits: 1 }) : "—"],
          ["Updated", c.fetchedAt ? ago(c.fetchedAt) : "—"],
        ]),
        actions,
      );
    } else {
      chainBody.replaceChildren(
        el("p", "pulse-empty", "Live chain data can't be reached right now (Solana RPC isn't responding). Market data and headlines below are unaffected."),
        el("div", "pulse-actions"),
      );
      chainBody.lastChild.append(askButton("Ask about Solana", "Explain Solana in simple terms: what it is and what it's for."));
    }

    // Market
    const marketBody = pulseBody("pulse-market");
    const pools = p.market?.pools ?? [];
    if (pools.length) {
      const table = el("table", "pool-table");
      const head = el("tr");
      for (const h of ["Pool", "Price", "Liquidity", "Vol 24h", "24h"]) head.append(el("th", "", h));
      const thead = el("thead");
      thead.append(head);
      const tbody = el("tbody");
      // data-label names each figure when phones show a pool as a small block instead of a table row.
      const cell = (text, label, cls = "") => {
        const td = el("td", cls, text);
        if (label) td.dataset.label = label;
        return td;
      };
      for (const pool of pools) {
        const tr = el("tr", "pool-row");
        tr.tabIndex = 0;
        tr.setAttribute("role", "button");
        tr.setAttribute("aria-label", `Ask Click about the ${pool.name} pool`);
        const ch = pool.change24hPct;
        tr.append(
          cell(pool.name),
          cell(usd(pool.priceUsd), "Price"),
          cell(usd(pool.liquidityUsd), "Liquidity"),
          cell(usd(pool.volume24hUsd), "Vol 24h"),
          cell(pct(ch), "", ch > 0 ? "up" : ch < 0 ? "down" : ""),
        );
        const ask = () => openChat({ question: poolQuestion(pool) });
        tr.addEventListener("click", ask);
        tr.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ask(); } });
        tbody.append(tr);
      }
      table.append(thead, tbody);
      const wrap = el("div", "pool-scroll");
      wrap.append(table);
      marketBody.replaceChildren(wrap);
    } else {
      marketBody.replaceChildren(el("p", "pulse-empty", "Market data is unavailable right now."));
    }
    renderQuickPool(pools[0]);

    // News
    const newsBody = pulseBody("pulse-news");
    const headlines = (p.news?.headlines ?? []).filter((h) => safeUrl(h.url));
    if (headlines.length) {
      const ul = el("ul", "headlines");
      for (const h of headlines) {
        const li = el("li");
        const text = el("div");
        text.append(link(safeUrl(h.url), h.title), el("span", "headline-meta", [h.source, h.publishedAt ? ago(h.publishedAt) : ""].filter(Boolean).join(" · ")));
        li.append(text, askButton("Ask", `Summarize this article and why it matters: ${h.url}`));
        ul.append(li);
      }
      newsBody.replaceChildren(ul);
    } else {
      newsBody.replaceChildren(el("p", "pulse-empty", "Headlines are unavailable right now."));
    }

    const t = Date.parse(p.generatedAt);
    pulseUpdated.textContent = Number.isFinite(t) ? `Updated ${new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "";
  }
  let pulseVisible = false;
  let quickShown = false; // the side widgets are showing (wide screens, while reading the sections)
  async function loadPulse() {
    try {
      const res = await fetch("/api/pulse");
      if (!res.ok) throw new Error(String(res.status));
      renderPulse(await res.json());
    } catch {
      for (const id of ["pulse-chain", "pulse-market", "pulse-news"]) pulseBody(id).replaceChildren(el("p", "pulse-empty", "Live data is unavailable right now."));
      pulseUpdated.textContent = "";
      renderQuickPool(null);
    }
  }
  // Loaded right away (cached on the server, no AI involved), so the section already has its full height when
  // someone scrolls or jumps past it from the menu; otherwise the late content would push the target down.
  loadPulse();
  new IntersectionObserver((entries) => {
    pulseVisible = entries.some((e) => e.isIntersecting);
  }, { rootMargin: "300px" }).observe(pulseSection);
  // Refresh every minute while live data is on screen (the section, or the quick panel's top pool) and the
  // tab is visible.
  setInterval(() => {
    if ((pulseVisible || quickShown) && document.visibilityState === "visible" && chat.hidden) loadPulse();
  }, 60_000);

  // ── Landing: live status from /health (booleans only: what this server is configured to use) ──
  const PROVIDER_LABEL = { openrouter: "OpenRouter", gemini: "Gemini", groq: "Groq", "dev-mock": "Dev mock (local only)" };
  const TOOL_LABEL = {
    tavily: "Web search · Tavily", exa: "Web search · Exa", jina: "Page reader · Jina", firecrawl: "Page reader · Firecrawl",
    github: "GitHub", rss: "News feeds", "solana-rpc": "Solana RPC", geckoterminal: "Markets · GeckoTerminal",
  };
  const statusModels = document.getElementById("status-models");
  const statusTools = document.getElementById("status-tools");
  const statusNote = document.getElementById("status-note");
  const statusRefresh = document.getElementById("status-refresh");
  const readyChip = document.getElementById("ready-chip");
  const readyText = document.getElementById("ready-text");
  const statusRows = (entries, labels) =>
    Object.entries(entries ?? {}).map(([id, on]) => {
      const li = el("li");
      li.append(el("span", "", labels[id] ?? id), el("span", `status-dot${on ? " on" : ""}`, on ? "Configured" : "Not set up"));
      return li;
    });
  // Until the check returns, one "Checking…" tile per known model / source keeps the section at its final
  // height, so the sections below don't move while someone is scrolling or jumping to them.
  const checkingRows = (labels) =>
    Object.entries(labels).filter(([id]) => id !== "dev-mock").map(([, label]) => {
      const li = el("li");
      li.append(el("span", "", label), el("span", "status-dot", "Checking…"));
      return li;
    });
  statusModels.replaceChildren(...checkingRows(PROVIDER_LABEL));
  statusTools.replaceChildren(...checkingRows(TOOL_LABEL));
  async function loadStatus() {
    statusRefresh.disabled = true;
    try {
      const res = await fetch("/health", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const h = await res.json();
      statusModels.replaceChildren(...statusRows(h.providers, PROVIDER_LABEL));
      statusTools.replaceChildren(...statusRows(h.tools, TOOL_LABEL));
      const models = Object.values(h.providers ?? {}).filter(Boolean).length;
      const sources = Object.values(h.tools ?? {}).filter(Boolean).length;
      statusNote.textContent = `${models} model provider${models === 1 ? "" : "s"} and ${sources} data source${sources === 1 ? "" : "s"} configured · checked ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. A configured source can still be temporarily unreachable — answers say so when that happens.`;
      readyText.textContent = `${models} AI model${models === 1 ? "" : "s"} · ${sources} data source${sources === 1 ? "" : "s"} configured`;
      readyChip.hidden = models === 0;
    } catch {
      statusModels.replaceChildren(el("li", "status-loading", "Status unavailable"));
      statusTools.replaceChildren(el("li", "status-loading", "Status unavailable"));
      statusNote.textContent = "Couldn't reach the Click server. Is it running?";
      readyChip.hidden = true;
    } finally {
      statusRefresh.disabled = false;
    }
  }
  statusRefresh.addEventListener("click", loadStatus);
  // Checked right away (a tiny request, booleans only) so the section has its final size before anyone
  // scrolls or jumps past it.
  loadStatus();

  // ── Glossary lookup: filters the terms as you type; a term that isn't listed can still be asked ──
  const termSearch = document.getElementById("term-search-input");
  const terms = [...document.querySelectorAll(".glossary .term")];
  const termMiss = document.getElementById("term-miss");
  const termMissAsk = document.getElementById("term-miss-ask");
  let missedTerm = "";
  termSearch.addEventListener("input", () => {
    const raw = termSearch.value.trim().slice(0, 60);
    const q = raw.toLowerCase();
    let shown = 0;
    for (const t of terms) {
      const hit = !q || t.querySelector("dt").textContent.toLowerCase().includes(q) || t.querySelector("dd").textContent.toLowerCase().includes(q);
      t.hidden = !hit;
      if (hit) { shown++; t.classList.add("in"); } // filtered-in terms skip the scroll reveal
    }
    missedTerm = raw;
    termMiss.hidden = !q || shown > 0;
    termMissAsk.textContent = `Ask Click: what is “${raw}”?`;
  });
  termSearch.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !termMiss.hidden) { e.preventDefault(); termMissAsk.click(); }
  });
  // Fills the chat with the question (sent only when the visitor presses Send), like the "Ask" buttons.
  termMissAsk.addEventListener("click", () => {
    if (missedTerm) openChat({ question: `What is "${missedTerm}"? Explain it simply, in the context of Solana and DeFi.` });
  });

  // ── Wide screens: section index (left) and quick actions (right), shown while reading the sections ──
  const pageIndex = document.getElementById("page-index");
  const quick = document.getElementById("quick");
  const indexLinks = new Map([...pageIndex.querySelectorAll("a")].map((a) => [a.hash.slice(1), a]));
  const wide = matchMedia("(min-width: 1440px)"); // where the side widgets exist at all (see styles.css)
  const onMidline = new Set();
  let currentSection = null;
  const setCurrentSection = (id) => {
    currentSection = id;
    for (const [key, a] of indexLinks) {
      if (key === id) a.setAttribute("aria-current", "true");
      else a.removeAttribute("aria-current");
    }
    pageIndex.classList.toggle("show", Boolean(id));
    quick.classList.toggle("show", Boolean(id));
    quickShown = Boolean(id) && wide.matches;
  };
  wide.addEventListener("change", () => setCurrentSection(currentSection));
  // A thin band across the middle of the screen: the section crossing it is the one being read.
  const spy = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) onMidline.add(e.target.id);
      else onMidline.delete(e.target.id);
    }
    setCurrentSection([...indexLinks.keys()].find((id) => onMidline.has(id)) ?? null);
  }, { rootMargin: "-49% 0px -49% 0px" });
  for (const id of indexLinks.keys()) spy.observe(document.getElementById(id));
  document.getElementById("quick-top").addEventListener("click", () => {
    scrollTo({ top: 0 }); // smooth unless the visitor prefers reduced motion (CSS scroll-behavior)
    heroInput.focus({ preventScroll: true });
  });

  // ── Boot: restore a deep-linked conversation (never auto-submits anything) ──
  renderHistory();
  const deepLink = location.pathname.match(CHAT_PATH);
  if (deepLink) {
    if (!store.get(deepLink[1])) setPath(null, false); // unknown here (history is per-browser): start fresh
    openChat({ conversationId: store.get(deepLink[1]) ? deepLink[1] : undefined, push: false });
  } else {
    // From the docs: "/#ask" opens the chat; "/?q=…" opens it with that question filled in — never sent
    // automatically (the visitor presses Send).
    const preset = new URLSearchParams(location.search).get("q")?.trim().slice(0, 4000);
    if (preset || location.hash === "#ask") {
      try { history.replaceState(null, "", "/"); } catch { /* sandboxed: URL stays */ }
      openChat(preset ? { question: preset } : {});
    }
  }

  // Contract address in the footer: click to copy.
  for (const btn of document.querySelectorAll("[data-copy]")) {
    const done = btn.querySelector(".ca-done");
    btn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(btn.dataset.copy);
        if (done) done.textContent = "Copied";
      } catch {
        if (done) done.textContent = "Copy failed";
      }
      setTimeout(() => { if (done) done.textContent = ""; }, 1600);
    });
  }
})();
