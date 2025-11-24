/**
 * viz_radar.js
 * Engine B: "The Radar" (Low-Spec / Lofi)
 * 
 * Technology: CSS 3D Transforms + Canvas 2D.
 * Goal: Maximum performance on low-end devices (Chromebooks, etc).
 * 
 * Architecture:
 * - Planets: DOM Elements (divs) moved via 'transform: translate3d(...)'. 
 *   Why? The browser compositor handles this on the GPU, efficient for < 500 elements.
 *   Crisp text rendering for labels.
 * - Orbit Lines / Tails: Single full-screen Canvas 2D overlay.
 *   Why? Canvas 2D is extremely fast for drawing simple lines/arcs.
 */

import { logger } from './logger.js';

let container = null;
let domLayer = null; // Div for Planets
let canvasLayer = null; // Canvas for lines
let ctx = null;
let width = 0;
let height = 0;
let initialized = false;
let universeState = null;

// State
const entities = new Map(); // Map<ID, { el, x, y, z, type, label, ... }>
const camera = { x: 0, y: 0, z: 1000 }; // Simple 2.5D camera
let animationFrameId = null;

// Config
const ORBIT_SCALE = 150; // Pixels
const SATELLITE_SCALE = 40; // Pixels
const PLANET_SIZE = 40;
const SATELLITE_SIZE = 8;

export function init() {
    if (initialized) return;
    
    container = document.getElementById('radar-container');
    if (!container) {
        logger.error("Radar container not found");
        return;
    }
    
    // 1. Setup DOM Layer (Planets)
    domLayer = document.createElement('div');
    domLayer.style.position = 'absolute';
    domLayer.style.top = '0';
    domLayer.style.left = '0';
    domLayer.style.width = '100%';
    domLayer.style.height = '100%';
    domLayer.style.pointerEvents = 'none'; // Allow clicks to pass through if needed
    domLayer.style.transformStyle = 'preserve-3d';
    domLayer.style.perspective = '1000px';
    container.appendChild(domLayer);

    // 2. Setup Canvas Layer (Orbits/Lines)
    canvasLayer = document.createElement('canvas');
    canvasLayer.style.position = 'absolute';
    canvasLayer.style.top = '0';
    canvasLayer.style.left = '0';
    canvasLayer.style.zIndex = '-1'; // Behind DOM layer
    container.appendChild(canvasLayer);
    ctx = canvasLayer.getContext('2d', { alpha: true });

    // 3. Resize Handler
    const resizeObserver = new ResizeObserver(() => handleResize());
    resizeObserver.observe(container);
    handleResize(); // Initial size

    // 4. Data Listener
    if (typeof chrome !== 'undefined' && chrome.storage) {
        chrome.storage.onChanged.addListener((changes, ns) => {
            if (ns === 'local' && changes.universeState) {
                universeState = changes.universeState.newValue;
                updateEntities(universeState);
            }
        });
        chrome.storage.local.get('universeState', (res) => {
            if (res.universeState) {
                universeState = res.universeState;
                updateEntities(universeState);
            }
        });
    }

    initialized = true;
    animate();
    logger.info("Radar Engine Initialized");
}

export function resize() {
    handleResize();
}

function handleResize() {
    if (!container) return;
    width = container.clientWidth;
    height = container.clientHeight;

    // Fallback if container thinks it is 0 or very small (e.g. if display:none logic failed)
    if (width < 50 || height < 50) {
        width = window.innerWidth;
        // subtract header/padding roughly? Or just take full window
        // If we are in a tab, usually window.innerWidth is safe-ish
    }
    
    // Handle High DPI
    const dpr = window.devicePixelRatio || 1;
    canvasLayer.width = width * dpr;
    canvasLayer.height = height * dpr;
    canvasLayer.style.width = `${width}px`;
    canvasLayer.style.height = `${height}px`;
    ctx.scale(dpr, dpr);
    
    // Center camera
    camera.x = width / 2;
    camera.y = height / 2;
}

function createPlanetElement(id, label) {
    const el = document.createElement('div');
    el.className = 'radar-planet';
    el.textContent = label;
    // Basic Styles
    el.style.position = 'absolute';
    el.style.width = `${PLANET_SIZE}px`;
    el.style.height = `${PLANET_SIZE}px`;
    el.style.borderRadius = '50%';
    el.style.background = '#3b82f6'; // Blue
    el.style.color = 'white';
    el.style.display = 'flex';
    el.style.alignItems = 'center';
    el.style.justifyContent = 'center';
    el.style.fontSize = '10px';
    el.style.fontWeight = 'bold';
    el.style.textAlign = 'center';
    el.style.boxShadow = '0 0 10px rgba(59, 130, 246, 0.5)';
    el.style.willChange = 'transform'; // Hint to browser
    el.style.overflow = 'hidden';
    el.style.whiteSpace = 'nowrap';
    el.style.textOverflow = 'ellipsis';
    
    domLayer.appendChild(el);
    return el;
}

