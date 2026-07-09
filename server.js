const express = require('express');
const cors = require('cors');
const { open } = require('sqlite');
const sqlite3 = require('sqlite3');
const path = require('path');
const multer = require('multer'); // โมดูลสำหรับจัดการไฟล์อัปโหลด
const fs = require('fs');
const axios = require('axios'); // โมดูลสำหรับส่งข้อมูลหา API ของ LINE

// 🟢 โค้ดเปลี่ยนมาใช้ LINE Messaging API Token ของคุณเรียบร้อยแล้ว
const LINE_CHANNEL_ACCESS_TOKEN = 'Hc0qtV0xC09Ry7lrPQ24FQdRp9XATOWIOOc4SVa/zc8TotlBGnJkropJ42SZRPu78yI9aAz98Y3CqJXNzvJtsAwpQTXNR1MrVa0sUBL+3YPOMdNZcj1PCU9rDTZ3egbazYAYXFJqv3QJqBVCrslHvgdB04t89/1O/w1cDnyilFU='; 

// 🟢 ใส่ไอดีปลายทางตรงนี้ (ไอดีผู้ใช้ของคุณ ดูได้จากหน้าเว็บหน้าแรกแท็บ Basic settings ตัวล่างสุด หรือ Group ID ของกลุ่ม)
const LINE_TARGET_ID = 'Ccbf8a8d104dd53e7cfc08e98d48caf2f'; 

const app = express();

// ปลดล็อกระบบรักษาความปลอดภัย CORS เพื่อให้ฝั่งหน้าเว็บเชื่อมต่อได้อย่างสมบูรณ์
app.use(cors());

// เพิ่มการจำกัดขนาดไฟล์เป็น 50mb เพื่อรองรับไฟล์รูปภาพสลิปขนาดใหญ่จากมือถือ
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

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

// ตั้งค่าข้อจำกัดใน multer ให้รับไฟล์ขนาดใหญ่ขึ้น
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 20 * 1024 * 1024 } 
});

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
            slip_image TEXT,
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

// 🛠️ แก้ไขฟังก์ชัน: ให้รองรับการส่งทั้งข้อความและ URL รูปภาพสลิปพร้อมกัน
async function sendLineBotMessage(message, imageUrl = null) {
    if (!LINE_CHANNEL_ACCESS_TOKEN || !LINE_TARGET_ID || LINE_TARGET_ID === '') {
        console.log('⚠️ ยังไม่ได้ระบุ Token หรือ Target ID ข้ามการแจ้งเตือน');
        return;
    }
    
    try {
        // เริ่มต้นด้วยการใส่ข้อความรายละเอียดการจอง
        const messagesPayload = [
            {
                type: 'text',
                text: message
            }
        ];

        // 🛠️ ถ้ามี URL รูปภาพสลิปส่งมาด้วย ให้ดันประเภท image เข้าไปในลิสต์ข้อความ
        if (imageUrl) {
            messagesPayload.push({
                type: 'image',
                originalContentUrl: imageUrl,
                previewImageUrl: imageUrl
            });
        }

        const linePayload = {
            to: LINE_TARGET_ID,
            messages: messagesPayload
        };

        await axios.post('https://api.line.me/v2/bot/message/push', linePayload, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`
            }
        });
        console.log('🔔 แจ้งเตือนพร้อมรูปภาพสลิปส่งเข้า LINE เรียบร้อยแล้ว!');
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

// API จองโต๊ะ รองรับการอัปโหลดไฟล์รูปภาพพร้อมกัน + ยิงเข้า LINE บอท
app.post('/api/book-table', upload.single('slip'), async (req, res) => {
    const { table_id, concert_id, customer_name, customer_phone, customer_count, booking_date } = req.body;
    const slip_image = req.file ? req.file.filename : null;

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

        const lineMessage = `📢 มีรายการจองโต๊ะใหม่เข้ามา!\n📌 หมายเลขโต๊ะ: ${table_id}\n👤 ชื่อลูกค้า: ${customer_name}\n📞 เบอร์โทรศัพท์: ${customer_phone}\n👥 จำนวนคน: ${customer_count} ท่าน\n📅 วันที่จอง: ${booking_date}\n\n👉 ตรวจสอบรูปภาพสลิปเงินด้านล่างนี้ได้เลยครับ!`;
        
        // 🛠️ สร้าง URL รูปภาพสลิปที่ทำงานอยู่บน Render เพื่อส่งให้ LINE ดึงภาพไปแสดง
        let slipUrl = null;
        if (slip_image) {
            slipUrl = `https://raosrinakarin-get-concert-and-party.onrender.com/uploads/${slip_image}`;
        }
        
        // ส่งข้อความพร้อมแนบ URL สลิป
        sendLineBotMessage(lineMessage, slipUrl);

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
        const booking = await db.get(`SELECT slip_image FROM bookings WHERE id = ?`, [id]);
        if (booking && booking.slip_image) {
            const filePath = path.join(__dirname, 'uploads', booking.slip_image);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }
        await db.run(`DELETE FROM bookings WHERE id = ?`, [id]);
        res.json({ success: true, message: "ยกเลิกการจองและลบข้อมูลแล้ว" });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server หลังบ้านวิ่งอยู่ที่: https://raosrinakarin-get-concert-and-party.onrender.com/admin.html:${PORT}`);
});