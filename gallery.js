/* =====================================================================
   Gallery: one example at a time. Each example =
     top    → composite preview video (auto-playing)
     bottom → Google model-viewer with a transparent camera-trajectory overlay
   Switching uses the same video-thumbnail pattern as the demo teaser.
===================================================================== */

import * as THREE from 'three';

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
const VIDEO_VER = "clean2";
const THUMB_VER = "thumb-compressed-2";
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
const MODEL_VIEWER_MIN_RADIUS_SCALE = 0.5;
const MODEL_VIEWER_MAX_RADIUS_SCALE = 3.5;
const MODEL_VIEWER_FOV_DEG = 45;

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
    const response = await fetch(`./camera-views.json?${CAMERA_VIEWS_VER}`);
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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function directionToModelViewerOrbit(direction) {
  const len = Math.hypot(direction.x, direction.y, direction.z) || 1;
  const x = direction.x / len;
  const y = direction.y / len;
  const z = direction.z / len;
  return {
    theta: Math.atan2(x, z),
    phi: Math.acos(clamp(y, -1, 1)),
  };
}

function vectorOrZero(value) {
  return value && Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z)
    ? value
    : { x: 0, y: 0, z: 0 };
}

function runWhenIdle(callback) {
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(callback, { timeout: 1000 });
  } else {
    window.setTimeout(callback, 0);
  }
}

function applyInitialModelViewerCamera(viewer, name) {
  const spec = cameraForScene(name);
  const dimensions = viewer.getDimensions ? viewer.getDimensions() : null;
  const center = vectorOrZero(viewer.getBoundingBoxCenter ? viewer.getBoundingBoxCenter() : null);
  const maxDim = Math.max(dimensions?.x || 0, dimensions?.y || 0, dimensions?.z || 0) || 1;
  const fov = Number.isFinite(viewer.getFieldOfView?.())
    ? viewer.getFieldOfView()
    : MODEL_VIEWER_FOV_DEG;
  const baseDist = maxDim / (2 * Math.tan(fov * Math.PI / 360));
  const radius = Math.max(baseDist * spec.fitScale, 0.001);
  const target = {
    x: center.x + maxDim * spec.targetScale.x,
    y: center.y + maxDim * spec.targetScale.y,
    z: center.z + maxDim * spec.targetScale.z,
  };
  const orbit = directionToModelViewerOrbit(spec.direction);

  viewer.cameraTarget = `${target.x}m ${target.y}m ${target.z}m`;
  viewer.setAttribute('min-camera-orbit', `auto auto ${radius * MODEL_VIEWER_MIN_RADIUS_SCALE}m`);
  viewer.setAttribute('max-camera-orbit', `auto auto ${radius * MODEL_VIEWER_MAX_RADIUS_SCALE}m`);
  viewer.cameraOrbit = `${orbit.theta}rad ${orbit.phi}rad ${radius}m`;
  if (viewer.resetTurntableRotation) viewer.resetTurntableRotation(0);
  if (viewer.jumpCameraToGoal) viewer.jumpCameraToGoal();
}

