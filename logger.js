const LOG_LEVEL = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  NONE: 4,
};

const config = {
  level: LOG_LEVEL.DEBUG, // Set the default log level
  prefix: '[NetAnalyzer]',
};

function log(level, ...args) {
  if (level >= config.level) {
    const timestamp = new Date().toISOString();
    console.log(`${config.prefix} [${timestamp}]`, ...args);
  }
}

export const logger = {
  debug: (...args) => log(LOG_LEVEL.DEBUG, ...args),
  info: (...args) => log(LOG_LEVEL.INFO, ...args),
  warn: (...args) => log(LOG_LEVEL.WARN, ...args),
  error: (...args) => log(LOG_LEVEL.ERROR, ...args),
  setLevel: (newLevel) => {
    config.level = newLevel;
  },
};
