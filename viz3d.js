import { logger } from './logger.js';
import { OrbitControls } from './OrbitControls.js';

let scene, camera, renderer, points, controls;
const MAX_POINTS = 2500;
let initialized = false;
let packetCache = []; // currently displayed/filtered points
let resizeObserver = null;
let resizeScheduled = false;
let allPackets = []; // full dataset from storage
let projectionMode = 'absolute'; // 'absolute' | 'relative'
let rangeStartPct = 0; // 0..100
let rangeEndPct = 100; // 0..100
let timeMin = null; // ms
let timeMax = null; // ms
let playTimer = null; // interval id for playhead
let selectedClusters = new Set();
let selectedDomains = new Set();
let selectedTokens = new Set();
let vectorizerSettings = { weighting: 'count', minDfRatio: 0, maxDfRatio: 1, vocabSize: 1000 };
let histCanvas = null;
let histCtx = null;
const HIST_BINS = 50;
let statusStrip = null;
let projectionView = 'endpoint'; // 'endpoint' | 'flow' | 'all'
let timeConsistency = 0; // 0..1, 0 = adapt fast, 1 = very stable
let relativeMix = 1; // 0 = absolute coordinates, 1 = fully relative
let precisionDecimals = 3; // 0..4

// Position smoothing and camera framing
let lastPositionsById = new Map();
const POSITION_INERTIA = 0.2; // 0..1 blend toward new positions
let hasFramedOnce = false;

// Domain label overlay state
let domainLabelOverlay = null;
let domainLabelElems = [];
let visibleDomainLabels = [];
let maxDomainLabels = 6;
let domainLabelCountInputEl = null;
let domainLabelCountLabelEl = null;

function getTimeFromPct(pct) {
    if (timeMin == null || timeMax == null) return null;
    const span = Math.max(0, timeMax - timeMin);
    return timeMin + (pct / 100) * span;
}

function fmtTime(ts) {
    try {
        return new Date(ts).toLocaleTimeString();
    } catch { return String(ts); }
}

function doResize() {
    const container = document.getElementById('viz-container');
    if (!container || !renderer || !camera) return;
    const width = Math.max(1, container.clientWidth || 0);
    const height = Math.max(1, container.clientHeight || 0);
    renderer.setSize(width, height);
    camera.aspect = Math.max(1e-6, width / Math.max(1, height));
    camera.updateProjectionMatrix();
    // Resize histogram canvas too
    if (histCanvas) {
        const dpr = window.devicePixelRatio || 1;
        const cssHeight = parseInt(getComputedStyle(histCanvas).height, 10) || 60;
        histCanvas.width = Math.max(1, Math.floor(width * dpr));
        histCanvas.height = Math.max(1, Math.floor(cssHeight * dpr));
        drawHistogram();
    }
}

function handleResize() {
    if (resizeScheduled) return;
    resizeScheduled = true;
    requestAnimationFrame(() => { resizeScheduled = false; doResize(); });
}

