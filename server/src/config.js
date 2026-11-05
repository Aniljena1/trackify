import 'dotenv/config';

const env = process.env.NODE_ENV || 'development';
const isProd = env === 'production';
const isTest = env === 'test';

// Warn if JWT_SECRET is unset in production, but don't crash the build/bundling step.
if (isProd && !process.env.JWT_SECRET) {
  console.warn('[config] Warning: JWT_SECRET is not set. Using fallback secret.');
}

export const config = {
  env,
  isProd,
  isTest,
  port: Number(process.env.PORT || 4000),
  databaseUrl:
    (isTest && process.env.TEST_DATABASE_URL) ||
    process.env.DATABASE_URL ||
    (isTest
      ? 'postgres://foreman:foreman@localhost:5432/foreman_test'
      : 'postgres://foreman:foreman@localhost:5432/foreman'),
  dbSsl: process.env.DATABASE_SSL === 'true',
  jwtSecret: process.env.JWT_SECRET || 'dev-only-secret-change-me',
  jwtExpires: process.env.JWT_EXPIRES || '8h',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  // "Today" is evaluated in this zone so overdue flags flip at the team's midnight, not UTC's.
  timezone: process.env.APP_TZ || 'Asia/Kolkata',
};

/** Today as YYYY-MM-DD in the configured zone. */
export function today(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone }).format(date);
}
