const MODEL_VIEWER_FOV_DEG = 45;
const MODEL_VIEWER_MIN_RADIUS_SCALE = 0.5;
const MODEL_VIEWER_MAX_RADIUS_SCALE = 3.5;
const MODEL_VIEWER_STAGE_HEIGHT_SCALE = 1.2;
const CAMERA_VIEWS_VER = "views11";
const GLB_MAGIC = 0x46546c67;
const GLB_JSON_CHUNK_TYPE = 0x4e4f534a;
const DEFAULT_CAMERA_VIEW = {
  direction: { x: -0.210258, y: 0.179858, z: 0.960959 },
  targetScale: { x: 0, y: 0, z: 0 },
  fitScale: 2.261559,
  fieldOfView: MODEL_VIEWER_FOV_DEG,
};
let cameraViews = {
  default: DEFAULT_CAMERA_VIEW,
  scenes: {},
};
let threeModulePromise = null;

function loadThree() {
  if (!threeModulePromise) {
    threeModulePromise = typeof window.importShim === "function" ? window.importShim("three") : import("three");
  }
  return threeModulePromise;
}

function playVideo(video) {
  if (!video) return;
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.loop = true;
  video.setAttribute("muted", "");
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");
  const p = video.play();
  if (p && typeof p.catch === "function") p.catch(() => {});
}

function resetThumbVideo(video) {
  if (!video) return;
  video.pause();
  try { video.currentTime = 0; } catch (_) {}
}

function numericVector(value, fallback) {
  const v = value || {};
  return {
    x: Number.isFinite(v.x) ? v.x : fallback.x,
    y: Number.isFinite(v.y) ? v.y : fallback.y,
    z: Number.isFinite(v.z) ? v.z : fallback.z,
  };
}

function normalizeCameraSpec(spec, fallback = DEFAULT_CAMERA_VIEW) {
  if (!spec || typeof spec !== "object") return fallback;
  return {
    direction: numericVector(spec.direction, fallback.direction),
    targetScale: numericVector(spec.targetScale || spec.targetScaleVsMaxDim, fallback.targetScale),
    fitScale: Number.isFinite(spec.fitScale) ? spec.fitScale :
      (Number.isFinite(spec.fitScaleVsBase) ? spec.fitScaleVsBase : fallback.fitScale),
    fieldOfView: Number.isFinite(spec.fieldOfView) ? spec.fieldOfView :
      (Number.isFinite(fallback.fieldOfView) ? fallback.fieldOfView : MODEL_VIEWER_FOV_DEG),
  };
}

