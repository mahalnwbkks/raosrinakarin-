const express = require('express');
const cors = require('cors');
const { open } = require('sqlite');
const sqlite3 = require('sqlite3');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json()); // ให้หลังบ้านอ่านข้อมูล JSON ที่ส่งมาจากหน้าเว็บได้

let db;

// 1. เชื่อมต่อฐานข้อมูล SQLite และสร้างตารางถ้ายังไม่มี
async function initDatabase() {
    db = await open({
        filename: path.join(__dirname, 'database.db'),
        driver: sqlite3.Database
    });

    // สร้างตารางเก็บข้อมูลการจอง
    await db.exec(`
        CREATE TABLE IF NOT EXISTS bookings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            table_id TEXT NOT NULL,
            concert_id TEXT NOT NULL,
            customer_name TEXT NOT NULL,
            customer_phone TEXT NOT NULL,
            customer_count INTEGER NOT NULL,
            booking_date TEXT NOT NULL,
            status TEXT DEFAULT 'pending', -- pending = รอตรวจสอบ, confirmed = ยืนยันแล้ว
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    console.log('Database พร้อมใช้งานแล้ว (ไฟล์ database.db ถูกสร้างขึ้น)');
}

initDatabase();

// 2. API สำหรับดึงรายชื่อโต๊ะที่ "ถูกจองไปแล้ว" ของแต่ละคอนเสิร์ต
app.get('/api/booked-tables', async (req, res) => {
    const { concert_id, date } = req.query;
    try {
        // ค้นหาโต๊ะที่ถูกจองในคอนเสิร์ตและวันที่เลือก
        const rows = await db.all(
            'SELECT table_id FROM bookings WHERE concert_id = ? AND booking_date = ?',
            [concert_id, date]
        );
        const bookedList = rows.map(row => row.table_id);
        res.json({ success: true, bookedTables: bookedList });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 3. API สำหรับบันทึกการจองใหม่จากลูกค้า
app.post('/api/book-table', async (req, res) => {
    const { table_id, concert_id, customer_name, customer_phone, customer_count, booking_date } = req.body;

    try {
        // ตรวจสอบซ้ำอีกครั้งว่าโต๊ะนี้มีคนชิงตัดหน้าจองไปหรือยัง
        const isAlreadyBooked = await db.get(
            'SELECT id FROM bookings WHERE table_id = ? AND concert_id = ? AND booking_date = ?',
            [table_id, concert_id, booking_date]
        );

        if (isAlreadyBooked) {
            return res.status(400).json({ success: false, message: '❌ โต๊ะนี้ถูกจองตัดหน้าไปแล้วเรียบร้อย' });
        }

        // บันทึกลงฐานข้อมูล
        await db.run(
            `INSERT INTO bookings (table_id, concert_id, customer_name, customer_phone, customer_count, booking_date) 
             VALUES (?, ?, ?, ?, ?, ? )`,
            [table_id, concert_id, customer_name, customer_phone, customer_count, booking_date]
        );

        res.json({ success: true, message: 'บันทึกข้อมูลการจองสำเร็จ กรุณาชำระเงิน' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// เปิดเซิร์ฟเวอร์ที่ Port 3000
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server หลังบ้านวิ่งอยู่ที่: http://localhost:${PORT}`);
});