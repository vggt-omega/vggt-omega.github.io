/* =====================================================================
   Gallery: one example at a time. Each example =
     top    → composite preview video (auto-playing)
     bottom → interactive Three.js GLB viewer
   Switching uses the same video-thumbnail pattern as the demo teaser.
===================================================================== */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Selected entries. Each name becomes its own selectable example.
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
  "wwm_20260430_11_fps4",
  "lIjGmjqyiZk_0102750_0104550_seg0-1025",
];

// Cache-buster appended to every <video src> so the browser re-fetches when
// we re-encode a clip (browsers cache MP4 bodies aggressively and don't honor
// HTML query-string cache-busters on the parent index.html alone).
const VIDEO_VER = "clean1";
const THUMB_VER = "left1";
const CAMERA_VIEWS_VER = "views1";
const PREVIEW   = "./assets/videos/preview/";
const THUMBS    = "./assets/videos/thumbs/";
const FULL      = "./assets/videos/full/";
// Known portrait clips get a provisional layout before metadata loads. Some
// browser/media combinations expose the encoded dimensions instead of the
// displayed rotated dimensions, so the explicit list is also honored after
// metadata loads.
const PORTRAIT_NAMES = new Set([
  "wwm_20260430_11_fps4",
]);
const REFERENCE_VIDEO_ASPECT = 2580 / 720;
const PORTRAIT_VIDEO_MAX_HEIGHT = 630;
const PORTRAIT_VIDEO_MIN_HEIGHT = 220;
const PORTRAIT_VIDEO_VIEWPORT_RATIO = 0.68;
const portraitVideoLayouts = new Set();
const PAGES = NAMES.map((name) => [name]);
const TOTAL_PAGES = Math.max(1, PAGES.length);
const initialExample = new URLSearchParams(window.location.search).get("example");
const INITIAL_PAGE = Math.max(0, NAMES.indexOf(initialExample));
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

const DEFAULT_THREE_CAMERA = {
  direction: { x: 0.232788, y: 0.200791, z: 0.951574 },
  targetScale: { x: -0.011213, y: -0.007986, z: 0.00858 },
  fitScale: 1.046048,
};
let cameraViews = {
  default: DEFAULT_THREE_CAMERA,
  scenes: {},
};

function updatePortraitVideoLayout(layout) {
  const { panel, video, forcePortrait } = layout;
  if (!panel.isConnected || !video.videoWidth || !video.videoHeight) return;

  const naturalAspect = video.videoWidth / video.videoHeight;
  const aspect = forcePortrait && naturalAspect > 1 ? 1 / naturalAspect : naturalAspect;
  const parentWidth = panel.parentElement?.clientWidth || panel.clientWidth || 720;
  const viewportHeight =
    window.innerHeight || document.documentElement.clientHeight || 900;
  const referenceHeight = parentWidth / REFERENCE_VIDEO_ASPECT;
  const preferredHeight = Math.min(
    PORTRAIT_VIDEO_MAX_HEIGHT,
    viewportHeight * PORTRAIT_VIDEO_VIEWPORT_RATIO,
    Math.max(PORTRAIT_VIDEO_MIN_HEIGHT, referenceHeight),
  );
  const height = Math.max(180, Math.min(preferredHeight, parentWidth / aspect));
  const width = Math.min(parentWidth, height * aspect);

  panel.style.width = `${Math.round(width)}px`;
  panel.style.height = `${Math.round(height)}px`;
}

function updatePortraitVideoLayouts() {
  for (const layout of portraitVideoLayouts) updatePortraitVideoLayout(layout);
}

window.addEventListener("resize", updatePortraitVideoLayouts);

function numericVector(value, fallback) {
  const v = value || {};
  return {
    x: Number.isFinite(v.x) ? v.x : fallback.x,
    y: Number.isFinite(v.y) ? v.y : fallback.y,
    z: Number.isFinite(v.z) ? v.z : fallback.z,
  };
}

function normalizeCameraSpec(spec, fallback = DEFAULT_THREE_CAMERA) {
  if (!spec || typeof spec !== "object") return fallback;
  return {
    direction: numericVector(spec.direction, fallback.direction),
    targetScale: numericVector(spec.targetScale || spec.targetScaleVsMaxDim, fallback.targetScale),
    fitScale: Number.isFinite(spec.fitScale) ? spec.fitScale :
      (Number.isFinite(spec.fitScaleVsBase) ? spec.fitScaleVsBase : fallback.fitScale),
  };
}

