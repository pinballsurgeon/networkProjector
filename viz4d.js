import { logger } from './logger.js';

// --- Global Variables ---
let scene, camera, renderer;
let sun, sunLight, ambientLight;
let sunGroup; // A group to hold the sun and all planets
let planets = []; // To store planet objects and their tails
let clock = new THREE.Clock();

// Mouse/Camera control state
let isDragging = false;
let previousMousePosition = { x: 0, y: 0 };
let cameraTarget = new THREE.Group(); // A group to act as the camera's pivot point
let cameraRadius = 50; // Start a bit further back
let cameraYaw = 0.2; // Horizontal rotation
let cameraPitch = 0.5; // Vertical rotation

// Parameters controlled by the UI
let params = {
    sunSpeed: 0.2,
    orbitSpeed: 1.0,
    numPlanets: 5,
    tailLength: 500,
    evolutionRate: 0.5,
    tailSize: 1.0,
    diffusion: 0.0,
    glowIntensity: 1.0
};

let initialized = false;

// --- Shaders for Particle Tails ---
const vertexShader = `
    attribute float customSize;
    attribute float customOpacity;
    varying float vOpacity;

    void main() {
        vOpacity = customOpacity;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        
        // This magic line sets the point size based on its distance
        gl_PointSize = customSize * (300.0 / -mvPosition.z);
        
        gl_Position = projectionMatrix * mvPosition;
    }
`;

const fragmentShader = `
    uniform vec3 color;
    uniform float u_intensity; // Master intensity control
    varying float vOpacity;

    void main() {
        if (vOpacity < 0.01) discard; // Don't render invisible particles
        
        // Creates a soft, round point
        float strength = 1.0 - (2.0 * length(gl_PointCoord - vec2(0.5)));
        if (strength < 0.0) discard;

        // Scale the color by the master intensity *before* blending
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
        <div style="background-color: rgba(20, 20, 30, 0.85); backdrop-filter: blur(10px); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 12px; padding: 1.5rem; max-width: 320px; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3); color: white; font-family: 'Inter', sans-serif;">
            <h1 class="text-xl font-bold mb-4 text-white" style="font-size: 1.25rem; font-weight: bold; margin-bottom: 1rem;">4D Vector Space</h1>
            <p class="text-sm text-gray-300 mb-6" style="font-size: 0.875rem; color: #d1d5db; margin-bottom: 1.5rem;">Adjust the solar system's trajectory.</p>

            <label for="sunSpeedSlider" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; font-weight: 500; font-size: 0.875rem;">
                <span>Sun Speed</span>
                <span id="sunSpeedValue" style="font-weight: 600; color: #93c5fd;">0.2</span>
            </label>
            <input type="range" id="sunSpeedSlider" min="0" max="1" step="0.01" value="0.2" style="width: 100%; margin-bottom: 1rem;">

            <label for="orbitSpeedSlider" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; font-weight: 500; font-size: 0.875rem;">
                <span>Orbit Speed</span>
                <span id="orbitSpeedValue" style="font-weight: 600; color: #93c5fd;">1.0</span>
            </label>
            <input type="range" id="orbitSpeedSlider" min="0" max="5" step="0.1" value="1.0" style="width: 100%; margin-bottom: 1rem;">

            <label for="numPlanetsSlider" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; font-weight: 500; font-size: 0.875rem;">
                <span>Planets</span>
                <span id="numPlanetsValue" style="font-weight: 600; color: #93c5fd;">5</span>
            </label>
            <input type="range" id="numPlanetsSlider" min="1" max="15" step="1" value="5" style="width: 100%; margin-bottom: 1rem;">

            <label for="tailLengthSlider" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; font-weight: 500; font-size: 0.875rem;">
                <span>Tail Length</span>
                <span id="tailLengthValue" style="font-weight: 600; color: #93c5fd;">500</span>
            </label>
            <input type="range" id="tailLengthSlider" min="50" max="2000" step="50" value="500" style="width: 100%; margin-bottom: 1rem;">
            
            <label for="evolutionRateSlider" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; font-weight: 500; font-size: 0.875rem;">
                <span>Evolution Rate</span>
                <span id="evolutionRateValue" style="font-weight: 600; color: #93c5fd;">0.5</span>
            </label>
            <input type="range" id="evolutionRateSlider" min="0" max="3" step="0.1" value="0.5" style="width: 100%; margin-bottom: 1rem;">
            
            <label for="tailSizeSlider" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; font-weight: 500; font-size: 0.875rem;">
                <span>Tail Sizing</span>
                <span id="tailSizeValue" style="font-weight: 600; color: #93c5fd;">1.0</span>
            </label>
            <input type="range" id="tailSizeSlider" min="0.5" max="10" step="0.1" value="1.0" style="width: 100%; margin-bottom: 1rem;">

            <label for="diffusionSlider" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; font-weight: 500; font-size: 0.875rem;">
                <span>Tail Diffusion</span>
                <span id="diffusionValue" style="font-weight: 600; color: #93c5fd;">0.0</span>
            </label>
            <input type="range" id="diffusionSlider" min="0" max="10" step="0.1" value="0.0" style="width: 100%; margin-bottom: 1rem;">
            
            <label for="glowIntensitySlider" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; font-weight: 500; font-size: 0.875rem;">
                <span>Glow Intensity</span>
                <span id="glowIntensityValue" style="font-weight: 600; color: #93c5fd;">1.0</span>
            </label>
            <input type="range" id="glowIntensitySlider" min="0.1" max="2.5" step="0.05" value="1.0" style="width: 100%; margin-bottom: 1rem;">
        </div>
    `;
}

