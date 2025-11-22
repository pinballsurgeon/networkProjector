import { queuePacket } from './vectorizer.js';
import { aggregator } from './aggregator.js';

let packetsInCount = 0;
let packetsOutCount = 0;
let totalBytesIn = 0;
let totalBytesOut = 0;
let recentPackets = [];
let trafficHistory = [];
const requestData = {}; // Temporary storage for request details

// Initialize stats from storage to ensure persistence
chrome.storage.local.get(['packetsInCount', 'packetsOutCount', 'totalBytesIn', 'totalBytesOut', 'recentPackets', 'trafficHistory', 'vizConfig'], (result) => {
  packetsInCount = result.packetsInCount || 0;
  packetsOutCount = result.packetsOutCount || 0;
  
  if (result.vizConfig) {
      aggregator.setConfig(result.vizConfig);
  }
  totalBytesIn = result.totalBytesIn || 0;
  totalBytesOut = result.totalBytesOut || 0;
  recentPackets = result.recentPackets || [];
  trafficHistory = result.trafficHistory || [];
});

// Periodically save the total packet count for the chart AND the universe state
setInterval(() => {
  const totalPackets = packetsInCount + packetsOutCount;
  if (trafficHistory.length === 0 || trafficHistory[trafficHistory.length - 1].value !== totalPackets) {
    trafficHistory.push({ time: Date.now(), value: totalPackets });
    chrome.storage.local.set({ trafficHistory });
  }

  // Save the hierarchical universe state for the 4D viz
  // 200ms update rate for smoother animation
  const universeState = aggregator.getState();
  chrome.storage.local.set({ universeState });
}, 200);

// Listener for outgoing requests
chrome.webRequest.onSendHeaders.addListener(
  (details) => {
    packetsOutCount++;
    const requestHeadersSize = details.requestHeaders.reduce((acc, header) => acc + header.name.length + (header.value ? header.value.length : 0), 0);
    totalBytesOut += requestHeadersSize;

    // Store request size and start time to use it in onCompleted
    requestData[details.requestId] = {
      requestHeadersSize,
      startTime: details.timeStamp,
      requestHeaders: details.requestHeaders || [],
    };

    chrome.storage.local.set({
      packetsOutCount,
      totalBytesOut,
    });
  },
  { urls: ["<all_urls>"] },
  ["requestHeaders"]
);

// Listen for config changes from UI
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.vizConfig) {
    aggregator.setConfig(changes.vizConfig.newValue);
  }
});

// Listener for incoming responses
chrome.webRequest.onCompleted.addListener(
  (details) => {
    packetsInCount++;
    
    const responseHeadersSize = details.responseHeaders ? details.responseHeaders.reduce((acc, header) => acc + header.name.length + (header.value ? header.value.length : 0), 0) : 0;
    totalBytesIn += responseHeadersSize;

    const storedRequestData = requestData[details.requestId] || { requestHeadersSize: 0, startTime: details.timeStamp, requestHeaders: [] };

    // Approximate latency (ms) from first sendHeaders to completed
    const latencyMs = Math.max(0, details.timeStamp - (storedRequestData.startTime || details.timeStamp));

    function getHeader(headers, name) {
      const lower = name.toLowerCase();
      if (!headers) return null;
      for (const h of headers) {
        if ((h.name || '').toLowerCase() === lower) return h.value || null;
      }
      return null;
    }

    const reqContentLength = parseInt(getHeader(storedRequestData.requestHeaders, 'content-length') || '0', 10) || 0;
    const resContentLength = parseInt(getHeader(details.responseHeaders || [], 'content-length') || '0', 10) || 0;

    const packetInfo = {
      requestId: details.requestId,
      url: details.url,
      method: details.method,
      statusCode: details.statusCode,
      type: details.type,
      tabId: details.tabId, // Crucial for grouping by Tab/Planet
      timeStamp: details.timeStamp,
      requestHeadersSize: storedRequestData.requestHeadersSize,
      responseHeadersSize,
      responseHeaders: details.responseHeaders || [],
      latencyMs,
      requestContentLength: reqContentLength,
      responseContentLength: resContentLength,
    };

    queuePacket(packetInfo);
    aggregator.addPacket(packetInfo); // Add to hierarchical aggregator

    recentPackets.unshift(packetInfo);
    if (recentPackets.length > 30) {
      recentPackets.pop();
    }

    // Clean up stored data
    delete requestData[details.requestId];

    chrome.storage.local.set({
      packetsInCount,
      totalBytesIn,
      recentPackets,
    });
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);
