const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: { rejectUnauthorized: false },
  waitForConnections: true,
  connectionLimit: 10,
  // ─── KEEP CONNECTIONS WARM ───────────────────────────────────
  // The DB is remote (Azure) over SSL, so a fresh connection costs a ~250ms
  // TLS handshake. TCP keep-alive stops Azure dropping idle sockets, and keeping
  // a few idle connections in the pool means most requests skip the handshake.
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
  maxIdle: 10,
  idleTimeout: 600000, // 10 min — comfortably under Azure's idle cutoff
});

module.exports = pool;
