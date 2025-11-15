import { queuePacket } from './vectorizer.js';

let packetsInCount = 0;
let packetsOutCount = 0;
let totalBytesIn = 0;
let totalBytesOut = 0;
let recentPackets = [];
let trafficHistory = [];
const requestData = {}; // Temporary storage for request details

// Initialize stats from storage to ensure persistence
chrome.storage.local.get(['packetsInCount', 'packetsOutCount', 'totalBytesIn', 'totalBytesOut', 'recentPackets', 'trafficHistory'], (result) => {
  packetsInCount = result.packetsInCount || 0;
  packetsOutCount = result.packetsOutCount || 0;
  totalBytesIn = result.totalBytesIn || 0;
  totalBytesOut = result.totalBytesOut || 0;
  recentPackets = result.recentPackets || [];
  trafficHistory = result.trafficHistory || [];
});

// Periodically save the total packet count for the chart
setInterval(() => {
  const totalPackets = packetsInCount + packetsOutCount;
  if (trafficHistory.length === 0 || trafficHistory[trafficHistory.length - 1].value !== totalPackets) {
    trafficHistory.push({ time: Date.now(), value: totalPackets });
    chrome.storage.local.set({ trafficHistory });
  }
}, 1000);

// Listener for outgoing requests
chrome.webRequest.onSendHeaders.addListener(
  (details) => {
    packetsOutCount++;
    const requestHeadersSize = details.requestHeaders.reduce((acc, header) => acc + header.name.length + (header.value ? header.value.length : 0), 0);
    totalBytesOut += requestHeadersSize;

    // Store request size to use it in onCompleted
    requestData[details.requestId] = { requestHeadersSize };

    chrome.storage.local.set({
      packetsOutCount,
      totalBytesOut,
    });
  },
  { urls: ["<all_urls>"] },
  ["requestHeaders"]
);

// Listener for incoming responses
chrome.webRequest.onCompleted.addListener(
  (details) => {
    packetsInCount++;
    
    const responseHeadersSize = details.responseHeaders ? details.responseHeaders.reduce((acc, header) => acc + header.name.length + (header.value ? header.value.length : 0), 0) : 0;
    totalBytesIn += responseHeadersSize;

    const storedRequestData = requestData[details.requestId] || { requestHeadersSize: 0 };

    const packetInfo = {
      requestId: details.requestId,
      url: details.url,
      method: details.method,
      statusCode: details.statusCode,
      type: details.type,
      timeStamp: details.timeStamp,
      requestHeadersSize: storedRequestData.requestHeadersSize,
      responseHeadersSize,
      responseHeaders: details.responseHeaders || [],
    };

    queuePacket(packetInfo);
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