export function init() {
    if (initialized) return;
    initialized = true;

    const container = document.getElementById('viz-container');
    if (!container) return;

    // Scene
    scene = new THREE.Scene();

    // Camera
    const initialWidth = Math.max(1, container.clientWidth || 0);
    const initialHeight = Math.max(1, container.clientHeight || 0);
    logger.debug('Initializing 3D viz', { width: initialWidth, height: initialHeight });
    camera = new THREE.PerspectiveCamera(75, initialWidth / initialHeight, 0.1, 10000);
    camera.position.z = 30;

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.setSize(initialWidth, initialHeight);
    container.appendChild(renderer.domElement);

    // Overlay container for domain labels (HTML on top of canvas)
    domainLabelOverlay = document.createElement('div');
    domainLabelOverlay.style.position = 'absolute';
    domainLabelOverlay.style.left = '0';
    domainLabelOverlay.style.top = '0';
    domainLabelOverlay.style.width = '100%';
    domainLabelOverlay.style.height = '100%';
    domainLabelOverlay.style.pointerEvents = 'none';
    domainLabelOverlay.style.zIndex = '10';
    container.appendChild(domainLabelOverlay);

    // Keep renderer/camera sized correctly
    window.addEventListener('resize', handleResize);
    if ('ResizeObserver' in window) {
        resizeObserver = new ResizeObserver(() => handleResize());
        resizeObserver.observe(container);
    }

    // Points
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(MAX_POINTS * 3);
    const colors = new Float32Array(MAX_POINTS * 3);
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({ size: 4.5, vertexColors: true, sizeAttenuation: false });
    points = new THREE.Points(geometry, material);
    points.frustumCulled = false; // avoid unexpected culling while debugging
    scene.add(points);

    // Controls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;

    const recenterBtn = document.getElementById('recenter-btn');
    if (recenterBtn) {
        recenterBtn.addEventListener('click', () => {
            if (points.geometry.boundingSphere) {
                const center = points.geometry.boundingSphere.center;
                const radius = points.geometry.boundingSphere.radius;
                const fov = camera.fov * (Math.PI / 180);
                const distance = Math.max(50, Math.abs(radius / Math.sin(fov / 2)));
                camera.position.set(center.x, center.y, center.z + distance);
                controls.target.copy(center);
                controls.update();
            }
        });
    } else {
        logger.warn('Recenter button not found when initializing viz');
    }

    // Raycasting for point selection
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    raycaster.params.Points.threshold = 1; // Adjust threshold for easier clicking

    renderer.domElement.addEventListener('click', (event) => {
        const rect = renderer.domElement.getBoundingClientRect();
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObject(points);

        if (intersects.length > 0) {
            const index = intersects[0].index;
            if (packetCache[index]) {
                displayPacketInfo(packetCache[index]);
            }
        }
    });

    // Listen for storage changes
    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local' && changes.vectorizedPackets) {
            updatePoints(changes.vectorizedPackets.newValue);
        }
    });

    // Initial load
    chrome.storage.local.get('vectorizedPackets', (result) => {
        if (result.vectorizedPackets) {
            updatePoints(result.vectorizedPackets);
        }
    });

    // UI controls for projection mode and time window
    const modeSelect = document.getElementById('projection-mode');
    const startSlider = document.getElementById('time-range-start');
    const endSlider = document.getElementById('time-range-end');
    const startLabel = document.getElementById('time-start-label');
    const endLabel = document.getElementById('time-end-label');
    const playBtn = document.getElementById('play-toggle');
    const speedSel = document.getElementById('play-speed');
    const viewSelect = document.getElementById('projection-view');
    const relativeMixInput = document.getElementById('relative-mix');
    const trailEnabledInput = document.getElementById('trail-enabled');
    const trailLengthInput = document.getElementById('trail-length');
    const trailLengthDisplay = document.getElementById('trail-length-display');
    const clusterSel = document.getElementById('cluster-filter');
    const domainSel = document.getElementById('domain-filter');
    const tokenSel = document.getElementById('token-filter');
    const weightingSel = document.getElementById('weighting-mode');
    const minDfInput = document.getElementById('min-df');
    const maxDfInput = document.getElementById('max-df');
    const vocabSizeInput = document.getElementById('vocab-size');
    const precisionInput = document.getElementById('precision-decimals');
    const precisionDisplay = document.getElementById('precision-decimals-display');
    const applyBtn = document.getElementById('apply-vector-settings');
    const resetBtn = document.getElementById('reset-filters');
    const timeConsistencyInput = document.getElementById('time-consistency');
    const autoBtn = document.getElementById('auto-vector-settings');
    histCanvas = document.getElementById('time-histogram');
    histCtx = histCanvas ? histCanvas.getContext('2d') : null;
    statusStrip = document.getElementById('status-strip');
    domainLabelCountInputEl = document.getElementById('domain-label-count');
    domainLabelCountLabelEl = document.getElementById('domain-label-count-display');

    // Domain label count slider wiring
    if (domainLabelCountInputEl) {
        maxDomainLabels = parseInt(domainLabelCountInputEl.value, 10) || maxDomainLabels;
        if (domainLabelCountLabelEl) {
            domainLabelCountLabelEl.textContent = String(maxDomainLabels);
        }
        domainLabelCountInputEl.addEventListener('input', () => {
            maxDomainLabels = Math.max(0, parseInt(domainLabelCountInputEl.value, 10) || 0);
            if (domainLabelCountLabelEl) {
                domainLabelCountLabelEl.textContent = String(maxDomainLabels);
            }
            rebuildGeometry();
        });
    }

    function updateLabels() {
        const sTs = getTimeFromPct(rangeStartPct);
        const eTs = getTimeFromPct(rangeEndPct);
        if (startLabel && sTs != null) startLabel.textContent = fmtTime(sTs);
        if (endLabel && eTs != null) endLabel.textContent = fmtTime(eTs);
        drawHistogram();
    }

    if (modeSelect) {
        modeSelect.addEventListener('change', () => {
            projectionMode = modeSelect.value;
            rebuildGeometry();
        });
    }
    if (viewSelect) {
        projectionView = viewSelect.value || 'endpoint';
        viewSelect.addEventListener('change', () => {
            projectionView = viewSelect.value || 'endpoint';
            rebuildGeometry();
            renderStatus();
        });
    }
    if (precisionInput) {
        precisionDecimals = Math.max(0, Math.min(4, parseInt(precisionInput.value, 10) || 3));
        if (precisionDisplay) precisionDisplay.textContent = String(precisionDecimals);
        precisionInput.addEventListener('input', () => {
            precisionDecimals = Math.max(0, Math.min(4, parseInt(precisionInput.value, 10) || 3));
            if (precisionDisplay) precisionDisplay.textContent = String(precisionDecimals);
        });
    }
    if (relativeMixInput) {
        relativeMix = Math.max(0, Math.min(1, parseFloat(relativeMixInput.value) || 1));
        relativeMixInput.addEventListener('input', () => {
            relativeMix = Math.max(0, Math.min(1, parseFloat(relativeMixInput.value) || 1));
            if (projectionMode === 'relative') rebuildGeometry();
        });
    }
    if (timeConsistencyInput) {
        timeConsistency = Math.max(0, Math.min(1, parseFloat(timeConsistencyInput.value) || 0));
        timeConsistencyInput.addEventListener('input', () => {
            timeConsistency = Math.max(0, Math.min(1, parseFloat(timeConsistencyInput.value) || 0));
            if (projectionMode === 'relative') rebuildGeometry();
        });
    }
    if (trailLengthInput && trailLengthDisplay) {
        trailLengthDisplay.textContent = `${trailLengthInput.value}s`;
        trailLengthInput.addEventListener('input', () => {
            trailLengthDisplay.textContent = `${trailLengthInput.value}s`;
            if (trailEnabledInput && trailEnabledInput.checked && projectionMode === 'absolute') rebuildGeometry();
        });
    }
    if (trailEnabledInput) {
        trailEnabledInput.addEventListener('change', () => {
            if (projectionMode === 'absolute') rebuildGeometry();
        });
    }
    function clampRange() {
        if (rangeStartPct > rangeEndPct) {
            const tmp = rangeStartPct; rangeStartPct = rangeEndPct; rangeEndPct = tmp;
            if (startSlider && endSlider) {
                startSlider.value = String(rangeStartPct);
                endSlider.value = String(rangeEndPct);
            }
        }
        updateLabels();
        rebuildGeometry();
    }
    if (startSlider && endSlider) {
        startSlider.addEventListener('input', () => { rangeStartPct = parseInt(startSlider.value, 10) || 0; clampRange(); });
        endSlider.addEventListener('input', () => { rangeEndPct = parseInt(endSlider.value, 10) || 100; clampRange(); });
        updateLabels();
    }

    function setPlaying(on) {
        if (on) {
            if (playTimer) return;
            playBtn && (playBtn.textContent = 'Pause');
            const baseStep = 1; // percent per tick at 1x
            const intervalMs = 200; // tick rate
            playTimer = setInterval(() => {
                const width = Math.max(1, (rangeEndPct - rangeStartPct));
                const speed = speedSel ? Math.max(0.25, parseFloat(speedSel.value) || 1) : 1;
                const step = Math.max(1, Math.round(baseStep * speed));
                let nextStart = rangeStartPct + step;
                let nextEnd = nextStart + width;
                if (nextEnd > 100) {
                    nextStart = 0;
                    nextEnd = width;
                }
                rangeStartPct = nextStart;
                rangeEndPct = nextEnd;
                if (startSlider && endSlider) {
                    startSlider.value = String(rangeStartPct);
                    endSlider.value = String(rangeEndPct);
                }
                clampRange();
            }, intervalMs);
        } else {
            if (playTimer) { clearInterval(playTimer); playTimer = null; }
            playBtn && (playBtn.textContent = 'Play');
        }
    }
    if (playBtn) {
        playBtn.addEventListener('click', () => {
            setPlaying(!playTimer);
        });
    }

    // Size histogram canvas to container width
    function sizeHistCanvas() {
        if (!histCanvas) return;
        const container = document.getElementById('viz-container');
        const dpr = window.devicePixelRatio || 1;
        const cssWidth = (container ? container.clientWidth : histCanvas.clientWidth) || 300;
        const cssHeight = parseInt(getComputedStyle(histCanvas).height, 10) || 60;
        histCanvas.width = Math.max(1, Math.floor(cssWidth * dpr));
        histCanvas.height = Math.max(1, Math.floor(cssHeight * dpr));
        drawHistogram();
    }
    sizeHistCanvas();
    renderStatus();

    // Load existing vectorizer settings to populate UI
    chrome.storage.local.get('vectorizerSettings', (res) => {
        const s = res.vectorizerSettings || vectorizerSettings;
        vectorizerSettings = { ...vectorizerSettings, ...s };
        if (weightingSel) weightingSel.value = vectorizerSettings.weighting;
        if (minDfInput) minDfInput.value = String(vectorizerSettings.minDfRatio);
        if (maxDfInput) maxDfInput.value = String(vectorizerSettings.maxDfRatio);
        if (vocabSizeInput) vocabSizeInput.value = String(vectorizerSettings.vocabSize);
    });
    if (applyBtn) {
        applyBtn.addEventListener('click', () => {
            const s = {
                weighting: (weightingSel && (weightingSel.value === 'tfidf')) ? 'tfidf' : 'count',
                minDfRatio: minDfInput ? Math.max(0, Math.min(1, parseFloat(minDfInput.value) || 0)) : 0,
                maxDfRatio: maxDfInput ? Math.max(0, Math.min(1, parseFloat(maxDfInput.value) || 1)) : 1,
                vocabSize: vocabSizeInput ? Math.max(128, (parseInt(vocabSizeInput.value, 10) || 1000)) : 1000,
            };
            vectorizerSettings = { ...vectorizerSettings, ...s };
            chrome.storage.local.set({ vectorizerSettings: vectorizerSettings });
            // Rebuild relative view immediately to reflect new weighting
            if (projectionMode === 'relative') rebuildGeometry();
            logger.info('Saved vectorizer settings', vectorizerSettings);
            renderStatus();
        });
    }

    if (autoBtn) {
        autoBtn.addEventListener('click', () => {
            runAutoVectorSettings();
        });
    }

    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            // Clear selections
            selectedClusters.clear();
            selectedDomains.clear();
            selectedTokens.clear();
            for (const sel of [clusterSel, domainSel, tokenSel]) {
                if (!sel) continue;
                for (const opt of sel.options) opt.selected = false;
            }
            // Reset vector settings to defaults
            vectorizerSettings = { weighting: 'count', minDfRatio: 0, maxDfRatio: 1, vocabSize: 1000 };
            if (weightingSel) weightingSel.value = vectorizerSettings.weighting;
            if (minDfInput) minDfInput.value = String(vectorizerSettings.minDfRatio);
            if (maxDfInput) maxDfInput.value = String(vectorizerSettings.maxDfRatio);
            if (vocabSizeInput) vocabSizeInput.value = String(vectorizerSettings.vocabSize);
            chrome.storage.local.set({ vectorizerSettings });
            rebuildGeometry();
            logger.info('Reset filters and vectorizer settings');
            renderStatus();
        });
    }

    function extractSelected(sel) {
        const out = new Set();
        if (!sel) return out;
        for (const opt of sel.options) if (opt.selected) out.add(opt.value);
        return out;
    }
    function attachSelectListeners() {
        if (clusterSel) clusterSel.addEventListener('change', () => { selectedClusters = extractSelected(clusterSel); rebuildGeometry(); });
        if (domainSel) domainSel.addEventListener('change', () => { selectedDomains = extractSelected(domainSel); rebuildGeometry(); });
        if (tokenSel) tokenSel.addEventListener('change', () => { selectedTokens = extractSelected(tokenSel); rebuildGeometry(); });
    }
    attachSelectListeners();

    animate();
}

