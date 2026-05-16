/* =====================================================================
   Gallery: vertical stack of rows. Each row =
     left  → cropped source half of the composite video (auto-playing)
     right → interactive <model-viewer> GLB viewer (1M-point downsample)
   Pagination: 3 rows per page.
===================================================================== */

// 12 top-rated entries. Wide composites are paginated 3 per page; the
// ~square / portrait clips listed in PORTRAIT_NAMES get their own page.
const NAMES = [
  "16539923_uhd_fps4",
  "znz_20260430_11_fps3",
  "znz_20260430_18",
  "3747862_uhd",
  "boat_sailing__speedboat_motor__18031863",
  "DE62PUU1FZg_0018150_0019950_seg0-1025",
  "dyz_20260430_15",
  "loop_closure__temple_castle__31996068_fps4",
  "dyz_20260430_19_fps3",
  "DjaOuqgRWGQ_0041828_0043628_seg0-1025_hstack",
  "lIjGmjqyiZk_0102750_0104550_seg0-1025",
  "wwm_20260430_11_fps4",
];

// Cache-buster appended to every <video src> so the browser re-fetches when
// we re-encode a clip (browsers cache MP4 bodies aggressively and don't honor
// HTML query-string cache-busters on the parent index.html alone).
const VIDEO_VER = "clean1";
const PREVIEW   = "./assets/videos/preview/";
const FULL      = "./assets/videos/full/";
const PAGE_SIZE = 3;
// Videos whose composite is narrow / portrait — detect via aspect ratio after
// loadedmetadata and add .portrait to the row for a different grid layout.
const NARROW_THRESHOLD = 2.0;  // width/height < this → portrait row
// Clips that are NOT the wide side-by-side composite (≈square / portrait,
// width/height < NARROW_THRESHOLD). They break the wide-row layout, so they
// are pulled out and shown together on their own dedicated page.
const PORTRAIT_NAMES = new Set([
  "wwm_20260430_11_fps4",
]);
const LANDSCAPE = NAMES.filter((n) => !PORTRAIT_NAMES.has(n));
const PORTRAIT  = NAMES.filter((n) =>  PORTRAIT_NAMES.has(n));
// Page model: wide composites in PAGE_SIZE-chunks, then one page that holds
// all portrait clips (only added if there are any).
const PAGES = [];
for (let i = 0; i < LANDSCAPE.length; i += PAGE_SIZE) {
  PAGES.push(LANDSCAPE.slice(i, i + PAGE_SIZE));
}
if (PORTRAIT.length) PAGES.push(PORTRAIT.slice());
const TOTAL_PAGES = Math.max(1, PAGES.length);
// Downsampled GLBs (~1M points each, ~17 MB) — committed in the repo.
const GLB_1M_DIR   = "./assets/glb/";
// A handful of entries store their GLB under a slightly different name than
// the video filename. Map them explicitly here.
const GLB_NAME_OVERRIDES = {
  "DjaOuqgRWGQ_0041828_0043628_seg0-1025_hstack": "DjaOuqgRWGQ_0041828_0043628_seg0-1025",
};
const GLB_VER = "clean1";
function glbPath1M(name) { return GLB_1M_DIR + (GLB_NAME_OVERRIDES[name] || name) + ".glb?" + GLB_VER; }
const INITIAL_CAMERA = {
  theta: -0.082163,
  phi: 0.808258,
  radiusScale: 1.057403,
};

