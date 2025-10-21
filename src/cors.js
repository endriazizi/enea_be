const mysql = require('mysql2/promise');
const cfg = require('./config');
const logger = require('./logger');


let pool;


async function getPool() {
if (!pool) {
logger.info({ msg: 'DB: creating pool', host: cfg.db.host, db: cfg.db.name });
pool = mysql.createPool({
host: cfg.db.host,
user: cfg.db.user,
password: cfg.db.password,
database: cfg.db.name,
waitForConnections: true,
connectionLimit: 10
});
}
return pool;
}


async function query(sql, params = []) {
const p = await getPool();
const start = Date.now();
const [rows] = await p.query(sql, params);
const ms = Date.now() - start;
logger.info({ msg: 'DB query', sql, params, rowsCount: Array.isArray(rows) ? rows.length : 0, ms });
return rows;
}


module.exports = { getPool, query };