(function () {
  const FACE_API_SOURCES = [
    "https://cdn.jsdelivr.net/npm/@vladmandic/face-api/dist/face-api.min.js",
    "https://unpkg.com/@vladmandic/face-api/dist/face-api.min.js"
  ];
  const MODEL_BASE_URLS = [
    "./models",
    "https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/",
    "https://unpkg.com/@vladmandic/face-api/model/",
    "https://justadudewhohacks.github.io/face-api.js/models"
  ];

  const MAX_RENDER_EDGE = 1600;
  const DETECT_MAX_EDGE = 1280;
  const SSD_SCORE_THRESHOLD = 0.56;
  const TINY_SCORE_THRESHOLD = 0.4;
  const BOX_EXPAND_RATIO = 0.14;
  const FACE_ASPECT_MIN = 0.56;
  const FACE_ASPECT_MAX = 1.78;
  const MIN_FACE_AREA_RATIO = 0.00028;
  const MAX_FACE_AREA_RATIO = 0.66;
  const EYE_DISTANCE_RATIO_MIN = 0.2;
  const EYE_DISTANCE_RATIO_MAX = 0.84;
  const NOSE_EYE_Y_RATIO_MIN = 0.06;
  const NOSE_EYE_Y_RATIO_MAX = 0.56;
  const MOUTH_EYE_Y_RATIO_MIN = 0.16;
  const MOUTH_EYE_Y_RATIO_MAX = 0.9;
  const NOSE_CENTER_X_TOL_RATIO = 0.34;
  const EYE_LABEL_TEXT = "BLOCKED";
  const HANDLE_SIZE = 18;
  const ROTATE_HANDLE_OFFSET = 34;
  const MIN_EFFECT_SIZE = 20;
  const APP_VERSION = "2026.04.13-3";

  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("fileInput");
  const pickButton = document.getElementById("pickButton");
  const processButton = document.getElementById("processButton");
  const downloadButton = document.getElementById("downloadButton");
  const mosaicScaleInput = document.getElementById("mosaicScale");
  const blockedToggle = document.getElementById("blockedToggle");
  const addMosaicButton = document.getElementById("addMosaicButton");
  const addBlockedButton = document.getElementById("addBlockedButton");
  const deleteEffectButton = document.getElementById("deleteEffectButton");
  const buildVersion = document.getElementById("buildVersion");
  const status = document.getElementById("status");
  const canvas = document.getElementById("resultCanvas");
  const ctx = canvas.getContext("2d");
  const isTouchDevice =
    typeof window !== "undefined" &&
    ("ontouchstart" in window || navigator.maxTouchPoints > 0 || navigator.msMaxTouchPoints > 0);

  let modelReady = false;
  let sourceImage = null;
  let baseCanvas = null;
  let effects = [];
  let selectedEffectId = null;
  let dragState = null;
  let nextEffectId = 1;
  let busy = false;
  let detectorProfile = "tiny";
  let mosaicLayerCache = { pixelSize: null, canvas: null };

  if (buildVersion) buildVersion.textContent = APP_VERSION;

  function setStatus(text) {
    status.textContent = text;
  }

  function degToRad(deg) {
    return (deg * Math.PI) / 180;
  }

  function radToDeg(rad) {
    return (rad * 180) / Math.PI;
  }

  function normalizeRotation(deg) {
    let out = deg;
    while (out > 180) out -= 360;
    while (out <= -180) out += 360;
    return out;
  }

  function getEffectById(id) {
    return effects.find((e) => e.id === id) || null;
  }

  function getEffectCenter(effect) {
    return {
      x: effect.x + effect.width / 2,
      y: effect.y + effect.height / 2
    };
  }

  function toLocalPoint(point, center, rotationDeg) {
    const rad = degToRad(rotationDeg || 0);
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    return {
      x: dx * cos + dy * sin,
      y: -dx * sin + dy * cos
    };
  }

  function fromLocalPoint(local, center, rotationDeg) {
    const rad = degToRad(rotationDeg || 0);
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    return {
      x: center.x + local.x * cos - local.y * sin,
      y: center.y + local.x * sin + local.y * cos
    };
  }

  function getRotatedCorners(effect) {
    const center = getEffectCenter(effect);
    const hw = effect.width / 2;
    const hh = effect.height / 2;
    return {
      nw: fromLocalPoint({ x: -hw, y: -hh }, center, effect.rotation || 0),
      ne: fromLocalPoint({ x: hw, y: -hh }, center, effect.rotation || 0),
      se: fromLocalPoint({ x: hw, y: hh }, center, effect.rotation || 0),
      sw: fromLocalPoint({ x: -hw, y: hh }, center, effect.rotation || 0)
    };
  }

  function getRotateHandlePoint(effect) {
    const center = getEffectCenter(effect);
    return fromLocalPoint(
      { x: 0, y: -effect.height / 2 - ROTATE_HANDLE_OFFSET },
      center,
      effect.rotation || 0
    );
  }

  function isEffectVisible(effect) {
    if (effect.type === "blocked") return blockedToggle.checked;
    return true;
  }

  function refreshButtons() {
    const hasImage = Boolean(sourceImage && baseCanvas);
    processButton.disabled = busy || !hasImage || !modelReady;
    pickButton.disabled = busy;
    downloadButton.disabled = busy || !hasImage;
    addMosaicButton.disabled = busy || !hasImage;
    addBlockedButton.disabled = busy || !hasImage;
    deleteEffectButton.disabled = busy || selectedEffectId == null;
  }

  function setBusy(nextBusy) {
    busy = nextBusy;
    refreshButtons();
  }

  function selectEffect(id) {
    selectedEffectId = id;
    refreshButtons();
    renderCanvas();
  }

  function clearMosaicLayerCache() {
    mosaicLayerCache.pixelSize = null;
    mosaicLayerCache.canvas = null;
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if ([...document.scripts].some((s) => s.src === src)) {
        resolve();
        return;
      }
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
      document.head.appendChild(script);
    });
  }

  async function loadScriptFromAnySource(sources) {
    let lastError = null;
    for (const src of sources) {
      try {
        await loadScript(src);
        return src;
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new Error("Script load failed.");
  }

  async function loadNetFromAnySource(loader) {
    let lastError = null;
    for (const baseUrl of MODEL_BASE_URLS) {
      try {
        await loader(baseUrl);
        return;
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new Error("Model load failed.");
  }

  async function ensureStableTfBackend() {
    if (!window.faceapi?.tf) return;
    const tf = window.faceapi.tf;
    if (typeof tf.ready === "function") await tf.ready();
    if (isTouchDevice && typeof tf.setBackend === "function") {
      try {
        await tf.setBackend("cpu");
        if (typeof tf.ready === "function") await tf.ready();
      } catch {
        // keep existing backend
      }
    }
  }

  async function tryLoadDetectionNets() {
    try {
      await loadNetFromAnySource((baseUrl) =>
        window.faceapi.nets.ssdMobilenetv1.loadFromUri(baseUrl)
      );
      await loadNetFromAnySource((baseUrl) =>
        window.faceapi.nets.faceLandmark68TinyNet.loadFromUri(baseUrl)
      );
      detectorProfile = "ssd";
      return;
    } catch (ssdErr) {
      try {
        await loadNetFromAnySource((baseUrl) =>
          window.faceapi.nets.tinyFaceDetector.loadFromUri(baseUrl)
        );
        await loadNetFromAnySource((baseUrl) =>
          window.faceapi.nets.faceLandmark68TinyNet.loadFromUri(baseUrl)
        );
        detectorProfile = "tiny";
        return;
      } catch (tinyErr) {
        throw tinyErr || ssdErr || new Error("Model load failed.");
      }
    }
  }

  async function loadModels() {
    await loadScriptFromAnySource(FACE_API_SOURCES);
    if (!window.faceapi) throw new Error("face-api.js could not be loaded.");
    if (window.faceapi.tf) {
      const tf = window.faceapi.tf;
      try {
        if (typeof tf.enableProdMode === "function") tf.enableProdMode();
        if (typeof tf.env === "function") {
          try {
            tf.env().set("WASM_HAS_SIMD_SUPPORT", false);
            tf.env().set("WASM_HAS_MULTITHREAD_SUPPORT", false);
          } catch {
            // env keys may differ by runtime
          }
        }
        const backendOrder = isTouchDevice ? ["webgl", "cpu", "wasm"] : ["webgl", "wasm", "cpu"];
        let backendReady = false;
        if (typeof tf.setBackend === "function") {
          for (const backend of backendOrder) {
            try {
              await tf.setBackend(backend);
              if (typeof tf.ready === "function") await tf.ready();
              backendReady = true;
              break;
            } catch {
              // try next backend
            }
          }
        }
        if (!backendReady && typeof tf.ready === "function") await tf.ready();
        const current = typeof tf.getBackend === "function" ? tf.getBackend() : "unknown";
        if (current === "wasm") {
          try {
            await tf.setBackend("cpu");
            if (typeof tf.ready === "function") await tf.ready();
          } catch {
            // keep current backend if cpu switch failed
          }
        }
      } catch (err) {
        throw new Error(`TensorFlow backend init failed: ${err?.message || err}`);
      }
    }
    try {
      await tryLoadDetectionNets();
    } catch (err) {
      if (String(err?.message || err).includes("highest priority backend 'wasm'")) {
        await ensureStableTfBackend();
        await tryLoadDetectionNets();
        return;
      }
      throw err;
    }
  }

  function fitSize(width, height, maxEdge) {
    const max = Math.max(width, height);
    if (max <= maxEdge) return { width, height, scale: 1 };
    const scale = maxEdge / max;
    return {
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale)),
      scale
    };
  }

  function buildBaseCanvas(image) {
    const fitted = fitSize(image.naturalWidth, image.naturalHeight, MAX_RENDER_EDGE);
    const out = document.createElement("canvas");
    out.width = fitted.width;
    out.height = fitted.height;
    out.getContext("2d").drawImage(image, 0, 0, out.width, out.height);
    return out;
  }

  function setBaseImage(image) {
    baseCanvas = buildBaseCanvas(image);
    canvas.width = baseCanvas.width;
    canvas.height = baseCanvas.height;
    clearMosaicLayerCache();
  }

  function makeEffect(type, rect, rotation = 0) {
    return {
      id: nextEffectId++,
      type,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      rotation
    };
  }

  function getMosaicLayer(pixelSize) {
    if (
      mosaicLayerCache.canvas &&
      mosaicLayerCache.pixelSize === pixelSize &&
      mosaicLayerCache.canvas.width === baseCanvas.width &&
      mosaicLayerCache.canvas.height === baseCanvas.height
    ) {
      return mosaicLayerCache.canvas;
    }

    const out = document.createElement("canvas");
    out.width = baseCanvas.width;
    out.height = baseCanvas.height;
    const outCtx = out.getContext("2d");

    const small = document.createElement("canvas");
    small.width = Math.max(1, Math.floor(baseCanvas.width / pixelSize));
    small.height = Math.max(1, Math.floor(baseCanvas.height / pixelSize));
    small.getContext("2d").drawImage(baseCanvas, 0, 0, small.width, small.height);

    outCtx.imageSmoothingEnabled = false;
    outCtx.drawImage(small, 0, 0, small.width, small.height, 0, 0, out.width, out.height);
    outCtx.imageSmoothingEnabled = true;

    mosaicLayerCache = { pixelSize, canvas: out };
    return out;
  }

  function drawMosaicEffect(effect, pixelSize) {
    const corners = getRotatedCorners(effect);
    const mosaicLayer = getMosaicLayer(pixelSize);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(corners.nw.x, corners.nw.y);
    ctx.lineTo(corners.ne.x, corners.ne.y);
    ctx.lineTo(corners.se.x, corners.se.y);
    ctx.lineTo(corners.sw.x, corners.sw.y);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(mosaicLayer, 0, 0);
    ctx.restore();
  }

  function drawBlockedRect(effect) {
    drawBlockedOnContext(ctx, effect);
  }

  function drawBlockedOnContext(targetCtx, effect) {
    const center = getEffectCenter(effect);
    const rad = degToRad(effect.rotation || 0);
    targetCtx.save();
    targetCtx.translate(center.x, center.y);
    targetCtx.rotate(rad);
    targetCtx.fillStyle = "rgba(0, 0, 0, 0.92)";
    targetCtx.fillRect(-effect.width / 2, -effect.height / 2, effect.width, effect.height);

    const innerPad = Math.max(4, Math.min(effect.width, effect.height) * 0.1);
    const maxTextW = Math.max(8, effect.width - innerPad * 2);
    const maxTextH = Math.max(8, effect.height - innerPad * 2);
    const byHeight = maxTextH * 0.9;
    const byWidth = maxTextW / Math.max(1, EYE_LABEL_TEXT.length * 0.62);
    const fontSize = Math.max(8, Math.min(byHeight, byWidth));

    targetCtx.beginPath();
    targetCtx.rect(-effect.width / 2 + innerPad, -effect.height / 2 + innerPad, maxTextW, maxTextH);
    targetCtx.clip();
    targetCtx.font = `700 ${fontSize}px sans-serif`;
    targetCtx.textAlign = "center";
    targetCtx.textBaseline = "middle";
    targetCtx.fillStyle = "#ffffff";
    targetCtx.fillText(EYE_LABEL_TEXT, 0, 0);
    targetCtx.restore();
  }

  function drawSelection() {
    if (selectedEffectId == null) return;
    const effect = getEffectById(selectedEffectId);
    if (!effect || !isEffectVisible(effect)) return;

    const corners = getRotatedCorners(effect);
    const visualHandleSize = isTouchDevice ? HANDLE_SIZE * 1.2 : HANDLE_SIZE;
    const rotateHandle = getRotateHandlePoint(effect);
    const topCenter = fromLocalPoint(
      { x: 0, y: -effect.height / 2 },
      getEffectCenter(effect),
      effect.rotation || 0
    );

    ctx.save();
    ctx.strokeStyle = "#4aa3ff";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(corners.nw.x, corners.nw.y);
    ctx.lineTo(corners.ne.x, corners.ne.y);
    ctx.lineTo(corners.se.x, corners.se.y);
    ctx.lineTo(corners.sw.x, corners.sw.y);
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.beginPath();
    ctx.moveTo(topCenter.x, topCenter.y);
    ctx.lineTo(rotateHandle.x, rotateHandle.y);
    ctx.stroke();

    for (const point of Object.values(corners)) {
      ctx.fillStyle = "#4aa3ff";
      ctx.fillRect(
        point.x - visualHandleSize / 2,
        point.y - visualHandleSize / 2,
        visualHandleSize,
        visualHandleSize
      );
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1;
      ctx.strokeRect(
        point.x - visualHandleSize / 2,
        point.y - visualHandleSize / 2,
        visualHandleSize,
        visualHandleSize
      );
    }

    ctx.beginPath();
    ctx.fillStyle = "#4aa3ff";
    ctx.arc(rotateHandle.x, rotateHandle.y, visualHandleSize * 0.58, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  function renderCanvas() {
    if (!baseCanvas) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    canvas.width = baseCanvas.width;
    canvas.height = baseCanvas.height;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(baseCanvas, 0, 0);

    const pixelSize = Number.parseInt(mosaicScaleInput.value, 10) || 14;
    for (const effect of effects) {
      if (!isEffectVisible(effect)) continue;
      if (effect.type === "mosaic") drawMosaicEffect(effect, pixelSize);
      if (effect.type === "blocked") drawBlockedRect(effect);
    }

    drawSelection();
  }

  function drawImageWithoutSelection(targetCtx, targetCanvas) {
    if (!baseCanvas) return;
    targetCanvas.width = baseCanvas.width;
    targetCanvas.height = baseCanvas.height;
    targetCtx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
    targetCtx.drawImage(baseCanvas, 0, 0);

    const pixelSize = Number.parseInt(mosaicScaleInput.value, 10) || 14;
    for (const effect of effects) {
      if (!isEffectVisible(effect)) continue;
      if (effect.type === "mosaic") {
        const corners = getRotatedCorners(effect);
        const mosaicLayer = getMosaicLayer(pixelSize);
        targetCtx.save();
        targetCtx.beginPath();
        targetCtx.moveTo(corners.nw.x, corners.nw.y);
        targetCtx.lineTo(corners.ne.x, corners.ne.y);
        targetCtx.lineTo(corners.se.x, corners.se.y);
        targetCtx.lineTo(corners.sw.x, corners.sw.y);
        targetCtx.closePath();
        targetCtx.clip();
        targetCtx.drawImage(mosaicLayer, 0, 0);
        targetCtx.restore();
      } else if (effect.type === "blocked") drawBlockedOnContext(targetCtx, effect);
    }
  }

  function oppositeHandleName(handle) {
    if (handle === "nw") return "se";
    if (handle === "ne") return "sw";
    if (handle === "se") return "nw";
    return "ne";
  }

  function dedupeDetections(detections) {
    const iou = (a, b) => {
      const ax2 = a.box.x + a.box.width;
      const ay2 = a.box.y + a.box.height;
      const bx2 = b.box.x + b.box.width;
      const by2 = b.box.y + b.box.height;
      const ix1 = Math.max(a.box.x, b.box.x);
      const iy1 = Math.max(a.box.y, b.box.y);
      const ix2 = Math.min(ax2, bx2);
      const iy2 = Math.min(ay2, by2);
      const iw = Math.max(0, ix2 - ix1);
      const ih = Math.max(0, iy2 - iy1);
      if (!iw || !ih) return 0;
      const inter = iw * ih;
      const union = a.box.width * a.box.height + b.box.width * b.box.height - inter;
      return union > 0 ? inter / union : 0;
    };

    const sorted = [...detections].sort((a, b) => {
      const scoreDiff = (b.score || 0) - (a.score || 0);
      if (Math.abs(scoreDiff) > 0.03) return scoreDiff;
      const areaA = a.box.width * a.box.height;
      const areaB = b.box.width * b.box.height;
      return areaB - areaA;
    });
    const kept = [];
    for (const item of sorted) {
      const isNearDuplicate = kept.some((k) => {
        const cx1 = item.box.x + item.box.width * 0.5;
        const cy1 = item.box.y + item.box.height * 0.5;
        const cx2 = k.box.x + k.box.width * 0.5;
        const cy2 = k.box.y + k.box.height * 0.5;
        const centerDistance = Math.hypot(cx1 - cx2, cy1 - cy2);
        const nearThreshold = Math.min(item.box.width, k.box.width) * 0.22;
        return centerDistance < nearThreshold;
      });
      if (!isNearDuplicate && !kept.some((k) => iou(item, k) >= 0.4)) kept.push(item);
    }
    return kept;
  }

  function expandFaceBox(box, width, height) {
    const growW = box.width * BOX_EXPAND_RATIO;
    const growH = box.height * BOX_EXPAND_RATIO * 1.2;
    const x1 = Math.max(0, box.x - growW * 0.5);
    const y1 = Math.max(0, box.y - growH * 0.5);
    const x2 = Math.min(width, box.x + box.width + growW * 0.5);
    const y2 = Math.min(height, box.y + box.height + growH * 0.5);
    return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
  }

  function averagePoints(points) {
    if (!Array.isArray(points) || points.length === 0) return null;
    let sx = 0;
    let sy = 0;
    for (const p of points) {
      sx += p.x;
      sy += p.y;
    }
    return { x: sx / points.length, y: sy / points.length };
  }

  function getEyeCenters(landmarks) {
    if (!landmarks || typeof landmarks.getLeftEye !== "function" || typeof landmarks.getRightEye !== "function") {
      return null;
    }
    const left = averagePoints(landmarks.getLeftEye());
    const right = averagePoints(landmarks.getRightEye());
    if (!left || !right) return null;
    return { left, right };
  }

  function getFeatureCenters(landmarks) {
    if (!landmarks) return null;
    if (
      typeof landmarks.getNose !== "function" ||
      typeof landmarks.getMouth !== "function"
    ) {
      return null;
    }
    const nose = averagePoints(landmarks.getNose());
    const mouth = averagePoints(landmarks.getMouth());
    if (!nose || !mouth) return null;
    return { nose, mouth };
  }

  function isLandmarkGeometryLikelyFace(box, eyes, features) {
    if (!eyes || !features) return false;
    const eyeCenterX = (eyes.left.x + eyes.right.x) * 0.5;
    const eyeCenterY = (eyes.left.y + eyes.right.y) * 0.5;
    const boxCenterX = box.x + box.width * 0.5;
    const eyeDistance = Math.hypot(eyes.right.x - eyes.left.x, eyes.right.y - eyes.left.y);
    if (eyeDistance < 8) return false;

    const noseDy = features.nose.y - eyeCenterY;
    const mouthDy = features.mouth.y - eyeCenterY;
    const noseDyRatio = noseDy / Math.max(1, box.height);
    const mouthDyRatio = mouthDy / Math.max(1, box.height);
    if (noseDyRatio < NOSE_EYE_Y_RATIO_MIN || noseDyRatio > NOSE_EYE_Y_RATIO_MAX) return false;
    if (mouthDyRatio < MOUTH_EYE_Y_RATIO_MIN || mouthDyRatio > MOUTH_EYE_Y_RATIO_MAX) return false;

    const noseToEyeCenterX = Math.abs(features.nose.x - eyeCenterX) / Math.max(1, box.width);
    const noseToBoxCenterX = Math.abs(features.nose.x - boxCenterX) / Math.max(1, box.width);
    if (noseToEyeCenterX > NOSE_CENTER_X_TOL_RATIO || noseToBoxCenterX > NOSE_CENTER_X_TOL_RATIO) {
      return false;
    }

    return true;
  }

  function isLikelyFaceDetection(box, score, eyes, features, imageWidth, imageHeight) {
    const minScore = detectorProfile === "ssd" ? SSD_SCORE_THRESHOLD : TINY_SCORE_THRESHOLD;
    if (score < minScore) return false;
    if (box.width < 20 || box.height < 20) return false;

    const area = box.width * box.height;
    const frameArea = imageWidth * imageHeight;
    const areaRatio = area / Math.max(1, frameArea);
    if (areaRatio < MIN_FACE_AREA_RATIO || areaRatio > MAX_FACE_AREA_RATIO) return false;

    const aspect = box.width / Math.max(1, box.height);
    if (aspect < FACE_ASPECT_MIN || aspect > FACE_ASPECT_MAX) return false;

    if (!eyes) return false;
    const eyeDistance = Math.hypot(eyes.right.x - eyes.left.x, eyes.right.y - eyes.left.y);
    const ratio = eyeDistance / Math.max(1, box.width);
    if (ratio < EYE_DISTANCE_RATIO_MIN || ratio > EYE_DISTANCE_RATIO_MAX) return false;
    const eyeCenterY = (eyes.left.y + eyes.right.y) * 0.5;
    if (eyeCenterY < box.y + box.height * 0.12 || eyeCenterY > box.y + box.height * 0.72) return false;
    if (!isLandmarkGeometryLikelyFace(box, eyes, features)) return false;

    return true;
  }

  function clampRect(rect, maxW, maxH) {
    let x = rect.x;
    let y = rect.y;
    let w = rect.width;
    let h = rect.height;

    if (w < 0) {
      x += w;
      w = Math.abs(w);
    }
    if (h < 0) {
      y += h;
      h = Math.abs(h);
    }

    w = Math.max(MIN_EFFECT_SIZE, w);
    h = Math.max(MIN_EFFECT_SIZE, h);
    x = Math.min(Math.max(0, x), Math.max(0, maxW - w));
    y = Math.min(Math.max(0, y), Math.max(0, maxH - h));
    w = Math.min(w, maxW - x);
    h = Math.min(h, maxH - y);
    return { x, y, width: w, height: h };
  }

  function makeBlockedRectFromFace(faceBox, width, height) {
    const bandW = Math.max(24, faceBox.width * 0.8);
    const bandH = Math.max(12, Math.min(40, faceBox.height * 0.22));
    const eyeCenterY = faceBox.y + faceBox.height * 0.38;
    const x = faceBox.x + (faceBox.width - bandW) / 2;
    const y = eyeCenterY - bandH / 2;
    return clampRect({ x, y, width: bandW, height: bandH }, width, height);
  }

  function makeBlockedRectFromEyes(faceBox, eyes, width, height) {
    const dx = eyes.right.x - eyes.left.x;
    const dy = eyes.right.y - eyes.left.y;
    const eyeDistance = Math.hypot(dx, dy);
    if (eyeDistance < 8) {
      return {
        rect: makeBlockedRectFromFace(faceBox, width, height),
        rotation: 0
      };
    }

    const centerX = (eyes.left.x + eyes.right.x) * 0.5;
    const centerY = (eyes.left.y + eyes.right.y) * 0.5;
    const bandW = Math.max(24, Math.min(faceBox.width * 1.16, eyeDistance * 2.4));
    const bandH = Math.max(12, Math.min(faceBox.height * 0.34, eyeDistance * 0.78));
    return {
      rect: clampRect(
        {
          x: centerX - bandW / 2,
          y: centerY - bandH / 2,
          width: bandW,
          height: bandH
        },
        width,
        height
      ),
      rotation: normalizeRotation(radToDeg(Math.atan2(dy, dx)))
    };
  }

  async function runDetectionWithLandmarks(detectCanvas, detectSize) {
    if (detectorProfile === "ssd") {
      return window.faceapi
        .detectAllFaces(
          detectCanvas,
          new window.faceapi.SsdMobilenetv1Options({
            minConfidence: SSD_SCORE_THRESHOLD,
            maxResults: 128
          })
        )
        .withFaceLandmarks(true);
    }

    return window.faceapi
      .detectAllFaces(
        detectCanvas,
        new window.faceapi.TinyFaceDetectorOptions({
          inputSize: detectSize.width >= 880 || detectSize.height >= 880 ? 608 : 512,
          scoreThreshold: TINY_SCORE_THRESHOLD
        })
      )
      .withFaceLandmarks(true);
  }

  async function detectFaces() {
    const detectSize = fitSize(baseCanvas.width, baseCanvas.height, DETECT_MAX_EDGE);
    const detectCanvas = document.createElement("canvas");
    detectCanvas.width = detectSize.width;
    detectCanvas.height = detectSize.height;
    detectCanvas.getContext("2d").drawImage(baseCanvas, 0, 0, detectCanvas.width, detectCanvas.height);

    const detections = await runDetectionWithLandmarks(detectCanvas, detectSize);

    const inv = 1 / detectSize.scale;
    const mapped = detections
      .map((raw) => {
        const det = raw?.detection || raw;
        const box = det?.box || raw?.box;
        if (!box) return null;
        const eyes = getEyeCenters(raw?.landmarks || null);
        const features = getFeatureCenters(raw?.landmarks || null);
        const mappedEyes = eyes
          ? {
              left: { x: eyes.left.x * inv, y: eyes.left.y * inv },
              right: { x: eyes.right.x * inv, y: eyes.right.y * inv }
            }
          : null;
        const mappedFeatures = features
          ? {
              nose: { x: features.nose.x * inv, y: features.nose.y * inv },
              mouth: { x: features.mouth.x * inv, y: features.mouth.y * inv }
            }
          : null;
        return {
          box: {
            x: box.x * inv,
            y: box.y * inv,
            width: box.width * inv,
            height: box.height * inv
          },
          score: det?.score || raw?.score || 0,
          eyes: mappedEyes,
          features: mappedFeatures
        };
      })
      .filter(Boolean)
      .filter((item) =>
        isLikelyFaceDetection(
          item.box,
          item.score,
          item.eyes,
          item.features,
          baseCanvas.width,
          baseCanvas.height
        )
      );

    return dedupeDetections(mapped).map((item) => {
      const faceRect = expandFaceBox(item.box, baseCanvas.width, baseCanvas.height);
      const blocked = item.eyes
        ? makeBlockedRectFromEyes(item.box, item.eyes, baseCanvas.width, baseCanvas.height)
        : { rect: makeBlockedRectFromFace(item.box, baseCanvas.width, baseCanvas.height), rotation: 0 };
      return {
        faceRect,
        blockedRect: blocked.rect,
        blockedRotation: blocked.rotation
      };
    });
  }

  async function processCurrentImage() {
    if (!sourceImage || !modelReady || !baseCanvas) return;

    setBusy(true);
    setStatus("顔を検出中...");

    try {
      const faces = await detectFaces();
      const next = [];
      for (const face of faces) {
        next.push(makeEffect("mosaic", face.faceRect, 0));
        if (blockedToggle.checked) {
          next.push(makeEffect("blocked", face.blockedRect, face.blockedRotation));
        }
      }
      effects = next;
      selectEffect(effects.length ? effects[0].id : null);
      setStatus(
        faces.length
          ? `${faces.length}件の顔を検出しました。位置・サイズ・回転を編集できます。`
          : "顔は検出されませんでした。"
      );
    } catch (err) {
      console.error(err);
      setStatus("処理に失敗しました。別の画像で試してください。");
    } finally {
      setBusy(false);
    }
  }

  function addEffect(type) {
    if (!baseCanvas) return;
    if (type === "blocked") blockedToggle.checked = true;
    const baseW = type === "blocked" ? baseCanvas.width * 0.32 : baseCanvas.width * 0.24;
    const baseH = type === "blocked" ? baseCanvas.height * 0.08 : baseCanvas.height * 0.2;
    const minSize = isTouchDevice ? 34 : MIN_EFFECT_SIZE;
    const rect = clampRect(
      {
        x: (baseCanvas.width - baseW) / 2,
        y: (baseCanvas.height - baseH) / 2,
        width: Math.max(minSize, baseW),
        height: Math.max(minSize, baseH)
      },
      baseCanvas.width,
      baseCanvas.height
    );
    const effect = makeEffect(type, rect, 0);
    effects.push(effect);
    selectEffect(effect.id);
  }

  function deleteSelectedEffect() {
    if (selectedEffectId == null) return;
    effects = effects.filter((effect) => effect.id !== selectedEffectId);
    selectEffect(null);
  }

  function getCanvasPoint(event) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / Math.max(1, rect.width);
    const scaleY = canvas.height / Math.max(1, rect.height);
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY
    };
  }

  function pointNear(a, b, distance) {
    return Math.hypot(a.x - b.x, a.y - b.y) <= distance;
  }

  function pointInEffect(effect, point) {
    const center = getEffectCenter(effect);
    const local = toLocalPoint(point, center, effect.rotation || 0);
    return (
      Math.abs(local.x) <= effect.width / 2 &&
      Math.abs(local.y) <= effect.height / 2
    );
  }

  function hitHandle(effect, point) {
    const hitRadius = isTouchDevice ? HANDLE_SIZE * 1.4 : HANDLE_SIZE;
    const corners = getRotatedCorners(effect);
    for (const [name, h] of Object.entries(corners)) {
      if (pointNear(point, h, hitRadius)) return { mode: "resize", handle: name };
    }
    const rotateHandle = getRotateHandlePoint(effect);
    if (pointNear(point, rotateHandle, hitRadius)) return { mode: "rotate", handle: "rotate" };
    return null;
  }

  function hitTest(point) {
    const visible = effects.filter(isEffectVisible);
    for (let i = visible.length - 1; i >= 0; i -= 1) {
      const effect = visible[i];
      const handleHit = hitHandle(effect, point);
      if (handleHit) return { effect, ...handleHit };
      if (pointInEffect(effect, point)) return { effect, mode: "move", handle: null };
    }
    return null;
  }

  function cursorForHit(hit) {
    if (!hit) return "default";
    if (hit.mode === "rotate") return "grab";
    if (hit.mode === "resize") {
      if (hit.handle === "nw" || hit.handle === "se") return "nwse-resize";
      if (hit.handle === "ne" || hit.handle === "sw") return "nesw-resize";
    }
    return "move";
  }

  function onPointerDown(event) {
    if (busy || !baseCanvas) return;
    const point = getCanvasPoint(event);
    const hit = hitTest(point);
    if (!hit) {
      selectEffect(null);
      dragState = null;
      canvas.style.cursor = "default";
      return;
    }

    selectEffect(hit.effect.id);
    const center = getEffectCenter(hit.effect);
    const corners = getRotatedCorners(hit.effect);
    const oppositeCorner =
      hit.mode === "resize" && hit.handle
        ? corners[oppositeHandleName(hit.handle)]
        : null;
    dragState = {
      id: hit.effect.id,
      mode: hit.mode,
      handle: hit.handle,
      startPoint: point,
      origin: {
        x: hit.effect.x,
        y: hit.effect.y,
        width: hit.effect.width,
        height: hit.effect.height,
        rotation: hit.effect.rotation || 0
      },
      center,
      corners,
      oppositeCorner,
      startLocal: toLocalPoint(point, center, hit.effect.rotation || 0),
      startAngle: Math.atan2(point.y - center.y, point.x - center.x)
    };

    canvas.style.cursor = isTouchDevice ? "default" : hit.mode === "rotate" ? "grabbing" : cursorForHit(hit);
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function onPointerMove(event) {
    if (!baseCanvas) return;
    const point = getCanvasPoint(event);

    if (!dragState) {
      if (!isTouchDevice) canvas.style.cursor = cursorForHit(hitTest(point));
      return;
    }

    const effect = getEffectById(dragState.id);
    if (!effect) return;

    if (dragState.mode === "move") {
      const dx = point.x - dragState.startPoint.x;
      const dy = point.y - dragState.startPoint.y;
      const clamped = clampRect(
        {
          x: dragState.origin.x + dx,
          y: dragState.origin.y + dy,
          width: dragState.origin.width,
          height: dragState.origin.height
        },
        baseCanvas.width,
        baseCanvas.height
      );
      effect.x = clamped.x;
      effect.y = clamped.y;
      effect.width = clamped.width;
      effect.height = clamped.height;
    } else if (dragState.mode === "resize") {
      if (!dragState.oppositeCorner) return;
      const rotation = dragState.origin.rotation || 0;
      const fixed = dragState.oppositeCorner;
      const localCurrent = toLocalPoint(point, fixed, rotation);

      let width = Math.abs(localCurrent.x);
      let height = Math.abs(localCurrent.y);
      width = Math.max(MIN_EFFECT_SIZE, width);
      height = Math.max(MIN_EFFECT_SIZE, height);

      const signX = localCurrent.x >= 0 ? 1 : -1;
      const signY = localCurrent.y >= 0 ? 1 : -1;
      const newCornerLocal = { x: signX * width, y: signY * height };
      const newCenterLocal = { x: newCornerLocal.x * 0.5, y: newCornerLocal.y * 0.5 };
      const newCenter = fromLocalPoint(newCenterLocal, fixed, rotation);

      const candidate = {
        x: newCenter.x - width / 2,
        y: newCenter.y - height / 2,
        width,
        height
      };
      const clamped = clampRect(candidate, baseCanvas.width, baseCanvas.height);
      effect.x = clamped.x;
      effect.y = clamped.y;
      effect.width = clamped.width;
      effect.height = clamped.height;
    } else if (dragState.mode === "rotate") {
      const center = dragState.center;
      const angle = Math.atan2(point.y - center.y, point.x - center.x);
      const delta = angle - dragState.startAngle;
      effect.rotation = normalizeRotation(dragState.origin.rotation + radToDeg(delta));
    }

    renderCanvas();
  }

  function onPointerUp(event) {
    if (!dragState) return;
    try {
      canvas.releasePointerCapture(event.pointerId);
    } catch {
      // ignore
    }
    dragState = null;
    canvas.style.cursor = "default";
    renderCanvas();
    refreshButtons();
  }

  async function loadImageFile(file) {
    if (!file || (!file.type?.startsWith("image/") && !/\.(heic|heif|jpg|jpeg|png|webp)$/i.test(file.name || ""))) {
      setStatus("画像ファイル（png/jpg/webpなど）を選択してください。");
      return;
    }

    setBusy(true);
    setStatus("画像を読み込み中...");
    const image = new Image();
    image.crossOrigin = "anonymous";
    const blobUrl = URL.createObjectURL(file);
    try {
      await new Promise((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("Image load failed"));
        image.src = blobUrl;
      });
      if (!image.naturalWidth || !image.naturalHeight) {
        throw new Error("Image has invalid dimensions");
      }
    } catch (err) {
      console.error(err);
      setStatus("画像の読み込みに失敗しました。別の写真で試してください。");
      setBusy(false);
      return;
    } finally {
      URL.revokeObjectURL(blobUrl);
    }

    sourceImage = image;
    setBaseImage(sourceImage);
    effects = [];
    selectEffect(null);
    renderCanvas();
    setStatus("画像を読み込みました。検出後、枠を編集できます。");
    setBusy(false);
  }

  function setupDnD() {
    const onDragOver = (event) => {
      event.preventDefault();
      dropzone.classList.add("dragover");
    };
    const onDragLeave = () => dropzone.classList.remove("dragover");
    const onDrop = (event) => {
      event.preventDefault();
      dropzone.classList.remove("dragover");
      const file = event.dataTransfer?.files?.[0];
      if (file) loadImageFile(file);
    };

    dropzone.addEventListener("dragover", onDragOver);
    dropzone.addEventListener("dragleave", onDragLeave);
    dropzone.addEventListener("drop", onDrop);
    dropzone.addEventListener("click", () => {
      if (!busy) fileInput.click();
    });
  }

  function setupEvents() {
    const openPicker = () => {
      if (busy) return;
      try {
        fileInput.click();
      } catch {
        setStatus("画像選択を開けませんでした。再度タップしてください。");
      }
    };
    pickButton.addEventListener("click", openPicker);
    pickButton.addEventListener("touchend", (event) => {
      event.preventDefault();
      openPicker();
    });
    pickButton.addEventListener("pointerup", (event) => {
      if (event.pointerType === "touch") {
        event.preventDefault();
        openPicker();
      }
    });
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      if (file) {
        loadImageFile(file);
      } else if (isTouchDevice) {
        setStatus("画像が選択されませんでした。写真アプリからもう一度選択してください。");
      }
      fileInput.value = "";
    });

    processButton.addEventListener("click", () => processCurrentImage());
    addMosaicButton.addEventListener("click", () => addEffect("mosaic"));
    addBlockedButton.addEventListener("click", () => addEffect("blocked"));
    deleteEffectButton.addEventListener("click", () => deleteSelectedEffect());

    mosaicScaleInput.addEventListener("input", () => {
      clearMosaicLayerCache();
      renderCanvas();
    });

    blockedToggle.addEventListener("change", () => {
      const selected = getEffectById(selectedEffectId);
      if (selected && selected.type === "blocked" && !blockedToggle.checked) {
        selectEffect(null);
      }
      renderCanvas();
      refreshButtons();
    });

    downloadButton.addEventListener("click", () => {
      if (!baseCanvas) return;
      const exportCanvas = document.createElement("canvas");
      const exportCtx = exportCanvas.getContext("2d");
      drawImageWithoutSelection(exportCtx, exportCanvas);
      const link = document.createElement("a");
      link.href = exportCanvas.toDataURL("image/png");
      link.download = "image-censor-studio-result.png";
      link.click();
    });

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);

    window.addEventListener("keydown", (event) => {
      if ((event.key === "Delete" || event.key === "Backspace") && selectedEffectId != null) {
        const tag = document.activeElement?.tagName || "";
        if (tag !== "INPUT" && tag !== "TEXTAREA") {
          event.preventDefault();
          deleteSelectedEffect();
        }
      }
    });
  }

  async function start() {
    setupDnD();
    setupEvents();
    setBusy(true);
    try {
      await loadModels();
      modelReady = true;
      setStatus(
        detectorProfile === "ssd"
          ? "準備完了（高精度モード）。画像をドロップしてください。"
          : "準備完了（軽量モード）。画像をドロップしてください。"
      );
    } catch (err) {
      console.error(err);
      setStatus(`モデル読み込みに失敗しました: ${err?.message || "通信環境を確認してください。"}`);
    } finally {
      setBusy(false);
      refreshButtons();
    }
  }

  start();
})();
