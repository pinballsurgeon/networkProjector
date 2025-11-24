// background.js

// INLINED CONSTANTS
const PACKET_SIZE = 20;
const FLAGS = {
  IS_REQUEST: 1,
  IS_RESPONSE: 2,
  HAS_CONTENT: 4,
  IS_ERROR: 8,
};
const MSG_CAPTURE_PAYLOAD = 'CAPTURE_PAYLOAD';

// The "Ring of Fire" - In-memory buffer
let ringBuffer = [];
const MAX_BUFFER_LENGTH = 5000; 

// Domain and Vector Dictionaries (Interning)
let domainMap = new Map();
let nextDomainId = 1;
let vectorMap = new Map();
let nextVectorId = 1;

// Load persisted state
chrome.storage.local.get(['domainMap', 'vectorMap', 'nextDomainId', 'nextVectorId'], (result) => {
  if (result && result.domainMap) {
      try {
          domainMap = new Map(Object.entries(result.domainMap));
      } catch (e) { console.error("Failed to load domainMap", e); }
  }
  if (result && result.vectorMap) {
      try {
          vectorMap = new Map(Object.entries(result.vectorMap));
      } catch (e) { console.error("Failed to load vectorMap", e); }
  }
  if (result && result.nextDomainId) nextDomainId = result.nextDomainId;
  if (result && result.nextVectorId) nextVectorId = result.nextVectorId;
});

function getDomainId(hostname) {
  try {
    if (domainMap.has(hostname)) return domainMap.get(hostname);
    
    const id = nextDomainId++;
    domainMap.set(hostname, id);
    chrome.storage.local.set({ 
        domainMap: Object.fromEntries(domainMap),
        nextDomainId 
    });
    return id;
  } catch (e) {
    return 0;
  }
}

function parseDomainInfo(url) {
    try {
        const hostname = new URL(url).hostname;
        const parts = hostname.split('.');
        const rootDomain = parts.slice(-2).join('.'); 
        
        return {
            hostname: hostname,
            rootDomain: rootDomain,
            isSubdomain: hostname !== rootDomain
        };
    } catch (e) {
        return { hostname: 'unknown', rootDomain: 'unknown', isSubdomain: false };
    }
}

function getVectorId(content) {
    const signature = content.substring(0, 50); 
    if (vectorMap.has(signature)) return vectorMap.get(signature);

    const id = nextVectorId++;
    vectorMap.set(signature, id);
     chrome.storage.local.set({ 
        vectorMap: Object.fromEntries(vectorMap),
        nextVectorId 
    });
    return id;
}

function ingestPacket(url, method, type, size, time, content = '', meta = {}, initiator = null, isRequest = false) {
    let { hostname, rootDomain, isSubdomain } = parseDomainInfo(url);
    
    let finalRootDomain = rootDomain;
    let finalIsSubdomain = isSubdomain;

    if (initiator && initiator !== 'null') {
        const initiatorInfo = parseDomainInfo(initiator);
        if (initiatorInfo.rootDomain !== rootDomain) {
             finalRootDomain = initiatorInfo.rootDomain; 
             finalIsSubdomain = true; 
        }
    }

    const domainId = getDomainId(hostname); 
    const rootDomainId = getDomainId(finalRootDomain); 
    const vectorId = content ? getVectorId(content) : 0;
    
    let flags = 0;
    if (isRequest) flags |= FLAGS.IS_REQUEST;
    else flags |= FLAGS.IS_RESPONSE;
    if (content) flags |= FLAGS.HAS_CONTENT;

    const particle = {
        time: time,
        domainId: domainId, 
        rootDomainId: rootDomainId,
        vectorId: vectorId,
        size: size,
        flags: flags,
        url: url,
        bloatScore: meta.bloatScore || 0,
        isClean: meta.isClean !== undefined ? meta.isClean : true,
        isSubdomain: finalIsSubdomain
    };

    ringBuffer.push(particle);
    if (ringBuffer.length > MAX_BUFFER_LENGTH) {
        ringBuffer.shift(); 
    }

    chrome.runtime.sendMessage({
        type: 'NEW_PARTICLE',
        payload: particle
    }).catch(() => {});
}

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    ingestPacket(
        details.url, 
        details.method, 
        details.type, 
        0, 
        Date.now(),
        '', 
        {}, 
        details.initiator,
        true 
    );
  },
  { urls: ["<all_urls>"] }
);

chrome.webRequest.onCompleted.addListener(
  (details) => {
    ingestPacket(
        details.url, 
        details.method, 
        details.type, 
        0, 
        Date.now(),
        '', 
        {}, 
        details.initiator,
        false 
    );
  },
  { urls: ["<all_urls>"] }
);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === MSG_CAPTURE_PAYLOAD) {
        ingestPacket(
            sender.tab ? sender.tab.url : 'unknown',
            'GET',
            'document',
            message.payload.length,
            Date.now(),
            message.payload,
            message.meta
        );
    }
    if (message.type === 'QUERY_BUFFER') {
        sendResponse({ buffer: ringBuffer });
    }
});

console.log("The Devourer is hungry...");