/**
 * Generates a random color with good brightness.
 */
function getRandomColor() {
    const h = Math.random();
    const s = 0.7 + Math.random() * 0.3; // Saturation
    const l = 0.6 + Math.random() * 0.1; // Lightness
    return new THREE.Color().setHSL(h, s, l);
}

/**
 * Creates a new planet object.
 */
function createPlanet(index, numPlanets) {
    const baseSize = Math.random() * 0.4 + 0.1;
    const color = getRandomColor();
    const orbitRadius = 5 + index * (3 + Math.random() * 2);
    const orbitalSpeed = (Math.random() * 0.5 + 0.5) * (1 / Math.sqrt(orbitRadius)) * 5;
    const phaseOffset = Math.random() * Math.PI * 2;

    // 1. Create the planet mesh
    const geometry = new THREE.SphereGeometry(baseSize, 16, 16);
    const material = new THREE.MeshStandardMaterial({
        color: color,
        emissive: color, // Make it glow slightly
        emissiveIntensity: 0.3
    });
    const mesh = new THREE.Mesh(geometry, material);

    // 2. Create the tail (trajectory line)
    const positions = new Float32Array(params.tailLength * 3); // x, y, z
    const sizes = new Float32Array(params.tailLength); // size
    const opacities = new Float32Array(params.tailLength); // opacity

    const tailGeometry = new THREE.BufferGeometry();
    tailGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    tailGeometry.setAttribute('customSize', new THREE.BufferAttribute(sizes, 1));
    tailGeometry.setAttribute('customOpacity', new THREE.BufferAttribute(opacities, 1));
    
    const tailMaterial = new THREE.ShaderMaterial({
        uniforms: {
            color: { value: color },
            u_intensity: { value: params.glowIntensity }
        },
        vertexShader: vertexShader,
        fragmentShader: fragmentShader,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });

    const tail = new THREE.Points(tailGeometry, tailMaterial);
    tail.frustumCulled = false; 
    
    scene.add(tail);

    const planetObj = {
        mesh,
        tail,
        orbitRadius,
        orbitalSpeed,
        phaseOffset,
        baseSize,
        evolutionPhase: Math.random() * Math.PI * 2,
        tailPositions: [], 
        tailSizes: [],
        tailOpacities: []
    };

    return planetObj;
}

/**
 * Clears and rebuilds the entire solar system.
 */
function rebuildSolarSystem() {
    if (!scene) return;
    // 1. Clear existing objects
    if (sunGroup) {
        scene.remove(sunGroup);
    }
    planets.forEach(p => {
        scene.remove(p.tail);
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
        p.tail.geometry.dispose();
        p.tail.material.dispose();
    });
    planets = [];
    
    // 2. Create new container group
    sunGroup = new THREE.Group();
    scene.add(sunGroup);

    // 3. Create Sun
    const sunGeometry = new THREE.SphereGeometry(2, 32, 32);
    const sunMaterial = new THREE.MeshBasicMaterial({ color: 0xffddaa });
    sun = new THREE.Mesh(sunGeometry, sunMaterial);
    sunGroup.add(sun);

    // 4. Update Sun light
    sunLight.intensity = 1.5; 

    // 5. Create new planets
    for (let i = 0; i < params.numPlanets; i++) {
        const planet = createPlanet(i, params.numPlanets);
        planets.push(planet);
        sunGroup.add(planet.mesh);
    }
}