async function loadCameraViews() {
  try {
    const response = await fetch(`./camera-views.json?${CAMERA_VIEWS_VER}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const defaultSpec = normalizeCameraSpec(data.default, DEFAULT_THREE_CAMERA);
    const scenes = {};
    for (const [name, spec] of Object.entries(data.scenes || {})) {
      scenes[name] = normalizeCameraSpec(spec, defaultSpec);
    }
    cameraViews = { default: defaultSpec, scenes };
  } catch (error) {
    console.warn("Using built-in camera defaults; failed to load camera-views.json", error);
  }
}

function cameraForScene(name) {
  return cameraViews.scenes[name] || cameraViews.default || DEFAULT_THREE_CAMERA;
}

function applyInitialCamera(camera, controls, maxDim, name) {
  const spec = cameraForScene(name);
  const baseDist = maxDim / (2 * Math.tan(camera.fov * Math.PI / 360));
  controls.target.set(
    maxDim * spec.targetScale.x,
    maxDim * spec.targetScale.y,
    maxDim * spec.targetScale.z
  );
  camera.position.set(
    controls.target.x + baseDist * spec.fitScale * spec.direction.x,
    controls.target.y + baseDist * spec.fitScale * spec.direction.y,
    controls.target.z + baseDist * spec.fitScale * spec.direction.z
  );
  camera.near = baseDist / 200;
  camera.far = baseDist * 100;
  camera.updateProjectionMatrix();
  controls.update();
}

function pretty(name) {
  return name
    .replace(/_fps\d+$/, "")
    .replace(/_uhd$/, "")
    .replace(/__/g, " · ")
    .replace(/_/g, " ");
}

const grid          = document.getElementById("galleryGrid");
const galleryThumbs = document.getElementById("galleryThumbs");
if (grid) {

  let currentPage = 0;
  let thumbButtons = [];

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

  function loadGlbIntoViewer(viewer, url, statusEl, name) {
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
        applyInitialCamera(viewer.camera, viewer.controls, maxDim, name);

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
  function makeRow(name, isPortrait) {
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
        const isPortraitVideo = v.videoHeight > v.videoWidth;
        const shouldUsePortraitLayout = isPortrait || isPortraitVideo;
        const displayedWidth = shouldUsePortraitLayout ?
          Math.min(v.videoWidth, v.videoHeight) : v.videoWidth;
        const displayedHeight = shouldUsePortraitLayout ?
          Math.max(v.videoWidth, v.videoHeight) : v.videoHeight;
        // Use the real media aspect ratio. Tall videos get a bounded height
        // and derive width from that so they don't become overly tall cards.
        vPanel.style.aspectRatio = `${displayedWidth} / ${displayedHeight}`;
        row.classList.toggle("portrait", shouldUsePortraitLayout);
        if (shouldUsePortraitLayout) {
          const layout = { panel: vPanel, video: v, forcePortrait: isPortrait };
          portraitVideoLayouts.add(layout);
          updatePortraitVideoLayout(layout);
        }
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
    loadGlbIntoViewer(viewer, glbPath1M(name), status, name);

    panels.appendChild(viewPanel);
    return row;
  }

  function prepareThumbVideo(video) {
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.setAttribute("muted", "");
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
  }

  function playThumbVideo(video) {
    prepareThumbVideo(video);
    const p = video.play();
    if (p && typeof p.catch === "function") p.catch(() => {});
  }

  function resetThumbVideo(video) {
    video.pause();
    try { video.currentTime = Math.min(0.1, video.duration || 0.1); } catch (_) {}
  }

  function createGalleryThumbnailControls() {
    if (!galleryThumbs) return [];
    galleryThumbs.innerHTML = "";
    return NAMES.map((name, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "gallery-thumb";
      button.dataset.pageIndex = String(index);
      button.setAttribute("aria-label", `Show ${pretty(name)} example`);
      button.setAttribute("aria-pressed", "false");

      const thumb = document.createElement("video");
      prepareThumbVideo(thumb);
      thumb.preload = "metadata";
      thumb.tabIndex = -1;
      thumb.setAttribute("aria-hidden", "true");
      thumb.src = THUMBS + name + ".mp4?" + THUMB_VER;
      thumb.addEventListener("loadedmetadata", () => {
        if (thumb.videoWidth && thumb.videoHeight) {
          button.style.aspectRatio = `${thumb.videoWidth} / ${thumb.videoHeight}`;
        }
        resetThumbVideo(thumb);
      }, { once: true });

      button.appendChild(thumb);
      button.addEventListener("mouseenter", () => playThumbVideo(thumb));
      button.addEventListener("focus", () => playThumbVideo(thumb));
      button.addEventListener("mouseleave", () => resetThumbVideo(thumb));
      button.addEventListener("blur", () => resetThumbVideo(thumb));
      button.addEventListener("click", () => renderPage(index, { scroll: false }));
      galleryThumbs.appendChild(button);
      return button;
    });
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

  // ---- example selection ---------------------------------------------
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
    portraitVideoLayouts.clear();
    grid.innerHTML = "";

    const items = PAGES[page] || [];
    items.forEach((name) => {
      grid.appendChild(makeRow(name, PORTRAIT_NAMES.has(name)));
    });
    renderExampleSelector();

    if (opts && opts.scroll) {
      const sec = document.getElementById("gallery");
      if (sec) sec.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function renderExampleSelector() {
    thumbButtons.forEach((button) => {
      const active = Number(button.dataset.pageIndex) === currentPage;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
      if (active) {
        button.setAttribute("aria-current", "page");
        if (galleryThumbs) {
          const left = button.offsetLeft - (galleryThumbs.clientWidth - button.clientWidth) / 2;
          galleryThumbs.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
        }
      } else {
        button.removeAttribute("aria-current");
      }
    });
  }

  loadCameraViews().finally(() => {
    thumbButtons = createGalleryThumbnailControls();
    renderPage(INITIAL_PAGE, { scroll: false });
  });
}
