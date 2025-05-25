require('dotenv').config();
const mysql = require('mysql2/promise');

const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

db.getConnection()
  .then((conn) => {
    console.log('Database udah connect');
    conn.release();
  })
  .catch((err) => {
    console.error('Database gagal connect:', err.message);
  });

module.exports = db;