const grid       = document.getElementById("galleryGrid");
const pagerPages = document.getElementById("pagerPages");
const pagerEl    = document.getElementById("galleryPager");
if (grid) {

  let currentPage = 0;

  // ---- row factory ----------------------------------------------------
  function makeRow(name, globalIndex, isPortrait) {
    const row = document.createElement("article");
    row.className = "row";
    row.dataset.name = name;
    // Portrait clips live on their own page: tag the row up front so the
    // layout is correct before video metadata loads (which then refines the
    // exact aspect ratio in the loadedmetadata handler below).
    if (isPortrait) row.classList.add("portrait");

    const panels = document.createElement("div");
    panels.className = "row-panels";
    row.appendChild(panels);

    // LEFT: full composite (input | render orbit). Use native controls for
    // fullscreen / play / scrub — no custom click handler to avoid fighting
    // the default video UI.
    const vPanel = document.createElement("div");
    vPanel.className = "row-video";
    // Sensible square default for portrait clips so they render correctly
    // even before loadedmetadata overrides .row-video's wide aspect ratio.
    if (isPortrait) vPanel.style.aspectRatio = "1 / 1";
    const v = document.createElement("video");
    v.muted = true;
    v.loop = true;
    v.autoplay = true;
    v.playsInline = true;
    v.preload = "auto";
    v.controls = true;
    v.controlsList = "nodownload";
    // Default to the small preview tier so the page loads fast.  We swap to
    // the full-quality encode on fullscreen (see fullscreenchange listener
    // outside makeRow) so users only pay for the full encode when they ask
    // to see it big.
    v.dataset.previewSrc = PREVIEW + name + ".mp4?" + VIDEO_VER;
    v.dataset.fullSrc    = FULL    + name + ".mp4?" + VIDEO_VER;
    v.src = v.dataset.previewSrc;
    v.addEventListener("loadedmetadata", () => {
      if (v.videoWidth && v.videoHeight) {
        const aspect = v.videoWidth / v.videoHeight;
        // Size each video panel from its real media dimensions: common width,
        // height follows the video's aspect ratio instead of a fixed default.
        vPanel.style.aspectRatio = `${v.videoWidth} / ${v.videoHeight}`;
        if (aspect < NARROW_THRESHOLD) row.classList.add("portrait");
      }
    }, { once: true });
    v.addEventListener("loadeddata", () => {
      const p = v.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
    }, { once: true });
    // Click the video → fullscreen (which then triggers the quality swap).
    // Bottom strip is the native controls UI; clicks there should not be
    // hijacked.
    v.addEventListener("click", (e) => {
      const r = v.getBoundingClientRect();
      if (r.bottom - e.clientY < 48) return;     // ignore clicks on controls
      if (document.fullscreenElement === v) {
        document.exitFullscreen?.();
      } else if (v.requestFullscreen) {
        v.requestFullscreen();
      } else if (v.webkitRequestFullscreen) {
        v.webkitRequestFullscreen();
      }
    });
    vPanel.appendChild(v);
    panels.appendChild(vPanel);

    // RIGHT: GLB viewer — <model-viewer> on the 1M-point downsampled GLB.
    const viewPanel = document.createElement("div");
    viewPanel.className = "row-viewer active";
    viewPanel.dataset.name = name;
    viewPanel.dataset.tier = "1m";

    const mv = document.createElement("model-viewer");
    mv.className = "viewer-mv";
    mv.setAttribute("alt", "3D Model");
    mv.setAttribute("loading", "eager");
    mv.setAttribute("touch-action", "pan-y");
    mv.setAttribute("environment-image", "legacy");
    mv.setAttribute("camera-orbit", `${INITIAL_CAMERA.theta}rad ${INITIAL_CAMERA.phi}rad auto`);
    mv.setAttribute("zoom-sensitivity", "0.2");
    mv.setAttribute("camera-controls", "");
    mv.setAttribute("disable-tap", "");
    mv.setAttribute("min-camera-orbit", "auto auto 1m");
    mv.setAttribute("max-camera-orbit", "auto auto 10m");
    mv.setAttribute("interaction-prompt", "none");
    mv.setAttribute("shadow-intensity", "0");
    mv.setAttribute("disable-shadow", "");
    mv.setAttribute("ar", "");
    mv.setAttribute("ar-modes", "webxr scene-viewer quick-look");
    mv.setAttribute("src", glbPath1M(name));
    viewPanel.appendChild(mv);

    const status = document.createElement("div");
    status.className = "viewer-status";
    status.textContent = "Loading 3D…";
    viewPanel.appendChild(status);
    mv.addEventListener("load", () => {
      status.style.display = "none";
      // Bring the camera in tighter than model-viewer's auto-framing.
      try {
        const o = mv.getCameraOrbit();
        mv.cameraOrbit = `${INITIAL_CAMERA.theta}rad ${INITIAL_CAMERA.phi}rad ${o.radius * INITIAL_CAMERA.radiusScale}m`;
        mv.jumpCameraToGoal();
      } catch (_) {}
    });
    mv.addEventListener("progress", (e) => {
      const p = e.detail?.totalProgress;
      if (p == null) return;
      if (p >= 1) {
        status.style.display = "none";
      } else {
        status.style.display = "";
        status.textContent = `Loading… ${Math.round(p * 100)}%`;
      }
    });
    mv.addEventListener("error", () => {
      status.style.display = "";
      status.classList.add("error");
      status.textContent = "Failed to load 3D scene";
    });

    // Toolbar over the viewer (top-right): "Open full point cloud ↗" link.
    // Clicking opens a dedicated standalone viewer page in a new tab so the
    // heavy full-res GLB doesn't slow this row down.
    const toolbar = document.createElement("div");
    toolbar.className = "viewer-toolbar";
    const openBtn = document.createElement("a");
    openBtn.className = "vb-btn open-full";
    openBtn.href = "./viewer.html?name=" + encodeURIComponent(name);
    openBtn.target = "_blank";
    openBtn.rel = "noopener";
    openBtn.title = "Open the full (un-downsampled) point cloud in a new tab";
    openBtn.innerHTML =
      `<span class="vb-dot"></span>` +
      `<span class="vb-label">Open Full 3D Viewer</span>`;
    toolbar.appendChild(openBtn);
    viewPanel.appendChild(toolbar);

    panels.appendChild(viewPanel);
    return row;
  }

  // ---- quality swap on fullscreen ------------------------------------
  // While not in fullscreen we serve the small preview encode (~1-5 MB).
  // When the user enters fullscreen on a row's video, swap to the full
  // 720p encode, restoring playback position. Swap back on exit.
  let lastFsVideo = null;
  function swapVideoQuality(v, newSrc) {
    if (!v || !newSrc) return;
    // preview and full URLs share the same basename — only the parent
    // directory ("preview" vs "full") differs. Compare a directory-aware
    // suffix so the swap actually fires.
    function tail(u) {
      const parts = (u || "").split('/');
      return parts.slice(-2).join('/');   // "<tier>/<name>.mp4?<ver>"
    }
    if (tail(v.src) === tail(newSrc)) return;
    const t       = v.currentTime;
    const playing = !v.paused;
    v.src = newSrc;
    v.addEventListener("loadedmetadata", () => {
      try { v.currentTime = t; } catch (_) {}
      if (playing) { const p = v.play(); if (p?.catch) p.catch(() => {}); }
    }, { once: true });
  }
  document.addEventListener("fullscreenchange", () => {
    const fs = document.fullscreenElement;
    if (fs && fs.tagName === "VIDEO" && fs.dataset.fullSrc) {
      swapVideoQuality(fs, fs.dataset.fullSrc);
      lastFsVideo = fs;
    } else if (lastFsVideo) {
      swapVideoQuality(lastFsVideo, lastFsVideo.dataset.previewSrc);
      lastFsVideo = null;
    }
  });

  // ---- pagination -----------------------------------------------------
  function renderPage(page, opts) {
    page = Math.max(0, Math.min(page, TOTAL_PAGES - 1));
    currentPage = page;

    // tear down current page: stop videos, drop model-viewers
    grid.querySelectorAll("video").forEach((vid) => {
      try { vid.pause(); } catch (_) {}
      vid.removeAttribute("src");
      vid.load();
    });
    grid.innerHTML = "";

    const items = PAGES[page] || [];
    items.forEach((name, i) => {
      grid.appendChild(makeRow(name, i, PORTRAIT_NAMES.has(name)));
    });
    renderPager();

    if (opts && opts.scroll) {
      const sec = document.getElementById("gallery");
      if (sec) sec.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function renderPager() {
    if (!pagerPages) return;
    pagerPages.innerHTML = "";
    for (let p = 0; p < TOTAL_PAGES; p++) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "pager-num" + (p === currentPage ? " active" : "");
      b.textContent = String(p + 1);
      if (p === currentPage) b.setAttribute("aria-current", "page");
      b.addEventListener("click", () => renderPage(p, { scroll: true }));
      pagerPages.appendChild(b);
    }
    if (pagerEl) {
      const prev = pagerEl.querySelector('[data-pager="prev"]');
      const next = pagerEl.querySelector('[data-pager="next"]');
      if (prev) prev.disabled = (currentPage === 0);
      if (next) next.disabled = (currentPage === TOTAL_PAGES - 1);
    }
  }

  if (pagerEl) {
    pagerEl.addEventListener("click", (e) => {
      const t = e.target.closest("[data-pager]");
      if (!t) return;
      const dir = t.getAttribute("data-pager");
      if (dir === "prev") renderPage(currentPage - 1, { scroll: true });
      else if (dir === "next") renderPage(currentPage + 1, { scroll: true });
    });
  }

  renderPage(0, { scroll: false });
}