/**
 * Updates the position of all points in a planet's tail.
 */
function updateTail(planet) {
    const tail = planet.tail;
    const geometry = tail.geometry;
    
    const positions = planet.tailPositions;
    const sizes = planet.tailSizes;
    const opacities = planet.tailOpacities;
    
    const positionAttribute = geometry.getAttribute('position');
    const sizeAttribute = geometry.getAttribute('customSize');
    const opacityAttribute = geometry.getAttribute('customOpacity');

    const worldPos = new THREE.Vector3();
    planet.mesh.getWorldPosition(worldPos);
    const currentScale = planet.mesh.scale.x;
    
    const particlesPerFrame = 1 + Math.floor(params.diffusion);
    
    for (let i = 0; i < particlesPerFrame; i++) {
        const diffusionAmount = params.diffusion * 0.5;
        const offsetX = (Math.random() - 0.5) * diffusionAmount;
        const offsetY = (Math.random() - 0.5) * diffusionAmount;
        const offsetZ = (Math.random() - 0.5) * diffusionAmount;

        positions.push(worldPos.x + offsetX, worldPos.y + offsetY, worldPos.z + offsetZ);
        sizes.push(currentScale * params.tailSize);
        opacities.push(1.0);
    }

    for (let i = 0; i < opacities.length; i++) {
        opacities[i] *= 0.995;
    }

    while (positions.length / 3 > params.tailLength || (opacities.length > 0 && opacities[0] < 0.01)) {
        positions.shift(); positions.shift(); positions.shift();
        sizes.shift();
        opacities.shift();
    }

    for (let i = 0; i < positions.length; i++) {
        positionAttribute.array[i] = positions[i];
    }
    for (let i = 0; i < sizes.length; i++) {
        sizeAttribute.array[i] = sizes[i];
        opacityAttribute.array[i] = opacities[i];
    }

    const particleCount = positions.length / 3;
    geometry.setDrawRange(0, particleCount);

    positionAttribute.needsUpdate = true;
    sizeAttribute.needsUpdate = true;
    opacityAttribute.needsUpdate = true;
    
    geometry.computeBoundingSphere();
}

/**
 * Initialize the 3D scene.
 */
export function init() {
    if (initialized) return;
    
    const container = document.getElementById('solar-container');
    if (!container) {
        logger.error("Solar container not found!");
        return;
    }

    // Inject controls HTML
    createControls();

    // 1. Scene
    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x000000, 0.005);
    scene.add(cameraTarget);

    // 2. Camera
    camera = new THREE.PerspectiveCamera(75, container.clientWidth / container.clientHeight, 0.1, 5000);
    camera.position.set(0, 20, 30);
    camera.lookAt(cameraTarget.position);

    // 3. Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    // 4. Lights
    sunLight = new THREE.PointLight(0xffffff, 1.5, 2000);
    scene.add(sunLight);
    ambientLight = new THREE.AmbientLight(0x404040, 0.3);
    scene.add(ambientLight);

    // 5. Initial Build
    rebuildSolarSystem();

    // 6. Setup UI Event Listeners
    setupEventListeners();

    // 7. Handle window resizing
    window.addEventListener('resize', onWindowResize, false);
    
    // 8. Add mouse controls
    renderer.domElement.addEventListener('mousedown', onMouseDown, false);
    renderer.domElement.addEventListener('mousemove', onMouseMove, false);
    renderer.domElement.addEventListener('mouseup', onMouseUp, false);
    renderer.domElement.addEventListener('wheel', onMouseWheel, false);
    renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault(), false);

    initialized = true;
    animate();
}

/**
 * Setup all UI event listeners.
 */