function updatePoints(packetData) {
    // Set all packets and time bounds, then rebuild view
    allPackets = Array.isArray(packetData) ? packetData : [];
    const tsVals = allPackets.map(p => p.ts).filter(v => typeof v === 'number' && isFinite(v));
    if (tsVals.length) {
        timeMin = Math.min(...tsVals);
        timeMax = Math.max(...tsVals);
    } else {
        timeMin = timeMax = null;
    }
    rebuildGeometry();
    drawHistogram();
    renderStatus();
}

function filterPacketsByTime(data) {
    if (timeMin == null || timeMax == null) return data;
    const startTs = getTimeFromPct(rangeStartPct);
    const endTs = getTimeFromPct(rangeEndPct);
    if (startTs == null || endTs == null) return data;
    const s = Math.min(startTs, endTs);
    const e = Math.max(startTs, endTs);
    return data.filter(p => typeof p.ts === 'number' ? (p.ts >= s && p.ts <= e) : true);
}

function parseHost(u) {
    try { return new URL(u).hostname; } catch { return ''; }
}

// Extract a simple domain key: the label just before the TLD (e.g. "google" from "www.google.com")
function getDomainKey(host) {
    if (!host) return '';
    const parts = host.split('.').filter(Boolean);
    if (parts.length >= 2) {
        return parts[parts.length - 2];
    }
    return host;
}

function applySelections(data) {
    return data.filter(p => {
        // cluster filter
        if (selectedClusters.size > 0) {
            if (!selectedClusters.has(String(p.cluster))) return false;
        }
        // domain filter (grouped by root domain label)
        if (selectedDomains.size > 0) {
            const host = parseHost(p.url);
            const key = getDomainKey(host);
            if (!selectedDomains.has(key)) return false;
        }
        // token filter (any match)
        if (selectedTokens.size > 0) {
            const toks = (p.diagnostics && p.diagnostics.tokens) ? p.diagnostics.tokens : [];
            let ok = false;
            for (const t of toks) { if (selectedTokens.has(t)) { ok = true; break; } }
            if (!ok) return false;
        }
        return true;
    });
}

function populateFilters(windowed) {
    const clusterCounts = new Map();
    const domainCounts = new Map();
    const tokenCounts = new Map();
    for (const p of windowed) {
        const c = String(p.cluster || 0);
        clusterCounts.set(c, (clusterCounts.get(c) || 0) + 1);
        const host = parseHost(p.url);
        const key = getDomainKey(host);
        if (key) domainCounts.set(key, (domainCounts.get(key) || 0) + 1);
        const toks = (p.diagnostics && p.diagnostics.tokens) ? p.diagnostics.tokens : [];
        for (const t of toks) tokenCounts.set(t, (tokenCounts.get(t) || 0) + 1);
    }
    // sort by count desc
    const clusterSorted = [...clusterCounts.entries()].sort((a,b)=>b[1]-a[1]);
    const domainSorted = [...domainCounts.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 50);
    const tokenSorted = [...tokenCounts.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 100);

    function setOptions(sel, entries) {
        if (!sel) return;
        const prev = new Set();
        for (const opt of sel.options) if (opt.selected) prev.add(opt.value);
        sel.innerHTML = '';
        for (const [val,count] of entries) {
            const opt = document.createElement('option');
            opt.value = val; opt.textContent = `${val} (${count})`;
            if (prev.has(val)) opt.selected = true;
            sel.appendChild(opt);
        }
    }
    setOptions(document.getElementById('cluster-filter'), clusterSorted);
    setOptions(document.getElementById('domain-filter'), domainSorted);
    setOptions(document.getElementById('token-filter'), tokenSorted);
}

