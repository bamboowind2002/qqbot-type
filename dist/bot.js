import { NCWebsocket } from 'node-napcat-ts';
import mysql from 'mysql';
import { databaseConfig, napcatConfig } from './config.js';

export const consql = mysql.createConnection(databaseConfig);

export const bot = new NCWebsocket({
  ...napcatConfig,
  throwPromise: false,
  reconnection: {
    enable: true,
    attempts: 10,
    delay: 5000
  }
}, false);

await bot.connect();

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
