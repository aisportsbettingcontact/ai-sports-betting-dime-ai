import mysql from 'mysql2/promise'
const conn = await mysql.createConnection(process.env.DATABASE_URL!)
const [r] = await conn.query(`SELECT TIMESTAMPDIFF(MINUTE, MAX(createdAt), UTC_TIMESTAMP()) AS staleMin FROM odds_history WHERE sport='MLB'`)
console.log('live-pipeline staleness via odds_history (min):', (r as any[])[0].staleMin)
await conn.end()
