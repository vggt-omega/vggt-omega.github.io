export const VIEWER_MIN_RADIUS_SCALE = 0.5;
export const VIEWER_MAX_RADIUS_SCALE = 3.5;

export function configureModelViewerLikeControls(controls, THREE, options = {}) {
  const { allowPagePanY = false } = options;

  controls.enableDamping = true;
  controls.dampingFactor = 0.085;
  controls.rotateSpeed = 0.78;
  controls.zoomSpeed = 0.28;
  controls.panSpeed = 0.7;
  controls.screenSpacePanning = true;
  controls.minPolarAngle = 0.001;
  controls.maxPolarAngle = Math.PI - 0.001;
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.PAN,
  };
  controls.touches = {
    ONE: THREE.TOUCH.ROTATE,
    TWO: THREE.TOUCH.DOLLY_PAN,
  };

  if ("zoomToCursor" in controls) controls.zoomToCursor = true;
  controls.domElement.style.touchAction = allowPagePanY ? "pan-y" : "none";
  installPointerReleaseGuard(controls);
}

export function setModelViewerLikeZoomLimits(controls, initialDistance) {
  if (!Number.isFinite(initialDistance) || initialDistance <= 0) return;
  controls.minDistance = Math.max(initialDistance * VIEWER_MIN_RADIUS_SCALE, 0.001);
  controls.maxDistance = Math.max(
    initialDistance * VIEWER_MAX_RADIUS_SCALE,
    controls.minDistance * 2
  );
}

function installPointerReleaseGuard(controls) {
  const element = controls.domElement;
  if (!element || element.__orbitPointerReleaseGuard) return;
  element.__orbitPointerReleaseGuard = true;

  const doc = element.ownerDocument || document;
  const win = doc.defaultView || window;
  const activePointers = new Map();
  let lastPointer = { pointerId: 1, pointerType: 'mouse' };
  let restoringControls = false;

  const originalReleasePointerCapture = element.releasePointerCapture?.bind(element);
  if (originalReleasePointerCapture) {
    element.releasePointerCapture = (pointerId) => {
      try {
        if (!element.hasPointerCapture || element.hasPointerCapture(pointerId)) {
          originalReleasePointerCapture(pointerId);
        }
      } catch (_) {}
    };
  }

  function rememberPointer(event) {
    lastPointer = {
      pointerId: event.pointerId,
      pointerType: event.pointerType || 'mouse',
    };
    activePointers.set(lastPointer.pointerId, lastPointer.pointerType);
  }

  function forgetPointer(event) {
    activePointers.delete(event.pointerId);
  }

  function dispatchSyntheticPointerUp(pointerId, pointerType) {
    if (!win.PointerEvent) return;
    const pointerUp = new win.PointerEvent('pointerup', {
      bubbles: true,
      cancelable: true,
      pointerId,
      pointerType,
      button: 0,
      buttons: 0,
    });
    element.dispatchEvent(pointerUp);
  }

  function forceRelease(event) {
    const pointers = activePointers.size
      ? Array.from(activePointers.entries())
      : [[event?.pointerId ?? lastPointer.pointerId, event?.pointerType || lastPointer.pointerType]];
    activePointers.clear();

    const wasEnabled = controls.enabled;
    controls.enabled = false;
    for (const [pointerId, pointerType] of pointers) {
      dispatchSyntheticPointerUp(pointerId, pointerType || 'mouse');
    }

    if (!restoringControls) {
      restoringControls = true;
      win.requestAnimationFrame(() => {
        controls.enabled = wasEnabled;
        restoringControls = false;
      });
    }
  }

  function releaseIfMouseButtonIsUp(event) {
    if (event.pointerType !== 'mouse' || event.buttons !== 0 || activePointers.size === 0) {
      return;
    }
    forceRelease(event);
    event.stopImmediatePropagation();
  }

  function releaseIfActive(event) {
    if (activePointers.size > 0) forceRelease(event);
  }

  element.addEventListener('pointerdown', rememberPointer);
  element.addEventListener('pointerup', forgetPointer);
  element.addEventListener('pointercancel', releaseIfActive);
  element.addEventListener('lostpointercapture', releaseIfActive);
  element.addEventListener('pointermove', releaseIfMouseButtonIsUp, true);
  win.addEventListener('pointerup', releaseIfActive);
  win.addEventListener('pointercancel', releaseIfActive);
  win.addEventListener('mouseup', releaseIfActive);
  win.addEventListener('blur', releaseIfActive);
  function releaseOnHidden() {
    if (doc.visibilityState !== 'visible') releaseIfActive();
  }
  doc.addEventListener('visibilitychange', releaseOnHidden);
  element.addEventListener('contextmenu', releaseIfActive);

  const dispose = controls.dispose.bind(controls);
  controls.dispose = () => {
    element.removeEventListener('pointerdown', rememberPointer);
    element.removeEventListener('pointerup', forgetPointer);
    element.removeEventListener('pointercancel', releaseIfActive);
    element.removeEventListener('lostpointercapture', releaseIfActive);
    element.removeEventListener('pointermove', releaseIfMouseButtonIsUp, true);
    win.removeEventListener('pointerup', releaseIfActive);
    win.removeEventListener('pointercancel', releaseIfActive);
    win.removeEventListener('mouseup', releaseIfActive);
    win.removeEventListener('blur', releaseIfActive);
    doc.removeEventListener('visibilitychange', releaseOnHidden);
    element.removeEventListener('contextmenu', releaseIfActive);
    if (originalReleasePointerCapture) {
      element.releasePointerCapture = originalReleasePointerCapture;
    }
    delete element.__orbitPointerReleaseGuard;
    dispose();
  };
}
