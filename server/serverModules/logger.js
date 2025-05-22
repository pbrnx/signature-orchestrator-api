//logger.js

const { createLogger, format, transports } = require('winston');
const path = require('path');

const logFormat = format.printf(({ timestamp, level, message }) => {
  return `[${timestamp}] ${level.toUpperCase()}: ${message}`;
});

const logger = createLogger({
  level: 'info',
  format: format.combine(
    format.timestamp({
  format: () => new Date().toISOString().replace('Z', ' UTC')
}),

    format.errors({ stack: true }),
    format.splat(),
    format.json()
  ),
  transports: [
    new transports.File({
      filename: path.join(__dirname, '../logs/error.log'),
      level: 'error',
      format: format.combine(format.timestamp(), logFormat)
    }),
    new transports.File({
      filename: path.join(__dirname, '../logs/audit.log'),
      level: 'info',
      format: format.combine(format.timestamp(), logFormat)
    })
  ]
});

// Também loga no console em dev
if (process.env.NODE_ENV !== 'production') {
  logger.add(new transports.Console({
    format: format.combine(format.colorize(), format.simple())
  }));
}



module.exports = logger;
