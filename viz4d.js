import { logger } from './logger.js';

// --- Global Variables ---
let scene, camera, renderer;
let sun, sunLight, ambientLight;
let sunGroup; // A group to hold the sun and all planet systems
let celestialBodies = new Map(); // Map<ID, BodyObject>
let clock = new THREE.Clock();

// Mouse/Camera control state
let isDragging = false;
let previousMousePosition = { x: 0, y: 0 };
let cameraTarget = new THREE.Group();
let cameraRadius = 50;
let cameraYaw = 0.2;
let cameraPitch = 0.5;

// Parameters controlled by the UI
let params = {
    sunSpeed: 0.2,
    orbitSpeed: 1.0,
    tailLength: 500,
    evolutionRate: 0.5,
    tailSize: 1.0,
    diffusion: 0.0,
    glowIntensity: 1.0,
    maxSatellites: 20 // New limit parameter
};

let initialized = false;
let currentUniverseState = null;

// --- Shaders for Particle Tails ---
const vertexShader = `
    attribute float customSize;
    attribute float customOpacity;
    varying float vOpacity;

    void main() {
        vOpacity = customOpacity;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = customSize * (300.0 / -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
    }
`;

const fragmentShader = `
    uniform vec3 color;
    uniform float u_intensity;
    varying float vOpacity;

    void main() {
        if (vOpacity < 0.01) discard;
        float strength = 1.0 - (2.0 * length(gl_PointCoord - vec2(0.5)));
        if (strength < 0.0) discard;
        gl_FragColor = vec4(color * strength * u_intensity, vOpacity);
    }
`;

function createControls() {
    const controlsContainer = document.getElementById('solar-controls');
    if (!controlsContainer) {
        logger.error("Solar controls container not found!");
        return;
    }

    controlsContainer.innerHTML = `
        <div id="vizPanel" style="background-color: rgba(20, 20, 30, 0.85); backdrop-filter: blur(10px); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 12px; padding: 1rem; max-width: 320px; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3); color: white; font-family: 'Inter', sans-serif; transition: all 0.3s ease;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                <h1 class="text-xl font-bold text-white" style="font-size: 1.1rem; margin: 0;">4D Network Universe</h1>
                <button id="toggleVizPanel" style="background: transparent; border: none; color: #93c5fd; cursor: pointer;">▼</button>
            </div>
            
            <div id="vizControlsContent">
                <label for="maxSatellitesSlider" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; font-weight: 500; font-size: 0.8rem;">
                    <span>Cluster Density</span>
                    <span id="maxSatellitesValue" style="font-weight: 600; color: #93c5fd;">8</span>
                </label>
                <input type="range" id="maxSatellitesSlider" min="1" max="50" step="1" value="8" style="width: 100%; margin-bottom: 1rem;">

                <label for="sunSpeedSlider" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; font-weight: 500; font-size: 0.8rem;">
                    <span>System Speed</span>
                    <span id="sunSpeedValue" style="font-weight: 600; color: #93c5fd;">0.2</span>
                </label>
                <input type="range" id="sunSpeedSlider" min="0" max="1" step="0.01" value="0.2" style="width: 100%; margin-bottom: 1rem;">

                <label for="orbitSpeedSlider" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; font-weight: 500; font-size: 0.8rem;">
                    <span>Orbit Speed</span>
                    <span id="orbitSpeedValue" style="font-weight: 600; color: #93c5fd;">1.0</span>
                </label>
                <input type="range" id="orbitSpeedSlider" min="0" max="5" step="0.1" value="1.0" style="width: 100%; margin-bottom: 1rem;">

                <label for="tailLengthSlider" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; font-weight: 500; font-size: 0.8rem;">
                    <span>Tail Length</span>
                    <span id="tailLengthValue" style="font-weight: 600; color: #93c5fd;">500</span>
                </label>
                <input type="range" id="tailLengthSlider" min="50" max="2000" step="50" value="500" style="width: 100%; margin-bottom: 1rem;">
                
                <label for="glowIntensitySlider" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; font-weight: 500; font-size: 0.8rem;">
                    <span>Glow Intensity</span>
                    <span id="glowIntensityValue" style="font-weight: 600; color: #93c5fd;">1.0</span>
                </label>
                <input type="range" id="glowIntensitySlider" min="0.1" max="2.5" step="0.05" value="1.0" style="width: 100%; margin-bottom: 1rem;">

                <div style="margin-top: 0.5rem; font-size: 0.75rem; color: #aaa;">
                    Active Planets: <span id="activeDomainsCount" style="color:white">0</span>
                </div>
            </div>
        </div>
    `;
}

