# Network Solar System: Technical Architecture

**Date:** November 22, 2025
**Status:** Production Ready (Lofi MVP)

## 1. High-Level Vision

The project visualizes network traffic as a "4D Solar System".
*   **The Sun:** The user's browser (origin).
*   **Planets:** Active Tabs (Base Domains).
*   **Satellites (Moons):** Network resources (images, scripts, ads) loaded by that tab.
*   **Dynamics:**
    *   **Size/Brightness:** Driven by real-time traffic volume and frequency.
    *   **Trajectory:** The Sun moves forward through space, leaving a trail of history.
    *   **Coagulation:** Excessive moons are automatically squashed into "Cluster" moons to maintain performance.

## 2. System Architecture

### 2.1 Data Pipeline

1.  **`background.js` (Service Worker):**
    *   Intercepts `chrome.webRequest` events.
    *   Captures metadata: URL, Method, Status, Size, Time, **TabID**.
    *   Feeds data into the `aggregator`.
    *   Listens for UI config changes (`chrome.storage.onChanged`) to update aggregation rules live.

2.  **`aggregator.js` (State Engine):**
    *   **Tab-Centric Model:** Groups packets primarily by `tabId`.
    *   **Hierarchy:**
        *   `Universe` -> `Tab (Planet)` -> `Domain (Satellite)`.
    *   **Pressure Logic:**
        *   Calculates "Pressure" based on total entity count.
        *   If `Satellites > Limit` (default 8), sorts by volume and merges the tail into a `Cluster` node.
    *   **Time Window:** Maintains a rolling window (e.g. 60s) of active traffic. Prunes stale entities gracefully.

3.  **`chrome.storage.local`:**
    *   Stores the `UniverseState` tree.
    *   Serves as the sync bridge between Background (Write) and Frontend (Read).

### 2.2 Visualization Engine (`viz4d.js`)

A pure Three.js engine that renders the `UniverseState`.

*   **Initialization:** Sets up Scene, Camera, Renderer, and HTML Overlay Container.
*   **State Sync:** Listens to storage changes. Diff-updates the scene graph (adds/removes objects, updates targets).
*   **Rendering Loop (`animate`):**
    *   **Motion:** Moves `SunGroup` towards the camera (+Z). Camera moves backward to match, creating the illusion of "flying through" the data trails.
    *   **Orbit:** Planets orbit (0,0,0). Satellites orbit their parent Planet.
    *   **Interpolation:** Smoothly lerps scale and brightness to target values (received from backend).
    *   **Billboarding:** Projects 3D positions to 2D screen coordinates to position HTML Text Labels.
*   **Optimization:**
    *   **Planets:** High-poly spheres + Particle Tails (Shader-based).
    *   **Satellites:** Low-poly spheres + No Tails.
    *   **Labels:** HTML Overlays (crisp text), visibility culled by distance/size/occlusion.

## 3. Key Features

*   **Dynamic Coagulation:** Automatically simplifies the view when traffic spikes.
*   **Labeling:** Clean, truncated labels ("google", "github") attached to planets and major moons.
*   **Cinematic Camera:** Reverse-angle trajectory (Sun comes to us).
*   **Configurable:** UI sliders for "Cluster Density", Speed, and Visuals.

## 4. Future Integration Points

*   **Content Vectorization:** The Aggregator is ready to accept "Page Content Vectors" (TF-IDF) to color-code Planets by topic.
*   **Anomaly Detection:** "Interstellar" bucket currently captures background traffic; this can be analyzed for malware/leaks.