function createSatelliteElement(id) {
    const el = document.createElement('div');
    el.className = 'radar-satellite';
    // Satellites are just small dots, maybe no text or text on hover
    el.style.position = 'absolute';
    el.style.width = `${SATELLITE_SIZE}px`;
    el.style.height = `${SATELLITE_SIZE}px`;
    el.style.borderRadius = '50%';
    el.style.background = '#ef4444'; // Red
    el.style.willChange = 'transform';
    
    domLayer.appendChild(el);
    return el;
}

function updateEntities(state) {
    if (!state || !state.domains) return;

    const activeIds = new Set();
    
    state.domains.forEach((planetNode, i) => {
        activeIds.add(planetNode.id);
        
        // Ensure Planet Exists
        let planet = entities.get(planetNode.id);
        if (!planet) {
            const el = createPlanetElement(planetNode.id, planetNode.label);
            planet = { 
                id: planetNode.id, 
                type: 'planet', 
                el, 
                angle: Math.random() * Math.PI * 2, 
                radius: 0, // Center (Sun orbit handled in animation)
                orbitSpeed: 0.05 + Math.random() * 0.05,
                metrics: planetNode.metrics
            };
            entities.set(planetNode.id, planet);
        } else {
            // Update Label if changed
            if (planet.el.textContent !== planetNode.label) {
                planet.el.textContent = planetNode.label;
            }
            planet.metrics = planetNode.metrics;
        }

        // Process Satellites
        if (planetNode.children) {
            planetNode.children.forEach((satNode, j) => {
                activeIds.add(satNode.id);
                
                let sat = entities.get(satNode.id);
                if (!sat) {
                    const el = createSatelliteElement(satNode.id);
                    sat = {
                        id: satNode.id,
                        type: 'satellite',
                        parentId: planetNode.id,
                        el,
                        angle: Math.random() * Math.PI * 2,
                        radius: SATELLITE_SCALE + (j * 5), // Spiral out slightly
                        orbitSpeed: 0.5 + Math.random() * 0.5,
                        metrics: satNode.metrics
                    };
                    entities.set(satNode.id, sat);
                }
                sat.metrics = satNode.metrics;
            });
        }
    });

    // Prune
    for (const [id, entity] of entities) {
        if (!activeIds.has(id)) {
            entity.el.remove();
            entities.delete(id);
        }
    }
}

function animate() {
    animationFrameId = requestAnimationFrame(animate);
    
    const now = Date.now() / 1000;
    const cx = width / 2;
    const cy = height / 2;

    // Clear Canvas
    ctx.clearRect(0, 0, width, height);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';

    // Update Entities
    entities.forEach(entity => {
        // Simple Physics / Orbit Logic
        if (entity.type === 'planet') {
            // Planets orbit the center "Sun" (which is invisible or the browser center)
            // Spread them out based on ID hash or index?
            // For now, let's put them in a ring
            const ringRadius = ORBIT_SCALE;
            entity.angle += entity.orbitSpeed * 0.01;
            
            const x = Math.cos(entity.angle) * ringRadius;
            const y = Math.sin(entity.angle) * ringRadius * 0.5; // Oval orbit
            
            // Apply to DOM
            // Use translate3d for hardware acceleration
            // Centering: (cx + x) - (size/2)
            entity.x = cx + x;
            entity.y = cy + y;
            entity.z = y; // Z-sorting by Y (pseudo depth)

            entity.el.style.transform = `translate3d(${entity.x - PLANET_SIZE/2}px, ${entity.y - PLANET_SIZE/2}px, 0px)`;
            entity.el.style.zIndex = Math.floor(entity.y); // Simple Z-sort

            // Draw Orbit Ring on Canvas (Optional, maybe too busy)
        } 
        else if (entity.type === 'satellite') {
            const parent = entities.get(entity.parentId);
            if (parent) {
                entity.angle += entity.orbitSpeed * 0.02;
                
                const x = Math.cos(entity.angle) * entity.radius;
                const y = Math.sin(entity.angle) * entity.radius;
                
                entity.x = parent.x + x;
                entity.y = parent.y + y;

                entity.el.style.transform = `translate3d(${entity.x - SATELLITE_SIZE/2}px, ${entity.y - SATELLITE_SIZE/2}px, 0px)`;
                
                // Draw Orbit Line around Parent
                ctx.beginPath();
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
                ctx.arc(parent.x, parent.y, entity.radius, 0, Math.PI * 2);
                ctx.stroke();

                // Draw Tether (Line from Parent to Satellite)
                ctx.beginPath();
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
                ctx.moveTo(parent.x, parent.y);
                ctx.lineTo(entity.x, entity.y);
                ctx.stroke();
            }
        }
    });
}