function setupEventListeners() {
    document.getElementById('sunSpeedSlider').addEventListener('input', (e) => {
        params.sunSpeed = parseFloat(e.target.value);
        document.getElementById('sunSpeedValue').textContent = params.sunSpeed.toFixed(2);
    });
    
    document.getElementById('orbitSpeedSlider').addEventListener('input', (e) => {
        params.orbitSpeed = parseFloat(e.target.value);
        document.getElementById('orbitSpeedValue').textContent = params.orbitSpeed.toFixed(1);
    });
    
    document.getElementById('numPlanetsSlider').addEventListener('input', (e) => {
        params.numPlanets = parseInt(e.target.value);
        document.getElementById('numPlanetsValue').textContent = params.numPlanets;
    });
    document.getElementById('numPlanetsSlider').addEventListener('change', () => {
        rebuildSolarSystem();
    });

    document.getElementById('tailLengthSlider').addEventListener('input', (e) => {
        params.tailLength = parseInt(e.target.value);
        document.getElementById('tailLengthValue').textContent = params.tailLength;
    });
    document.getElementById('tailLengthSlider').addEventListener('change', () => {
        rebuildSolarSystem();
    });
    
    document.getElementById('evolutionRateSlider').addEventListener('input', (e) => {
        params.evolutionRate = parseFloat(e.target.value);
        document.getElementById('evolutionRateValue').textContent = params.evolutionRate.toFixed(1);
    });
    
    document.getElementById('tailSizeSlider').addEventListener('input', (e) => {
        params.tailSize = parseFloat(e.target.value);
        document.getElementById('tailSizeValue').textContent = params.tailSize.toFixed(1);
    });
    
    document.getElementById('diffusionSlider').addEventListener('input', (e) => {
        params.diffusion = parseFloat(e.target.value);
        document.getElementById('diffusionValue').textContent = params.diffusion.toFixed(1);
    });
    
    document.getElementById('glowIntensitySlider').addEventListener('input', (e) => {
        params.glowIntensity = parseFloat(e.target.value);
        document.getElementById('glowIntensityValue').textContent = params.glowIntensity.toFixed(2);
    });
}

function onMouseDown(e) {
    isDragging = true;
    previousMousePosition.x = e.clientX;
    previousMousePosition.y = e.clientY;
}

function onMouseMove(e) {
    if (!isDragging) return;
    const deltaX = e.clientX - previousMousePosition.x;
    const deltaY = e.clientY - previousMousePosition.y;
    cameraYaw -= deltaX * 0.005;
    cameraPitch -= deltaY * 0.005;
    cameraPitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, cameraPitch));
    previousMousePosition.x = e.clientX;
    previousMousePosition.y = e.clientY;
}

function onMouseUp() {
    isDragging = false;
}

function onMouseWheel(e) {
    cameraRadius += e.deltaY * 0.05;
    cameraRadius = Math.max(10, Math.min(200, cameraRadius));
}

function onWindowResize() {
    const container = document.getElementById('solar-container');
    if (!container) return;
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
}

/**
 * The main animation loop.
 */
function animate() {
    if (!initialized) return;
    requestAnimationFrame(animate);

    const elapsedTime = clock.getElapsedTime();
    
    sunGroup.position.z -= params.sunSpeed;
    sunGroup.position.x = Math.sin(elapsedTime * 0.1) * 10;
    
    sun.getWorldPosition(sunLight.position); 
    
    sunLight.intensity = 1.5;
    ambientLight.intensity = 0.3; 

    planets.forEach(p => {
        const angle = elapsedTime * p.orbitalSpeed * params.orbitSpeed + p.phaseOffset;
        p.mesh.position.x = p.orbitRadius * Math.cos(angle);
        p.mesh.position.y = p.orbitRadius * Math.sin(angle);
        
        const oscillation = (Math.sin(elapsedTime * 0.3 + p.evolutionPhase) + 1) / 2; 
        const newScale = 1.0 + (oscillation * params.evolutionRate);
        p.mesh.scale.set(newScale, newScale, newScale);
        
        p.mesh.material.emissiveIntensity = 0.3 * params.glowIntensity;
        p.tail.material.uniforms.u_intensity.value = params.glowIntensity;
        
        updateTail(p);
    });

    cameraTarget.position.copy(sunGroup.position);
    
    camera.position.x = cameraTarget.position.x + cameraRadius * Math.sin(cameraYaw) * Math.cos(cameraPitch);
    camera.position.z = cameraTarget.position.z + cameraRadius * Math.cos(cameraYaw) * Math.cos(cameraPitch);
    camera.position.y = cameraTarget.position.y + cameraRadius * Math.sin(cameraPitch);
    
    camera.lookAt(cameraTarget.position);

    renderer.render(scene, camera);
}