function rebuildGeometry() {
    const data = allPackets || [];
    const valid = data.filter(p => p && p.y && p.y.every && p.y.every(isFinite));
    let windowed = filterPacketsByTime(valid);
    // Optional trail limiting in absolute mode
    const trailEnabledInput = document.getElementById('trail-enabled');
    const trailLengthInput = document.getElementById('trail-length');
    const trailsOn = trailEnabledInput && trailEnabledInput.checked && projectionMode === 'absolute';
    let maxTrailMs = null;
    let trailNowTs = null;
    if (trailsOn && trailLengthInput) {
        const lenSec = Math.max(1, parseInt(trailLengthInput.value, 10) || 10);
        maxTrailMs = lenSec * 1000;
        // Use end of current time window (or global latest) as "now" for trails
        const endTsFromSlider = getTimeFromPct(rangeEndPct);
        trailNowTs = (endTsFromSlider != null) ? endTsFromSlider : timeMax;
        if (trailNowTs != null) {
            windowed = windowed.filter(p => {
                const ts = typeof p.ts === 'number' ? p.ts : NaN;
                if (!isFinite(ts)) return false;
                const age = trailNowTs - ts;
                return age <= maxTrailMs && age >= 0;
            });
        }
    }
    const filtered = applySelections(windowed);
    populateFilters(windowed);
    logger.debug('Updating points', { total: data.length, valid: valid.length, windowed: windowed.length, filtered: filtered.length, mode: projectionMode });

    let positions3D;
    let relClusters = null;

    const absPositions = filtered.map(p => (Array.isArray(p.y) ? p.y : Array.from(p.y)));

    if (projectionMode === 'relative') {
        const relPositions = computeRelativePCA(filtered);
        const mix = Math.max(0, Math.min(1, relativeMix));
        if (mix >= 1) {
            positions3D = relPositions;
        } else if (mix <= 0) {
            positions3D = absPositions;
        } else {
            positions3D = relPositions.map((r, i) => {
                const a = absPositions[i] || r;
                return [
                    a[0] * (1 - mix) + r[0] * mix,
                    a[1] * (1 - mix) + r[1] * mix,
                    a[2] * (1 - mix) + r[2] * mix,
                ];
            });
        }
        const k = Math.max(1, Math.min(8, positions3D.length));
        relClusters = (positions3D.length >= 2) ? kmeans3D(positions3D, k, 10) : { labels: new Array(positions3D.length).fill(0), k, centers: [] };
    } else {
        positions3D = absPositions;
    }

    // Fallback if degenerate positions (all same / near-zero variance)
    if (positions3D.length > 1) {
        let meanX=0, meanY=0, meanZ=0;
        for (const p of positions3D) { meanX+=p[0]; meanY+=p[1]; meanZ+=p[2]; }
        meanX/=positions3D.length; meanY/=positions3D.length; meanZ/=positions3D.length;
        let varSum=0; for (const p of positions3D) { varSum += (p[0]-meanX)**2 + (p[1]-meanY)**2 + (p[2]-meanZ)**2; }
        if (varSum < 1e-6) {
            // Use absolute embedding as safe fallback
            positions3D = filtered.map(p => (Array.isArray(p.y) ? p.y : Array.from(p.y)));
            relClusters = null;
            logger.warn('Relative projection degenerate; falling back to absolute coordinates');
        }
    }

    const positions = points.geometry.attributes.position.array;
    const colors = points.geometry.attributes.color.array;
    const numPoints = Math.min(positions3D.length, MAX_POINTS);

    if (numPoints === 0) {
        packetCache = [];
        lastPositionsById = new Map();
        hasFramedOnce = false;
        points.geometry.setDrawRange(0, 0);
        points.geometry.attributes.position.needsUpdate = true;
        visibleDomainLabels = [];
        syncDomainLabelElements();
        return;
    }

    packetCache = filtered.slice(0, numPoints);
    const domainStats = new Map();
    const nextPositions = new Map();
    for (let i = 0; i < numPoints; i++) {
        const y = positions3D[i];
        const idx = i * 3;
        const rawX = y[0] * 10;
        const rawY = y[1] * 10;
        const rawZ = y[2] * 10;

        const packet = packetCache[i];
        const prev = packet && packet.id != null ? lastPositionsById.get(packet.id) : null;
        let px = rawX;
        let py = rawY;
        let pz = rawZ;
        if (prev && Array.isArray(prev) && prev.length === 3) {
            const alpha = POSITION_INERTIA;
            const inv = 1 - alpha;
            px = prev[0] * inv + rawX * alpha;
            py = prev[1] * inv + rawY * alpha;
            pz = prev[2] * inv + rawZ * alpha;
        }
        positions[idx] = px;
        positions[idx + 1] = py;
        positions[idx + 2] = pz;
        if (packet && packet.id != null) {
            nextPositions.set(packet.id, [px, py, pz]);
        }

        const color = new THREE.Color();
        const denom = (projectionMode === 'relative' && relClusters) ? Math.max(1, relClusters.k || 8) : 8;
        const cls = (projectionMode === 'relative' && relClusters) ? relClusters.labels[i] : (packet.cluster || 0);

        // Time-based fade in absolute mode with trails
        let sat = 0.8;
        let light = 0.6;
        if (trailsOn && maxTrailMs != null && trailNowTs != null && typeof packet.ts === 'number' && isFinite(packet.ts)) {
            const age = Math.max(0, Math.min(maxTrailMs, trailNowTs - packet.ts));
            const t = age / maxTrailMs; // 0 = newest, 1 = oldest in trail
            const fade = 1 - t;
            sat = 0.3 + 0.7 * fade;
            light = 0.3 + 0.4 * fade;
        }
        color.setHSL((cls % denom) / denom, sat, light);
        colors[idx] = color.r;
        colors[idx + 1] = color.g;
        colors[idx + 2] = color.b;

        // Accumulate per-domain centroid stats (grouped by domain key)
        const host = parseHost(packet.url);
        const key = getDomainKey(host);
        if (key) {
            let s = domainStats.get(key);
            if (!s) {
                s = { sumX: 0, sumY: 0, sumZ: 0, count: 0 };
                domainStats.set(key, s);
            }
            s.sumX += px;
            s.sumY += py;
            s.sumZ += pz;
            s.count++;
        }
    }
    lastPositionsById = nextPositions;

    // Build sorted list of visible domain centroids for labeling
    if (domainStats.size && maxDomainLabels > 0) {
        const allDomains = [];
        for (const [key, s] of domainStats.entries()) {
            const cx = s.sumX / s.count;
            const cy = s.sumY / s.count;
            const cz = s.sumZ / s.count;
            allDomains.push({
                key,
                count: s.count,
                center: new THREE.Vector3(cx, cy, cz),
            });
        }
        allDomains.sort((a, b) => b.count - a.count);
        const limit = Math.max(0, Math.min(maxDomainLabels, allDomains.length));
        visibleDomainLabels = allDomains.slice(0, limit);
        if (domainLabelCountInputEl) {
            // Let the slider know how many labels are possible (cap for sanity)
            const maxSlider = Math.min(allDomains.length, 24);
            domainLabelCountInputEl.max = String(maxSlider);
            if (maxDomainLabels > maxSlider) {
                maxDomainLabels = maxSlider;
                domainLabelCountInputEl.value = String(maxDomainLabels);
                if (domainLabelCountLabelEl) {
                    domainLabelCountLabelEl.textContent = String(maxDomainLabels);
                }
            }
        }
    } else {
        visibleDomainLabels = [];
    }
    syncDomainLabelElements();

    points.geometry.attributes.position.needsUpdate = true;
    points.geometry.attributes.color.needsUpdate = true;
    points.geometry.setDrawRange(0, numPoints);

    // Keep bounding sphere updated for overlays and recenter, but only auto-frame once
    points.geometry.computeBoundingSphere();
    const sphere = points.geometry.boundingSphere;
    if (!hasFramedOnce && sphere && sphere.radius > 0) {
        const center = sphere.center;
        const radius = sphere.radius;
        logger.debug('Bounding sphere computed (initial frame):', { center, radius });
        const fov = camera.fov * (Math.PI / 180);
        const distance = Math.max(50, Math.abs(radius / Math.sin(fov / 2)));
        const near = Math.max(0.1, distance - radius * 2);
        const far = Math.max(distance + radius * 2, 2000);
        camera.near = near; camera.far = far; camera.updateProjectionMatrix();
        camera.position.set(center.x, center.y, center.z + distance);
        camera.lookAt(center);
        if (controls) { controls.target.copy(center); controls.update(); }
        hasFramedOnce = true;
        logger.debug('Camera position auto-framed', { position: camera.position, target: center });
    }
}

