const { createLogger, format, transports } = require('winston');
const path = require('path');

const logFormat = format.printf(({ timestamp, level, message }) => {
  return `[${timestamp}] ${level.toUpperCase()}: ${message}`;
});

// Define caminhos de log dinâmicos conforme ambiente
const errorLogPath = process.env.NODE_ENV === 'production'
  ? '/tmp/error.log'
  : path.join(__dirname, '../logs/error.log');

const auditLogPath = process.env.NODE_ENV === 'production'
  ? '/tmp/audit.log'
  : path.join(__dirname, '../logs/audit.log');

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
      filename: errorLogPath,
      level: 'error',
      format: format.combine(format.timestamp(), logFormat)
    }),
    new transports.File({
      filename: auditLogPath,
      level: 'info',
      format: format.combine(format.timestamp(), logFormat)
    }),
    // Sempre adiciona log no console, inclusive em produção/cloud!
    new transports.Console({
      format: format.combine(format.colorize(), logFormat)
    })
  ]
});

module.exports = logger;


