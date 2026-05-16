/* =====================================================================
   Gallery: vertical stack of rows. Each row =
     left  → cropped source half of the composite video (auto-playing)
     right → interactive Three.js GLB viewer (click to load on demand)
   Pagination: 3 rows per page.
===================================================================== */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

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
// Full-resolution GLBs (3-13M points, 60-470 MB each) — hosted on Hugging Face.
const GLB_FULL_DIR = "https://huggingface.co/datasets/silentchen/vggt-omega-glbs-full/resolve/main/";
// A handful of entries store their GLB under a slightly different name than
// the video filename. Map them explicitly here.
const GLB_NAME_OVERRIDES = {
  "DjaOuqgRWGQ_0041828_0043628_seg0-1025_hstack": "DjaOuqgRWGQ_0041828_0043628_seg0-1025",
};
const GLB_VER = "clean1";
function glbPath1M(name)   { return GLB_1M_DIR   + (GLB_NAME_OVERRIDES[name] || name) + ".glb?" + GLB_VER; }
function glbPathFull(name) { return GLB_FULL_DIR + (GLB_NAME_OVERRIDES[name] || name) + ".glb?" + GLB_VER; }

function pretty(name) {
  return name
    .replace(/_fps\d+$/, "")
    .replace(/_uhd$/, "")
    .replace(/__/g, " · ")
    .replace(/_/g, " ");
}