function drawHistogram() {
    if (!histCtx || !histCanvas) return;
    const ctx = histCtx;
    const w = histCanvas.width;
    const h = histCanvas.height;
    ctx.clearRect(0, 0, w, h);
    // No data
    if (!allPackets || !allPackets.length || timeMin == null || timeMax == null) {
        ctx.fillStyle = '#ddd';
        ctx.fillRect(0, 0, w, h);
        return;
    }
    // Build histogram over [timeMin, timeMax]
    const bins = new Array(HIST_BINS).fill(0);
    const span = Math.max(1, timeMax - timeMin);
    for (const p of allPackets) {
        const ts = p.ts;
        if (typeof ts !== 'number' || !isFinite(ts)) continue;
        let idx = Math.floor(((ts - timeMin) / span) * HIST_BINS);
        if (idx < 0) idx = 0; if (idx >= HIST_BINS) idx = HIST_BINS - 1;
        bins[idx] += 1;
    }
    const maxCount = bins.reduce((m, v) => v > m ? v : m, 0) || 1;
    // Draw background
    ctx.fillStyle = '#fafafa';
    ctx.fillRect(0, 0, w, h);
    // Draw bars
    const barW = w / HIST_BINS;
    for (let i = 0; i < HIST_BINS; i++) {
        const v = bins[i] / maxCount;
        const bh = Math.floor(v * (h - 4));
        const x = Math.floor(i * barW);
        const y = h - bh;
        ctx.fillStyle = '#cbd5e1';
        ctx.fillRect(x, y, Math.ceil(barW) - 1, bh);
    }
    // Overlay selected window
    const sPct = Math.min(rangeStartPct, rangeEndPct) / 100;
    const ePct = Math.max(rangeStartPct, rangeEndPct) / 100;
    const x0 = Math.floor(sPct * w);
    const x1 = Math.floor(ePct * w);
    ctx.fillStyle = 'rgba(0,123,255,0.18)';
    ctx.fillRect(x0, 0, x1 - x0, h);
    ctx.strokeStyle = 'rgba(0,123,255,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x0 + 0.5, 0);
    ctx.lineTo(x0 + 0.5, h);
    ctx.moveTo(x1 + 0.5, 0);
    ctx.lineTo(x1 + 0.5, h);
    ctx.stroke();
}

function syncDomainLabelElements() {
    if (!domainLabelOverlay) return;
    // Remove any extra elements
    while (domainLabelElems.length > visibleDomainLabels.length) {
        const el = domainLabelElems.pop();
        if (el && el.parentNode === domainLabelOverlay) {
            domainLabelOverlay.removeChild(el);
        }
    }
    // Add missing elements
    while (domainLabelElems.length < visibleDomainLabels.length) {
        const el = document.createElement('div');
        el.className = 'domain-label';
        el.style.position = 'absolute';
        el.style.transform = 'translate(-50%, -50%)';
        el.style.padding = '2px 6px';
        el.style.fontSize = '11px';
        el.style.borderRadius = '999px';
        el.style.background = 'rgba(15,23,42,0.85)';
        el.style.color = '#e2e8f0';
        el.style.pointerEvents = 'auto';
        el.style.whiteSpace = 'nowrap';
        domainLabelOverlay.appendChild(el);
        domainLabelElems.push(el);
    }
    // Update labels text
    for (let i = 0; i < visibleDomainLabels.length; i++) {
        const el = domainLabelElems[i];
        const dom = visibleDomainLabels[i];
        el.textContent = `${dom.key} (${dom.count})`;
        el.style.display = 'block';
    }
    if (visibleDomainLabels.length === 0) {
        // Hide any leftover elements
        for (const el of domainLabelElems) {
            el.style.display = 'none';
        }
    }
}

