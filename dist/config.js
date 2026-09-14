import dotenv from 'dotenv';

dotenv.config();

const required = [
  'BOT_DB_HOST', 'BOT_DB_PORT', 'BOT_DB_USER', 'BOT_DB_PASSWORD',
  'BOT_DB_NAME', 'NAPCAT_HOST', 'NAPCAT_PORT', 'NAPCAT_ACCESS_TOKEN'
];

const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) {
  throw new Error(`Missing required environment variables: ${missing.join(', ')}. Copy .env.example to .env and fill in the production values.`);
}

function port(name) {
  const value = Number(process.env[name]);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535.`);
  }
  return value;
}

export const databaseConfig = Object.freeze({
  host: process.env.BOT_DB_HOST,
  port: port('BOT_DB_PORT'),
  user: process.env.BOT_DB_USER,
  password: process.env.BOT_DB_PASSWORD,
  database: process.env.BOT_DB_NAME,
  charset: 'utf8mb4'
});

export const napcatConfig = Object.freeze({
  protocol: 'ws',
  host: process.env.NAPCAT_HOST,
  port: port('NAPCAT_PORT'),
  accessToken: process.env.NAPCAT_ACCESS_TOKEN
});
