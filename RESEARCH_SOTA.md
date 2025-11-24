# Deep Research: State-of-the-Art (SOTA) Network Visualization Architecture

**Objective:** Define the "scientifically small footprint" approach for visualizing millions of network entities with zero latency and lossless fidelity.

## 1. The Rendering Engine: WebGPU & Compute Shaders

The current implementation uses **WebGL2**, which is performant but limited by the CPU-GPU bridge (JavaScript must update positions every frame). The SOTA approach is **WebGPU**.

### Why WebGPU?
*   **Compute Shaders:** We can move the entire "Physics Engine" (Orbit calculations, Tail generation, Coagulation logic) to the GPU.
*   **Zero CPU Overhead:** Once the data (Universe State) is uploaded, the GPU handles all animation. The CPU is free to process network packets.
*   **Massive Scale:** WebGL struggles with >100k active particles. WebGPU can handle **millions** of particles (Moons, Stars, Debris) at 60fps.

### Architecture: "GPU-Driven Rendering"
1.  **Storage Buffers:** Store the entire Universe State (Planet IDs, Positions, Velocities, Metrics) in a GPU Storage Buffer (`read-only` for vertex shader, `read-write` for compute shader).
2.  **Compute Pass:** A Compute Shader runs every frame to update positions (Orbits) and spawn/fade particles (Tails).
3.  **Render Pass:** Draws instances directly from the Storage Buffer using `drawIndirect`.

## 2. The Data Engine: Rust & WASM

JavaScript is fast, but Garbage Collection (GC) causes micro-stutters in high-frequency data streams. The SOTA approach uses **Rust** compiled to **WebAssembly (WASM)**.

### Aggregator V2 (Rust)
*   **Memory Layout:** Use **Struct of Arrays (SoA)** instead of Array of Structs (AoS). This maximizes CPU cache coherence and allows for SIMD (Single Instruction, Multiple Data) processing.
*   **Zero-Copy:** The `background.js` writes raw packet bytes into a SharedArrayBuffer. The WASM worker reads this buffer directly without serialization/deserialization overhead.
*   **Logic:** The "Coagulation" and "Pressure" logic becomes a highly optimized mathematical function running in WASM linear memory.

## 3. Data Structure: The "Entity Component System" (ECS)

Instead of Object-Oriented (`class Planet`), use a Data-Oriented design.

*   **Entities:** Just an ID (Integer).
*   **Components (Arrays):**
    *   `Position[ID]`: `vec3`
    *   `Metric[ID]`: `float` (Volume)
    *   `Parent[ID]`: `int` (Entity ID of Star/Planet)
    *   `Type[ID]`: `enum` (Star, Planet, Moon, Debris)

This allows the rendering engine to iterate over *just* the positions for rendering, while the logic engine iterates over *just* the metrics for coagulation, resulting in 10-100x performance gains.

## 4. Lossless Compression: Delta Encoding

To keep the "History" (Tails) small in memory:
*   Don't store absolute timestamps for every packet.
*   Store **Delta Time** (ms since last packet) and **Delta Size**.
*   Use **Run-Length Encoding (RLE)** for idle periods.
*   This allows keeping hours of "Lossless" history in RAM without bloating the browser footprint.

## 5. The "Perfect Line" Summary

The ultimate SOTA architecture for this project is:

1.  **Input:** `background.js` streams raw binary data to `SharedArrayBuffer`.
2.  **Process:** **Rust/WASM** Aggregator reads buffer, updates ECS state (SoA layout), applies Coagulation.
3.  **Render:** **WebGPU Compute Shader** reads ECS state, updates Physics/Orbits, generates Trails.
4.  **Display:** WebGPU Render Pipeline draws millions of points/lines with zero CPU draw calls.

This achieves the goal: **Maximum Information Density, Minimum Resource Footprint.**