function updateDomainLabels() {
    if (!domainLabelOverlay || !camera || !renderer) return;
    if (!visibleDomainLabels.length || !domainLabelElems.length) return;
    const width = renderer.domElement.clientWidth || 1;
    const height = renderer.domElement.clientHeight || 1;
    for (let i = 0; i < visibleDomainLabels.length; i++) {
        const el = domainLabelElems[i];
        const dom = visibleDomainLabels[i];
        const v = dom.center.clone();
        v.project(camera);
        // Cull if behind camera or off-screen
        if (v.z < 0 || v.z > 1 || v.x < -1 || v.x > 1 || v.y < -1 || v.y > 1) {
            el.style.display = 'none';
            continue;
        }
        el.style.display = 'block';
        const x = (v.x * 0.5 + 0.5) * width;
        const y = (-v.y * 0.5 + 0.5) * height;
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
    }
}

function renderStatus() {
    if (!statusStrip) return;
    const clearBtn = document.getElementById('clear-all-filters');
    statusStrip.innerHTML = '';
    if (clearBtn) statusStrip.appendChild(clearBtn);

    function addChip(text, onRemove) {
        const chip = document.createElement('span');
        chip.className = 'chip';
        const label = document.createElement('span');
        label.textContent = text;
        chip.appendChild(label);
        if (onRemove) {
            const close = document.createElement('span');
            close.className = 'close';
            close.textContent = '×';
            close.addEventListener('click', onRemove);
            chip.appendChild(close);
        }
        statusStrip.insertBefore(chip, clearBtn || null);
    }

    // Time window chip
    if (rangeStartPct > 0 || rangeEndPct < 100) {
        const sTs = getTimeFromPct(rangeStartPct);
        const eTs = getTimeFromPct(rangeEndPct);
        addChip(`Window: ${fmtTime(sTs)}–${fmtTime(eTs)}`, () => {
            const startSlider = document.getElementById('time-range-start');
            const endSlider = document.getElementById('time-range-end');
            rangeStartPct = 0; rangeEndPct = 100;
            if (startSlider) startSlider.value = '0';
            if (endSlider) endSlider.value = '100';
            drawHistogram();
            rebuildGeometry();
        });
    }

    // Projection + vectorization summary
    addChip(`Projection: ${projectionMode}`, null);
    addChip(`Weighting: ${vectorizerSettings.weighting}`, null);
    addChip(`DF: ${vectorizerSettings.minDfRatio}–${vectorizerSettings.maxDfRatio}`, null);

    // Clusters
    for (const c of selectedClusters) {
        addChip(`Cluster: ${c}`, () => {
            selectedClusters.delete(c);
            const sel = document.getElementById('cluster-filter');
            if (sel) { for (const opt of sel.options) if (opt.value === c) opt.selected = false; }
            rebuildGeometry();
        });
    }
    // Domains
    let i = 0;
    for (const d of selectedDomains) {
        if (i < 10) {
            addChip(`Domain: ${d}`, () => {
                selectedDomains.delete(d);
                const sel = document.getElementById('domain-filter');
                if (sel) { for (const opt of sel.options) if (opt.value === d) opt.selected = false; }
                rebuildGeometry();
            });
        }
        i++;
    }
    if (selectedDomains.size > 10) addChip(`+${selectedDomains.size - 10} more domains`, null);

    // Tokens
    i = 0;
    for (const t of selectedTokens) {
        if (i < 10) {
            addChip(`Token: ${t}`, () => {
                selectedTokens.delete(t);
                const sel = document.getElementById('token-filter');
                if (sel) { for (const opt of sel.options) if (opt.value === t) opt.selected = false; }
                rebuildGeometry();
            });
        }
        i++;
    }
    if (selectedTokens.size > 10) addChip(`+${selectedTokens.size - 10} more tokens`, null);

    // Clear all
    if (clearBtn) {
        clearBtn.onclick = () => {
            selectedClusters.clear(); selectedDomains.clear(); selectedTokens.clear();
            const cs = document.getElementById('cluster-filter'); if (cs) for (const o of cs.options) o.selected = false;
            const ds = document.getElementById('domain-filter'); if (ds) for (const o of ds.options) o.selected = false;
            const ts = document.getElementById('token-filter'); if (ts) for (const o of ts.options) o.selected = false;
            const startSlider = document.getElementById('time-range-start');
            const endSlider = document.getElementById('time-range-end');
            rangeStartPct = 0; rangeEndPct = 100;
            if (startSlider) startSlider.value = '0';
            if (endSlider) endSlider.value = '100';
            drawHistogram();
            rebuildGeometry();
        };
    }
}

// Simple local Auto mode: try a small grid of vectorizer settings on the current window
function runAutoVectorSettings() {
    if (!allPackets || allPackets.length < 10) {
        logger.info('Auto vector settings skipped: not enough packets');
        return;
    }
    const data = allPackets.filter(p => p && p.y && p.y.every && p.y.every(isFinite));
    const windowed = filterPacketsByTime(data);
    const sample = (projectionMode === 'absolute') ? data : windowed;
    if (sample.length < 10) {
        logger.info('Auto vector settings skipped: not enough packets in sample');
        return;
    }

    const candidates = [];
    const weightings = ['count', 'tfidf'];
    const minDfs = [0, 0.01, 0.05];
    const maxDfs = [0.9, 1.0];
    const ks = [6, 8];
    for (const w of weightings) {
        for (const minDf of minDfs) {
            for (const maxDf of maxDfs) {
                if (minDf >= maxDf) continue;
                for (const k of ks) {
                    candidates.push({ weighting: w, minDfRatio: minDf, maxDfRatio: maxDf, k });
                }
            }
        }
    }

    let bestScore = -Infinity;
    let bestCfg = null;

    for (const cfg of candidates) {
        try {
            const X = projectTokensToDims(sample, 12, cfg);
            if (X.length < 2) continue;
            const k = Math.max(2, Math.min(cfg.k, X.length));
            const km = kmeans3D(X.map(v => (Array.isArray(v) ? v : Array.from(v))), k, 8);
            if (!km || !km.labels || km.labels.length === 0) continue;

            // Compute compactness: average distance to cluster center
            let compactSum = 0;
            for (let i = 0; i < X.length; i++) {
                const c = km.labels[i] || 0;
                const center = km.centers && km.centers[c] ? km.centers[c] : [0,0,0];
                const p = X[i];
                const dx = p[0] - center[0];
                const dy = p[1] - center[1];
                const dz = p[2] - center[2];
                compactSum += Math.sqrt(dx*dx + dy*dy + dz*dz);
            }
            const compactness = compactSum / X.length;

            // Separation: average pairwise distance between cluster centers
            let sepSum = 0;
            let sepCnt = 0;
            if (km.centers && km.centers.length > 1) {
                for (let i = 0; i < km.centers.length; i++) {
                    for (let j = i + 1; j < km.centers.length; j++) {
                        const a = km.centers[i];
                        const b = km.centers[j];
                        const dx = a[0] - b[0];
                        const dy = a[1] - b[1];
                        const dz = a[2] - b[2];
                        sepSum += Math.sqrt(dx*dx + dy*dy + dz*dz);
                        sepCnt++;
                    }
                }
            }
            const separation = sepCnt > 0 ? (sepSum / sepCnt) : 0;

            if (!isFinite(compactness) || compactness <= 1e-6) continue;
            const score = separation / compactness;
            if (score > bestScore) {
                bestScore = score;
                bestCfg = cfg;
            }
        } catch (e) {
            logger.warn('Auto vector candidate failed', e);
        }
    }

    if (!bestCfg) {
        logger.info('Auto vector settings could not find a better configuration');
        return;
    }

    vectorizerSettings = {
        ...vectorizerSettings,
        weighting: bestCfg.weighting,
        minDfRatio: bestCfg.minDfRatio,
        maxDfRatio: bestCfg.maxDfRatio,
    };
    chrome.storage.local.set({ vectorizerSettings });
    logger.info('Auto-selected vectorizer settings', bestCfg);

    // Rebuild using the current projection mode to reflect new settings
    rebuildGeometry();
    renderStatus();
}