async function loadCameraViews() {
  try {
    const response = await fetch(`./interactive-camera-views.json?${CAMERA_VIEWS_VER}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const defaultSpec = normalizeCameraSpec(data.default, DEFAULT_CAMERA_VIEW);
    const scenes = {};
    for (const [sceneName, spec] of Object.entries(data.scenes || {})) {
      scenes[sceneName] = normalizeCameraSpec(spec, defaultSpec);
    }
    cameraViews = { default: defaultSpec, scenes };
  } catch (error) {
    console.warn("Using built-in interactive camera defaults; failed to load interactive-camera-views.json", error);
  }
}

function cameraForScene(sceneName) {
  return cameraViews.scenes[sceneName] || cameraViews.default || DEFAULT_CAMERA_VIEW;
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

function applyInitialModelViewerCamera(viewer, sceneName) {
  if (!viewer) return;
  const spec = cameraForScene(sceneName);
  const dimensions = viewer.getDimensions ? viewer.getDimensions() : null;
  const center = vectorOrZero(viewer.getBoundingBoxCenter ? viewer.getBoundingBoxCenter() : null);
  const maxDim = Math.max(dimensions?.x || 0, dimensions?.y || 0, dimensions?.z || 0) || 1;
  const fov = Number.isFinite(spec.fieldOfView) ? spec.fieldOfView : MODEL_VIEWER_FOV_DEG;
  const baseDist = maxDim / (2 * Math.tan(fov * Math.PI / 360));
  const radius = Math.max(baseDist * spec.fitScale * MODEL_VIEWER_STAGE_HEIGHT_SCALE, 0.001);
  const target = {
    x: center.x + maxDim * spec.targetScale.x,
    y: center.y + maxDim * spec.targetScale.y,
    z: center.z + maxDim * spec.targetScale.z,
  };
  const orbit = directionToModelViewerOrbit(spec.direction);

  viewer.setAttribute("field-of-view", `${fov}deg`);
  viewer.cameraTarget = `${target.x}m ${target.y}m ${target.z}m`;
  viewer.setAttribute("min-camera-orbit", `auto auto ${radius * MODEL_VIEWER_MIN_RADIUS_SCALE}m`);
  viewer.setAttribute("max-camera-orbit", `auto auto ${radius * MODEL_VIEWER_MAX_RADIUS_SCALE}m`);
  viewer.cameraOrbit = `${orbit.theta}rad ${orbit.phi}rad ${radius}m`;
  if (viewer.resetTurntableRotation) viewer.resetTurntableRotation(0);
  if (viewer.jumpCameraToGoal) viewer.jumpCameraToGoal();
}

function prepareModelViewerCameraAngles(viewer, sceneName) {
  if (!viewer) return;
  const spec = cameraForScene(sceneName);
  const orbit = directionToModelViewerOrbit(spec.direction);
  const fov = Number.isFinite(spec.fieldOfView) ? spec.fieldOfView : MODEL_VIEWER_FOV_DEG;
  viewer.setAttribute("field-of-view", `${fov}deg`);
  viewer.removeAttribute("camera-target");
  viewer.setAttribute("camera-orbit", `${orbit.theta}rad ${orbit.phi}rad auto`);
  viewer.setAttribute("min-camera-orbit", `auto auto ${MODEL_VIEWER_MIN_RADIUS_SCALE * 100}%`);
  viewer.setAttribute("max-camera-orbit", `auto auto ${MODEL_VIEWER_MAX_RADIUS_SCALE * 100}%`);
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

function buildCamsViz(extras, THREE) {
  const flat = extras?.cam_from_worlds || [];
  const count = Math.min(extras?.frame_count || 0, Math.floor(flat.length / 16));
  if (!flat.length || !count) return null;

  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const tmpC2W = new THREE.Matrix4();
  const tmpP = new THREE.Vector3();
  const tmpCol = new THREE.Color();

  for (let i = 0; i < count; i++) {
    const off = i * 16;
    tmpC2W.set(
      flat[off + 0], flat[off + 1], flat[off + 2], flat[off + 3],
      flat[off + 4], flat[off + 5], flat[off + 6], flat[off + 7],
      flat[off + 8], flat[off + 9], flat[off + 10], flat[off + 11],
      flat[off + 12], flat[off + 13], flat[off + 14], flat[off + 15],
    ).invert();
    tmpP.setFromMatrixPosition(tmpC2W);
    positions[i * 3] = tmpP.x;
    positions[i * 3 + 1] = tmpP.y;
    positions[i * 3 + 2] = tmpP.z;
    tmpCol.setHSL((i / Math.max(count - 1, 1)) * 0.83, 1.0, 0.5);
    colors[i * 3] = tmpCol.r;
    colors[i * 3 + 1] = tmpCol.g;
    colors[i * 3 + 2] = tmpCol.b;
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));

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
    vertexColors: true,
    transparent: true,
    opacity: 0.55,
    depthTest: false,
    depthWrite: false,
  });
  const line = new THREE.Line(geom, lineMat);
  line.renderOrder = 998;

  const group = new THREE.Group();
  group.add(dots);
  group.add(line);
  return group;
}

function disposeObject3D(root) {
  root.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach((mat) => {
        for (const key of Object.keys(mat)) {
          if (mat[key]?.isTexture) mat[key].dispose();
        }
        mat.dispose();
      });
    }
  });
}

function syncOverlayCamera(modelViewer, camera, canvas) {
  let orbit;
  let target;
  let fov;
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
    target.z + orbit.radius * sinPhi * Math.cos(orbit.theta),
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
  let renderer = null;
  let scene = null;
  let camera = null;
  let abortController = null;
  let trajectory = null;
  let disposed = false;
  let frameId = 0;
  let renderWidth = 0;
  let renderHeight = 0;
  let currentUrl = "";
  let loading = false;
  let loadToken = 0;

  function initRenderer(THREE) {
    if (renderer) return;
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(MODEL_VIEWER_FOV_DEG, 1, 0.0001, 1000);
  }

  function clearTrajectory() {
    if (!trajectory) return;
    if (scene) scene.remove(trajectory);
    disposeObject3D(trajectory);
    trajectory = null;
    if (frameId) {
      cancelAnimationFrame(frameId);
      frameId = 0;
    }
    if (renderer) renderer.clear();
  }

  function tick() {
    if (disposed) return;
    frameId = requestAnimationFrame(tick);
    if (!renderer || !scene || !camera) return;
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
    if (!url || disposed) return;
    if (url === currentUrl && (loading || trajectory)) return;

    currentUrl = url;
    loading = true;
    loadToken += 1;
    const token = loadToken;
    if (abortController) abortController.abort();
    abortController = new AbortController();
    clearTrajectory();

    loadGlbExtras(url, abortController.signal)
      .then(async (extras) => {
        if (disposed || token !== loadToken) return;
        const THREE = await loadThree();
        if (disposed || token !== loadToken) return;
        initRenderer(THREE);
        trajectory = buildCamsViz(extras, THREE);
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
        if (token === loadToken) loading = false;
      });
  }

  return {
    load,
    dispose() {
      disposed = true;
      if (frameId) cancelAnimationFrame(frameId);
      if (abortController) abortController.abort();
      clearTrajectory();
      if (renderer) renderer.dispose();
    },
  };
}

function initInteractiveDemos() {
  const viewer = document.getElementById("interactiveDemoViewer");
  const canvas = document.getElementById("interactiveDemoTrajectory");
  const status = document.getElementById("interactiveDemoStatus");
  const stage = viewer?.closest(".interactive-demo-stage");
  const thumbs = Array.from(document.querySelectorAll("#interactiveDemoThumbs .interactive-demo-thumb, #interactiveDemoThumbs > video"));
  if (!viewer || thumbs.length === 0) return;

  const overlay = canvas ? createTrajectoryOverlay(canvas, viewer) : null;
  let activeGlb = "";
  let activeScene = "";
  let cameraToken = 0;

  function setCameraPending(pending) {
    stage?.classList.toggle("model-viewer-camera-pending", pending);
    viewer.classList.toggle("model-viewer-camera-pending", pending);
    canvas?.classList.toggle("model-viewer-camera-pending", pending);
  }

  function hideLoading() {
    if (!status) return;
    status.textContent = "";
    status.style.display = "none";
  }

  function showLoading() {
    if (!status) return;
    status.classList.remove("error");
    status.style.display = "";
    status.textContent = "Loading 3D...";
  }

  function videoForThumb(thumb) {
    return thumb?.tagName === "VIDEO" ? thumb : thumb?.querySelector("video");
  }

  function selectThumb(activeThumb) {
    const glb = activeThumb.dataset.glb;
    if (!glb) return;
    activeGlb = glb;
    activeScene = activeThumb.dataset.scene || activeThumb.dataset.name || activeThumb.getAttribute("name") || "";

    thumbs.forEach((thumb) => {
      const active = thumb === activeThumb;
      thumb.classList.toggle("active", active);
      thumb.setAttribute("aria-pressed", String(active));
      const video = videoForThumb(thumb);
      if (active) {
        playVideo(video);
      } else {
        resetThumbVideo(video);
      }
    });

    const nextSrc = new URL(glb, window.location.href).href;
    if (viewer.src !== nextSrc && viewer.getAttribute("src") !== glb) {
      cameraToken += 1;
      setCameraPending(true);
      showLoading();
      prepareModelViewerCameraAngles(viewer, activeScene);
      viewer.setAttribute("src", glb);
    } else {
      applyInitialModelViewerCamera(viewer, activeScene);
      setCameraPending(false);
      hideLoading();
    }
  }

  viewer.addEventListener("progress", (event) => {
    const progress = event.detail && event.detail.totalProgress;
    if (!status || !Number.isFinite(progress) || progress >= 1) return;
    status.classList.remove("error");
    status.style.display = "";
    status.textContent = `Loading... ${Math.round(progress * 100)}%`;
  });
  viewer.addEventListener("load", () => {
    const token = cameraToken;
    try { applyInitialModelViewerCamera(viewer, activeScene); } catch (_) {}
    Promise.resolve(viewer.updateComplete).catch(() => {}).then(() => {
      window.requestAnimationFrame(() => {
        if (token !== cameraToken) return;
        try { applyInitialModelViewerCamera(viewer, activeScene); } catch (_) {}
        window.requestAnimationFrame(() => {
          if (token !== cameraToken) return;
          setCameraPending(false);
          hideLoading();
          if (activeGlb) {
            const url = new URL(activeGlb, window.location.href).href;
            runWhenIdle(() => {
              if (token === cameraToken) overlay?.load(url);
            });
          }
        });
      });
    });
  });
  viewer.addEventListener("error", () => {
    if (!status) return;
    status.classList.add("error");
    status.style.display = "";
    status.textContent = "Failed to load 3D scene";
  });

  thumbs.forEach((thumb) => {
    const video = videoForThumb(thumb);
    if (thumb.tagName !== "BUTTON") {
      thumb.tabIndex = 0;
      thumb.setAttribute("role", "button");
    }
    if (!thumb.hasAttribute("aria-label")) {
      thumb.setAttribute("aria-label", "Show interactive demo");
    }
    if (video && video !== thumb) {
      video.tabIndex = -1;
      video.setAttribute("aria-hidden", "true");
    }
    thumb.addEventListener("click", () => selectThumb(thumb));
    thumb.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectThumb(thumb);
      }
    });
    thumb.addEventListener("mouseenter", () => playVideo(video));
    thumb.addEventListener("focus", () => playVideo(video));
    thumb.addEventListener("mouseleave", () => {
      if (!thumb.classList.contains("active")) resetThumbVideo(video);
    });
    thumb.addEventListener("blur", () => {
      if (!thumb.classList.contains("active")) resetThumbVideo(video);
    });
  });

  loadCameraViews().finally(() => selectThumb(thumbs[0]));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initInteractiveDemos);
} else {
  initInteractiveDemos();
}
