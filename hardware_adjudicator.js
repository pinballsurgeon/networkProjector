/**
 * hardware_adjudicator.js
 * 
 * Responsibilities:
 * 1. Detect Hardware Capabilities (GPU Tier).
 * 2. Monitor Performance (FPS).
 * 3. Decide which Render Engine to use (Holodeck vs Radar).
 */

import { logger } from './logger.js';

class HardwareAdjudicator {
    constructor() {
        this.fpsHistory = [];
        this.lastFrameTime = performance.now();
        this.checkInterval = 2000; // Check every 2s
        this.lowFpsThreshold = 30;
        this.consecutiveLowFps = 0;
        this.forcedEngine = null; // 'radar' | 'holodeck' | null
    }

    async detectTier() {
        // Simple heuristic based on Renderer String
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl');
        if (!gl) return 'low';

        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        if (!debugInfo) return 'medium'; // Assume medium if masked

        const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL).toLowerCase();
        
        // Heuristics
        if (renderer.includes('swiftshader') || renderer.includes('llvmpipe') || renderer.includes('basic render')) {
            return 'low'; // Software rendering
        }
        if (renderer.includes('intel') || renderer.includes('uhd graphics')) {
            return 'medium'; // Integrated GPU
        }
        if (renderer.includes('nvidia') || renderer.includes('amd') || renderer.includes('radeon') || renderer.includes('geforce')) {
            return 'high'; // Dedicated GPU
        }

        return 'medium';
    }

    startMonitoring(onFallback) {
        this.onFallback = onFallback;
        this.monitorLoop();
    }

    monitorLoop() {
        const now = performance.now();
        const delta = now - this.lastFrameTime;
        this.lastFrameTime = now;
        
        const fps = 1000 / delta;
        this.fpsHistory.push(fps);
        if (this.fpsHistory.length > 60) this.fpsHistory.shift();

        // Check periodically
        if (Math.random() < 0.05) { // Stagger checks
            this.evaluateHealth();
        }

        requestAnimationFrame(() => this.monitorLoop());
    }

    evaluateHealth() {
        if (this.fpsHistory.length < 30) return;
        
        const avgFps = this.fpsHistory.reduce((a,b) => a+b, 0) / this.fpsHistory.length;
        
        if (avgFps < this.lowFpsThreshold) {
            this.consecutiveLowFps++;
            logger.warn(`Low FPS detected: ${avgFps.toFixed(1)}`);
        } else {
            this.consecutiveLowFps = 0;
        }

        if (this.consecutiveLowFps > 3) {
            logger.error("Sustained Low FPS. Triggering Fallback.");
            if (this.onFallback) {
                this.onFallback();
                this.consecutiveLowFps = 0; // Reset
            }
        }
    }
}

export const adjudicator = new HardwareAdjudicator();
