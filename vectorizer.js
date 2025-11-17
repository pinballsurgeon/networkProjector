import { logger } from './logger.js';

// ---- Config ----
const VEC_CONFIG = {
  vocabSize: 1000,           // top-K tokens tracked explicitly
  hashDim: 2048,             // hashed features (stable size)
  emitHz: 10,                // points/sec max
  pcaDim: 3,                 // output dims
  projDim: 16,               // intermediate random projection dims
  kClusters: 8,              // online mini-batch k-means
  batch: 32,                 // mini-batch size for kmeans
  decay: 0.995,              // EMA decay for stats
  weighting: 'count',        // 'count' | 'tfidf'
  minDfRatio: 0.0,           // exclude tokens with df/docCount < minDfRatio
  maxDfRatio: 1.0            // exclude tokens with df/docCount > maxDfRatio
};


// ---- State ----
const State = {
  // streaming buffers
  pktQueue: [],
  lastEmit: 0,


  // token tracking (space-saving top-K)
  vocab: new Map(), // token->count
  tombstones: 0,
  docCount: 0,


  // hashing
  hashSeed: 1337,


  // random projection matrix (hashDim -> projDim)
  R: null, // Float32Array(hashDim*projDim)


  // PCA (Oja's rule)
  pca: {
    W: null, // Float32Array(projDim*pcaDim) columns are eigenvectors
    lr: 0.05
  },


  // online k-means
  kmeans: {
    centers: null, // Float32Array(kClusters*pcaDim)
    counts: new Uint32Array(VEC_CONFIG.kClusters)
  },


  // scaling
  scaler: {
    mean: new Float32Array(VEC_CONFIG.projDim),
    var: new Float32Array(VEC_CONFIG.projDim)
  }
};