function getRandomColor() {
    const h = Math.random();
    const s = 0.7 + Math.random() * 0.3;
    const l = 0.6 + Math.random() * 0.1;
    return new THREE.Color().setHSL(h, s, l);
}

function getColorForKey(key) {
    if (!key) return getRandomColor();
    let h = 0;
    for (let i = 0; i < key.length; i++) {
        h = (h * 31 + key.charCodeAt(i)) >>> 0;
    }
    const hue = (h % 360) / 360;
    return new THREE.Color().setHSL(hue, 0.65, 0.6);
}

function cleanLabel(text) {
    if (!text) return "";
    // Remove protocol
    text = text.replace(/^https?:\/\//, '');
    // Remove www
    text = text.replace(/^www\./, '');
    // Remove TLD (simple heuristic: take first part of domain)
    const parts = text.split('.');
    if (parts.length > 1) {
        text = parts[0]; 
    }
    // Truncate to 10 chars
    if (text.length > 10) {
        text = text.substring(0, 10);
    }
    return text;
}

// Deterministic phase offset from string
function getPhaseForKey(key) {
    let h = 0;
    for (let i = 0; i < key.length; i++) {
        h = (h * 31 + key.charCodeAt(i)) >>> 0;
    }
    return (h % 1000) / 1000 * Math.PI * 2;
}

function createCelestialBody(id, type, index, label) {
    const isPlanet = type === 'planet';
    const baseSize = isPlanet ? 1.0 : 0.2; 
    const color = getColorForKey(label || id);
    
    const orbitRadius = isPlanet ? (15 + index * 8) : (2.5 + index * 0.8); 
    const orbitalSpeed = (isPlanet ? 0.2 : 1.5) * (10 / orbitRadius); 
    const phaseOffset = getPhaseForKey(id);

    // Optimization: Lower detail for satellites
    const segmentCount = isPlanet ? 32 : 8;
    const geometry = new THREE.SphereGeometry(baseSize, segmentCount, segmentCount);
    const material = new THREE.MeshStandardMaterial({
        color: color,
        emissive: color,
        emissiveIntensity: isPlanet ? 0.5 : 0.2
    });
    const mesh = new THREE.Mesh(geometry, material);

    const anchor = new THREE.Group();
    // IMPORTANT: Mesh stays at 0,0,0 inside anchor. We move the ANCHOR to orbit.
    anchor.add(mesh);

    // Label
    const labelText = cleanLabel(label || id);
    const labelDiv = document.createElement('div');
    labelDiv.className = 'planet-label';
    labelDiv.textContent = labelText;
    labelDiv.style.position = 'absolute';
    labelDiv.style.top = '0'; // CSS Fix for transform
    labelDiv.style.left = '0';
    labelDiv.style.color = 'white';
    labelDiv.style.fontFamily = "'Inter', sans-serif";
    labelDiv.style.fontSize = isPlanet ? '12px' : '10px';
    labelDiv.style.fontWeight = isPlanet ? 'bold' : 'normal';
    labelDiv.style.textShadow = '0 0 4px black';
    labelDiv.style.pointerEvents = 'none';
    labelDiv.style.opacity = '0'; // Start hidden
    labelDiv.style.transition = 'opacity 0.2s';
    labelDiv.style.willChange = 'transform, opacity';
    
    const container = document.getElementById('solar-container');
    if (container) container.appendChild(labelDiv);

    let tail = null;
    if (isPlanet) {
        const positions = new Float32Array(params.tailLength * 3);
        const sizes = new Float32Array(params.tailLength);
        const opacities = new Float32Array(params.tailLength);
        const tailGeo = new THREE.BufferGeometry();
        tailGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        tailGeo.setAttribute('customSize', new THREE.BufferAttribute(sizes, 1));
        tailGeo.setAttribute('customOpacity', new THREE.BufferAttribute(opacities, 1));
        const tailMat = new THREE.ShaderMaterial({
            uniforms: { color: { value: color }, u_intensity: { value: params.glowIntensity } },
            vertexShader, fragmentShader, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
        });
        tail = new THREE.Points(tailGeo, tailMat);
        tail.frustumCulled = false;
        scene.add(tail); 
    }

    return {
        id, type, mesh, anchor, tail, labelDiv, orbitRadius, orbitalSpeed, phaseOffset, baseSize,
        tailPositions: [], tailSizes: [], tailOpacities: [],
        targetScale: 0.01, 
        currentScale: 0.01,
        shouldShowLabel: false // Controlled by state update
    };
}

function updateUniverseState(state) {
    currentUniverseState = state;
    if (!state || !state.domains) return;

    document.getElementById('activeDomainsCount').innerText = state.domains.length;

    const activeIds = new Set();

    state.domains.forEach((domainNode, dIndex) => {
        activeIds.add(domainNode.id);
        
        let planet = celestialBodies.get(domainNode.id);
        if (!planet) {
            planet = createCelestialBody(domainNode.id, 'planet', dIndex, domainNode.label);
            celestialBodies.set(domainNode.id, planet);
            sunGroup.add(planet.anchor);
        }

        const vol = domainNode.metrics.volume || 0;
        planet.targetScale = 1.0 + Math.log10(vol + 1) * 0.2;
        planet.shouldShowLabel = true; // Always show planet labels

        if (domainNode.children) {
            // Limit Satellites to prevent clutter
            const sortedChildren = domainNode.children
                .sort((a, b) => (b.metrics.volume || 0) - (a.metrics.volume || 0))
                .slice(0, params.maxSatellites);

            sortedChildren.forEach((childNode, cIndex) => {
                activeIds.add(childNode.id);
                
                let satellite = celestialBodies.get(childNode.id);
                if (!satellite) {
                    satellite = createCelestialBody(childNode.id, 'satellite', cIndex, childNode.label);
                    celestialBodies.set(childNode.id, satellite);
                    planet.anchor.add(satellite.anchor);
                }
                const satVol = childNode.metrics.volume || 0;
                satellite.targetScale = 1.0 + Math.log10(satVol + 1) * 0.2;
                
                // Only show label for top 2 satellites
                satellite.shouldShowLabel = (cIndex < 2);
            });
        }
    });

    for (const [id, body] of celestialBodies) {
        if (!activeIds.has(id)) {
            body.targetScale = 0.001; 
        }
    }
}

function updateTail(body) {
    if (!body.tail) return; 

    const tail = body.tail;
    const positions = body.tailPositions;
    const sizes = body.tailSizes;
    const opacities = body.tailOpacities;
    
    const worldPos = new THREE.Vector3();
    body.mesh.getWorldPosition(worldPos);

    if (body.currentScale > 0.1) {
        const particlesPerFrame = 1;
        for (let i = 0; i < particlesPerFrame; i++) {
            positions.push(worldPos.x, worldPos.y, worldPos.z);
            sizes.push(body.currentScale * params.tailSize * (body.type === 'planet' ? 1.0 : 0.5));
            opacities.push(1.0);
        }
    }

    for (let i = 0; i < opacities.length; i++) opacities[i] *= 0.99;
    while (positions.length / 3 > params.tailLength || (opacities.length > 0 && opacities[0] < 0.01)) {
        positions.shift(); positions.shift(); positions.shift();
        sizes.shift(); opacities.shift();
    }

    const posAttr = tail.geometry.getAttribute('position');
    const sizeAttr = tail.geometry.getAttribute('customSize');
    const opAttr = tail.geometry.getAttribute('customOpacity');

    for (let i = 0; i < positions.length; i++) posAttr.array[i] = positions[i];
    for (let i = 0; i < sizes.length; i++) {
        sizeAttr.array[i] = sizes[i];
        opAttr.array[i] = opacities[i];
    }

    tail.geometry.setDrawRange(0, positions.length / 3);
    posAttr.needsUpdate = true;
    sizeAttr.needsUpdate = true;
    opAttr.needsUpdate = true;
}

export function init() {
    if (initialized) return;
    const container = document.getElementById('solar-container');
    if (!container) return;

    createControls();
    setupEventListeners();

    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x050510, 0.002);

    camera = new THREE.PerspectiveCamera(75, container.clientWidth / container.clientHeight, 0.1, 5000);
    camera.position.set(0, 40, 60);
    camera.lookAt(0, 0, 0);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);

    sunLight = new THREE.PointLight(0xffaa00, 2, 2000);
    scene.add(sunLight);
    ambientLight = new THREE.AmbientLight(0x404060, 0.5);
    scene.add(ambientLight);

    const sunGeo = new THREE.SphereGeometry(4, 32, 32);
    const sunMat = new THREE.MeshBasicMaterial({ color: 0xffaa00 });
    sun = new THREE.Mesh(sunGeo, sunMat);
    
    sunGroup = new THREE.Group();
    sunGroup.add(sun);
    scene.add(sunGroup);

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.onChanged.addListener((changes, ns) => {
            if (ns === 'local' && changes.universeState) {
                updateUniverseState(changes.universeState.newValue);
            }
        });
        chrome.storage.local.get('universeState', (res) => {
            if (res.universeState) updateUniverseState(res.universeState);
        });
    }

    initialized = true;
    animate();
}

