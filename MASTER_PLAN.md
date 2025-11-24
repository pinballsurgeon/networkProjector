# Network World Model: The Master Plan

**Document Version:** 1.0
**Target Audience:** Research & Engineering Teams
**Objective:** Define the ultimate, scalable, lossless architecture for visualizing network traffic on *any* device, from high-end workstations to low-power laptops.

---

## 1. High-Level Vision

We are building a **Universal Network Mirror**.
*   **Concept:** A living, breathing digital twin of your internet activity.
*   **Metaphor:** A Solar System (Planets = Tabs, Moons = Assets) moving through 4D space (Time).
*   **Goal:** "Scientifically Small Footprint" — Maximum insight with minimum resource usage.

---

## 2. The "Dual-Engine" Architecture

To handle the "No GPU" scenario while enabling "SOTA" performance, we propose a bifurcated rendering engine.

### Engine A: "The Holodeck" (High-Spec)
*   **Technology:** WebGPU (Compute Shaders).
*   **Capacity:** 1,000,000+ particles.
*   **Features:** Volumetric glows, particle tails, physics-based collisions.
*   **Use Case:** Desktop users with dedicated GPUs.

### Engine B: "The Radar" (Low-Spec / Lofi)
*   **Technology:** CSS 3D Transforms + Canvas 2D.
*   **Capacity:** 500 DOM Nodes (Planets) + 2D Lines (Tails).
*   **Features:** Crisp text, vector-perfect circles, battery-saving.
*   **Why:** CSS Transforms run on the compositor thread (fast even on slow CPUs). Canvas 2D is highly optimized for lines.
*   **Fallback Trigger:** Automatic detection of low FPS or `requestAdapter()` failure.

---

## 3. Low-Level Specifications

### 3.1 Data Structure (The "Unified Atom")
We treat every network packet as an "Atom" that coagulates into larger structures.

```typescript
// Optimized Struct-of-Arrays (SoA) layout for WASM
struct UniverseState {
    // Entities
    u32 ids[MAX_ENTITIES];
    u8 types[MAX_ENTITIES]; // 0=Planet, 1=Moon, 2=Cluster
    u32 parent_ids[MAX_ENTITIES];
    
    // Metrics (Normalized 0-1 for visual scaling)
    f32 volumes[MAX_ENTITIES];
    f32 frequencies[MAX_ENTITIES];
    
    // Physics
    f32 positions_x[MAX_ENTITIES];
    f32 positions_y[MAX_ENTITIES];
    f32 positions_z[MAX_ENTITIES];
}
```

### 3.2 Core Functions

1.  **`Aggregator::ingest(packet)` (Rust/WASM)**
    *   **Input:** Raw binary packet headers.
    *   **Action:** Updates the `UniverseState` in Shared Memory. Performs O(1) lookups.
    *   **Coagulation:** If `EntityCount > Limit`, sorts by `Metric` and merges tail-end entities into a `Cluster` entity.

2.  **`Renderer::frame(state)` (JS/Typescript)**
    *   **Input:** Read-only view of `UniverseState`.
    *   **Logic:**
        *   If `Engine A`: Dispatch Compute Shader to update particle buffer.
        *   If `Engine B`: Update CSS `transform: translate3d(...)` for active DOM nodes.

---

## 4. Testing & Validation Protocol

To ensure "mathematically lossless" fidelity, we must validate against baselines.

### 4.1 The Standard Candle Test
We define a set of "Standard Sites" with known complexity.

| Site | Expected Planets | Expected Moons | Traffic Profile |
|------|------------------|----------------|-----------------|
| `google.com` | 1 | ~5-10 | Low volume, high frequency (XHR) |
| `wikipedia.org` | 1 | ~2-5 | Static assets, low frequency |
| `cnn.com` | 1 | ~100+ | High volume, massive tracking (AdTech) |
| **Saturation** | 50 (Tabs) | 5000+ | Stress test for Coagulation |

### 4.2 Metric Collection
For every test run, capture:
1.  **Fidelity Score:** `(RenderedEntities / ActualEntities)`. Target: 100% (via Coagulation representation).
2.  **Latency:** Time from `Network.requestReceived` to `PixelOnScreen`. Target: < 16ms (1 frame).
3.  **Overhead:** CPU Usage % increase. Target: < 5% on Low-Spec.

### 4.3 Automated Browser Testing (Puppeteer)
The testing suite (`test_extension_smoothness.js` evolved) must:
1.  Launch Browser with Extension.
2.  Inject performance observers (`PerformanceObserver`).
3.  Navigate to "Standard Candle" sites.
4.  Scroll/Interact to trigger lazy-loading.
5.  Dump internal `UniverseState` and compare with `performance.getEntries()`.

---

## 5. Failure Analysis & Mitigations

| Failure Mode | Impact | Mitigation |
|--------------|--------|------------|
| **GPU Crash/Loss** | Visualization freezes | Watchdog timer auto-switches to **Engine B** (CSS/Canvas). |
| **Memory Pressure** | Browser tab crash | Aggregator aggressively increases `CoagulationThreshold` (merges more aggressive). |
| **Data Flood** | UI lag | Decouple UI loop from Data loop (Double Buffering). Render last *stable* frame while processing backlog. |

---

## 6. Implementation Roadmap

1.  **Phase 1 (Current):** Refine Lofi Heuristics (Tab-Centric Grouping). **[COMPLETE]**
2.  **Phase 2:** Implement **Engine B** (CSS/Canvas) as the robust fallback layer.
3.  **Phase 3:** Port Aggregator to **WASM** for zero-latency processing.
4.  **Phase 4:** Implement **Engine A** (WebGPU) for high-end visual fidelity.

This plan ensures we deliver a "World Class Product" that works beautifully on a gaming rig and reliably on a Chromebook.
