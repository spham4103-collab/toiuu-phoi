# HƯỚNG DẪN TRIỂN KHAI TÊN MIỀN RIÊNG & MÁY CHỦ CLOUD 24/7
## Hệ Thống Tối Ưu Xếp Phôi Thép Hộp - Cơ Khí An Bình

---

### TẠI SAO CẦN CHUYỂN TỪ NETLIFY SANG MÁY CHỦ BACKEND & TÊN MIỀN RIÊNG?
1. **Netlify** là nền tảng máy chủ tĩnh (chỉ chứa file HTML/CSS/JS), **không chạy được tiến trình Node.js ngầm 24/7** (`server.js`) và **không lưu trữ được file 3D .IGS lâu dài trên ổ cứng**.
2. **Khắc phục triệt để lỗi "no tunnel" & không phụ thuộc máy tính cá nhân**:
   - Khi chạy qua máy tính cá nhân, nếu tắt máy, gập laptop hoặc mạng chập chờn thì toàn bộ xưởng và điện thoại sẽ mất kết nối.
   - Khi có **Tên miền riêng + Máy chủ Cloud VPS 24/7**: Hệ thống hoạt động độc lập 365 ngày/năm, bất kể máy tính văn phòng có bật hay tắt. Kỹ sư vẽ Fusion 360 ở bất cứ đâu bấm "Xuất phôi" là toàn bộ xưởng (điện thoại, máy tính bảng, máy cắt CNC) nhận được dữ liệu tức thì.

---

### BƯỚC 1: MUA TÊN MIỀN (DOMAIN) RIÊNG

1. **Chọn nhà cung cấp tên miền uy tín tại Việt Nam**:
   - **PA Việt Nam** (pavietnam.vn)
   - **Mắt Bão** (matbao.net)
   - **TinoHost** (tinohost.com)
   - **iNET** (inet.vn)
   - Hoặc quốc tế: **Cloudflare Registrar**, **Namecheap**.

2. **Gợi ý tên miền đẹp cho xưởng**:
   - `xepphoianbinh.com` hoặc `xepphoianbinh.vn`
   - `toiuuanbinh.com` hoặc `toiuuanbinh.vn`
   - `cokhianbinh.vn` hoặc `cokhianbinh.com`
   *(Chi phí: Tên miền `.com` khoảng 200.000đ - 300.000đ/năm; Tên miền `.vn` khoảng 550.000đ/năm)*.

---

### BƯỚC 2: CHỌN MÁY CHỦ CLOUD BACKEND 24/7

Có 2 phương án tùy thuộc vào nhu cầu của xưởng:

####  Phương Án 1: Thuê Cloud VPS Việt Nam (Khuyên Dùng Số 1 - Tối Ưu Nhất)
- **Nhà cung cấp**: **Vietnix**, **TinoHost**, **AZDIGI**, **BKNS**, hoặc **Viettel IDC**.
- **Gói đề xuất**: Gói Cloud VPS rẻ nhất (1 CPU Core, 1GB hoặc 2GB RAM, 20GB SSD). Hệ điều hành: **Ubuntu 22.04 LTS** hoặc **Ubuntu 24.04 LTS**.
- **Chi phí**: Khoảng **79.000đ - 120.000đ / tháng** (~1 triệu đồng/năm).
- **Ưu điểm**:
  - Máy chủ đặt tại Hà Nội / TP.HCM, ping cực thấp (< 5ms), tốc độ mở trang siêu nhanh.
  - Lưu trữ trực tiếp file `.IGS`, cơ sở dữ liệu dự án trên ổ cứng SSD tốc độ cao.
  - Chạy cả Web giao diện lẫn Backend API trên cùng 1 tên miền `https://xepphoianbinh.com`.

####  Phương Án 2: Sử Dụng Nền Tảng Đám Mây Tự Động (Render.com / Railway.app)
- **Cơ chế**: Kết nối với tài khoản GitHub, hệ thống tự động tải code và chạy `server.js` 24/7.
- **Chi phí**: Miễn phí hoặc $5/tháng (~125.000đ/tháng).
- **Ưu điểm**: Quản lý bằng giao diện web bấm chuột, không cần biết gõ lệnh Linux.

---

### BƯỚC 3: CẤU HÌNH TRỎ TÊN MIỀN (DNS) VỀ MÁY CHỦ

Sau khi mua VPS, bạn sẽ nhận được một **địa chỉ IP máy chủ** (Ví dụ: `103.179.188.50`).

1. Đăng nhập vào trang quản trị tên miền (nơi bạn mua tên miền).
2. Vào mục **Quản lý DNS (DNS Management)** và thêm 2 bản ghi sau:

