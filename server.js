const express = require('express');
const cors = require('cors');
const { open } = require('sqlite');
const sqlite3 = require('sqlite3');
const path = require('path');
const multer = require('multer'); // โมดูลสำหรับจัดการไฟล์อัปโหลด
const fs = require('fs');
const axios = require('axios'); // โมดูลสำหรับส่งข้อมูลหา API ของ LINE

// 🟢 โค้ดเปลี่ยนมาใช้ LINE Messaging API Token ของคุณเรียบร้อยแล้ว
const LINE_CHANNEL_ACCESS_TOKEN = 'scvQb4rx8otarH1ncxZks5MMDzzlO53ewpi9xRdBkd8vvCnmZJwtuuGol4O7jI5R8yI9aAz98Y3CqJXNzvJtsAwpQTXNR1MrVa0sUBL+3YN2yuJKoM6OwrcDYuHZd8q8AphcIIJG3jUw7zcmCw4A/gdB04t89/1O/w1cDnyilFU='; 

// 🟢 ใส่ไอดีปลายทางตรงนี้ (ไอดีผู้ใช้ของคุณ ดูได้จากหน้าเว็บหน้าแรกแท็บ Basic settings ตัวล่างสุด หรือ Group ID ของกลุ่ม)
const LINE_TARGET_ID = 'ใส่_USER_ID_หรือ_GROUP_ID_ตรงนี้'; 

const app = express();

// ปลดล็อกระบบรักษาความปลอดภัย CORS เพื่อให้ฝั่งหน้าเว็บเชื่อมต่อได้อย่างสมบูรณ์
app.use(cors());
app.use(express.json());

// เปิดให้หน้าเว็บสามารถเข้าถึงไฟล์รูปภาพในโฟลเดอร์ uploads ได้โดยตรงผ่าน URL
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ตรวจสอบว่ามีโฟลเดอร์ uploads ไหม ถ้าไม่มีให้สร้างอัตโนมัติ
if (!fs.existsSync('./uploads')){
    fs.mkdirSync('./uploads');
}

// ตั้งค่าการเก็บไฟล์รูปภาพสลิป
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, './uploads/');
    },
    filename: function (req, file, cb) {
        // ตั้งชื่อไฟล์ใหม่เป็น: slip-เวลาปัจจุบัน-ชื่อไฟล์เดิม
        cb(null, 'slip-' + Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

let db;

async function initDatabase() {
    db = await open({
        filename: path.join(__dirname, 'database.db'),
        driver: sqlite3.Database
    });

    // ปรับโครงสร้างตารางเพิ่มคอลัมน์ slip_image ถ้ายังไม่มี
    await db.exec(`
        CREATE TABLE IF NOT EXISTS bookings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            table_id TEXT NOT NULL,
            concert_id TEXT NOT NULL,
            customer_name TEXT NOT NULL,
            customer_phone TEXT NOT NULL,
            customer_count INTEGER NOT NULL,
            booking_date TEXT NOT NULL,
            status TEXT DEFAULT 'pending',
            slip_image TEXT, -- คอลัมน์เก็บชื่อไฟล์รูปภาพสลิป
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    
    // โค้ดเซฟตี้: เผื่อมีตารางเดิมอยู่แล้วแต่ไม่มีคอลัมน์ slip_image
    try {
        await db.exec(`ALTER TABLE bookings ADD COLUMN slip_image TEXT`);
    } catch(e) {
        // ถ้ามีคอลัมน์อยู่แล้วจะข้ามไป ไม่แจ้ง Error
    }

    console.log('Database พร้อมใช้งานและรองรับระบบแนบสลิปแล้ว');
}
initDatabase();

// 🟢 ฟังก์ชันส่งข้อความแจ้งเตือนผ่าน LINE Messaging API (บอท) รูปแบบใหม่
async function sendLineBotMessage(message) {
    if (!LINE_CHANNEL_ACCESS_TOKEN || LINE_TARGET_ID === 'ใส่_USER_ID_หรือ_GROUP_ID_ตรงนี้') {
        console.log('⚠️ ยังไม่ได้ระบุ Token หรือ Target ID ข้ามการแจ้งเตือน');
        return;
    }
    
    try {
        const linePayload = {
            to: LINE_TARGET_ID,
            messages: [
                {
                    type: 'text',
                    text: message
                }
            ]
        };

        await axios.post('https://api.line.me/v2/bot/message/push', linePayload, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`
            }
        });
        console.log('🔔 แจ้งเตือนผ่าน LINE บอทเรียบร้อยแล้ว!');
    } catch (error) {
        console.error('❌ ส่งข้อความเข้า LINE ล้มเหลว:', error.response ? error.response.data : error.message);
    }
}