function computeRelativePCA(packets) {
    // Build projected features from tokens using current weighting settings
    const proj = projectTokensToDims(packets, 16, vectorizerSettings);
    const X = proj;
    if (X.length < 2) {
        return packets.map(p => (Array.isArray(p.y) ? p.y : Array.from(p.y)));
    }
    const N = X.length;
    const D = X[0].length;
    const mean = new Float64Array(D);
    const varr = new Float64Array(D);
    const weights = new Float64Array(N);

    // Time-consistency weights: emphasize mid-window timestamps when slider > 0
    let wSum = 0;
    let tMinLocal = Infinity;
    let tMaxLocal = -Infinity;
    if (timeConsistency > 0) {
        for (const p of packets) {
            const ts = typeof p.ts === 'number' ? p.ts : NaN;
            if (!isFinite(ts)) continue;
            if (ts < tMinLocal) tMinLocal = ts;
            if (ts > tMaxLocal) tMaxLocal = ts;
        }
        if (!isFinite(tMinLocal) || tMinLocal === tMaxLocal) {
            tMinLocal = Infinity;
            tMaxLocal = -Infinity;
        }
    }
    for (let i = 0; i < N; i++) {
        let w = 1;
        if (timeConsistency > 0 && isFinite(tMinLocal) && isFinite(tMaxLocal)) {
            const p = packets[i];
            const ts = typeof p.ts === 'number' ? p.ts : tMinLocal;
            const span = tMaxLocal - tMinLocal || 1;
            const tNorm = Math.min(1, Math.max(0, (ts - tMinLocal) / span));
            const focus = 1 - Math.abs(2 * tNorm - 1); // peak in middle
            const base = 1 - timeConsistency;
            w = base + timeConsistency * focus;
        }
        weights[i] = w;
        wSum += w;
    }
    if (!isFinite(wSum) || wSum <= 0) {
        return packets.map(p => (Array.isArray(p.y) ? p.y : Array.from(p.y)));
    }

    // weighted mean
    for (let i = 0; i < N; i++) {
        const xi = X[i];
        const wi = weights[i];
        for (let d = 0; d < D; d++) mean[d] += wi * xi[d];
    }
    for (let d = 0; d < D; d++) mean[d] /= wSum;

    // quick variance check before standardization
    let varSumQuick = 0;
    for (let i = 0; i < N; i++) {
        const xi = X[i];
        const wi = weights[i];
        for (let d = 0; d < D; d++) {
            const diff = xi[d] - mean[d];
            varSumQuick += wi * diff * diff;
        }
    }
    if (varSumQuick < 1e-9) {
        return packets.map(p => (Array.isArray(p.y) ? p.y : Array.from(p.y)));
    }

    // weighted variance
    for (let i = 0; i < N; i++) {
        const xi = X[i];
        const wi = weights[i];
        for (let d = 0; d < D; d++) {
            const diff = xi[d] - mean[d];
            varr[d] += wi * diff * diff;
        }
    }
    const denomVar = Math.max(1, wSum - 1);
    for (let d = 0; d < D; d++) varr[d] = Math.max(1e-12, varr[d] / denomVar);

    const Z = new Array(N);
    for (let i = 0; i < N; i++) {
        const row = new Float64Array(D);
        const xi = X[i];
        for (let d = 0; d < D; d++) row[d] = (xi[d] - mean[d]) / Math.sqrt(varr[d]);
        Z[i] = row;
    }

    const C = new Float64Array(D * D);
    for (let i = 0; i < N; i++) {
        const zi = Z[i];
        const wi = weights[i];
        for (let a = 0; a < D; a++) {
            const za = zi[a] * wi;
            for (let b = 0; b < D; b++) C[a * D + b] += za * zi[b];
        }
    }
    const scale = 1 / Math.max(1, wSum - 1);
    for (let k = 0; k < C.length; k++) C[k] *= scale;
    const comps = [];
    const maxIter = 40; const tol = 1e-6; let Cwork = C;
    for (let m = 0; m < 3; m++) {
        let v = new Float64Array(D);
        for (let d = 0; d < D; d++) v[d] = Math.random() - 0.5;
        let nrm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
        if (nrm === 0) v[0] = 1; else for (let d = 0; d < D; d++) v[d] /= nrm;
        let lambda = 0;
        for (let it = 0; it < maxIter; it++) {
            const w = new Float64Array(D);
            for (let i2 = 0; i2 < D; i2++) {
                let s = 0; const row = i2 * D;
                for (let j2 = 0; j2 < D; j2++) s += Cwork[row + j2] * v[j2];
                w[i2] = s;
            }
            const n = Math.sqrt(w.reduce((s, x) => s + x * x, 0));
            if (n < 1e-12) break;
            for (let d = 0; d < D; d++) v[d] = w[d] / n;
            const newLambda = dotVecMatVec(v, Cwork, v, D);
            if (Math.abs(newLambda - lambda) < tol) { lambda = newLambda; break; }
            lambda = newLambda;
        }
        comps.push({ vec: v, val: lambda });
        const Cnext = new Float64Array(D * D);
        for (let i2 = 0; i2 < D; i2++) for (let j2 = 0; j2 < D; j2++) Cnext[i2 * D + j2] = Cwork[i2 * D + j2] - lambda * v[i2] * v[j2];
        Cwork = Cnext;
    }
    const W = new Float64Array(D * 3);
    for (let m = 0; m < 3; m++) for (let d = 0; d < D; d++) W[d * 3 + m] = (comps[m] && comps[m].vec ? comps[m].vec[d] : 0);
    const Y = new Array(N);
    for (let i = 0; i < N; i++) {
        const zi = Z[i];
        const y = [0, 0, 0];
        for (let m = 0; m < 3; m++) {
            let s = 0; for (let d = 0; d < D; d++) s += zi[d] * W[d * 3 + m];
            y[m] = s;
        }
        Y[i] = y;
    }
    return Y;
}