function prepareModelViewerCameraAngles(viewer, name) {
  if (!viewer) return;
  const spec = cameraForScene(name);
  const orbit = directionToModelViewerOrbit(spec.direction);
  viewer.removeAttribute('camera-target');
  viewer.setAttribute('camera-orbit', `${orbit.theta}rad ${orbit.phi}rad auto`);
  viewer.setAttribute('min-camera-orbit', `auto auto ${MODEL_VIEWER_MIN_RADIUS_SCALE * 100}%`);
  viewer.setAttribute('max-camera-orbit', `auto auto ${MODEL_VIEWER_MAX_RADIUS_SCALE * 100}%`);
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
  const activeOverlays = [];
  const GLB_MAGIC = 0x46546c67;
  const GLB_JSON_CHUNK_TYPE = 0x4e4f534a;

  function concatChunks(chunks, length) {
    const out = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      if (offset >= length) break;
      const slice = chunk.subarray(0, Math.min(chunk.byteLength, length - offset));
      out.set(slice, offset);
      offset += slice.byteLength;
    }
    return out;
  }

  function parseGlbJsonBytes(bytes) {
    if (bytes.byteLength < 20) throw new Error("Invalid GLB header");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(0, true) !== GLB_MAGIC) throw new Error("Expected GLB magic");
    const jsonLength = view.getUint32(12, true);
    const jsonType = view.getUint32(16, true);
    if (jsonType !== GLB_JSON_CHUNK_TYPE) throw new Error("Expected GLB JSON chunk");
    const jsonStart = 20;
    const jsonEnd = jsonStart + jsonLength;
    if (bytes.byteLength < jsonEnd) throw new Error("Incomplete GLB JSON chunk");
    const jsonText = new TextDecoder("utf-8").decode(bytes.subarray(jsonStart, jsonEnd)).trim();
    return JSON.parse(jsonText);
  }

  async function loadGlbJson(url, signal) {
    const response = await fetch(url, { cache: "force-cache", signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (!response.body) {
      return parseGlbJsonBytes(new Uint8Array(await response.arrayBuffer()));
    }

    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;
    let jsonEnd = 0;

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.byteLength;

        if (!jsonEnd && received >= 20) {
          const header = concatChunks(chunks, 20);
          const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
          if (view.getUint32(0, true) !== GLB_MAGIC) throw new Error("Expected GLB magic");
          if (view.getUint32(16, true) !== GLB_JSON_CHUNK_TYPE) {
            throw new Error("Expected GLB JSON chunk");
          }
          jsonEnd = 20 + view.getUint32(12, true);
        }

        if (jsonEnd && received >= jsonEnd) {
          const bytes = concatChunks(chunks, jsonEnd);
          await reader.cancel();
          return parseGlbJsonBytes(bytes);
        }
      }
    } finally {
      reader.releaseLock();
    }

    return parseGlbJsonBytes(concatChunks(chunks, received));
  }

  async function loadGlbExtras(url, signal) {
    const json = await loadGlbJson(url, signal);
    return json.extras || {};
  }

  function buildCamsViz(extras) {
    const flat = extras?.cam_from_worlds || [];
    const N = Math.min(extras?.frame_count || 0, Math.floor(flat.length / 16));
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

  function disposeObject3D(root) {
    root.traverse(c => {
      if (c.geometry) c.geometry.dispose();
      if (c.material) {
        const mats = Array.isArray(c.material) ? c.material : [c.material];
        mats.forEach(m => {
          for (const k of Object.keys(m)) if (m[k]?.isTexture) m[k].dispose();
          m.dispose();
        });
      }
    });
  }

  function syncOverlayCamera(modelViewer, camera, canvas) {
    let orbit, target, fov;
    try {
      orbit = modelViewer.getCameraOrbit();
      target = vectorOrZero(modelViewer.getCameraTarget ? modelViewer.getCameraTarget() : null);
      fov = modelViewer.getFieldOfView ? modelViewer.getFieldOfView() : MODEL_VIEWER_FOV_DEG;
    } catch (_) {
      return false;
    }

    if (!orbit || !Number.isFinite(orbit.radius) || orbit.radius <= 0) return false;
    const rect = canvas.getBoundingClientRect();
    const aspect = rect.width > 0 && rect.height > 0 ? rect.width / rect.height : 1;
    const sinPhi = Math.sin(orbit.phi);
    camera.position.set(
      target.x + orbit.radius * sinPhi * Math.sin(orbit.theta),
      target.y + orbit.radius * Math.cos(orbit.phi),
      target.z + orbit.radius * sinPhi * Math.cos(orbit.theta)
    );
    camera.up.set(0, 1, 0);
    camera.lookAt(target.x, target.y, target.z);
    camera.fov = Number.isFinite(fov) ? fov : MODEL_VIEWER_FOV_DEG;
    camera.aspect = aspect;

    const dimensions = modelViewer.getDimensions ? modelViewer.getDimensions() : null;
    const maxDim = Math.max(dimensions?.x || 0, dimensions?.y || 0, dimensions?.z || 0, orbit.radius, 1);
    camera.near = Math.max(maxDim / 10000, 0.0001);
    camera.far = Math.max(maxDim * 100, orbit.radius * 10, 1000);
    camera.updateProjectionMatrix();
    return true;
  }

  function createTrajectoryOverlay(canvas, modelViewer) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(MODEL_VIEWER_FOV_DEG, 1, 0.0001, 1000);
    const abortController = new AbortController();
    let trajectory = null;
    let disposed = false;
    let frameId = 0;
    let renderWidth = 0;
    let renderHeight = 0;
    let loading = false;
    let loadedUrl = "";

    function tick() {
      if (disposed) return;
      frameId = requestAnimationFrame(tick);
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const width = Math.floor(rect.width);
      const height = Math.floor(rect.height);
      if (renderWidth !== width || renderHeight !== height) {
        renderWidth = width;
        renderHeight = height;
        renderer.setSize(width, height, false);
      }
      if (syncOverlayCamera(modelViewer, camera, canvas)) {
        renderer.render(scene, camera);
      }
    }

    function startTicking() {
      if (!frameId) frameId = requestAnimationFrame(tick);
    }

    function load(url) {
      if (!url || disposed || loading || loadedUrl === url) return;
      loading = true;
      loadGlbExtras(url, abortController.signal)
        .then((extras) => {
          if (disposed) return;
          loadedUrl = url;
          trajectory = buildCamsViz(extras);
          if (trajectory) {
            scene.add(trajectory);
            startTicking();
          }
        })
        .catch((error) => {
          if (error?.name !== "AbortError") {
            console.warn("Camera trajectory load failed", url, error);
          }
        })
        .finally(() => {
          loading = false;
        });
    }

    return {
      load,
      dispose() {
        disposed = true;
        if (frameId) cancelAnimationFrame(frameId);
        abortController.abort();
        if (trajectory) {
          scene.remove(trajectory);
          disposeObject3D(trajectory);
          trajectory = null;
        }
        renderer.dispose();
      },
    };
  }

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

    // TOP: full composite (input RGB | point-of-view render). Use native controls for
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

    // BOTTOM: interactive GLB viewer; model-viewer handles the point cloud, and the transparent
    // canvas on top only draws the camera trajectory from GLB extras.
    const viewPanel = document.createElement("div");
    viewPanel.className = "row-viewer active model-viewer-camera-pending";
    viewPanel.dataset.name = name;
    viewPanel.dataset.tier = "1m";

    const glbUrl = glbPath1M(name);
    let cameraToken = 0;

    function setCameraPending(pending) {
      viewPanel.classList.toggle("model-viewer-camera-pending", pending);
      modelViewer.classList.toggle("model-viewer-camera-pending", pending);
      trajectoryCanvas.classList.toggle("model-viewer-camera-pending", pending);
    }

    function hideStatus() {
      status.textContent = "";
      status.style.display = "none";
    }

    const modelViewer = document.createElement("model-viewer");
    modelViewer.className = "viewer-model";
    modelViewer.setAttribute("loading", "lazy");
    modelViewer.setAttribute("touch-action", "pan-y");
    modelViewer.setAttribute("environment-image", "legacy");
    modelViewer.setAttribute("zoom-sensitivity", "0.2");
    modelViewer.setAttribute("field-of-view", `${MODEL_VIEWER_FOV_DEG}deg`);
    modelViewer.setAttribute("camera-controls", "");
    modelViewer.setAttribute("disable-tap", "");
    modelViewer.setAttribute("interaction-prompt", "none");
    modelViewer.setAttribute("shadow-intensity", "0");
    modelViewer.setAttribute("min-camera-orbit", `auto auto ${MODEL_VIEWER_MIN_RADIUS_SCALE * 100}%`);
    modelViewer.setAttribute("max-camera-orbit", `auto auto ${MODEL_VIEWER_MAX_RADIUS_SCALE * 100}%`);
    prepareModelViewerCameraAngles(modelViewer, name);
    modelViewer.setAttribute("src", glbUrl);
    viewPanel.appendChild(modelViewer);

    const trajectoryCanvas = document.createElement("canvas");
    trajectoryCanvas.className = "viewer-trajectory-canvas";
    trajectoryCanvas.setAttribute("aria-hidden", "true");
    viewPanel.appendChild(trajectoryCanvas);

    const status = document.createElement("div");
    status.className = "viewer-status";
    status.textContent = "Loading 3D…";
    viewPanel.appendChild(status);

    const overlay = createTrajectoryOverlay(trajectoryCanvas, modelViewer);
    activeOverlays.push(overlay);

    modelViewer.addEventListener("progress", (event) => {
      const progress = event.detail?.totalProgress;
      if (!Number.isFinite(progress) || progress >= 1) return;
      status.classList.remove("error");
      status.style.display = "";
      status.textContent = `Loading… ${Math.round(progress * 100)}%`;
    });
    modelViewer.addEventListener("load", () => {
      const token = ++cameraToken;
      try { applyInitialModelViewerCamera(modelViewer, name); } catch (_) {}
      Promise.resolve(modelViewer.updateComplete).catch(() => {}).then(() => {
        requestAnimationFrame(() => {
          if (!modelViewer.isConnected || token !== cameraToken) return;
          try { applyInitialModelViewerCamera(modelViewer, name); } catch (_) {}
          requestAnimationFrame(() => {
            if (!modelViewer.isConnected || token !== cameraToken) return;
            setCameraPending(false);
            hideStatus();
            runWhenIdle(() => {
              if (modelViewer.isConnected && token === cameraToken) overlay.load(glbUrl);
            });
          });
        });
      });
    });
    modelViewer.addEventListener("error", () => {
      setCameraPending(false);
      status.classList.add("error");
      status.style.display = "";
      status.textContent = "Failed to load 3D scene";
    });

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
      thumb.preload = "auto";
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
    if (page === currentPage && grid.childElementCount > 0) {
      renderExampleSelector();
      if (opts && opts.scroll) {
        const sec = document.getElementById("gallery");
        if (sec) sec.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      return;
    }
    currentPage = page;

    // tear down current page: stop videos, stop model-viewer fetches, dispose overlays
    grid.querySelectorAll("video").forEach((vid) => {
      try { vid.pause(); } catch (_) {}
      vid.removeAttribute("src");
      vid.load();
    });
    grid.querySelectorAll("model-viewer").forEach((viewer) => {
      try { viewer.removeAttribute("src"); } catch (_) {}
    });
    while (activeOverlays.length) {
      const overlay = activeOverlays.pop();
      try { overlay.dispose(); } catch (_) {}
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