function setupEventListeners() {
    // Collapse Toggle
    const toggleBtn = document.getElementById('toggleVizPanel');
    const content = document.getElementById('vizControlsContent');
    if (toggleBtn && content) {
        toggleBtn.addEventListener('click', () => {
            if (content.style.display === 'none') {
                content.style.display = 'block';
                toggleBtn.innerText = '▼';
            } else {
                content.style.display = 'none';
                toggleBtn.innerText = '▲';
            }
        });
    }

    // Max Satellites Slider
    const satSlider = document.getElementById('maxSatellitesSlider');
    if (satSlider) {
        satSlider.addEventListener('input', (e) => {
            params.maxSatellites = parseInt(e.target.value);
            document.getElementById('maxSatellitesValue').textContent = params.maxSatellites;
        });
        // Sync to backend on change
        satSlider.addEventListener('change', (e) => {
            if (typeof chrome !== 'undefined' && chrome.storage) {
                chrome.storage.local.set({ vizConfig: { maxSatellitesPerPlanet: params.maxSatellites } });
            }
        });
    }

    const sliders = ['sunSpeed', 'orbitSpeed', 'tailLength', 'glowIntensity'];
    sliders.forEach(id => {
        const el = document.getElementById(id + 'Slider');
        if (el) el.addEventListener('input', (e) => {
            params[id] = parseFloat(e.target.value);
            document.getElementById(id + 'Value').textContent = params[id];
        });
    });

    window.addEventListener('resize', () => {
        const c = document.getElementById('solar-container');
        if (c) {
            camera.aspect = c.clientWidth / c.clientHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(c.clientWidth, c.clientHeight);
        }
    });

    const canvas = document.querySelector('#solar-container canvas');
    if (canvas) {
        canvas.addEventListener('mousedown', (e) => { isDragging = true; previousMousePosition = { x: e.clientX, y: e.clientY }; });
        canvas.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const dx = e.clientX - previousMousePosition.x;
            const dy = e.clientY - previousMousePosition.y;
            cameraYaw -= dx * 0.005;
            cameraPitch -= dy * 0.005;
            cameraPitch = Math.max(-1.5, Math.min(1.5, cameraPitch));
            previousMousePosition = { x: e.clientX, y: e.clientY };
        });
        canvas.addEventListener('mouseup', () => isDragging = false);
        canvas.addEventListener('wheel', (e) => {
            cameraRadius += e.deltaY * 0.05;
            cameraRadius = Math.max(20, Math.min(300, cameraRadius));
        });
    }
}