function dotVecMatVec(v1, M, v2, D) {
    let s = 0;
    for (let i = 0; i < D; i++) {
        let r = 0; const row = i * D;
        for (let j = 0; j < D; j++) r += M[row + j] * v2[j];
        s += v1[i] * r;
    }
    return s;
}

// Simple k-means on 3D positions
function kmeans3D(points, k, iters = 10) {
    const n = points.length;
    if (n === 0) return { labels: [], k };
    k = Math.max(1, Math.min(k, n));
    // Init centers by sampling
    const centers = new Array(k);
    const used = new Set();
    for (let i = 0; i < k; i++) {
        let idx;
        do { idx = Math.floor(Math.random() * n); } while (used.has(idx) && used.size < n);
        used.add(idx);
        centers[i] = points[idx].slice ? points[idx].slice(0, 3) : [points[idx][0], points[idx][1], points[idx][2]];
    }
    const labels = new Array(n).fill(0);
    for (let it = 0; it < iters; it++) {
        // Assign
        for (let i = 0; i < n; i++) {
            const p = points[i];
            let best = 0, bestD = Infinity;
            for (let c = 0; c < k; c++) {
                const dx = p[0] - centers[c][0];
                const dy = p[1] - centers[c][1];
                const dz = p[2] - centers[c][2];
                const d = dx*dx + dy*dy + dz*dz;
                if (d < bestD) { bestD = d; best = c; }
            }
            labels[i] = best;
        }
        // Update
        const sum = new Array(k).fill(0).map(() => [0,0,0]);
        const cnt = new Array(k).fill(0);
        for (let i = 0; i < n; i++) {
            const c = labels[i];
            const p = points[i];
            sum[c][0] += p[0]; sum[c][1] += p[1]; sum[c][2] += p[2];
            cnt[c]++;
        }
        for (let c = 0; c < k; c++) {
            if (cnt[c] > 0) {
                centers[c][0] = sum[c][0] / cnt[c];
                centers[c][1] = sum[c][1] / cnt[c];
                centers[c][2] = sum[c][2] / cnt[c];
            }
        }
    }
    return { labels, k, centers };
}

// Hash helpers for relative projection from tokens
function murmur32(str, seed=1337){
    let h = seed >>> 0;
    for (let i=0;i<str.length;i++){
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x5bd1e995);
        h ^= h >>> 13;
    }
    h = Math.imul(h, 0x5bd1e995);
    h ^= h >>> 15;
    return h >>> 0;
}

function projectTokensToDims(packets, projDim, settings){
    const docs = [];
    const tokenSetList = [];
    const df = new Map();
    for (const p of packets) {
        const toks = (p.diagnostics && Array.isArray(p.diagnostics.tokens)) ? p.diagnostics.tokens : [];
        const set = new Set();
        for (const t of toks) {
            if (projectionView === 'endpoint') {
                // Focus on endpoint semantics: host/path/query/method/type/status/root/pathseg/depth
                if (
                    t.startsWith('host:') ||
                    t.startsWith('root:') ||
                    t.startsWith('path:') ||
                    t.startsWith('pathseg:') ||
                    t.startsWith('depth:') ||
                    t.startsWith('query:') ||
                    t.startsWith('method:') ||
                    t.startsWith('type:') ||
                    t.startsWith('status:')
                ) {
                    set.add(t);
                }
            } else if (projectionView === 'flow') {
                // Focus on flow/size/latency headers
                if (
                    t.startsWith('flow:') ||
                    t.startsWith('cache:') ||
                    t.startsWith('encoding:')
                ) {
                    set.add(t);
                }
            } else {
                // 'all' view uses all tokens
                set.add(t);
            }
        }
        tokenSetList.push(set);
        docs.push(p);
        for (const t of set) df.set(t, (df.get(t) || 0) + 1);
    }
    const N = Math.max(1, docs.length);
    const minDf = Math.max(0, Math.min(1, settings.minDfRatio || 0));
    const maxDf = Math.max(0, Math.min(1, settings.maxDfRatio || 1));

    const out = [];
    for (let i=0;i<docs.length;i++){
        const set = tokenSetList[i];
        const vec = new Float64Array(projDim);
        for (const t of set) {
            const dfi = df.get(t) || 0;
            const ratio = dfi / N;
            if (ratio < minDf || ratio > maxDf) continue;
            let w = 1;
            if (settings.weighting === 'tfidf') {
                const idf = Math.log((N + 1) / (dfi + 1)) + 1;
                w = idf;
            }
            for (let d=0; d<projDim; d++){
                const h = murmur32(t + '|' + d);
                const s = (h & 1) ? 1 : -1;
                vec[d] += w * s;
            }
        }
        out.push(Array.from(vec));
    }
    return out;
}

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
    updateDomainLabels();
}

function displayPacketInfo(packet) {
    logger.info('Displaying info for packet:', packet.id);
    const infoContainer = document.getElementById('info-container');
    if (!infoContainer) {
        logger.error('Info container not found!');
        return;
    }

    // Sanitize URL to prevent XSS
    const url = document.createElement('a');
    url.href = packet.url;
    const safeURL = url.href;

    function quantizeValue(val) {
        if (typeof val !== 'number') return val;
        const f = 10 ** precisionDecimals;
        return Math.round(val * f) / f;
    }
    function quantizeDeep(obj) {
        if (!obj || typeof obj !== 'object') return obj;
        if (Array.isArray(obj)) return obj.map(quantizeDeep);
        const out = {};
        for (const k of Object.keys(obj)) {
            const v = obj[k];
            if (typeof v === 'number') out[k] = quantizeValue(v);
            else if (Array.isArray(v) || (v && typeof v === 'object')) out[k] = quantizeDeep(v);
            else out[k] = v;
        }
        return out;
    }
    const diag = quantizeDeep(packet.diagnostics || {});

    let content = `
        <h3>Packet Details (ID: ${packet.id})</h3>
        <p><strong>URL:</strong> <a href="${safeURL}" target="_blank">${safeURL}</a></p>
        <p><strong>Status:</strong> ${packet.status}</p>
        <p><strong>Method:</strong> ${packet.method}</p>
        <p><strong>Cluster:</strong> ${packet.cluster}</p>
        <pre>${JSON.stringify(diag, null, 2)}</pre>
    `;

    infoContainer.innerHTML = content;
    infoContainer.style.display = 'block';
}
