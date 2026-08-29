"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const config_1 = require("./config");
const levels = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};
const currentLevel = levels[config_1.config.logLevel] ?? 1;
function formatMessage(level, message, meta) {
    const timestamp = new Date().toISOString();
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : "";
    return `[${timestamp}] ${level.toUpperCase()} ${message}${metaStr}`;
}
exports.logger = {
    debug: (message, meta) => {
        if (currentLevel <= levels.debug)
            console.log(formatMessage("debug", message, meta));
    },
    info: (message, meta) => {
        if (currentLevel <= levels.info)
            console.log(formatMessage("info", message, meta));
    },
    warn: (message, meta) => {
        if (currentLevel <= levels.warn)
            console.warn(formatMessage("warn", message, meta));
    },
    error: (message, meta) => {
        if (currentLevel <= levels.error)
            console.error(formatMessage("error", message, meta));
    },
};
//# sourceMappingURL=logger.js.map