| Loại bản ghi (Type) | Tên host (Host/Name) | Giá trị (Value/Points to) | TTL |
| :--- | :--- | :--- | :--- |
| **A** | `@` (hoặc để trống) | `Địa chỉ IP của VPS` (Ví dụ `103.179.188.50`) | Mặc định (hoặc 300) |
| **A** (hoặc CNAME) | `www` | `Địa chỉ IP của VPS` (hoặc CNAME trỏ về `@`) | Mặc định (hoặc 300) |

*(Đợi khoảng 5 - 15 phút để tên miền nhận IP máy chủ)*.

---

### BƯỚC 4: CÀI ĐẶT MÁY CHỦ VPS CHẠY 24/7 (CHỈ CẦN LÀM 1 LẦN)

Kết nối vào VPS qua SSH (dùng phần mềm **PuTTY** hoặc cửa sổ **PowerShell/Terminal** trên máy tính):
```bash
ssh root@103.179.188.50
```

Thực hiện lần lượt các lệnh sau:

#### 1. Cập nhật hệ thống & Cài đặt Node.js, Git, Nginx:
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git nginx

# Cài đặt Node.js phiên bản 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Cài đặt công cụ quản lý tiến trình tự động PM2
sudo npm install -g pm2
```

#### 2. Đưa mã nguồn phần mềm lên máy chủ:
Tạo thư mục chứa ứng dụng:
```bash
sudo mkdir -p /var/www/toiuu-phoi
sudo chown -R $USER:$USER /var/www/toiuu-phoi
cd /var/www/toiuu-phoi
```
*(Bạn có thể dùng Git clone hoặc dùng phần mềm WinSCP/FileZilla để tải toàn bộ các file trong thư mục `toiuu-phoi` lên `/var/www/toiuu-phoi`)*.

#### 3. Chạy Server ngầm 24/7 với PM2:
```bash
cd /var/www/toiuu-phoi
pm2 start ecosystem.config.js
pm2 startup
pm2 save
```
*(Lệnh này đảm bảo máy chủ Node.js tự động khởi động lại mỗi khi khởi động lại VPS, không bao giờ bị tắt)*.

#### 4. Cấu hình Nginx & Cấp chứng chỉ bảo mật SSL (HTTPS) miễn phí:
Tạo file cấu hình web:
```bash
sudo nano /etc/nginx/sites-available/toiuu-anbinh
```
Dán nội dung từ file `nginx-toiuu-phoi.conf` vào (thay `xepphoianbinh.com` bằng tên miền thật của bạn). Lưu lại (`Ctrl + O`, `Enter`, `Ctrl + X`).

Kích hoạt cấu hình:
```bash
sudo ln -s /etc/nginx/sites-available/toiuu-anbinh /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

Cài chứng chỉ bảo mật HTTPS (ổ khóa xanh) miễn phí trọn đời bằng Certbot:
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d xepphoianbinh.com -d www.xepphoianbinh.com
```
*(Certbot sẽ tự động gia hạn chứng chỉ SSL mỗi 3 tháng hoàn toàn miễn phí)*.

---

### BƯỚC 5: CẬP NHẬT SCRIPT FUSION 360 CỦA AN BÌNH

Sau khi website đã chạy trên tên miền mới (ví dụ: `https://xepphoianbinh.com`):

1. Mở file script `Xuat_IGS_Va_Toi_Uu_Phoi.py` (hoặc file cấu hình `workshop_config.json`).
2. Tìm dòng khai báo địa chỉ máy chủ và thay bằng tên miền chính thức của xưởng:
   ```python
   # Địa chỉ máy chủ Cloud trung tâm của Cơ Khí An Bình
   CUSTOM_CLOUD_URL = "https://xepphoianbinh.com"
   ```
3. Chạy script đồng bộ:
   ```bash
   python sync_all.py
   ```

---

### KẾT QUẢ ĐẠT ĐƯỢC

 Giờ đây, Cơ Khí An Bình đã sở hữu **Hệ thống Web App công nghiệp hoàn chỉnh 100%**:
- Tên miền riêng thương hiệu: `https://xepphoianbinh.com` (có ổ khóa bảo mật HTTPS màu xanh).
- Máy chủ hoạt động 24/7/365, không còn lo tắt máy tính hay đứt cáp nội bộ.
- Bất kỳ máy tính nào chạy Fusion 360 ở nhà hay ở công ty đều đồng bộ dữ liệu về chung một nơi.
- Các thợ cơ khí cầm điện thoại quét mã QR hoặc mở web trên máy tính bảng là xem ngay sơ đồ cắt mòi, chiều dài phôi và tải file `.IGS` gia công chuẩn xác!
