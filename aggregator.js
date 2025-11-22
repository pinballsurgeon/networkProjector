/**
 * aggregator.js
 * Refined "Tab-Centric" Universe Aggregator.
 * 
 * Concept:
 * - The Universe is the Browser Session.
 * - Each Active Tab is a PLANET.
 * - Each Network Request/Domain within that Tab is a SATELLITE (Moon).
 * - Unassociated traffic (background processes) are "Interstellar Debris".
 * 
 * This ensures that opening "yahoo.com" creates ONE Planet (Yahoo),
 * and all its third-party scripts (ads, cdns) orbit IT, rather than
 * cluttering the solar system as separate planets.
 */

class UniverseAggregator {
    constructor(windowDurationMs = 60000) {
        this.windowDurationMs = windowDurationMs;
        this.tabs = new Map(); // Map<TabId, PlanetNode>
        this.interstellar = new Map(); // Map<Domain, SatelliteNode> (No parent tab)
        this.config = {
            maxSatellitesPerPlanet: 8
        };
    }

    setConfig(newConfig) {
        Object.assign(this.config, newConfig);
    }

    addPacket(packet) {
        // 1. Identify the Planet (Tab)
        const tabId = packet.tabId;
        const { domain } = this.extractTaxonomy(packet.url);

        let planet;

        if (tabId && tabId !== -1) {
            // It belongs to a specific tab/planet
            if (!this.tabs.has(tabId)) {
                // Create new Planet for this Tab
                // ID is the TabID (Stable), Label is the Domain (Dynamic)
                this.tabs.set(tabId, this.createNode(String(tabId), 'planet', domain));
            }
            planet = this.tabs.get(tabId);
            
            // If this packet is a "Main Frame" navigation, update the Planet's Label
            if (packet.type === 'main_frame' || planet.label === `Tab ${tabId}`) {
                planet.label = domain;
            }

            this.updateNodeMetrics(planet, packet);

            // Add Satellite (The specific domain resource)
            this.addSatellite(planet, domain, packet);

        } else {
            // Background/System traffic
            this.addInterstellar(domain, packet);
        }
    }

    addSatellite(planet, domain, packet) {
        // Check if this domain already exists as a moon
        let satellite = planet.children.find(c => c.id === domain);
        if (!satellite) {
            satellite = this.createNode(domain, 'satellite');
            planet.children.push(satellite);
        }
        this.updateNodeMetrics(satellite, packet);
    }

    addInterstellar(domain, packet) {
        if (!this.interstellar.has(domain)) {
            this.interstellar.set(domain, this.createNode(domain, 'asteroid'));
        }
        const node = this.interstellar.get(domain);
        this.updateNodeMetrics(node, packet);
    }

    extractTaxonomy(urlStr) {
        try {
            const url = new URL(urlStr);
            return { domain: url.hostname };
        } catch (e) {
            return { domain: 'unknown' };
        }
    }

    createNode(id, type, label) {
        return {
            id,
            type,
            label: label || id,
            children: [],
            metrics: {
                frequency: 0,
                volume: 0,
                lastActive: Date.now()
            }
        };
    }

    updateNodeMetrics(node, packet) {
        node.metrics.frequency++;
        node.metrics.volume += (packet.responseContentLength || 0) + (packet.requestContentLength || 0);
        node.metrics.lastActive = Date.now();
    }

    prune() {
        const now = Date.now();
        const cutoff = now - this.windowDurationMs;

        // Prune Tabs (Planets)
        for (const [tabId, planet] of this.tabs) {
            if (planet.metrics.lastActive < cutoff) {
                this.tabs.delete(tabId);
                continue;
            }
            
            // Prune Satellites
            planet.children = planet.children.filter(sat => sat.metrics.lastActive > cutoff);
        }

        // Prune Interstellar
        for (const [id, node] of this.interstellar) {
            if (node.metrics.lastActive < cutoff) this.interstellar.delete(id);
        }
    }

    getState() {
        this.prune();

        // 1. Get Raw Planets
        let planets = Array.from(this.tabs.values());

        // 2. Coagulation Logic (Lofi Squash)
        const MAX_SATELLITES_PER_PLANET = this.config.maxSatellitesPerPlanet;

        planets = planets.map(planet => {
            if (planet.children.length > MAX_SATELLITES_PER_PLANET) {
                // Sort by importance (Volume + Freq)
                const sorted = [...planet.children].sort((a, b) => (b.metrics.volume) - (a.metrics.volume));
                
                const kept = sorted.slice(0, MAX_SATELLITES_PER_PLANET);
                const squashed = sorted.slice(MAX_SATELLITES_PER_PLANET);
                    
                if (squashed.length > 0) {
                    // Create a "Cluster" moon
                    const clusterMoon = {
                        id: `${planet.id}-cluster`,
                        type: 'satellite', 
                        label: `+${squashed.length} Others`,
                        metrics: {
                            frequency: squashed.reduce((sum, s) => sum + s.metrics.frequency, 0),
                            volume: squashed.reduce((sum, s) => sum + s.metrics.volume, 0),
                            lastActive: Date.now()
                        }
                    };
                    return { ...planet, children: [...kept, clusterMoon] };
                }
            }
            return planet;
        });

        return {
            timestamp: Date.now(),
            windowDuration: this.windowDurationMs,
            domains: planets
        };
    }
}

export const aggregator = new UniverseAggregator();
