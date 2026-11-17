# PHẦN MỀM TỐI ƯU XẾP PHÔI VÀ BÓC TÁCH FILE .IGS MÁY CẮT ỐNG - AN BÌNH

Ứng dụng web chuyên dụng cho xưởng cơ khí, chế tạo khung thép hộp - thép ống, gia công cắt laser CNC. Chạy 100% offline trên trình duyệt, không cần cài đặt phần mềm phức tạp, hỗ trợ kết nối trực tiếp với Autodesk Fusion 360 và file `.igs` của máy cắt ống laser CNC.

---

## 🚀 1. Cách Mở Ứng Dụng Nhanh

- **Cách 1 (Nhấp đúp chuột):** Mở thư mục `C:\Users\Administrator\toiuu-phoi\` hoặc `C:\Users\Administrator\Fusion360\toiuu-phoi\` và nhấp đúp vào file **`mo_ung_dung.bat`** hoặc **`index.html`**.
- **Cách 2 (Trình duyệt):** Dán link sau vào Chrome, Edge hoặc Cốc Cốc:
  `file:///C:/Users/Administrator/toiuu-phoi/index.html`

---

## ✨ 2. Các Tính Năng Đột Phá Mới

### 🧠 2.1. Nhận Diện Tự Động Quy Cách Kèm Độ Dày & Giữ Nguyên Số Thập Phân
- Khi nhập liệu nhanh tại ô **Tên chi tiết**, bạn chỉ cần gõ (hoặc dán):
  `Hộp 25x25x1 L728.5`
- Hệ thống sẽ tự động:
  - Nhận diện đúng loại hộp: **`Hộp 25x25x1`** (giữ nguyên độ dày `x1`, `x1.2`, `x1.4`, `x2.0`...).
  - Tự điền chiều dài: **`728,5`** mm (**giữ nguyên số thập phân**, tuyệt đối không làm tròn thành 729).
  - Tự gán bề rộng mặt hộp: **`25`** mm.
  - Tự động lưu quy cách `Hộp 25x25x1` vào **Bộ nhớ quy cách hộp** của trình duyệt.

---

### ⚙️ 2.2. Hướng 1: Bóc Tách Tự Động & Xuất File .IGS Từ Autodesk Fusion 360
1. Mở bản vẽ khung thiết kế bất kỳ trong **Autodesk Fusion 360**.
2. Nhấn tổ hợp phím **`Shift + S`** (hoặc vào menu `UTILITIES` ➔ `ADD-INS` ➔ `Scripts and Add-Ins`).
3. Chọn script **`Xuat_IGS_Va_Toi_Uu_Phoi`** trong mục *My Scripts* và bấm **Run**.
4. Script sẽ tự động:
   - Quét toàn bộ khung thép ống/hộp trong bản vẽ (tự động bỏ qua tấm tôn, mặt bàn mỏng).
   - Tự nhận diện kích thước cạnh, chiều dài thực, độ dày vật liệu và góc vát mòi $45^\circ$ (`thẳng`, `ke 1 đầu`, `ke 2 đầu`).
   - Xuất từng thanh chi tiết ra file **`.igs`** vào thư mục:
     `C:\Users\Administrator\Fusion360\export_igs\<Tên_bản_vẽ>\`
     để sẵn sàng nạp vào máy cắt laser ống.
   - Tự động mở ứng dụng Tối Ưu Phôi An Bình trên trình duyệt và điền sẵn danh sách chi tiết bóc tách.

---

### 📁 2.3. Hướng 2: Đọc Trực Tiếp File .IGS Trên Web App
1. Trên giao diện Web, bấm nút **`📁 Nhập file .IGS (Máy cắt ống)`**.
2. Kéo thả 1 hoặc nhiều file `.igs` (từ thư mục máy tính hoặc từ máy cắt ống) vào khung tải file.
3. Bộ phân tích 3D IGES tự động trích xuất:
   - Chiều rộng $W$, chiều cao $H$, chiều dài $L$ dọc trục chính.
   - Kiểm tra độ chênh lệch mặt đầu để nhận diện vát mòi $45^\circ$ (`ke1`, `ke`, `thẳng`).
   - Tự động gom nhóm các thanh giống nhau và cộng dồn số lượng ($SL$).
   - Nhận diện độ dày từ tên file hoặc cấu trúc 3D.
4. Bấm **`Đưa vào bảng tính`**, hệ thống sẽ tự động tạo các quy cách hộp tương ứng và tính toán phương án cắt xếp phôi tối ưu nhất.

---

### 🌐 2.4. Hướng Dẫn Sử Dụng Trên Máy Khác & Điện Thoại Di Động

#### Cách A: Dùng Offline Qua USB hoặc Mạng Nội Bộ (LAN)
- Sao chép toàn bộ thư mục `toiuu-phoi` hoặc file nén `toiuu-phoi-an-binh.zip` sang máy khác.
- Giải nén và mở file `index.html` bằng trình duyệt (không cần kết nối Internet).

#### Cách B: Đưa Lên Website Online Miễn Phí (Netlify Drop)
1. Truy cập trang web: **`https://app.netlify.com/drop`**
2. Kéo thả file nén **`toiuu-phoi-an-binh.zip`** (tại `C:\Users\Administrator\Fusion360\toiuu-phoi-an-binh.zip`) vào khung tròn trên trang web.
3. Sau 3 giây, Netlify sẽ cấp cho bạn một đường link website chính thức (ví dụ: `https://anbinh-toiuu.netlify.app`).
4. Bạn có thể mở link này trên **bất kỳ máy tính, máy tính bảng hoặc điện thoại di động** ở bất cứ đâu để sử dụng.
5. Dữ liệu bộ nhớ quy cách hộp sẽ được lưu cục bộ trên trình duyệt của từng thiết bị.

---

*Bản quyền phát triển: Cơ khí An Bình & Trợ lý Kỹ thuật AI Antigravity.*