// ---- Utilities ----
function murmur32(str, seed=State.hashSeed){
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

// ---- Core Logic ----

function getRootDomain(host) {
    if (!host) return '';
    const parts = host.split('.').filter(Boolean);
    if (parts.length >= 2) return parts[parts.length - 2];
    return host;
}

function bucketSize(bytes) {
    if (!bytes || !isFinite(bytes) || bytes <= 0) return 'none';
    if (bytes < 1024) return 'tiny';
    if (bytes < 16 * 1024) return 'small';
    if (bytes < 128 * 1024) return 'medium';
    if (bytes < 1024 * 1024) return 'large';
    return 'huge';
}

function bucketLatency(ms) {
    if (!ms || !isFinite(ms) || ms <= 0) return 'unknown';
    if (ms < 50) return 'fast';
    if (ms < 200) return 'medium';
    if (ms < 1000) return 'slow';
    return 'veryslow';
}

function tokenize(packet) {
    const tokens = new Set();
    try {
        const url = new URL(packet.url);
        tokens.add(`host:${url.hostname}`);
        const root = getRootDomain(url.hostname);
        if (root) tokens.add(`root:${root}`);
        const pathSegs = url.pathname.split('/').filter(Boolean);
        pathSegs.forEach(seg => {
            tokens.add(`path:${seg}`);
            if (/^\d+$/.test(seg)) tokens.add('pathseg:num');
            else if (/^[0-9a-fA-F-]{8,}$/.test(seg)) tokens.add('pathseg:hexish');
            else tokens.add('pathseg:alpha');
        });
        tokens.add(`depth:${pathSegs.length}`);
        url.searchParams.forEach((_, key) => tokens.add(`query:${key}`));
    } catch (e) {
        // Invalid URL, skip URL-derived tokens
    }
    tokens.add(`method:${packet.method}`);
    tokens.add(`type:${packet.type}`);
    tokens.add(`status:${Math.floor(packet.statusCode / 100)}xx`);
    packet.responseHeaders.forEach(h => {
        if (!h || !h.name) return;
        const name = h.name.toLowerCase();
        const value = (h.value || '').toLowerCase();
        if (name === 'content-type') {
            tokens.add(`type:${value.split(';')[0]}`);
        } else if (name === 'cache-control') {
            if (value.includes('no-store') || value.includes('no-cache')) tokens.add('cache:nocache');
            if (value.includes('max-age')) tokens.add('cache:maxage');
        } else if (name === 'content-encoding') {
            tokens.add(`encoding:${value}`);
        }
    });

    // Flow / size / latency features (prefixed so we can focus on them in certain views)
    const reqBytes = (packet.requestContentLength || 0) + (packet.requestHeadersSize || 0);
    const resBytes = (packet.responseContentLength || 0) + (packet.responseHeadersSize || 0);
    const totalBytes = reqBytes + resBytes;
    const sizeBucket = bucketSize(totalBytes);
    const reqBucket = bucketSize(reqBytes);
    const resBucket = bucketSize(resBytes);
    const latBucket = bucketLatency(packet.latencyMs);

    tokens.add(`flow:size:${sizeBucket}`);
    tokens.add(`flow:reqSize:${reqBucket}`);
    tokens.add(`flow:resSize:${resBucket}`);
    tokens.add(`flow:latency:${latBucket}`);

    return tokens;
}

function updateVocab(tokens) {
    tokens.forEach(token => {
        State.vocab.set(token, (State.vocab.get(token) || 0) + 1);
    });
    if (State.vocab.size > VEC_CONFIG.vocabSize * 1.2) {
        const sorted = [...State.vocab.entries()].sort((a, b) => b[1] - a[1]);
        State.vocab = new Map(sorted.slice(0, VEC_CONFIG.vocabSize));
        State.tombstones++;
    }
}

function vectorize(tokens) {
    const vec = new Float32Array(VEC_CONFIG.hashDim);
    const N = Math.max(1, State.docCount);
    tokens.forEach(token => {
        const df = State.vocab.get(token) || 0; // document frequency so far
        const dfRatio = df / N;
        if (dfRatio < VEC_CONFIG.minDfRatio || dfRatio > VEC_CONFIG.maxDfRatio) return;
        let w = 1;
        if (VEC_CONFIG.weighting === 'tfidf') {
            const idf = Math.log((N + 1) / (df + 1)) + 1; // smoothed IDF
            w = idf; // tf=1 since tokens are unique per packet
        }
        const hash = murmur32(token) % VEC_CONFIG.hashDim;
        vec[hash] += w;
    });
    return vec;
}

function project(vec) {
    if (!State.R) {
        State.R = new Float32Array(VEC_CONFIG.hashDim * VEC_CONFIG.projDim);
        for (let i = 0; i < State.R.length; i++) {
            State.R[i] = Math.random() > 0.5 ? 1 : -1;
        }
    }
    const projected = new Float32Array(VEC_CONFIG.projDim);
    for (let i = 0; i < VEC_CONFIG.projDim; i++) {
        let sum = 0;
        for (let j = 0; j < VEC_CONFIG.hashDim; j++) {
            sum += vec[j] * State.R[j * VEC_CONFIG.projDim + i];
        }
        projected[i] = sum;
    }
    return projected;
}

function onlinePCA(pvec) {
    if (!State.pca.W) {
        State.pca.W = new Float32Array(VEC_CONFIG.projDim * VEC_CONFIG.pcaDim);
        for (let i = 0; i < State.pca.W.length; i++) {
            State.pca.W[i] = Math.random() - 0.5;
        }
    }
    const y = new Float32Array(VEC_CONFIG.pcaDim);
    for (let i = 0; i < VEC_CONFIG.pcaDim; i++) {
        let sum = 0;
        for (let j = 0; j < VEC_CONFIG.projDim; j++) {
            sum += pvec[j] * State.pca.W[j * VEC_CONFIG.pcaDim + i];
        }
        y[i] = sum;
    }

    // If PCA becomes unstable, reset it.
    if (!y.every(isFinite)) {
        logger.warn('PCA result is not finite. Resetting PCA matrix.', y);
        State.pca.W = null;
        return new Float32Array(VEC_CONFIG.pcaDim).fill(NaN); // Return NaN to be filtered by viz
    }

    for (let i = 0; i < VEC_CONFIG.pcaDim; i++) {
        for (let j = 0; j < VEC_CONFIG.projDim; j++) {
            let residual = pvec[j];
            for (let k = 0; k < i; k++) {
                residual -= y[k] * State.pca.W[j * VEC_CONFIG.pcaDim + k];
            }
            State.pca.W[j * VEC_CONFIG.pcaDim + i] += State.pca.lr * y[i] * residual;
        }
    }

    // Normalize the PCA weights (eigenvectors) to prevent them from exploding
    for (let i = 0; i < VEC_CONFIG.pcaDim; i++) {
        let norm = 0;
        for (let j = 0; j < VEC_CONFIG.projDim; j++) {
            norm += State.pca.W[j * VEC_CONFIG.pcaDim + i] * State.pca.W[j * VEC_CONFIG.pcaDim + i];
        }
        norm = Math.sqrt(norm);
        if (norm > 1e-6) {
            for (let j = 0; j < VEC_CONFIG.projDim; j++) {
                State.pca.W[j * VEC_CONFIG.pcaDim + i] /= norm;
            }
        }
    }

    return y;
}

function onlineKMeans(y) {
    if (!State.kmeans.centers) {
        State.kmeans.centers = new Float32Array(VEC_CONFIG.kClusters * VEC_CONFIG.pcaDim);
        for (let i = 0; i < State.kmeans.centers.length; i++) {
            State.kmeans.centers[i] = Math.random() * 2 - 1;
        }
    }
    let bestCluster = -1;
    let minD = Infinity;
    for (let i = 0; i < VEC_CONFIG.kClusters; i++) {
        let d = 0;
        for (let j = 0; j < VEC_CONFIG.pcaDim; j++) {
            const diff = y[j] - State.kmeans.centers[i * VEC_CONFIG.pcaDim + j];
            d += diff * diff;
        }
        if (d < minD) {
            minD = d;
            bestCluster = i;
        }
    }
    State.kmeans.counts[bestCluster]++;
    const lr = 1 / State.kmeans.counts[bestCluster];
    for (let j = 0; j < VEC_CONFIG.pcaDim; j++) {
        State.kmeans.centers[bestCluster * VEC_CONFIG.pcaDim + j] += lr * (y[j] - State.kmeans.centers[bestCluster * VEC_CONFIG.pcaDim + j]);
    }
    return bestCluster;
}

function updateScaler(pvec) {
    const d = VEC_CONFIG.decay;
    for (let i = 0; i < VEC_CONFIG.projDim; i++) {
        const oldMean = State.scaler.mean[i];
        State.scaler.mean[i] = d * oldMean + (1 - d) * pvec[i];
        State.scaler.var[i] = d * State.scaler.var[i] + (1 - d) * (pvec[i] - oldMean) * (pvec[i] - State.scaler.mean[i]);
    }
}

function scale(pvec) {
    const scaled = new Float32Array(VEC_CONFIG.projDim);
    for (let i = 0; i < VEC_CONFIG.projDim; i++) {
        const std = Math.sqrt(Math.max(0, State.scaler.var[i]));
        if (std > 1e-6) {
            scaled[i] = (pvec[i] - State.scaler.mean[i]) / std;
        } else {
            scaled[i] = 0;
        }
    }
    return scaled;
}

export function queuePacket(packet) {
    State.pktQueue.push(packet);
}

function processQueue() {
    if (State.pktQueue.length === 0) return;

    const batchSize = Math.min(State.pktQueue.length, VEC_CONFIG.batch);
    const batch = State.pktQueue.splice(0, batchSize);
    const points = [];

    batch.forEach(packet => {
        State.docCount += 1; // increment total docs processed
        const tokens = tokenize(packet);
        updateVocab(tokens);
        const vec = vectorize(tokens);
        const pvec = project(vec);
        updateScaler(pvec);
        const scaled_pvec = scale(pvec);
        const y = onlinePCA(scaled_pvec);
        const cluster = onlineKMeans(y);

        const diagnostics = {
            tokens: [...tokens],
            // First 100 dims of hashed vector are already small ints; keep as-is
            vector: Array.from(vec.slice(0, 100)),
            projected: Array.from(pvec).map(v => Math.round(v * 1000) / 1000),
            scaled: Array.from(scaled_pvec).map(v => Math.round(v * 1000) / 1000),
            pca: Array.from(y).map(v => Math.round(v * 1000) / 1000),
            vocabSize: State.vocab.size,
            tombstones: State.tombstones,
        };

        points.push({
            id: packet.requestId,
            url: packet.url,
            ts: packet.timeStamp,
            y: Array.from(y),
            cluster,
            size: packet.requestHeadersSize + (packet.responseHeadersSize || 0),
            method: packet.method,
            type: packet.type,
            status: packet.statusCode,
            diagnostics,
        });
        logger.debug(`Processed packet ${packet.requestId}`, { y, cluster });
    });

    const now = Date.now();
    if (now - State.lastEmit > 1000 / VEC_CONFIG.emitHz) {
        chrome.storage.local.get({ vectorizedPackets: [] }, (result) => {
            const allPoints = result.vectorizedPackets.concat(points);
            if (allPoints.length > 2500) {
                allPoints.splice(0, allPoints.length - 2500);
            }
            chrome.storage.local.set({ vectorizedPackets: allPoints });
        });
        State.lastEmit = now;
    }
}

setInterval(processQueue, 50);

// Settings sync: listen for vectorizerSettings and apply
chrome.storage.local.get('vectorizerSettings', (res) => {
    if (res.vectorizerSettings) applySettings(res.vectorizerSettings);
});

chrome.storage.onChanged.addListener((changes, ns) => {
    if (ns !== 'local' || !changes.vectorizerSettings) return;
    applySettings(changes.vectorizerSettings.newValue || {});
});

function applySettings(s) {
    try {
        if (!s) return;
        if (typeof s.vocabSize === 'number' && s.vocabSize >= 128) VEC_CONFIG.vocabSize = s.vocabSize|0;
        if (s.weighting === 'count' || s.weighting === 'tfidf') VEC_CONFIG.weighting = s.weighting;
        if (typeof s.minDfRatio === 'number') VEC_CONFIG.minDfRatio = Math.max(0, Math.min(1, s.minDfRatio));
        if (typeof s.maxDfRatio === 'number') VEC_CONFIG.maxDfRatio = Math.max(0, Math.min(1, s.maxDfRatio));
        logger.info('Applied vectorizer settings', { ...VEC_CONFIG, R: undefined });
    } catch (e) {
        logger.error('Failed applying vectorizer settings', e);
    }
}