function animate() {
    if (!initialized) return;
    requestAnimationFrame(animate);

    const delta = clock.getDelta();
    const time = clock.getElapsedTime();

    // 1. Move Sun Group forward (Reverse: Coming towards us)
    sunGroup.position.z = time * params.sunSpeed * 10;
    
    // 2. Animate Camera
    cameraTarget.position.copy(sunGroup.position);
    camera.position.x = cameraTarget.position.x + cameraRadius * Math.sin(cameraYaw) * Math.cos(cameraPitch);
    camera.position.z = cameraTarget.position.z + cameraRadius * Math.cos(cameraYaw) * Math.cos(cameraPitch);
    camera.position.y = cameraTarget.position.y + cameraRadius * Math.sin(cameraPitch);
    camera.lookAt(cameraTarget.position);

    // 3. Animate Bodies
    const toRemove = [];

    celestialBodies.forEach((body, id) => {
        body.currentScale += (body.targetScale - body.currentScale) * (5.0 * delta);
        
        if (body.targetScale < 0.01 && body.currentScale < 0.05) {
            toRemove.push(id);
        }

        body.mesh.scale.set(body.currentScale, body.currentScale, body.currentScale);
        
        const angle = time * body.orbitalSpeed * params.orbitSpeed + body.phaseOffset;
        
        if (body.type === 'planet') {
            // Orbit Sun (Anchor moves)
            body.anchor.position.set(
                Math.cos(angle) * body.orbitRadius,
                0,
                Math.sin(angle) * body.orbitRadius
            );
        } else {
            // Orbit Planet (Anchor moves relative to Planet Anchor)
            body.anchor.position.set(
                Math.cos(angle) * body.orbitRadius,
                Math.sin(angle) * body.orbitRadius * 0.5, 
                0
            );
        }

        // Update Label
        if (body.labelDiv) {
            // Update logic: Only show if shouldShowLabel AND significant size/visible
            // Also update position projection
            
            const worldPos = new THREE.Vector3();
            body.mesh.getWorldPosition(worldPos);
            worldPos.y += body.baseSize * body.currentScale + 2; // Offset above planet
            
            // Project to 2D
            const screenPos = worldPos.clone().project(camera);
            
            const x = (screenPos.x * .5 + .5) * renderer.domElement.clientWidth;
            const y = (-(screenPos.y * .5) + .5) * renderer.domElement.clientHeight;

            if (body.shouldShowLabel && screenPos.z < 1 && body.currentScale > 0.2) {
                body.labelDiv.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`;
                body.labelDiv.style.opacity = '1';
            } else {
                body.labelDiv.style.opacity = '0';
            }
        }

        updateTail(body);
    });

    toRemove.forEach(id => {
        const body = celestialBodies.get(id);
        if (body) {
            if (body.type === 'planet') sunGroup.remove(body.anchor);
            else if (body.anchor.parent) body.anchor.parent.remove(body.anchor);
            
            if (body.tail) {
                scene.remove(body.tail);
                body.tail.geometry.dispose();
                body.tail.material.dispose();
            }
            if (body.labelDiv && body.labelDiv.parentNode) {
                body.labelDiv.parentNode.removeChild(body.labelDiv);
            }
            body.mesh.geometry.dispose();
            body.mesh.material.dispose();
            celestialBodies.delete(id);
        }
    });

    renderer.render(scene, camera);
}