const grid       = document.getElementById("galleryGrid");
const pagerPages = document.getElementById("pagerPages");
const pagerEl    = document.getElementById("galleryPager");
if (grid) {

  let currentPage = 0;

  // ---- viewer state ---------------------------------------------------
  const loader = new GLTFLoader();
  const activeViewers = [];   // {renderer, scene, camera, controls, model, canvas}
  const MAX_POINTS = 600000;  // budget per point cloud for fluid orbit

  function downsamplePoints(root, maxN) {
    let totalBefore = 0, totalAfter = 0;
    root.traverse(c => {
      if (!c.isPoints || !c.geometry?.attributes?.position) return;
      const pos = c.geometry.attributes.position;
      const n = pos.count;
      totalBefore += n;
      if (n <= maxN) { totalAfter += n; return; }
      const stride = n / maxN;
      const newPos = new Float32Array(maxN * 3);
      for (let i = 0; i < maxN; i++) {
        const s = Math.floor(i * stride);
        newPos[i*3]   = pos.array[s*3];
        newPos[i*3+1] = pos.array[s*3+1];
        newPos[i*3+2] = pos.array[s*3+2];
      }
      c.geometry.setAttribute('position', new THREE.BufferAttribute(newPos, 3));
      const col = c.geometry.attributes.color;
      if (col) {
        const Ctor = col.array.constructor;
        const newCol = new Ctor(maxN * col.itemSize);
        for (let i = 0; i < maxN; i++) {
          const s = Math.floor(i * stride);
          for (let j = 0; j < col.itemSize; j++) {
            newCol[i*col.itemSize + j] = col.array[s*col.itemSize + j];
          }
        }
        c.geometry.setAttribute('color',
          new THREE.BufferAttribute(newCol, col.itemSize, col.normalized));
      }
      for (const k of Object.keys(c.geometry.attributes)) {
        if (k !== 'position' && k !== 'color') c.geometry.deleteAttribute(k);
      }
      c.geometry.setIndex(null);
      c.geometry.computeBoundingBox();
      c.geometry.computeBoundingSphere();
      totalAfter += maxN;
    });
    return { before: totalBefore, after: totalAfter };
  }

  function buildCamsViz(extras) {
    const flat = extras?.cam_from_worlds || [];
    const N = extras?.frame_count || 0;
    if (!flat.length || !N) return null;
    const positions = new Float32Array(N * 3);
    const colors    = new Float32Array(N * 3);
    const tmpC2W = new THREE.Matrix4();
    const tmpP   = new THREE.Vector3();
    const tmpCol = new THREE.Color();
    for (let i = 0; i < N; i++) {
      const off = i * 16;
      tmpC2W.set(
        flat[off+0],  flat[off+1],  flat[off+2],  flat[off+3],
        flat[off+4],  flat[off+5],  flat[off+6],  flat[off+7],
        flat[off+8],  flat[off+9],  flat[off+10], flat[off+11],
        flat[off+12], flat[off+13], flat[off+14], flat[off+15]
      ).invert();
      tmpP.setFromMatrixPosition(tmpC2W);
      positions[i*3]   = tmpP.x;
      positions[i*3+1] = tmpP.y;
      positions[i*3+2] = tmpP.z;
      tmpCol.setHSL((i / Math.max(N - 1, 1)) * 0.83, 1.0, 0.5);
      colors[i*3]   = tmpCol.r;
      colors[i*3+1] = tmpCol.g;
      colors[i*3+2] = tmpCol.b;
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.setAttribute('color',    new THREE.Float32BufferAttribute(colors, 3));
    const dotMat = new THREE.PointsMaterial({
      size: 6,
      sizeAttenuation: false,
      vertexColors: true,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const dots = new THREE.Points(geom, dotMat);
    dots.renderOrder = 999;
    const lineMat = new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.55,
      depthTest: false, depthWrite: false,
    });
    const line = new THREE.Line(geom, lineMat);
    line.renderOrder = 998;
    const g = new THREE.Group();
    g.add(dots);
    g.add(line);
    return g;
  }

  function disposeModel(viewer) {
    if (!viewer.model) return;
    viewer.scene.remove(viewer.model);
    viewer.model.traverse(c => {
      if (c.geometry) c.geometry.dispose();
      if (c.material) {
        const mats = Array.isArray(c.material) ? c.material : [c.material];
        mats.forEach(m => {
          for (const k of Object.keys(m)) if (m[k]?.isTexture) m[k].dispose();
          m.dispose();
        });
      }
    });
    viewer.model = null;
  }

  function makeViewer(canvas) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf5f5f5);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 2000);
    camera.position.set(2, 1.2, 3);
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    scene.add(new THREE.AmbientLight(0xffffff, 1.6));
    const d1 = new THREE.DirectionalLight(0xffffff, 1.6); d1.position.set( 5, 8,  5); scene.add(d1);
    const d2 = new THREE.DirectionalLight(0xffffff, 0.9); d2.position.set(-3, 4, -5); scene.add(d2);
    return { canvas, renderer, scene, camera, controls, model: null };
  }

  function loadGlbIntoViewer(viewer, url, statusEl) {
    return new Promise((resolve) => {
      if (statusEl) statusEl.style.display = '';
      loader.load(url, (gltf) => {
        disposeModel(viewer);
        viewer.model = gltf.scene;
        viewer.scene.add(viewer.model);
        downsamplePoints(viewer.model, MAX_POINTS);
        const extras = gltf.parser?.json?.extras || {};
        const camsViz = buildCamsViz(extras);
        if (camsViz) viewer.model.add(camsViz);

        // center + frame
        const box  = new THREE.Box3().setFromObject(viewer.model);
        const sz   = box.getSize(new THREE.Vector3());
        const ctr  = box.getCenter(new THREE.Vector3());
        viewer.model.position.sub(ctr);
        const maxDim = Math.max(sz.x, sz.y, sz.z) || 1;
        const dist = maxDim / (2 * Math.tan(viewer.camera.fov * Math.PI / 360)) * 0.85;
        viewer.camera.position.set(dist * 0.38, dist * 0.24, dist * 0.72);
        viewer.camera.near = dist / 200;
        viewer.camera.far  = dist * 100;
        viewer.camera.updateProjectionMatrix();
        viewer.controls.target.set(0, 0, 0);
        viewer.controls.update();

        if (statusEl) {
          statusEl.textContent = '';
          statusEl.style.display = 'none';
        }
        resolve(viewer);
      },
      (p) => {
        if (statusEl && p.total) {
          statusEl.style.display = '';
          statusEl.textContent = `Loading… ${Math.round(p.loaded / p.total * 100)}%`;
        } else if (statusEl) {
          statusEl.style.display = '';
          statusEl.textContent = `Loading… ${(p.loaded / 1e6).toFixed(1)} MB`;
        }
      },
      (err) => {
        console.warn('GLB load failed', url, err);
        if (statusEl) {
          statusEl.style.display = '';
          statusEl.textContent = 'Failed to load 3D scene';
        }
        resolve(null);
      });
    });
  }

  // Shared animation loop runs every active viewer.
  function tick() {
    requestAnimationFrame(tick);
    for (const v of activeViewers) {
      v.controls.update();
      const r = v.canvas.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      const w = Math.floor(r.width), h = Math.floor(r.height);
      if (v.canvas.width !== w || v.canvas.height !== h) {
        v.renderer.setSize(w, h, false);
        v.camera.aspect = w / h;
        v.camera.updateProjectionMatrix();
      }
      v.renderer.render(v.scene, v.camera);
    }
  }
  tick();

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
      // Detect narrow / portrait videos and tag the row for CSS layout change
      if (v.videoWidth && v.videoHeight && (v.videoWidth / v.videoHeight) < NARROW_THRESHOLD) {
        row.classList.add("portrait");
        vPanel.style.aspectRatio = `${v.videoWidth} / ${v.videoHeight}`;
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

    // RIGHT: GLB viewer — auto-loaded with the 1M-point downsampled GLB.
    //         Has a "Full point cloud" toggle to swap in the original.
    const viewPanel = document.createElement("div");
    viewPanel.className = "row-viewer active";
    viewPanel.dataset.name = name;
    viewPanel.dataset.tier = "1m";

    const canvas = document.createElement("canvas");
    canvas.className = "viewer-canvas";
    viewPanel.appendChild(canvas);

    const status = document.createElement("div");
    status.className = "viewer-status";
    status.textContent = "Loading 3D…";
    viewPanel.appendChild(status);

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

    // Build the viewer and start loading the 1M GLB right away.
    const viewer = makeViewer(canvas);
    activeViewers.push(viewer);
    loadGlbIntoViewer(viewer, glbPath1M(name), status);

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

    // tear down current page: stop videos, dispose viewers
    grid.querySelectorAll("video").forEach((vid) => {
      try { vid.pause(); } catch (_) {}
      vid.removeAttribute("src");
      vid.load();
    });
    while (activeViewers.length) {
      const v = activeViewers.pop();
      try { disposeModel(v); v.controls.dispose(); v.renderer.dispose(); } catch (_) {}
    }
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