app.get('/api/booked-tables', async (req, res) => {
    const { concert_id, date } = req.query;
    try {
        const rows = await db.all('SELECT table_id FROM bookings WHERE concert_id = ? AND booking_date = ?', [concert_id, date]);
        const bookedList = rows.map(row => row.table_id);
        res.json({ success: true, bookedTables: bookedList });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 🔄 API จองโต๊ะ รองรับการอัปโหลดไฟล์รูปภาพพร้อมกัน + ยิงเข้า LINE บอท
app.post('/api/book-table', upload.single('slip'), async (req, res) => {
    const { table_id, concert_id, customer_name, customer_phone, customer_count, booking_date } = req.body;
    const slip_image = req.file ? req.file.filename : null; // ดึงชื่อไฟล์รูปที่เซฟได้

    try {
        const isAlreadyBooked = await db.get(
            'SELECT id FROM bookings WHERE table_id = ? AND concert_id = ? AND booking_date = ?',
            [table_id, concert_id, booking_date]
        );

        if (isAlreadyBooked) {
            return res.status(400).json({ success: false, message: '❌ โต๊ะนี้ถูกจองตัดหน้าไปแล้วเรียบร้อย' });
        }

        await db.run(
            `INSERT INTO bookings (table_id, concert_id, customer_name, customer_phone, customer_count, booking_date, slip_image) 
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [table_id, concert_id, customer_name, customer_phone, customer_count, booking_date, slip_image]
        );

        // 🔔 เปลี่ยนข้อความส่งแจ้งเตือนเข้าแชทไลน์ผ่านบอท
        const lineMessage = `📢 มีรายการจองโต๊ะใหม่เข้ามา!\n📌 หมายเลขโต๊ะ: ${table_id}\n👤 ชื่อลูกค้า: ${customer_name}\n📞 เบอร์โทรศัพท์: ${customer_phone}\n👥 จำนวนคน: ${customer_count} ท่าน\n📅 วันที่จอง: ${booking_date}\n\n👉 ตรวจสอบรูปภาพสลิปเงินและกดยืนยันผ่านระบบหลังบ้านแอดมินนะครับ!`;
        
        // เรียกฟังก์ชันส่งไลน์ผ่านบอทใหม่
        sendLineBotMessage(lineMessage);

        res.json({ success: true, message: 'บันทึกข้อมูลและอัปโหลดสลิปสำเร็จ!' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/admin/bookings', async (req, res) => {
    try {
        const rows = await db.all(`SELECT * FROM bookings ORDER BY booking_date DESC, table_id ASC`);
        res.json({ success: true, bookings: rows });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/admin/approve', async (req, res) => {
    const { id } = req.body;
    try {
        await db.run(`UPDATE bookings SET status = 'confirmed' WHERE id = ?`, [id]);
        res.json({ success: true, message: "อัปเดตสถานะการชำระเงินเรียบร้อยแล้ว" });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/admin/delete', async (req, res) => {
    const { id } = req.body;
    try {
        // ดึงชื่อไฟล์ภาพมาลบออกจากเครื่องด้วยเพื่อประหยัดพื้นที่
        const booking = await db.get(`SELECT slip_image FROM bookings WHERE id = ?`, [id]);
        if(booking && booking.slip_image) {
            const filePath = path.join(__dirname, 'uploads', booking.slip_image);
            if(fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }
        await db.run(`DELETE FROM bookings WHERE id = ?`, [id]);
        res.json({ success: true, message: "ยกเลิกการจองและลบข้อมูลแล้ว" });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server หลังบ้านวิ่งอยู่ที่: http://localhost:${PORT}`);
});