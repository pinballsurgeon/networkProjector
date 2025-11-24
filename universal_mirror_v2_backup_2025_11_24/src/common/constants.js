// Event Horizon Binary Format Constants
export const PACKET_SIZE = 20; // Size in bytes of a single packet struct
// [Timestamp (u64)] [DomainID (u32)] [VectorID (u32)] [Size (u16)] [Flags (u8)] + Padding

export const FLAGS = {
  IS_REQUEST: 1,
  IS_RESPONSE: 2,
  HAS_CONTENT: 4,
  IS_ERROR: 8,
};

export const BUFFER_SIZE = 1024 * 1024 * 10; // 10MB Circular Buffer

// Physics / Coagulation Constants
export const MAX_PARTICLES = 1000; // Hard limit for rendering performance
export const COAGULATION_THRESHOLD = 50; // Distance to trigger merge
export const ATTRACTION_FORCE = 0.05; // How fast similar particles pull together

// Message Types
export const MSG_CAPTURE_PAYLOAD = 'CAPTURE_PAYLOAD';
export const MSG_QUERY_HISTORY = 'QUERY_HISTORY';
